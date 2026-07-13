import {
  BASIC_COLLECTION_BLOCKER_CODES,
  BASIC_COLLECTION_REQUIRED_STATIC_FACT_PATHS,
  type BasicCollectionBlockerCode,
  type BasicCollectionJsonValue,
  type BasicInjectionRisk,
  type BasicSourceCheck,
} from "./basic-collection-contracts.js";
import {
  BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION,
  type BasicCollectionAuditBundleV2,
  type BasicExtractedFactV2,
} from "./basic-collection-v2-contracts.js";
import { parseBasicCollectionAuditBundleV2 } from "./basic-collection-v2-parser.js";
import { snapshotBasicBoundedJsonValue } from "./basic-bounded-json.js";
import {
  deepFreezeBasicOfflineValue,
  deeplyEqualBasicOfflineValue,
} from "./basic-offline-value.js";
import { validateBasicV2FactOwnership } from "./basic-v2-fact-ownership.js";

const INPUT_KEYS = [
  "sourceRegister",
  "extractedFacts",
  "sourceChecks",
  "injectionRisks",
  "catalogVersion",
  "catalogSha256",
] as const;
const V2_SNAPSHOT_BUDGETS = Object.freeze({
  maximumObjectProperties: 256,
  maximumTotalNodes: 65_536,
});
const INDICATOR_PATH =
  /^marketOverview\.keyIndicators\[(0|[1-9]\d*)\]\.(label|value|unit|year)$/;
const INDICATOR_KEYS = ["label", "value", "unit", "year"] as const;
const SAFE_VERSION = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

type JsonRecord = Record<string, BasicCollectionJsonValue>;
type PreflightInput = {
  readonly sourceRegister: BasicCollectionJsonValue;
  readonly extractedFacts: BasicCollectionJsonValue;
  readonly sourceChecks: BasicCollectionJsonValue;
  readonly injectionRisks: BasicCollectionJsonValue;
  readonly catalogVersion: BasicCollectionJsonValue;
  readonly catalogSha256: BasicCollectionJsonValue;
};

export interface BasicDeterministicPreflightResult {
  readonly valid: boolean;
  readonly blockers: readonly BasicCollectionBlockerCode[];
  readonly errors: readonly string[];
}

export function preflightBasicDeterministicCollection(input: {
  readonly sourceRegister: unknown;
  readonly extractedFacts: unknown;
  readonly sourceChecks: unknown;
  readonly injectionRisks: unknown;
  readonly catalogVersion: unknown;
  readonly catalogSha256: unknown;
}): BasicDeterministicPreflightResult {
  try {
    const snapshot = snapshotBasicBoundedJsonValue(
      input,
      () => undefined,
      V2_SNAPSHOT_BUDGETS,
    );
    if (!snapshot.valid) return invalid("preflight input must be a bounded JSON value");
    const parsedInput = exactInput(snapshot.data);
    if (parsedInput === null) return invalid("input must have exactly the required own keys");

    const parsedBundle = parseBasicCollectionAuditBundleV2(
      parserEnvelope(parsedInput),
    );
    if (parsedBundle.data === null) return structural(parsedBundle.errors);

    const errors = [
      ...validateCatalog(parsedInput, parsedBundle.data),
      ...validateRelations(parsedBundle.data),
      ...validateBasicV2FactOwnership(parsedBundle.data.extractedFacts.facts),
    ];
    if (errors.length > 0) return structural(errors);

    return freeze({
      valid: true,
      blockers: deriveBlockers(parsedBundle.data),
      errors: [],
    });
  } catch {
    return invalid("preflight input must be a bounded JSON value");
  }
}

function exactInput(value: BasicCollectionJsonValue): PreflightInput | null {
  if (!isRecord(value) || Object.keys(value).length !== INPUT_KEYS.length ||
    !INPUT_KEYS.every((key) => Object.hasOwn(value, key))) return null;
  return value as PreflightInput;
}

