import { describe, expect, test } from "vitest";

import { EnvValidationError, validateEnv } from "./env.js";

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
