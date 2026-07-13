import { isDeepStrictEqual } from "node:util";

import {
  BASIC_COLLECTION_REQUIRED_STATIC_FACT_PATHS,
  type BasicCollectionJsonValue,
  type BasicMarketOverviewDraft,
} from "./basic-collection-contracts.js";
import { BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION } from "./basic-collection-v2-contracts.js";
import {
  deepFreezeBasicLlamaValue,
  parseBasicLlamaFactsSnapshot,
  parseBasicLlamaIndicatorPath,
  parseBasicLlamaRegisterSnapshot,
  readBasicLlamaExactRuntimeRecord,
  snapshotBasicLlamaJson,
  type BasicLlamaFactSnapshot,
  type BasicLlamaFactsSnapshot,
  type BasicLlamaRegisterSnapshot,
  type BasicLlamaSourceSnapshot,
} from "./basic-llama-draft-schema.js";
import { parseBasicMarketOverviewDraft } from "./basic-market-overview-draft-parser.js";
import { snapshotBasicBoundedJsonValue } from "./basic-bounded-json.js";

const INPUT_KEYS = ["sourceRegister", "extractedFacts"] as const;
const INDICATOR_KEYS = ["label", "value", "unit", "year"] as const;
const V2_REGISTER_KEYS = [
  "schemaVersion", "runId", "countryCode", "catalogVersion", "catalogSha256", "sources",
] as const;
const V2_FACTS_KEYS = ["schemaVersion", "runId", "countryCode", "facts"] as const;
const V1_REGISTER_KEYS = ["schemaVersion", "runId", "countryCode", "sources"] as const;
const SHA256 = /^[0-9a-f]{64}$/;

interface GroundedFacts {
  readonly values: Map<string, BasicCollectionJsonValue>;
  readonly indicators: Map<number, Set<string>>;
}

export function assembleBasicMarketOverviewDraft(input: {
  readonly sourceRegister: unknown;
  readonly extractedFacts: unknown;
}): BasicMarketOverviewDraft | null {
  const values = readBasicLlamaExactRuntimeRecord(input, INPUT_KEYS);
  if (values === null) return null;

  const sourceValue = values.get("sourceRegister");
  const factsValue = values.get("extractedFacts");
  const legacySource = snapshotBasicLlamaJson(sourceValue);
  const legacyFacts = snapshotBasicLlamaJson(factsValue);
  if (!legacySource.valid || !legacyFacts.valid) return null;

  const sourceSchema = schemaVersion(legacySource.data);
  const factsSchema = schemaVersion(legacyFacts.data);
  if (sourceSchema === undefined || factsSchema === undefined || sourceSchema !== factsSchema) return null;
  if (sourceSchema === BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION) {
    return assembleV2(sourceValue, factsValue);
  }

  const register = parseBasicLlamaRegisterSnapshot(legacySource.data);
  const extracted = parseBasicLlamaFactsSnapshot(legacyFacts.data);
  return assembleParsed(register, extracted, false);
}

function assembleV2(
  sourceValue: unknown,
  factsValue: unknown,
): BasicMarketOverviewDraft | null {
  const sourceSnapshot = snapshotBasicBoundedJsonValue(sourceValue);
  const factsSnapshot = snapshotBasicBoundedJsonValue(factsValue);
  if (!sourceSnapshot.valid || !factsSnapshot.valid) return null;
  const register = parseV2Register(sourceSnapshot.data);
  const extracted = parseV2Facts(factsSnapshot.data);
  return assembleParsed(register, extracted, true);
}

function parseV2Register(value: BasicCollectionJsonValue): BasicLlamaRegisterSnapshot | null {
  const record = exactRecord(value, V2_REGISTER_KEYS);
  if (record === null) return null;
  const catalogVersion = valueAt(record, "catalogVersion");
  const catalogSha256 = valueAt(record, "catalogSha256");
  if (
    valueAt(record, "schemaVersion") !== BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION ||
    !nonBlank(catalogVersion) || !sha256(catalogSha256)
  ) return null;
  const legacy: Record<string, BasicCollectionJsonValue> = {
    schemaVersion: "basic-country-audit/v1",
    runId: valueAt(record, "runId"),
    countryCode: valueAt(record, "countryCode"),
    sources: valueAt(record, "sources"),
  };
  return parseBasicLlamaRegisterSnapshot(legacy);
}

function parseV2Facts(value: BasicCollectionJsonValue): BasicLlamaFactsSnapshot | null {
  const record = exactRecord(value, V2_FACTS_KEYS);
  if (record === null || valueAt(record, "schemaVersion") !== BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION) return null;
  const facts = valueAt(record, "facts");
  if (!Array.isArray(facts) || facts.some((fact) => !v2FactMethod(fact))) return null;
  const legacy: Record<string, BasicCollectionJsonValue> = {
    schemaVersion: "basic-country-audit/v1",
    runId: valueAt(record, "runId"),
    countryCode: valueAt(record, "countryCode"),
    facts,
  };
  return parseBasicLlamaFactsSnapshot(legacy);
}

function v2FactMethod(value: BasicCollectionJsonValue): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const descriptor = Object.getOwnPropertyDescriptor(value, "extractionMethod");
  return descriptor !== undefined && Object.hasOwn(descriptor, "value") &&
    (descriptor.value === "deterministic" || descriptor.value === "manual");
}

