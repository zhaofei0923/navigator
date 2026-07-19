import { describe, expect, test } from "vitest";

import { validateApiEnv } from "./api-config.js";

describe("validateApiEnv", () => {
  test("uses the database runtime by default and ignores a canonical root", () => {
    expect(
      validateApiEnv({
        API_PORT: "3100",
        DATABASE_URL: "postgresql://navigator:secret@127.0.0.1:5432/navigator",
        CANONICAL_REPOSITORY_ROOT: "relative-root-is-ignored",
      }),
    ).toEqual({
      port: 3100,
      countryReadSource: "database",
      databaseUrl: "postgresql://navigator:secret@127.0.0.1:5432/navigator",
      databasePoolMax: 10,
      databasePoolTimeoutSeconds: 5,
      databaseConnectTimeoutSeconds: 5,
    });
  });

  test("parses bounded database pool overrides without changing the raw URL", () => {
    const databaseUrl =
      "postgresql://navigator:secret@127.0.0.1:5432/navigator";
    const environment = Object.freeze({
      API_PORT: "3100",
      DATABASE_URL: databaseUrl,
      DATABASE_POOL_MAX: "50",
      DATABASE_POOL_TIMEOUT_SECONDS: "30",
      DATABASE_CONNECT_TIMEOUT_SECONDS: "1",
    });

    const config = validateApiEnv(environment);

    expect(config).toEqual({
      port: 3100,
      countryReadSource: "database",
      databaseUrl,
      databasePoolMax: 50,
      databasePoolTimeoutSeconds: 30,
      databaseConnectTimeoutSeconds: 1,
    });
    expect(environment.DATABASE_URL).toBe(databaseUrl);
    expect(Object.isFrozen(config)).toBe(true);
  });

  test.each([
    ["DATABASE_POOL_MAX", "0"],
    ["DATABASE_POOL_MAX", "51"],
    ["DATABASE_POOL_MAX", "1.5"],
    ["DATABASE_POOL_TIMEOUT_SECONDS", "0"],
    ["DATABASE_POOL_TIMEOUT_SECONDS", "31"],
    ["DATABASE_POOL_TIMEOUT_SECONDS", "five-private"],
    ["DATABASE_CONNECT_TIMEOUT_SECONDS", "0"],
    ["DATABASE_CONNECT_TIMEOUT_SECONDS", "31"],
    ["DATABASE_CONNECT_TIMEOUT_SECONDS", "Infinity"],
  ])("rejects invalid %s by name without echoing its value", (name, value) => {
    const error = captureError(() =>
      validateApiEnv({
        API_PORT: "3100",
        DATABASE_URL:
          "postgresql://navigator:secret@127.0.0.1:5432/navigator",
        [name]: value,
      }),
    );

    expect(error.message).toBe(name);
    expect(error.message).not.toContain(value);
    expect(error.message).not.toContain("secret");
    expect("cause" in error).toBe(false);
  });

  test("requires only a normalized absolute root for canonical source", () => {
    const config = validateApiEnv({
      API_PORT: "3100",
      COUNTRY_READ_SOURCE: "canonical",
      CANONICAL_REPOSITORY_ROOT: "/srv/navigator",
    });

    expect(config).toEqual({
      port: 3100,
      countryReadSource: "canonical",
      canonicalRepositoryRoot: "/srv/navigator",
    });
    expect(Object.isFrozen(config)).toBe(true);
  });

  test("does not read database URL or pool variables for canonical source", () => {
    const environment = new Proxy(
      {
        API_PORT: "3100",
        COUNTRY_READ_SOURCE: "canonical",
        CANONICAL_REPOSITORY_ROOT: "/srv/navigator",
      },
      {
        get(target, property, receiver) {
          if (
            typeof property === "string" &&
            property.startsWith("DATABASE_")
          ) {
            throw new Error(`DATABASE_VARIABLE_READ:${property}`);
          }
          return Reflect.get(target, property, receiver);
        },
      },
    );

    expect(validateApiEnv(environment)).toEqual({
      port: 3100,
      countryReadSource: "canonical",
      canonicalRepositoryRoot: "/srv/navigator",
    });
  });

  test("reports invalid variable names without echoing values", () => {
    const secret = "postgresql://leaked:never@db.example/navigator";

    expect(() =>
      validateApiEnv({
        API_PORT: "70000",
        COUNTRY_READ_SOURCE: "not-a-source",
        DATABASE_URL: secret,
      }),
    ).toThrow(/API_PORT.*COUNTRY_READ_SOURCE/);
    expect(() =>
      validateApiEnv({
        API_PORT: "70000",
        COUNTRY_READ_SOURCE: "not-a-source",
        DATABASE_URL: secret,
      }),
    ).not.toThrow(secret);
  });

  test("rejects a canonical root that is not normalized", () => {
    expect(() =>
      validateApiEnv({
        API_PORT: "3100",
        COUNTRY_READ_SOURCE: "canonical",
        CANONICAL_REPOSITORY_ROOT: "/srv/navigator/../other",
      }),
    ).toThrow(/CANONICAL_REPOSITORY_ROOT/);
  });

  test("reports a null byte in a canonical root by variable name", () => {
    expect(() =>
      validateApiEnv({
        API_PORT: "3100",
        COUNTRY_READ_SOURCE: "canonical",
        CANONICAL_REPOSITORY_ROOT: "/srv/navigator\0",
      }),
    ).toThrow(/CANONICAL_REPOSITORY_ROOT/);
  });

  test("does not read unrelated service secrets", () => {
    const environment = new Proxy(
      {
        API_PORT: "3100",
        DATABASE_URL: "postgresql://navigator:secret@127.0.0.1:5432/navigator",
      },
      {
        get(target, property, receiver) {
          if (
            typeof property === "string" &&
            ![
              "API_PORT",
              "COUNTRY_READ_SOURCE",
              "DATABASE_URL",
              "DATABASE_POOL_MAX",
              "DATABASE_POOL_TIMEOUT_SECONDS",
              "DATABASE_CONNECT_TIMEOUT_SECONDS",
              "CANONICAL_REPOSITORY_ROOT",
            ].includes(property)
          ) {
            throw new Error("UNRELATED_ENV_READ");
          }
          return Reflect.get(target, property, receiver);
        },
      },
    );

    expect(validateApiEnv(environment)).toMatchObject({
      countryReadSource: "database",
    });
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
