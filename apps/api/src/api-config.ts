import { isAbsolute, normalize } from "node:path";

export type ApiConfig =
  | {
      readonly port: number;
      readonly countryReadSource: "database";
      readonly databaseUrl: string;
      readonly databasePoolMax: number;
      readonly databasePoolTimeoutSeconds: number;
      readonly databaseConnectTimeoutSeconds: number;
    }
  | {
      readonly port: number;
      readonly countryReadSource: "canonical";
      readonly canonicalRepositoryRoot: string;
    };

export type ApiEnvironment = Readonly<Record<string, string | undefined>>;

export function validateApiEnv(environment: ApiEnvironment): ApiConfig {
  const invalidVariables: string[] = [];
  const port = parsePort(environment.API_PORT, invalidVariables);
  const source = parseSource(environment.COUNTRY_READ_SOURCE, invalidVariables);

  if (source === "database") {
    const databaseUrl = requiredValue(
      environment.DATABASE_URL,
      "DATABASE_URL",
      invalidVariables,
    );
    const databasePoolMax = parseBoundedInteger(
      environment.DATABASE_POOL_MAX,
      10,
      1,
      50,
      "DATABASE_POOL_MAX",
      invalidVariables,
    );
    const databasePoolTimeoutSeconds = parseBoundedInteger(
      environment.DATABASE_POOL_TIMEOUT_SECONDS,
      5,
      1,
      30,
      "DATABASE_POOL_TIMEOUT_SECONDS",
      invalidVariables,
    );
    const databaseConnectTimeoutSeconds = parseBoundedInteger(
      environment.DATABASE_CONNECT_TIMEOUT_SECONDS,
      5,
      1,
      30,
      "DATABASE_CONNECT_TIMEOUT_SECONDS",
      invalidVariables,
    );
    throwIfInvalid(invalidVariables);
    return Object.freeze({
      port,
      countryReadSource: source,
      databaseUrl,
      databasePoolMax,
      databasePoolTimeoutSeconds,
      databaseConnectTimeoutSeconds,
    });
  }

  if (source === "canonical") {
    const canonicalRepositoryRoot = parseCanonicalRepositoryRoot(
      environment.CANONICAL_REPOSITORY_ROOT,
      invalidVariables,
    );
    throwIfInvalid(invalidVariables);
    return Object.freeze({
      port,
      countryReadSource: source,
      canonicalRepositoryRoot,
    });
  }

  throwIfInvalid(invalidVariables);
  throw new Error("COUNTRY_READ_SOURCE");
}

function parsePort(value: string | undefined, invalidVariables: string[]): number {
  const port = typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) {
    invalidVariables.push("API_PORT");
  }
  return port;
}

function parseSource(
  value: string | undefined,
  invalidVariables: string[],
): "database" | "canonical" | undefined {
  if (value === undefined) return "database";
  if (value === "database" || value === "canonical") return value;
  invalidVariables.push("COUNTRY_READ_SOURCE");
  return undefined;
}

function requiredValue(
  value: string | undefined,
  variableName: string,
  invalidVariables: string[],
): string {
  if (typeof value !== "string" || value.trim() === "") {
    invalidVariables.push(variableName);
    return "";
  }
  return value;
}

function parseBoundedInteger(
  value: string | undefined,
  defaultValue: number,
  minimum: number,
  maximum: number,
  variableName: string,
  invalidVariables: string[],
): number {
  if (value === undefined) return defaultValue;
  const parsed = Number(value);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < minimum ||
    parsed > maximum
  ) {
    invalidVariables.push(variableName);
  }
  return parsed;
}

function parseCanonicalRepositoryRoot(
  value: string | undefined,
  invalidVariables: string[],
): string {
  const root = requiredValue(
    value,
    "CANONICAL_REPOSITORY_ROOT",
    invalidVariables,
  );
  if (root === "") return root;
  if (root.includes("\0") || !isAbsolute(root) || normalize(root) !== root) {
    invalidVariables.push("CANONICAL_REPOSITORY_ROOT");
  }
  return root;
}

function throwIfInvalid(invalidVariables: readonly string[]): void {
  if (invalidVariables.length > 0) {
    throw new Error(invalidVariables.join(","));
  }
}