function assembleParsed(
  register: BasicLlamaRegisterSnapshot | null,
  extracted: BasicLlamaFactsSnapshot | null,
  requireIndicator: boolean,
): BasicMarketOverviewDraft | null {
  if (register === null || extracted === null || !identitiesMatch(register, extracted)) return null;
  const sources = safeSources(register.sources);
  if (sources === null) return null;
  const grounded = collectGroundedFacts(extracted.facts, sources);
  if (grounded === null || !hasRequiredFacts(grounded.values)) return null;
  if (
    grounded.values.get("country.code") !== register.countryCode ||
    grounded.values.get("marketOverview.countryCode") !== register.countryCode
  ) return null;
  const indices = completeIndicatorIndices(grounded.indicators);
  if (indices === null || requireIndicator && indices.length === 0) return null;
  return parseAndCanonicalizeDraft(buildDraft(grounded.values, indices));
}

function identitiesMatch(
  register: BasicLlamaRegisterSnapshot,
  facts: BasicLlamaFactsSnapshot,
): boolean {
  return register.runId === facts.runId && register.countryCode === facts.countryCode;
}

function safeSources(
  sources: readonly BasicLlamaSourceSnapshot[],
): Map<string, BasicLlamaSourceSnapshot> | null {
  if (sources.some(({ safe }) => !safe)) return null;
  return new Map(sources.map((source) => [source.sourceId, source]));
}

function collectGroundedFacts(
  facts: readonly BasicLlamaFactSnapshot[],
  sources: ReadonlyMap<string, BasicLlamaSourceSnapshot>,
): GroundedFacts | null {
  const values = new Map<string, BasicCollectionJsonValue>();
  const indicators = new Map<number, Set<string>>();
  for (const fact of facts) {
    if (fact.status !== "candidate" || values.has(fact.fieldPath)) return null;
    const normalized = fact.evidence[0]!.normalizedValue;
    if (!validEvidence(fact, normalized, sources)) return null;
    values.set(fact.fieldPath, normalized);
    const indicator = parseBasicLlamaIndicatorPath(fact.fieldPath);
    if (indicator !== null) {
      const keys = indicators.get(indicator.index) ?? new Set<string>();
      keys.add(indicator.key);
      indicators.set(indicator.index, keys);
    }
  }
  return { values, indicators };
}

function validEvidence(
  fact: BasicLlamaFactSnapshot,
  normalized: BasicCollectionJsonValue,
  sources: ReadonlyMap<string, BasicLlamaSourceSnapshot>,
): boolean {
  return fact.evidence.every((evidence) => {
    const source = sources.get(evidence.sourceId);
    return source !== undefined && source.locators.includes(evidence.locator) &&
      isDeepStrictEqual(evidence.normalizedValue, normalized);
  });
}

function hasRequiredFacts(values: ReadonlyMap<string, BasicCollectionJsonValue>): boolean {
  return BASIC_COLLECTION_REQUIRED_STATIC_FACT_PATHS.every((path) => values.has(path));
}

function completeIndicatorIndices(indicators: ReadonlyMap<number, Set<string>>): number[] | null {
  const indices = [...indicators.keys()].sort((left, right) => left - right);
  return indices.every((index, position) =>
    index === position && INDICATOR_KEYS.every((key) => indicators.get(index)?.has(key),
    ),
  ) ? indices : null;
}

function buildDraft(
  values: ReadonlyMap<string, BasicCollectionJsonValue>,
  indices: readonly number[],
): unknown {
  const read = (path: string) => values.get(path);
  return {
    overview: read("marketOverview.overview"),
    population: read("marketOverview.population"),
    gdp: read("marketOverview.gdp"),
    gdpGrowth: read("marketOverview.gdpGrowth"),
    energyDemand: read("marketOverview.energyDemand"),
    renewableTarget: read("marketOverview.renewableTarget"),
    keyIndicators: indices.map((index) => ({
      label: read(`marketOverview.keyIndicators[${index}].label`),
      value: read(`marketOverview.keyIndicators[${index}].value`),
      unit: read(`marketOverview.keyIndicators[${index}].unit`),
      year: read(`marketOverview.keyIndicators[${index}].year`),
    })),
    source: read("marketOverview.source"),
    sourceUrl: read("marketOverview.sourceUrl"),
    collectedAt: read("marketOverview.collectedAt"),
    updatedAt: read("marketOverview.updatedAt"),
    credibility: read("marketOverview.credibility"),
    reviewStatus: "draft",
    aiUsable: false,
    countryCode: read("marketOverview.countryCode"),
    industryTags: read("marketOverview.industryTags"),
    techTags: read("marketOverview.techTags"),
  };
}

function parseAndCanonicalizeDraft(value: unknown): BasicMarketOverviewDraft | null {
  const parsed = parseBasicMarketOverviewDraft(value);
  if (parsed.data === null) return null;
  try {
    const canonical: unknown = JSON.parse(JSON.stringify(parsed.data));
    const reparsed = parseBasicMarketOverviewDraft(canonical);
    return reparsed.data === null ? null : deepFreezeBasicLlamaValue(reparsed.data);
  } catch {
    return null;
  }
}

function schemaVersion(value: BasicCollectionJsonValue): string | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    typeof value.schemaVersion === "string" ? value.schemaVersion : undefined;
}

function exactRecord(
  value: BasicCollectionJsonValue,
  keys: readonly string[],
): Record<string, BasicCollectionJsonValue> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key))
    ? value
    : null;
}

function valueAt(
  record: Record<string, BasicCollectionJsonValue>,
  key: string,
): BasicCollectionJsonValue {
  return record[key]!;
}

function nonBlank(value: BasicCollectionJsonValue): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function sha256(value: BasicCollectionJsonValue): value is string {
  return typeof value === "string" && SHA256.test(value);
}
