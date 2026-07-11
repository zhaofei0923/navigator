export type BasicActivationModel =
  | "marketOverview"
  | "policy"
  | "risk"
  | "opportunity"
  | "project"
  | "partner"
  | "chineseCompany"
  | "entryStrategy"
  | "report"
  | "knowledgeChunk";

export type BasicActivationScope = "all" | "published" | "ai-eligible";

export interface BasicActivationCountPort {
  count(
    model: BasicActivationModel,
    scope: BasicActivationScope,
    countryCode: string,
  ): Promise<number>;
}

export interface BasicCountryActivationPreflightResult {
  readonly countryCode: string;
  readonly activation: "ready" | "blocked";
  readonly blockerCode:
    | "LEGACY_COUNTRY_DATA_PRESENT"
    | "PREFLIGHT_QUERY_FAILED"
    | null;
  readonly cleanupRequired: boolean;
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly counts: Readonly<Record<string, number>> | null;
}

interface BasicActivationQuery {
  readonly model: BasicActivationModel;
  readonly scope: BasicActivationScope;
}

const DEEP_AND_KNOWLEDGE_MODELS = Object.freeze([
  "policy",
  "risk",
  "opportunity",
  "project",
  "partner",
  "chineseCompany",
  "entryStrategy",
  "report",
  "knowledgeChunk",
] as const satisfies readonly BasicActivationModel[]);

const ALL_MODELS = Object.freeze([
  "marketOverview",
  ...DEEP_AND_KNOWLEDGE_MODELS,
] as const satisfies readonly BasicActivationModel[]);

const BASIC_ACTIVATION_QUERY_MATRIX: readonly BasicActivationQuery[] =
  Object.freeze([
    ...DEEP_AND_KNOWLEDGE_MODELS.map((model) => ({ model, scope: "all" as const })),
    ...DEEP_AND_KNOWLEDGE_MODELS.map((model) => ({
      model,
      scope: "published" as const,
    })),
    ...ALL_MODELS.map((model) => ({ model, scope: "ai-eligible" as const })),
  ]);

function queryKey(query: BasicActivationQuery): string {
  return `${query.model}:${query.scope}`;
}

function createFailedResult(
  countryCode: string,
  error: "INVALID_COUNTRY_CODE" | "COUNT_QUERY_FAILED",
): BasicCountryActivationPreflightResult {
  return Object.freeze({
    countryCode,
    activation: "blocked",
    blockerCode: "PREFLIGHT_QUERY_FAILED",
    cleanupRequired: false,
    valid: false,
    errors: Object.freeze([error]),
    counts: null,
  });
}

export async function preflightBasicCountryActivation(
  countryCode: string,
  port: BasicActivationCountPort,
): Promise<BasicCountryActivationPreflightResult> {
  if (!/^[A-Z]{2}$/.test(countryCode)) {
    return createFailedResult(countryCode, "INVALID_COUNTRY_CODE");
  }

  const counts: Record<string, number> = {};

  try {
    for (const query of BASIC_ACTIVATION_QUERY_MATRIX) {
      const count = await port.count(query.model, query.scope, countryCode);
      if (
        typeof count !== "number" ||
        !Number.isFinite(count) ||
        !Number.isSafeInteger(count) ||
        count < 0
      ) {
        return createFailedResult(countryCode, "COUNT_QUERY_FAILED");
      }
      counts[queryKey(query)] = count;
    }
  } catch {
    return createFailedResult(countryCode, "COUNT_QUERY_FAILED");
  }

  const frozenCounts = Object.freeze(counts);
  const cleanupRequired = Object.values(frozenCounts).some((count) => count > 0);

  return Object.freeze({
    countryCode,
    activation: cleanupRequired ? "blocked" : "ready",
    blockerCode: cleanupRequired ? "LEGACY_COUNTRY_DATA_PRESENT" : null,
    cleanupRequired,
    valid: true,
    errors: Object.freeze([]),
    counts: frozenCounts,
  });
}
