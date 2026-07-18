export type NodeEnv = "development" | "test" | "production";
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface AppEnvConfig {
  nodeEnv: NodeEnv;
  appBaseUrl: string;
  logLevel: LogLevel | undefined;
  databaseUrl: string;
  shadowDatabaseUrl: string | undefined;
  pgvectorDimension: number;
  authJwtSecret: string;
  authJwtExpiresIn: string | undefined;
  authSessionCookieName: string | undefined;
  leadEncryptionKey: string;
  aiProvider: string;
  aiApiKey: string;
  aiChatModel: string;
  aiEmbeddingModel: string;
  aiRateLimitPerMin: number | undefined;
  nextPublicApiBaseUrl: string | undefined;
  nextPublicMapToken: string | undefined;
  nextPublicDefaultLocale: "zh-CN" | undefined;
  taroAppApiBaseUrl: string | undefined;
}

export interface WebEnvConfig {
  nodeEnv: NodeEnv;
  apiInternalBaseUrl: string;
}

export class EnvValidationError extends Error {
  constructor(public readonly variables: readonly string[]) {
    super(`Invalid environment variables: ${variables.join(", ")}`);
    this.name = "EnvValidationError";
  }
}

const REQUIRED_ENV_KEYS = [
  "NODE_ENV",
  "APP_BASE_URL",
  "DATABASE_URL",
  "PGVECTOR_DIMENSION",
  "AUTH_JWT_SECRET",
  "LEAD_ENCRYPTION_KEY",
  "AI_PROVIDER",
  "AI_API_KEY",
  "AI_CHAT_MODEL",
  "AI_EMBEDDING_MODEL",
] as const;

const SERVER_ONLY_ENV_KEYS = [
  "APP_BASE_URL",
  "DATABASE_URL",
  "SHADOW_DATABASE_URL",
  "PGVECTOR_DIMENSION",
  "AUTH_JWT_SECRET",
  "AUTH_JWT_EXPIRES_IN",
  "AUTH_SESSION_COOKIE_NAME",
  "LEAD_ENCRYPTION_KEY",
  "AI_PROVIDER",
  "AI_API_KEY",
  "AI_CHAT_MODEL",
  "AI_EMBEDDING_MODEL",
  "AI_RATE_LIMIT_PER_MIN",
] as const;

const NODE_ENV_VALUES: readonly NodeEnv[] = [
  "development",
  "test",
  "production",
];

const LOG_LEVEL_VALUES: readonly LogLevel[] = ["debug", "info", "warn", "error"];

export function validateEnv(
  env: Record<string, string | undefined>,
): AppEnvConfig {
  const invalidVariables = new Set<string>();

  for (const key of REQUIRED_ENV_KEYS) {
    if (isBlank(env[key])) {
      invalidVariables.add(key);
    }
  }

  const nodeEnv = env.NODE_ENV;
  if (!isOneOf(nodeEnv, NODE_ENV_VALUES)) {
    invalidVariables.add("NODE_ENV");
  }
  const nodeEnvValue: NodeEnv = isOneOf(nodeEnv, NODE_ENV_VALUES)
    ? nodeEnv
    : "development";

  const logLevel = env.LOG_LEVEL;
  if (!isBlank(logLevel) && !isOneOf(logLevel, LOG_LEVEL_VALUES)) {
    invalidVariables.add("LOG_LEVEL");
  }
  const logLevelValue: LogLevel | undefined = isOneOf(
    logLevel,
    LOG_LEVEL_VALUES,
  )
    ? logLevel
    : undefined;

  const pgvectorDimension = parsePositiveInteger(
    env.PGVECTOR_DIMENSION,
    "PGVECTOR_DIMENSION",
    invalidVariables,
  );
  const aiRateLimitPerMin = parseOptionalPositiveInteger(
    env.AI_RATE_LIMIT_PER_MIN,
    "AI_RATE_LIMIT_PER_MIN",
    invalidVariables,
  );

  addPublicSecretLeaks(env, invalidVariables);
  const nextPublicDefaultLocale = readDefaultLocale(
    env.NEXT_PUBLIC_DEFAULT_LOCALE,
    invalidVariables,
  );

  if (invalidVariables.size > 0) {
    throw new EnvValidationError([...invalidVariables].sort());
  }

  return {
    nodeEnv: nodeEnvValue,
    appBaseUrl: readRequired(env, "APP_BASE_URL"),
    logLevel: logLevelValue,
    databaseUrl: readRequired(env, "DATABASE_URL"),
    shadowDatabaseUrl: blankToUndefined(env.SHADOW_DATABASE_URL),
    pgvectorDimension,
    authJwtSecret: readRequired(env, "AUTH_JWT_SECRET"),
    authJwtExpiresIn: blankToUndefined(env.AUTH_JWT_EXPIRES_IN),
    authSessionCookieName: blankToUndefined(env.AUTH_SESSION_COOKIE_NAME),
    leadEncryptionKey: readRequired(env, "LEAD_ENCRYPTION_KEY"),
    aiProvider: readRequired(env, "AI_PROVIDER"),
    aiApiKey: readRequired(env, "AI_API_KEY"),
    aiChatModel: readRequired(env, "AI_CHAT_MODEL"),
    aiEmbeddingModel: readRequired(env, "AI_EMBEDDING_MODEL"),
    aiRateLimitPerMin,
    nextPublicApiBaseUrl: blankToUndefined(env.NEXT_PUBLIC_API_BASE_URL),
    nextPublicMapToken: blankToUndefined(env.NEXT_PUBLIC_MAP_TOKEN),
    nextPublicDefaultLocale,
    taroAppApiBaseUrl: blankToUndefined(env.TARO_APP_API_BASE_URL),
  };
}

