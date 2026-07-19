export interface DatabaseRuntimeConfigInput {
  readonly databaseUrl: string;
  readonly poolMax: number;
  readonly poolTimeoutSeconds: number;
  readonly connectTimeoutSeconds: number;
}

export interface DatabaseRuntimeConfig {
  readonly databaseUrl: string;
}

const MANAGED_PARAMETER_NAMES = [
  "connection_limit",
  "pool_timeout",
  "connect_timeout",
  "application_name",
] as const;

export function buildDatabaseRuntimeConfig(
  input: DatabaseRuntimeConfigInput,
): DatabaseRuntimeConfig {
  assertBoundedInteger(input.poolMax, 1, 50, "DATABASE_POOL_MAX");
  assertBoundedInteger(
    input.poolTimeoutSeconds,
    1,
    30,
    "DATABASE_POOL_TIMEOUT_SECONDS",
  );
  assertBoundedInteger(
    input.connectTimeoutSeconds,
    1,
    30,
    "DATABASE_CONNECT_TIMEOUT_SECONDS",
  );

  const databaseUrl = parseDatabaseUrl(input.databaseUrl);
  for (const parameterName of MANAGED_PARAMETER_NAMES) {
    if (databaseUrl.searchParams.has(parameterName)) {
      throw new Error(`DATABASE_URL_MANAGED_PARAMETER:${parameterName}`);
    }
  }

  databaseUrl.searchParams.set("connection_limit", String(input.poolMax));
  databaseUrl.searchParams.set(
    "pool_timeout",
    String(input.poolTimeoutSeconds),
  );
  databaseUrl.searchParams.set(
    "connect_timeout",
    String(input.connectTimeoutSeconds),
  );
  databaseUrl.searchParams.set("application_name", "navigator-api");

  return Object.freeze({ databaseUrl: databaseUrl.toString() });
}

function parseDatabaseUrl(value: string): URL {
  let databaseUrl: URL;
  try {
    databaseUrl = new URL(value);
  } catch {
    throw new Error("DATABASE_URL");
  }

  const hasSingleDatabasePath = /^\/[^/]+$/.test(databaseUrl.pathname);
  if (
    databaseUrl.protocol !== "postgresql:" ||
    databaseUrl.username === "" ||
    databaseUrl.password === "" ||
    databaseUrl.hostname === "" ||
    !hasSingleDatabasePath ||
    databaseUrl.hash !== ""
  ) {
    throw new Error("DATABASE_URL");
  }
  return databaseUrl;
}

function assertBoundedInteger(
  value: number,
  minimum: number,
  maximum: number,
  variableName: string,
): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(variableName);
  }
}