function parserEnvelope(input: PreflightInput): BasicCollectionJsonValue {
  const identity = sourceIdentity(input.sourceRegister);
  return {
    countryDirectory: "preflight",
    runId: identity.runId,
    sourceRegister: input.sourceRegister,
    extractedFacts: input.extractedFacts,
    marketOverviewDraft: {
      overview: { zh: "preflight", en: "preflight" },
      population: null,
      gdp: null,
      gdpGrowth: null,
      energyDemand: { zh: "preflight", en: "preflight" },
      renewableTarget: { zh: "preflight", en: "preflight" },
      keyIndicators: [],
      source: "preflight",
      sourceUrl: "https://preflight.invalid/",
      collectedAt: "2000-01-01T00:00:00Z",
      updatedAt: "2000-01-01T00:00:00Z",
      credibility: "OFFICIAL",
      reviewStatus: "draft",
      aiUsable: false,
      countryCode: identity.countryCode,
      industryTags: ["solar"],
      techTags: ["pv-module"],
    },
    reviewReport: {
      schemaVersion: BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION,
      runId: identity.runId,
      countryCode: identity.countryCode,
      status: "blocked",
      missingFields: [],
      conflicts: [],
      sourceChecks: input.sourceChecks,
      injectionRisks: input.injectionRisks,
      publicationRecommendation: "do-not-publish",
      humanDecision: null,
    },
  };
}

function sourceIdentity(value: BasicCollectionJsonValue): {
  readonly runId: BasicCollectionJsonValue;
  readonly countryCode: BasicCollectionJsonValue;
} {
  if (!isRecord(value)) return { runId: "", countryCode: "" };
  return {
    runId: value.runId ?? "",
    countryCode: value.countryCode ?? "",
  };
}

function validateCatalog(
  input: PreflightInput,
  bundle: BasicCollectionAuditBundleV2,
): readonly string[] {
  const errors: string[] = [];
  if (typeof input.catalogVersion !== "string" || !SAFE_VERSION.test(input.catalogVersion)) {
    errors.push("catalogVersion must be a safe version token");
  } else if (input.catalogVersion !== bundle.sourceRegister.catalogVersion) {
    errors.push("catalogVersion must match sourceRegister.catalogVersion");
  }
  if (typeof input.catalogSha256 !== "string" || !/^[0-9a-f]{64}$/.test(input.catalogSha256)) {
    errors.push("catalogSha256 must be a lowercase SHA-256 hash");
  } else if (input.catalogSha256 !== bundle.sourceRegister.catalogSha256) {
    errors.push("catalogSha256 must match sourceRegister.catalogSha256");
  }
  return errors;
}

function validateRelations(bundle: BasicCollectionAuditBundleV2): readonly string[] {
  const errors: string[] = [];
  const sources = bundle.sourceRegister.sources;
  if (sources.length === 0) errors.push("sourceRegister.sources must contain at least one source");
  const sourcesById = new Map(sources.map((source) => [source.sourceId, source]));
  const firstPath = new Map<string, number>();

  for (const [factIndex, fact] of bundle.extractedFacts.facts.entries()) {
    const prior = firstPath.get(fact.fieldPath);
    if (prior === undefined) firstPath.set(fact.fieldPath, factIndex);
    else errors.push(
      `extractedFacts.facts[${factIndex}].fieldPath duplicates extractedFacts.facts[${prior}].fieldPath`,
    );
    validateEvidenceOrder(fact, factIndex, errors);
    for (const [evidenceIndex, evidence] of fact.evidence.entries()) {
      const source = sourcesById.get(evidence.sourceId);
      if (source === undefined) {
        errors.push(`extractedFacts.facts[${factIndex}].evidence[${evidenceIndex}].sourceId must reference a registered sourceId`);
      } else if (!source.evidenceLocators.includes(evidence.locator)) {
        errors.push(`extractedFacts.facts[${factIndex}].evidence[${evidenceIndex}].locator must match a registered evidenceLocator`);
      }
    }
    if (fact.status === "candidate") validateCandidateEvidence(fact, factIndex, errors);
  }
  validateSourceChecks(bundle.reviewReport.sourceChecks, sourcesById, errors);
  validateInjectionRisks(bundle.reviewReport.injectionRisks, sourcesById, errors);
  return errors;
}

