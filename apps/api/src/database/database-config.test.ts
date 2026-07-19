import { describe, expect, test } from "vitest";

import {
  buildDatabaseRuntimeConfig,
  type DatabaseRuntimeConfigInput,
} from "./database-config.js";

const RAW_DATABASE_URL =
  "postgresql://navigator:private@db.internal:5432/navigator?schema=tenant&sslmode=require&options=first&options=second";

describe("buildDatabaseRuntimeConfig", () => {
  test("adds the fixed managed Prisma parameters and preserves unrelated query parameters", () => {
    const input = Object.freeze({
      databaseUrl: RAW_DATABASE_URL,
      poolMax: 10,
      poolTimeoutSeconds: 5,
      connectTimeoutSeconds: 5,
    });
    const originalInput = { ...input };

    const result = buildDatabaseRuntimeConfig(input);
    const managedUrl = new URL(result.databaseUrl);

    expect(input).toEqual(originalInput);
    expect(Object.isFrozen(result)).toBe(true);
    expect(managedUrl.protocol).toBe("postgresql:");
    expect(managedUrl.username).toBe("navigator");
    expect(managedUrl.password).toBe("private");
    expect(managedUrl.hostname).toBe("db.internal");
    expect(managedUrl.pathname).toBe("/navigator");
    expect(managedUrl.searchParams.get("connection_limit")).toBe("10");
    expect(managedUrl.searchParams.get("pool_timeout")).toBe("5");
    expect(managedUrl.searchParams.get("connect_timeout")).toBe("5");
    expect(managedUrl.searchParams.get("application_name")).toBe(
      "navigator-api",
    );
    expect(managedUrl.searchParams.get("schema")).toBe("tenant");
    expect(managedUrl.searchParams.get("sslmode")).toBe("require");
    expect(managedUrl.searchParams.getAll("options")).toEqual([
      "first",
      "second",
    ]);
  });

  test.each(["postgresql", "postgres"] as const)(
    "preserves the supported %s scheme while adding the same managed parameters",
    (scheme) => {
      const result = buildDatabaseRuntimeConfig({
        databaseUrl:
          `${scheme}://navigator:private@db.internal:5432/navigator?schema=tenant`,
        poolMax: 10,
        poolTimeoutSeconds: 5,
        connectTimeoutSeconds: 5,
      });
      const managedUrl = new URL(result.databaseUrl);

      expect(managedUrl.protocol).toBe(`${scheme}:`);
      expect(managedUrl.searchParams.get("schema")).toBe("tenant");
      expect(managedUrl.searchParams.get("connection_limit")).toBe("10");
      expect(managedUrl.searchParams.get("pool_timeout")).toBe("5");
      expect(managedUrl.searchParams.get("connect_timeout")).toBe("5");
      expect(managedUrl.searchParams.get("application_name")).toBe(
        "navigator-api",
      );
    },
  );

  test.each([
    ["leading space", ` ${RAW_DATABASE_URL}`],
    ["trailing space", `${RAW_DATABASE_URL} `],
    [
      "username TAB",
      "postgresql://navi\tgator:private@db.internal/navigator",
    ],
    [
      "host LF",
      "postgresql://navigator:private@db.in\nternal/navigator",
    ],
    [
      "path CR",
      "postgresql://navigator:private@db.internal/navi\rgator",
    ],
  ])("rejects raw URL whitespace in %s before parsing", (_label, databaseUrl) => {
    expectDatabaseUrlError(databaseUrl);
  });

  test.each(
    [...Array.from({ length: 33 }, (_, codePoint) => codePoint), 127].map(
      (codePoint) => [
        codePoint.toString(16).toUpperCase().padStart(4, "0"),
        codePoint,
      ] as const,
    ),
  )(
    "rejects raw URL control code point U+%s before parsing",
    (_label, codePoint) => {
      const character = String.fromCodePoint(codePoint);
      expectDatabaseUrlError(
        `postgresql://navigator:private@db.internal/navigator?marker=left${character}right`,
      );
    },
  );

  test("allows percent-encoded whitespace and control octets", () => {
    const result = buildDatabaseRuntimeConfig({
      databaseUrl:
        "postgresql://navigator:private@db.internal/navigator?marker=%20%09%0A%0D%00%7F",
      poolMax: 10,
      poolTimeoutSeconds: 5,
      connectTimeoutSeconds: 5,
    });

    expect(new URL(result.databaseUrl).searchParams.get("marker")).toBe(
      " \t\n\r\0\u007f",
    );
  });

  test.each([
    [1, 1, 1],
    [50, 30, 30],
  ] as const)(
    "accepts inclusive pool boundaries max=%i pool-timeout=%i connect-timeout=%i",
    (poolMax, poolTimeoutSeconds, connectTimeoutSeconds) => {
      const result = buildDatabaseRuntimeConfig({
        databaseUrl: RAW_DATABASE_URL,
        poolMax,
        poolTimeoutSeconds,
        connectTimeoutSeconds,
      });
      const managedUrl = new URL(result.databaseUrl);

      expect(managedUrl.searchParams.get("connection_limit")).toBe(
        String(poolMax),
      );
      expect(managedUrl.searchParams.get("pool_timeout")).toBe(
        String(poolTimeoutSeconds),
      );
      expect(managedUrl.searchParams.get("connect_timeout")).toBe(
        String(connectTimeoutSeconds),
      );
    },
  );

  test.each([
    ["connection_limit", "10"],
    ["pool_timeout", "5"],
    ["connect_timeout", "5"],
    ["application_name", "navigator-api"],
  ])("rejects a preexisting managed %s parameter by name", (parameterName, value) => {
    const databaseUrl = `${RAW_DATABASE_URL}&${parameterName}=${value}`;

    const error = captureError(() =>
      buildDatabaseRuntimeConfig({
        databaseUrl,
        poolMax: 10,
        poolTimeoutSeconds: 5,
        connectTimeoutSeconds: 5,
      }),
    );

    expect(error.message).toBe(
      `DATABASE_URL_MANAGED_PARAMETER:${parameterName}`,
    );
    expect(error.message).not.toContain(databaseUrl);
    expect(error.message).not.toContain("private");
    expect("cause" in error).toBe(false);
  });

  test.each([
    "mysql://navigator:private@db.internal/navigator",
    "postgresql://:private@db.internal/navigator",
    "postgresql://navigator@db.internal/navigator",
    "postgresql:///navigator",
    "postgresql://navigator:private@db.internal",
    "postgresql://navigator:private@db.internal/",
    "postgresql://navigator:private@db.internal/navigator/extra",
    "postgresql://navigator:private@db.internal/navigator#private-fragment",
    "not-a-url",
  ])("rejects an invalid PostgreSQL URL without retaining it: %s", (databaseUrl) => {
    const error = captureError(() =>
      buildDatabaseRuntimeConfig({
        databaseUrl,
        poolMax: 10,
        poolTimeoutSeconds: 5,
        connectTimeoutSeconds: 5,
      }),
    );

    expect(error.message).toBe("DATABASE_URL");
    expect(error.message).not.toContain(databaseUrl);
    expect("cause" in error).toBe(false);
  });

  test.each([
    ["poolMax", 0, "DATABASE_POOL_MAX"],
    ["poolMax", 51, "DATABASE_POOL_MAX"],
    ["poolMax", 1.5, "DATABASE_POOL_MAX"],
    ["poolMax", Number.NaN, "DATABASE_POOL_MAX"],
    ["poolMax", Number.POSITIVE_INFINITY, "DATABASE_POOL_MAX"],
    ["poolTimeoutSeconds", 0, "DATABASE_POOL_TIMEOUT_SECONDS"],
    ["poolTimeoutSeconds", 31, "DATABASE_POOL_TIMEOUT_SECONDS"],
    ["poolTimeoutSeconds", 1.5, "DATABASE_POOL_TIMEOUT_SECONDS"],
    ["poolTimeoutSeconds", Number.NaN, "DATABASE_POOL_TIMEOUT_SECONDS"],
    [
      "poolTimeoutSeconds",
      Number.POSITIVE_INFINITY,
      "DATABASE_POOL_TIMEOUT_SECONDS",
    ],
    ["connectTimeoutSeconds", 0, "DATABASE_CONNECT_TIMEOUT_SECONDS"],
    ["connectTimeoutSeconds", 31, "DATABASE_CONNECT_TIMEOUT_SECONDS"],
    ["connectTimeoutSeconds", 1.5, "DATABASE_CONNECT_TIMEOUT_SECONDS"],
    ["connectTimeoutSeconds", Number.NaN, "DATABASE_CONNECT_TIMEOUT_SECONDS"],
    [
      "connectTimeoutSeconds",
      Number.POSITIVE_INFINITY,
      "DATABASE_CONNECT_TIMEOUT_SECONDS",
    ],
  ] as const)("rejects invalid %s=%s", (field, value, expectedCode) => {
    const input: DatabaseRuntimeConfigInput = {
      databaseUrl: RAW_DATABASE_URL,
      poolMax: 10,
      poolTimeoutSeconds: 5,
      connectTimeoutSeconds: 5,
      [field]: value,
    };

    const error = captureError(() => buildDatabaseRuntimeConfig(input));

    expect(error.message).toBe(expectedCode);
    expect(error.message).not.toContain(RAW_DATABASE_URL);
    expect("cause" in error).toBe(false);
  });
});

function captureError(operation: () => unknown): Error {
  try {
    operation();
  } catch (error) {
    if (error instanceof Error) return error;
  }
  throw new Error("Expected operation to throw Error");
}

function expectDatabaseUrlError(databaseUrl: string): void {
  const error = captureError(() =>
    buildDatabaseRuntimeConfig({
      databaseUrl,
      poolMax: 10,
      poolTimeoutSeconds: 5,
      connectTimeoutSeconds: 5,
    }),
  );

  expect(error.message).toBe("DATABASE_URL");
  expect(error.message).not.toContain(databaseUrl);
  expect("cause" in error).toBe(false);
}
