import { describe, expect, test } from "vitest";

import { validateApiEnv } from "./api-config.js";

describe("validateApiEnv", () => {
  test.each(["database", "canonical"] as const)(
    "uses the fixed metrics port default for %s source",
    (source) => {
      const environment =
        source === "canonical"
          ? {
              API_PORT: "3100",
              COUNTRY_READ_SOURCE: source,
              CANONICAL_REPOSITORY_ROOT: "/srv/navigator",
            }
          : {
              API_PORT: "3100",
              COUNTRY_READ_SOURCE: source,
              DATABASE_URL:
                "postgresql://navigator:secret@127.0.0.1:5432/navigator",
            };

      expect(validateApiEnv(environment)).toMatchObject({ metricsPort: 9464 });
    },
  );

  test.each([
    ["1024", 1024],
    ["65535", 65535],
  ] as const)("accepts inclusive METRICS_PORT boundary %s", (value, expected) => {
    expect(
      validateApiEnv({
        API_PORT: "3100",
        METRICS_PORT: value,
        DATABASE_URL:
          "postgresql://navigator:secret@127.0.0.1:5432/navigator",
      }),
    ).toMatchObject({ metricsPort: expected });
  });

  test.each(["1023", "65536", "1.5", "NaN", "Infinity", "", "   "])(
    "rejects invalid METRICS_PORT %p by variable name",
    (value) => {
      const error = captureError(() =>
        validateApiEnv({
          API_PORT: "3100",
          METRICS_PORT: value,
          DATABASE_URL:
            "postgresql://navigator:secret@127.0.0.1:5432/navigator",
        }),
      );

      expect(error.message).toBe("METRICS_PORT");
      if (value.trim() !== "") expect(error.message).not.toContain(value);
    },
  );

  test("uses the database runtime by default and ignores a canonical root", () => {
    expect(
      validateApiEnv({
        API_PORT: "3100",
        DATABASE_URL: "postgresql://navigator:secret@127.0.0.1:5432/navigator",
        CANONICAL_REPOSITORY_ROOT: "relative-root-is-ignored",
      }),
    ).toEqual({
      port: 3100,
      metricsPort: 9464,
      countryReadSource: "database",
      readCacheTtlSeconds: 60,
      readCacheStaleIfErrorSeconds: 300,
      readCacheMaxEntries: 1000,
      healthReadyTimeoutMs: 1000,
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
      metricsPort: 9464,
      countryReadSource: "database",
      readCacheTtlSeconds: 60,
      readCacheStaleIfErrorSeconds: 300,
      readCacheMaxEntries: 1000,
      healthReadyTimeoutMs: 1000,
      databaseUrl,
      databasePoolMax: 50,
      databasePoolTimeoutSeconds: 30,
      databaseConnectTimeoutSeconds: 1,
    });
    expect(environment.DATABASE_URL).toBe(databaseUrl);
    expect(Object.isFrozen(config)).toBe(true);
  });

  test("parses inclusive read cache boundaries for database source", () => {
    expect(
      validateApiEnv({
        API_PORT: "3100",
        DATABASE_URL:
          "postgresql://navigator:secret@127.0.0.1:5432/navigator",
        READ_CACHE_TTL_SECONDS: "1",
        READ_CACHE_STALE_IF_ERROR_SECONDS: "0",
        READ_CACHE_MAX_ENTRIES: "10",
      }),
    ).toMatchObject({
      readCacheTtlSeconds: 1,
      readCacheStaleIfErrorSeconds: 0,
      readCacheMaxEntries: 10,
    });

    expect(
      validateApiEnv({
        API_PORT: "3100",
        DATABASE_URL:
          "postgresql://navigator:secret@127.0.0.1:5432/navigator",
        READ_CACHE_TTL_SECONDS: "300",
        READ_CACHE_STALE_IF_ERROR_SECONDS: "600",
        READ_CACHE_MAX_ENTRIES: "10000",
      }),
    ).toMatchObject({
      readCacheTtlSeconds: 300,
      readCacheStaleIfErrorSeconds: 600,
      readCacheMaxEntries: 10000,
    });
  });

  test.each([
    ["database", "100", 100],
    ["database", "5000", 5000],
    ["canonical", "100", 100],
    ["canonical", "5000", 5000],
  ] as const)(
    "parses inclusive health timeout %s source boundary %s",
    (source, value, expected) => {
      const common = {
        API_PORT: "3100",
        COUNTRY_READ_SOURCE: source,
        HEALTH_READY_TIMEOUT_MS: value,
      };
      const environment = source === "canonical"
        ? { ...common, CANONICAL_REPOSITORY_ROOT: "/srv/navigator" }
        : {
            ...common,
            DATABASE_URL:
              "postgresql://navigator:secret@127.0.0.1:5432/navigator",
          };

      const config = validateApiEnv(environment);

      expect(config).toMatchObject({ healthReadyTimeoutMs: expected });
      expect(Object.isFrozen(config)).toBe(true);
    },
  );

  test.each([
    ["READ_CACHE_TTL_SECONDS", "0"],
    ["READ_CACHE_TTL_SECONDS", "301"],
    ["READ_CACHE_TTL_SECONDS", "1.5"],
    ["READ_CACHE_TTL_SECONDS", "NaN"],
    ["READ_CACHE_TTL_SECONDS", "Infinity"],
    ["READ_CACHE_TTL_SECONDS", ""],
    ["READ_CACHE_TTL_SECONDS", "   "],
    ["READ_CACHE_STALE_IF_ERROR_SECONDS", "-1"],
    ["READ_CACHE_STALE_IF_ERROR_SECONDS", "601"],
    ["READ_CACHE_STALE_IF_ERROR_SECONDS", "0.5"],
    ["READ_CACHE_STALE_IF_ERROR_SECONDS", "NaN"],
    ["READ_CACHE_STALE_IF_ERROR_SECONDS", "Infinity"],
    ["READ_CACHE_STALE_IF_ERROR_SECONDS", ""],
    ["READ_CACHE_STALE_IF_ERROR_SECONDS", "   "],
    ["READ_CACHE_MAX_ENTRIES", "9"],
    ["READ_CACHE_MAX_ENTRIES", "10001"],
    ["READ_CACHE_MAX_ENTRIES", "10.5"],
    ["READ_CACHE_MAX_ENTRIES", "NaN"],
    ["READ_CACHE_MAX_ENTRIES", "Infinity"],
    ["READ_CACHE_MAX_ENTRIES", ""],
    ["READ_CACHE_MAX_ENTRIES", "   "],
    ["HEALTH_READY_TIMEOUT_MS", "99"],
    ["HEALTH_READY_TIMEOUT_MS", "5001"],
    ["HEALTH_READY_TIMEOUT_MS", "100.5"],
    ["HEALTH_READY_TIMEOUT_MS", "NaN"],
    ["HEALTH_READY_TIMEOUT_MS", "Infinity"],
    ["HEALTH_READY_TIMEOUT_MS", ""],
    ["HEALTH_READY_TIMEOUT_MS", "   "],
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
    if (value.trim() !== "") expect(error.message).not.toContain(value);
    expect(error.message).not.toContain("secret");
    expect("cause" in error).toBe(false);
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
      metricsPort: 9464,
      countryReadSource: "canonical",
      readCacheTtlSeconds: 60,
      readCacheStaleIfErrorSeconds: 300,
      readCacheMaxEntries: 1000,
      healthReadyTimeoutMs: 1000,
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
      metricsPort: 9464,
      countryReadSource: "canonical",
      readCacheTtlSeconds: 60,
      readCacheStaleIfErrorSeconds: 300,
      readCacheMaxEntries: 1000,
      healthReadyTimeoutMs: 1000,
      canonicalRepositoryRoot: "/srv/navigator",
    });
  });

  test("reads read cache overrides for canonical source", () => {
    const config = validateApiEnv({
      API_PORT: "3100",
      COUNTRY_READ_SOURCE: "canonical",
      CANONICAL_REPOSITORY_ROOT: "/srv/navigator",
      READ_CACHE_TTL_SECONDS: "300",
      READ_CACHE_STALE_IF_ERROR_SECONDS: "0",
      READ_CACHE_MAX_ENTRIES: "10000",
      HEALTH_READY_TIMEOUT_MS: "4321",
    });

    expect(config).toMatchObject({
      readCacheTtlSeconds: 300,
      readCacheStaleIfErrorSeconds: 0,
      readCacheMaxEntries: 10000,
      healthReadyTimeoutMs: 4321,
    });
    expect(Object.isFrozen(config)).toBe(true);
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
              "METRICS_PORT",
              "COUNTRY_READ_SOURCE",
              "DATABASE_URL",
              "DATABASE_POOL_MAX",
              "DATABASE_POOL_TIMEOUT_SECONDS",
              "DATABASE_CONNECT_TIMEOUT_SECONDS",
              "READ_CACHE_TTL_SECONDS",
              "READ_CACHE_STALE_IF_ERROR_SECONDS",
              "READ_CACHE_MAX_ENTRIES",
              "HEALTH_READY_TIMEOUT_MS",
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