function validateCandidateEvidence(
  fact: BasicExtractedFactV2,
  factIndex: number,
  errors: string[],
): void {
  const candidateValue = fact.evidence[0]?.normalizedValue;
  for (const [evidenceIndex, evidence] of fact.evidence.entries()) {
    if (!deeplyEqualBasicOfflineValue(evidence.normalizedValue, candidateValue)) {
      errors.push(`extractedFacts.facts[${factIndex}].evidence[${evidenceIndex}].normalizedValue must deeply equal the candidate value`);
    }
  }
}

function validateSourceChecks(
  checks: readonly BasicSourceCheck[],
  sources: ReadonlyMap<string, BasicCollectionAuditBundleV2["sourceRegister"]["sources"][number]>,
  errors: string[],
): void {
  const firstIndex = new Map<string, number>();
  for (const [index, check] of checks.entries()) {
    if (index > 0 && compareText(checks[index - 1]!.sourceId, check.sourceId) > 0) {
      errors.push("sourceChecks must be sorted by sourceId");
    }
    const prior = firstIndex.get(check.sourceId);
    if (prior === undefined) firstIndex.set(check.sourceId, index);
    else errors.push(`sourceChecks[${index}].sourceId duplicates sourceChecks[${prior}].sourceId`);
    if (!sources.has(check.sourceId)) {
      errors.push(`sourceChecks[${index}].sourceId must reference a registered sourceId`);
    }
  }
}

function validateInjectionRisks(
  risks: readonly BasicInjectionRisk[],
  sources: ReadonlyMap<string, BasicCollectionAuditBundleV2["sourceRegister"]["sources"][number]>,
  errors: string[],
): void {
  for (const [index, risk] of risks.entries()) {
    if (index > 0 && compareRisk(risks[index - 1]!, risk) > 0) {
      errors.push("injectionRisks must be sorted");
    }
    for (let prior = 0; prior < index; prior += 1) {
      if (compareRisk(risks[prior]!, risk) === 0) {
        errors.push(`injectionRisks[${index}] duplicates injectionRisks[${prior}]`);
        break;
      }
    }
    const source = sources.get(risk.sourceId);
    if (source === undefined) {
      errors.push(`injectionRisks[${index}].sourceId must reference a registered sourceId`);
    } else if (!source.evidenceLocators.includes(risk.locator)) {
      errors.push(`injectionRisks[${index}].locator must match a registered evidenceLocator`);
    }
  }
}

function validateEvidenceOrder(
  fact: BasicExtractedFactV2,
  factIndex: number,
  errors: string[],
): void {
  const label = `extractedFacts.facts[${factIndex}].evidence`;
  for (const [index, evidence] of fact.evidence.entries()) {
    if (index > 0 && compareEvidence(fact.evidence[index - 1]!, evidence) > 0) {
      errors.push(`${label} must be unique and sorted`);
    }
    for (let prior = 0; prior < index; prior += 1) {
      if (compareEvidence(fact.evidence[prior]!, evidence) === 0) {
        errors.push(`${label}[${index}] duplicates ${label}[${prior}]`);
        break;
      }
    }
  }
}

function deriveBlockers(bundle: BasicCollectionAuditBundleV2): readonly BasicCollectionBlockerCode[] {
  const blockers = new Set<BasicCollectionBlockerCode>();
  const facts = bundle.extractedFacts.facts;
  const paths = new Set(facts.map(({ fieldPath }) => fieldPath));
  if (BASIC_COLLECTION_REQUIRED_STATIC_FACT_PATHS.some((path) => !paths.has(path)) ||
    facts.some(({ status }) => status === "missing") || !hasCompleteIndicators(facts)) {
    blockers.add("MISSING_REQUIRED_FACT");
  }
  if (facts.some(({ status }) => status === "conflict")) blockers.add("UNRESOLVED_CONFLICT");
  if (isUntrusted(bundle)) blockers.add("UNTRUSTED_INPUT");
  return BASIC_COLLECTION_BLOCKER_CODES.filter((code) => blockers.has(code));
}

