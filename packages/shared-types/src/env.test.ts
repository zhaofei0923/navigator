import { describe, expect, test } from "vitest";

import {
  EnvValidationError,
  validateEnv,
  validateWebEnv,
} from "./env.js";

const validEnv = {
  NODE_ENV: "development",
  APP_BASE_URL: "http://localhost:3000",
  LOG_LEVEL: "info",
  DATABASE_URL: "postgresql://user:password@localhost:5432/navigator",
  SHADOW_DATABASE_URL: "postgresql://user:password@localhost:5432/shadow",
  PGVECTOR_DIMENSION: "1536",
  AUTH_JWT_SECRET: "local-jwt-secret",
  AUTH_JWT_EXPIRES_IN: "2h",
  AUTH_SESSION_COOKIE_NAME: "navigator_session",
  LEAD_ENCRYPTION_KEY: "local-lead-key",
  AI_PROVIDER: "openai",
  AI_API_KEY: "local-ai-key",
  AI_CHAT_MODEL: "chat-model",
  AI_EMBEDDING_MODEL: "embedding-model",
  AI_RATE_LIMIT_PER_MIN: "20",
  NEXT_PUBLIC_API_BASE_URL: "http://localhost:3000/api/v1",
  NEXT_PUBLIC_MAP_TOKEN: "public-map-token",
  NEXT_PUBLIC_DEFAULT_LOCALE: "zh-CN",
  TARO_APP_API_BASE_URL: "http://localhost:3000/api/v1",
} satisfies Record<string, string | undefined>;

describe("validateEnv", () => {
  test("returns typed config for a valid environment", () => {
    expect(validateEnv(validEnv)).toMatchObject({
      nodeEnv: "development",
      appBaseUrl: "http://localhost:3000",
      pgvectorDimension: 1536,
      aiRateLimitPerMin: 20,
      nextPublicDefaultLocale: "zh-CN",
    });
  });

  test("fails fast with missing required variable names only", () => {
    const env = { ...validEnv, DATABASE_URL: "", AI_API_KEY: undefined };

    expect(() => validateEnv(env)).toThrow(EnvValidationError);

    try {
      validateEnv(env);
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      const validationError = error as EnvValidationError;
      expect(validationError.variables).toEqual(["AI_API_KEY", "DATABASE_URL"]);
      expect(validationError.message).not.toContain("local-ai-key");
      expect(validationError.message).not.toContain("postgresql://");
    }
  });

  test("rejects invalid NODE_ENV", () => {
    expect(() =>
      validateEnv({ ...validEnv, NODE_ENV: "staging" }),
    ).toThrowError(/NODE_ENV/);
  });

  test("rejects invalid PGVECTOR_DIMENSION", () => {
    expect(() =>
      validateEnv({ ...validEnv, PGVECTOR_DIMENSION: "0" }),
    ).toThrowError(/PGVECTOR_DIMENSION/);
  });

  test("rejects leaked server-only secrets under public prefixes", () => {
    expect(() =>
      validateEnv({
        ...validEnv,
        NEXT_PUBLIC_AI_API_KEY: "leaked-key",
        TARO_APP_AUTH_JWT_SECRET: "leaked-secret",
      }),
    ).toThrowError(/NEXT_PUBLIC_AI_API_KEY/);
  });
});

describe("validateWebEnv", () => {
  test("returns only the Web server configuration", () => {
    expect(
      validateWebEnv({
        NODE_ENV: "development",
        API_INTERNAL_BASE_URL: "http://127.0.0.1:3100/api/v1",
      }),
    ).toEqual({
      nodeEnv: "development",
      apiInternalBaseUrl: "http://127.0.0.1:3100/api/v1",
    });
  });

  test.each([
    "https://api.internal.example/api/v1",
    "http://127.0.0.1:3100/api/v1",
    "http://[::1]:3100/api/v1",
  ])("accepts a production-safe internal API URL: %s", (baseUrl) => {
    expect(
      validateWebEnv({
        NODE_ENV: "production",
        API_INTERNAL_BASE_URL: baseUrl,
      }).apiInternalBaseUrl,
    ).toBe(baseUrl);
  });

  test.each([
    ["development", undefined],
    ["development", "ftp://127.0.0.1:3100/api/v1"],
    ["development", "http://user:secret@127.0.0.1:3100/api/v1"],
    ["development", "http://@127.0.0.1:3100/api/v1"],
    ["development", "http://127.0.0.1:3100/api/v1?target=evil"],
    ["development", "http://127.0.0.1:3100/api/v1?"],
    ["development", "http://127.0.0.1:3100/api/v1#fragment"],
    ["development", "http://127.0.0.1:3100/api/v1#"],
    ["production", "http://api.internal.example/api/v1"],
    ["production", "http://localhost:3100/api/v1"],
    ["production", "http://127.1:3100/api/v1"],
    ["production", "http://127.0.0.1.example/api/v1"],
  ])("rejects an unsafe %s internal API URL", (nodeEnv, baseUrl) => {
    const secret = baseUrl ?? "missing-secret-value";
    expect(() =>
      validateWebEnv({
        NODE_ENV: nodeEnv,
        API_INTERNAL_BASE_URL: baseUrl,
      }),
    ).toThrowError(/API_INTERNAL_BASE_URL/);
    expect(() =>
      validateWebEnv({
        NODE_ENV: nodeEnv,
        API_INTERNAL_BASE_URL: baseUrl,
      }),
    ).not.toThrowError(secret);
  });

  test("reads no database, authentication, lead, or AI variables", () => {
    const environment = new Proxy(
      {
        NODE_ENV: "development",
        API_INTERNAL_BASE_URL: "http://127.0.0.1:3100/api/v1",
      },
      {
        get(target, property, receiver) {
          if (
            typeof property === "string" &&
            !["NODE_ENV", "API_INTERNAL_BASE_URL"].includes(property)
          ) {
            throw new Error(`UNRELATED_ENV_READ:${property}`);
          }
          return Reflect.get(target, property, receiver);
        },
      },
    );

    expect(validateWebEnv(environment)).toEqual({
      nodeEnv: "development",
      apiInternalBaseUrl: "http://127.0.0.1:3100/api/v1",
    });
  });
});
