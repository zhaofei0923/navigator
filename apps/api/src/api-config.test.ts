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
    });
  });

  test("requires only a normalized absolute root for canonical source", () => {
    expect(
      validateApiEnv({
        API_PORT: "3100",
        COUNTRY_READ_SOURCE: "canonical",
        CANONICAL_REPOSITORY_ROOT: "/srv/navigator",
      }),
    ).toEqual({
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