function hasCompleteIndicators(facts: readonly BasicExtractedFactV2[]): boolean {
  const groups = new Map<number, Set<string>>();
  for (const fact of facts) {
    const match = INDICATOR_PATH.exec(fact.fieldPath);
    if (match === null) continue;
    const index = Number(match[1]);
    const group = groups.get(index) ?? new Set<string>();
    group.add(match[2]!);
    groups.set(index, group);
  }
  const indices = [...groups.keys()].sort((left, right) => left - right);
  return indices.length > 0 && indices.every((index, position) =>
    index === position && INDICATOR_KEYS.every((key) => groups.get(index)?.has(key)));
}

function isUntrusted(bundle: BasicCollectionAuditBundleV2): boolean {
  const checksBySource = new Map<string, readonly BasicSourceCheck[]>();
  for (const check of bundle.reviewReport.sourceChecks) {
    checksBySource.set(check.sourceId, [
      ...(checksBySource.get(check.sourceId) ?? []),
      check,
    ]);
  }
  const sourceTrustFailure = bundle.sourceRegister.sources.some((source) => {
    const checks = checksBySource.get(source.sourceId);
    return source.discoveryOnly || source.accessStatus !== "open" ||
      source.credibility === "UNVERIFIED" || source.promptInjectionRisk !== "none" ||
      checks?.length !== 1 || checks[0]?.status !== "passed";
  });
  return sourceTrustFailure || bundle.reviewReport.sourceChecks.some(({ status }) => status === "failed") ||
    bundle.reviewReport.injectionRisks.length > 0 ||
    bundle.extractedFacts.facts.some((fact) =>
      fact.status === "untrusted" ||
      (fact.fieldPath === "marketOverview.credibility" && fact.status === "candidate" &&
        fact.evidence.some(({ normalizedValue }) => normalizedValue === "UNVERIFIED")));
}

function compareRisk(left: BasicInjectionRisk, right: BasicInjectionRisk): number {
  return compareText(left.sourceId, right.sourceId) || compareText(left.locator, right.locator) ||
    compareText(left.severity, right.severity) || compareText(left.details, right.details);
}

function compareEvidence(
  left: BasicExtractedFactV2["evidence"][number],
  right: BasicExtractedFactV2["evidence"][number],
): number {
  return compareText(left.sourceId, right.sourceId) || compareText(left.locator, right.locator) ||
    compareText(canonicalJson(left.rawValue), canonicalJson(right.rawValue)) ||
    compareText(canonicalJson(left.normalizedValue), canonicalJson(right.normalizedValue)) ||
    compareNullableText(left.unit, right.unit) || compareNullableNumber(left.year, right.year);
}

function canonicalJson(value: BasicCollectionJsonValue): string {
  if (value === null) return "null";
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : JSON.stringify(value);
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort(compareText).map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(value[key]!)}`).join(",")}}`;
}

function compareNullableText(left: string | null, right: string | null): number {
  if (left === null) return right === null ? 0 : -1;
  return right === null ? 1 : compareText(left, right);
}

function compareNullableNumber(left: number | null, right: number | null): number {
  if (left === null) return right === null ? 0 : -1;
  if (right === null) return 1;
  if (Object.is(left, right)) return 0;
  if (Object.is(left, -0)) return -1;
  if (Object.is(right, -0)) return 1;
  return left - right;
}

function isRecord(value: BasicCollectionJsonValue): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function invalid(error: string): BasicDeterministicPreflightResult {
  return freeze({ valid: false, blockers: [], errors: [error] });
}

function structural(errors: readonly string[]): BasicDeterministicPreflightResult {
  return freeze({ valid: false, blockers: [], errors: [...new Set(errors)].sort(compareText) });
}

function freeze(result: BasicDeterministicPreflightResult): BasicDeterministicPreflightResult {
  return deepFreezeBasicOfflineValue(result);
}