export function validateWebEnv(
  env: Readonly<Record<string, string | undefined>>,
): WebEnvConfig {
  const invalidVariables = new Set<string>();
  const nodeEnv = env.NODE_ENV;
  const apiInternalBaseUrl = env.API_INTERNAL_BASE_URL;

  if (!isOneOf(nodeEnv, NODE_ENV_VALUES)) {
    invalidVariables.add("NODE_ENV");
  }
  if (!isValidInternalApiBaseUrl(apiInternalBaseUrl, nodeEnv)) {
    invalidVariables.add("API_INTERNAL_BASE_URL");
  }

  if (invalidVariables.size > 0) {
    throw new EnvValidationError([...invalidVariables].sort());
  }

  return {
    nodeEnv: nodeEnv as NodeEnv,
    apiInternalBaseUrl: apiInternalBaseUrl as string,
  };
}

function isValidInternalApiBaseUrl(
  value: string | undefined,
  nodeEnv: string | undefined,
): boolean {
  if (isBlank(value)) return false;
  const authorityStart = value.indexOf("://") + 3;
  const pathStart = value.indexOf("/", authorityStart);
  const authority = value.slice(
    authorityStart,
    pathStart === -1 ? value.length : pathStart,
  );
  if (value.includes("?") || value.includes("#") || authority.includes("@")) {
    return false;
  }

  try {
    const url = new URL(value);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username !== "" ||
      url.password !== "" ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      return false;
    }

    if (nodeEnv !== "production" || url.protocol === "https:") {
      return true;
    }

    return /^http:\/\/(?:127\.0\.0\.1|\[::1\])(?::[0-9]+)?(?:\/|$)/.test(
      value,
    );
  } catch {
    return false;
  }
}

function addPublicSecretLeaks(
  env: Record<string, string | undefined>,
  invalidVariables: Set<string>,
): void {
  for (const key of Object.keys(env)) {
    if (!key.startsWith("NEXT_PUBLIC_") && !key.startsWith("TARO_APP_")) {
      continue;
    }

    for (const serverOnlyKey of SERVER_ONLY_ENV_KEYS) {
      if (key.endsWith(serverOnlyKey)) {
        invalidVariables.add(key);
      }
    }
  }
}

function parsePositiveInteger(
  value: string | undefined,
  key: string,
  invalidVariables: Set<string>,
): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    invalidVariables.add(key);
    return 0;
  }

  return parsed;
}

function parseOptionalPositiveInteger(
  value: string | undefined,
  key: string,
  invalidVariables: Set<string>,
): number | undefined {
  if (isBlank(value)) return undefined;
  return parsePositiveInteger(value, key, invalidVariables);
}

function readDefaultLocale(
  value: string | undefined,
  invalidVariables: Set<string>,
): "zh-CN" | undefined {
  if (isBlank(value)) return undefined;
  if (value === "zh-CN") return "zh-CN";
  invalidVariables.add("NEXT_PUBLIC_DEFAULT_LOCALE");
  return undefined;
}

function readRequired(
  env: Record<string, string | undefined>,
  key: string,
): string {
  return env[key] ?? "";
}

function blankToUndefined(value: string | undefined): string | undefined {
  return isBlank(value) ? undefined : value;
}

function isBlank(value: string | undefined): value is undefined {
  return value === undefined || value.trim() === "";
}

function isOneOf<T extends string>(
  value: string | undefined,
  allowedValues: readonly T[],
): value is T {
  return allowedValues.some((allowedValue) => allowedValue === value);
}
