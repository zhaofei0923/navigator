import { CREDIBILITIES } from "@navigator/shared-types/schema";

import {
  SAFE_COUNTRY_DIRECTORY,
  SAFE_RUN_ID,
  expectUtcRfc3339Timestamp,
  isEnumValue,
} from "../seed/basic-country-validation-utils.js";
import {
  BASIC_COLLECTION_REQUIRED_STATIC_FACT_PATHS,
  type BasicCollectionAuditSummary,
  type BasicCollectionJsonValue,
  type BasicInjectionRisk,
  type BasicMarketOverviewDraft,
  type BasicReviewConflict,
  type BasicSourceCheck,
  type BasicSourceRecord,
} from "./basic-collection-contracts.js";
import {
  BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION,
  type BasicCollectionAuditBundleV2,
  type BasicCollectionAuditParseResultV2,
  type BasicCollectionReviewReportV2,
  type BasicExtractedFactV2,
  type BasicExtractedFactsV2,
  type BasicFactEvidenceV2,
  type BasicSourceRegisterV2,
} from "./basic-collection-v2-contracts.js";
import { snapshotBasicBoundedJsonValue } from "./basic-bounded-json.js";
import { deepFreezeBasicOfflineValue } from "./basic-offline-value.js";
import { parseBasicMarketOverviewDraftForAudit } from "./basic-market-overview-draft-parser.js";
import { isBasicV2ReviewedSourceUrl } from "./basic-v2-source-url-policy.js";

type JsonRecord = Record<string, BasicCollectionJsonValue>;
type ExactJsonRecord<Keys extends readonly string[]> = {
  [Key in Keys[number]]: BasicCollectionJsonValue;
};

const BUNDLE_KEYS = ["countryDirectory", "runId", "sourceRegister", "extractedFacts", "marketOverviewDraft", "reviewReport"] as const;
const SOURCE_REGISTER_KEYS = ["schemaVersion", "runId", "countryCode", "catalogVersion", "catalogSha256", "sources"] as const;
const SOURCE_KEYS = ["sourceId", "sourceName", "sourceUrl", "retrievedAt", "publishedAt", "contentSha256", "evidenceLocators", "sourceFamily", "accessStatus", "accessNotes", "credibility", "discoveryOnly", "promptInjectionRisk"] as const;
const FACTS_KEYS = ["schemaVersion", "runId", "countryCode", "facts"] as const;
const FACT_KEYS = ["factId", "fieldPath", "status", "evidence", "extractionMethod", "uncertainty"] as const;
const EVIDENCE_KEYS = ["sourceId", "locator", "rawValue", "normalizedValue", "unit", "year"] as const;
const REPORT_KEYS = ["schemaVersion", "runId", "countryCode", "status", "missingFields", "conflicts", "sourceChecks", "injectionRisks", "publicationRecommendation", "humanDecision"] as const;
const CONFLICT_KEYS = ["fieldPath", "factIds", "resolution", "notes"] as const;
const SOURCE_CHECK_KEYS = ["sourceId", "status", "notes"] as const;
const INJECTION_RISK_KEYS = ["sourceId", "locator", "severity", "details"] as const;
const SOURCE_FAMILIES = ["international-organization", "official-statistics", "government", "energy-authority", "regulator", "grid-operator", "industry-association", "verified-research"] as const;
const STATIC_PATHS = new Set<string>(BASIC_COLLECTION_REQUIRED_STATIC_FACT_PATHS);
const INDICATOR_PATH = /^marketOverview\.keyIndicators\[(?:0|[1-9]\d*)\]\.(?:label|value|unit|year)$/;
const SAFE_VERSION = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const V2_SNAPSHOT_BUDGETS = Object.freeze({
  maximumObjectProperties: 256,
  maximumTotalNodes: 65_536,
});

export function parseBasicCollectionAuditBundleV2(
  value: unknown,
): BasicCollectionAuditParseResultV2 {
  const snapshot = snapshotBasicBoundedJsonValue(
    value,
    () => undefined,
    V2_SNAPSHOT_BUDGETS,
  );
  if (!snapshot.valid) {
    return frozenResult(null, ["bundle must be a bounded JSON value"], emptySummary());
  }
  const errors: string[] = [];
  const summary = buildSummary(snapshot.data);
  const bundle = exactRecord(snapshot.data, BUNDLE_KEYS, "bundle", errors);
  if (bundle === null) return frozenResult(null, errors, summary);

  const countryDirectory = slug(bundle.countryDirectory, "countryDirectory", errors);
  const runId = run(bundle.runId, "runId", errors);
  const sourceRegister = parseSourceRegister(bundle.sourceRegister, errors);
  const extractedFacts = parseExtractedFacts(bundle.extractedFacts, errors);
  const parsedDraft = parseBasicMarketOverviewDraftForAudit(bundle.marketOverviewDraft);
  errors.push(...parsedDraft.errors);
  const reviewReport = parseReport(bundle.reviewReport, errors);
  if (
    sourceRegister === null || extractedFacts === null ||
    parsedDraft.data === null || reviewReport === null
  ) return frozenResult(null, errors, summary);

  matchIdentities(
    runId,
    sourceRegister,
    extractedFacts,
    parsedDraft.data,
    reviewReport,
    errors,
  );
  const data: BasicCollectionAuditBundleV2 = {
    countryDirectory,
    runId,
    sourceRegister,
    extractedFacts,
    marketOverviewDraft: parsedDraft.data,
    reviewReport,
  };
  const valid = errors.length === 0;
  return frozenResult(valid ? data : null, errors, valid
    ? summaryFor(data)
    : countSummary(data));
}

function parseSourceRegister(
  value: BasicCollectionJsonValue,
  errors: string[],
): BasicSourceRegisterV2 | null {
  const record = exactRecord(value, SOURCE_REGISTER_KEYS, "sourceRegister", errors);
  if (record === null) return null;
  const sources = values(record.sources, "sourceRegister.sources", errors, parseSource);
  validateUniqueBy(
    sources,
    ({ sourceId }) => sourceId,
    "sourceRegister.sources",
    "sourceId",
    errors,
  );
  validateSortedBy(
    sources,
    ({ sourceId }) => sourceId,
    "sourceRegister.sources must be unique and sorted by sourceId",
    errors,
  );
  return {
    schemaVersion: schema(record.schemaVersion, "sourceRegister.schemaVersion", errors),
    runId: run(record.runId, "sourceRegister.runId", errors),
    countryCode: country(record.countryCode, "sourceRegister.countryCode", errors),
    catalogVersion: version(record.catalogVersion, "sourceRegister.catalogVersion", errors),
    catalogSha256: sha256(record.catalogSha256, "sourceRegister.catalogSha256", errors),
    sources,
  };
}

function parseSource(
  value: BasicCollectionJsonValue,
  label: string,
  errors: string[],
): BasicSourceRecord | null {
  const record = exactRecord(value, SOURCE_KEYS, label, errors);
  if (record === null) return null;
  const evidenceLocators = strings(
    record.evidenceLocators,
    `${label}.evidenceLocators`,
    errors,
    true,
  );
  validateUniqueSortedStrings(
    evidenceLocators,
    `${label}.evidenceLocators`,
    errors,
  );
  return {
    sourceId: text(record.sourceId, `${label}.sourceId`, errors),
    sourceName: text(record.sourceName, `${label}.sourceName`, errors),
    sourceUrl: url(record.sourceUrl, `${label}.sourceUrl`, errors),
    retrievedAt: timestamp(record.retrievedAt, `${label}.retrievedAt`, errors),
    publishedAt: nullableTimestamp(record.publishedAt, `${label}.publishedAt`, errors),
    contentSha256: sha256(record.contentSha256, `${label}.contentSha256`, errors),
    evidenceLocators,
    sourceFamily: enumValue(record.sourceFamily, SOURCE_FAMILIES, `${label}.sourceFamily`, errors),
    accessStatus: enumValue(record.accessStatus, ["open", "restricted", "unknown"], `${label}.accessStatus`, errors),
    accessNotes: nullableText(record.accessNotes, `${label}.accessNotes`, errors),
    credibility: enumValue(record.credibility, CREDIBILITIES, `${label}.credibility`, errors),
    discoveryOnly: booleanValue(record.discoveryOnly, `${label}.discoveryOnly`, errors),
    promptInjectionRisk: enumValue(record.promptInjectionRisk, ["none", "suspected", "confirmed"], `${label}.promptInjectionRisk`, errors),
  };
}

function parseExtractedFacts(
  value: BasicCollectionJsonValue,
  errors: string[],
): BasicExtractedFactsV2 | null {
  const record = exactRecord(value, FACTS_KEYS, "extractedFacts", errors);
  if (record === null) return null;
  const facts = values(record.facts, "extractedFacts.facts", errors, parseFact);
  validateUniqueBy(
    facts,
    ({ factId }) => factId,
    "extractedFacts.facts",
    "factId",
    errors,
  );
  validateSortedBy(
    facts,
    ({ fieldPath }) => fieldPath,
    "extractedFacts.facts must be unique and sorted by fieldPath",
    errors,
  );
  return {
    schemaVersion: schema(record.schemaVersion, "extractedFacts.schemaVersion", errors),
    runId: run(record.runId, "extractedFacts.runId", errors),
    countryCode: country(record.countryCode, "extractedFacts.countryCode", errors),
    facts,
  };
}

function parseFact(
  value: BasicCollectionJsonValue,
  label: string,
  errors: string[],
): BasicExtractedFactV2 | null {
  const record = exactRecord(value, FACT_KEYS, label, errors);
  if (record === null) return null;
  const status = enumValue(record.status, ["candidate", "missing", "conflict", "untrusted"], `${label}.status`, errors);
  const evidence = values(record.evidence, `${label}.evidence`, errors, parseEvidence);
  if ((status === "candidate" || status === "untrusted") && evidence.length === 0) {
    errors.push(`${label}.evidence must contain at least one item for ${status}`);
  }
  if (status === "missing" && evidence.length !== 0) {
    errors.push(`${label}.evidence must be empty for missing`);
  }
  if (status === "conflict" && new Set(evidence.map(({ sourceId }) => sourceId)).size < 2) {
    errors.push(`${label}.evidence must contain at least two distinct sourceIds for conflict`);
  }
  return {
    factId: text(record.factId, `${label}.factId`, errors),
    fieldPath: fieldPath(record.fieldPath, `${label}.fieldPath`, errors),
    status,
    evidence,
    extractionMethod: enumValue(record.extractionMethod, ["deterministic", "manual"], `${label}.extractionMethod`, errors),
    uncertainty: nullableText(record.uncertainty, `${label}.uncertainty`, errors),
  };
}

function parseEvidence(
  value: BasicCollectionJsonValue,
  label: string,
  errors: string[],
): BasicFactEvidenceV2 | null {
  const record = exactRecord(value, EVIDENCE_KEYS, label, errors);
  if (record === null) return null;
  return {
    sourceId: text(record.sourceId, `${label}.sourceId`, errors),
    locator: text(record.locator, `${label}.locator`, errors),
    rawValue: record.rawValue,
    normalizedValue: record.normalizedValue,
    unit: nullableText(record.unit, `${label}.unit`, errors),
    year: nullableNumber(record.year, `${label}.year`, errors),
  };
}

function parseReport(
  value: BasicCollectionJsonValue,
  errors: string[],
): BasicCollectionReviewReportV2 | null {
  const record = exactRecord(value, REPORT_KEYS, "reviewReport", errors);
  if (record === null) return null;
  if (record.humanDecision !== null) errors.push("reviewReport.humanDecision must be null");
  return {
    schemaVersion: schema(record.schemaVersion, "reviewReport.schemaVersion", errors),
    runId: run(record.runId, "reviewReport.runId", errors),
    countryCode: country(record.countryCode, "reviewReport.countryCode", errors),
    status: enumValue(record.status, ["ready-for-human-review", "blocked"], "reviewReport.status", errors),
    missingFields: fieldPaths(record.missingFields, "reviewReport.missingFields", errors),
    conflicts: values(record.conflicts, "reviewReport.conflicts", errors, parseConflict),
    sourceChecks: values(record.sourceChecks, "reviewReport.sourceChecks", errors, parseSourceCheck),
    injectionRisks: values(record.injectionRisks, "reviewReport.injectionRisks", errors, parseInjectionRisk),
    publicationRecommendation: enumValue(record.publicationRecommendation, ["request-human-review", "do-not-publish"], "reviewReport.publicationRecommendation", errors),
    humanDecision: null,
  };
}

function parseConflict(value: BasicCollectionJsonValue, label: string, errors: string[]): BasicReviewConflict | null {
  const record = exactRecord(value, CONFLICT_KEYS, label, errors);
  return record === null ? null : {
    fieldPath: fieldPath(record.fieldPath, `${label}.fieldPath`, errors),
    factIds: strings(record.factIds, `${label}.factIds`, errors, true),
    resolution: enumValue(record.resolution, ["unresolved", "resolved"], `${label}.resolution`, errors),
    notes: text(record.notes, `${label}.notes`, errors),
  };
}

function parseSourceCheck(value: BasicCollectionJsonValue, label: string, errors: string[]): BasicSourceCheck | null {
  const record = exactRecord(value, SOURCE_CHECK_KEYS, label, errors);
  return record === null ? null : {
    sourceId: text(record.sourceId, `${label}.sourceId`, errors),
    status: enumValue(record.status, ["passed", "failed"], `${label}.status`, errors),
    notes: nullableText(record.notes, `${label}.notes`, errors),
  };
}

function parseInjectionRisk(value: BasicCollectionJsonValue, label: string, errors: string[]): BasicInjectionRisk | null {
  const record = exactRecord(value, INJECTION_RISK_KEYS, label, errors);
  return record === null ? null : {
    sourceId: text(record.sourceId, `${label}.sourceId`, errors),
    locator: text(record.locator, `${label}.locator`, errors),
    severity: enumValue(record.severity, ["suspected", "confirmed"], `${label}.severity`, errors),
    details: text(record.details, `${label}.details`, errors),
  };
}

function exactRecord<const Keys extends readonly string[]>(
  value: BasicCollectionJsonValue,
  keys: Keys,
  label: string,
  errors: string[],
): ExactJsonRecord<Keys> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    errors.push(`${label} must have exactly ${keyList(keys)} own keys`);
    return null;
  }
  const actual = Object.keys(value);
  if (actual.length !== keys.length || !keys.every((key) => Object.hasOwn(value, key))) {
    errors.push(`${label} must have exactly ${keyList(keys)} own keys`);
    return null;
  }
  return value as ExactJsonRecord<Keys>;
}

function values<T>(value: BasicCollectionJsonValue, label: string, errors: string[], parse: (item: BasicCollectionJsonValue, label: string, errors: string[]) => T | null): T[] {
  if (!Array.isArray(value)) {
    errors.push(`${label} must be a standard JSON array`);
    return [];
  }
  const result: T[] = [];
  for (const [index, item] of value.entries()) {
    const parsed = parse(item, `${label}[${index}]`, errors);
    if (parsed !== null) result.push(parsed);
  }
  return result;
}

function strings(value: BasicCollectionJsonValue, label: string, errors: string[], required: boolean): string[] {
  if (!Array.isArray(value)) {
    errors.push(`${label} must be a standard JSON array`);
    return [];
  }
  if (required && value.length === 0) errors.push(`${label} must be a non-empty array`);
  return value.map((item, index) => text(item, `${label}[${index}]`, errors));
}

function fieldPaths(value: BasicCollectionJsonValue, label: string, errors: string[]): string[] {
  if (!Array.isArray(value)) {
    errors.push(`${label} must be a standard JSON array`);
    return [];
  }
  return value.map((item, index) => fieldPath(item, `${label}[${index}]`, errors));
}

function text(value: BasicCollectionJsonValue, label: string, errors: string[]): string {
  if (typeof value !== "string") {
    errors.push(`${label} must be a string`);
    return "";
  }
  if (value.trim() === "") errors.push(`${label} must be a non-empty string`);
  return value;
}

function nullableText(value: BasicCollectionJsonValue, label: string, errors: string[]): string | null {
  return value === null ? null : text(value, label, errors);
}

function nullableNumber(value: BasicCollectionJsonValue, label: string, errors: string[]): number | null {
  if (value === null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  errors.push(`${label} must be a finite number`);
  return 0;
}

function booleanValue(value: BasicCollectionJsonValue, label: string, errors: string[]): boolean {
  if (typeof value === "boolean") return value;
  errors.push(`${label} must be a boolean`);
  return false;
}

function enumValue<T extends string>(value: BasicCollectionJsonValue, allowed: readonly T[], label: string, errors: string[]): T {
  if (isEnumValue(value, allowed)) return value;
  errors.push(`${label} must be one of ${allowed.join(", ")}`);
  return allowed[0]!;
}

function timestamp(value: BasicCollectionJsonValue, label: string, errors: string[]): string {
  const result = text(value, label, errors);
  expectUtcRfc3339Timestamp(result, label, errors);
  return result;
}

function nullableTimestamp(value: BasicCollectionJsonValue, label: string, errors: string[]): string | null {
  return value === null ? null : timestamp(value, label, errors);
}

function url(value: BasicCollectionJsonValue, label: string, errors: string[]): string {
  const result = text(value, label, errors);
  if (!isBasicV2ReviewedSourceUrl(result)) {
    errors.push(`${label} must be an HTTPS URL without credentials or fragment`);
  }
  return result;
}

function country(value: BasicCollectionJsonValue, label: string, errors: string[]): string {
  const result = text(value, label, errors);
  if (!/^[A-Z]{2}$/.test(result)) errors.push(`${label} must be an uppercase two-letter country code`);
  return result;
}

function run(value: BasicCollectionJsonValue, label: string, errors: string[]): string {
  const result = text(value, label, errors);
  if (!SAFE_RUN_ID.test(result)) errors.push(`${label} must be a safe run id`);
  return result;
}

function slug(value: BasicCollectionJsonValue, label: string, errors: string[]): string {
  const result = text(value, label, errors);
  if (!SAFE_COUNTRY_DIRECTORY.test(result)) errors.push(`${label} must be a safe slug`);
  return result;
}

function schema(value: BasicCollectionJsonValue, label: string, errors: string[]): typeof BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION {
  if (value === BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION) return value;
  errors.push(`${label} must equal ${BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION}`);
  return BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION;
}

function version(value: BasicCollectionJsonValue, label: string, errors: string[]): string {
  const result = text(value, label, errors);
  if (!SAFE_VERSION.test(result)) errors.push(`${label} must be a safe version token`);
  return result;
}

function sha256(value: BasicCollectionJsonValue, label: string, errors: string[]): string {
  const result = text(value, label, errors);
  if (!/^[0-9a-f]{64}$/.test(result)) errors.push(`${label} must be a lowercase SHA-256 hash`);
  return result;
}

function fieldPath(value: BasicCollectionJsonValue, label: string, errors: string[]): string {
  const result = text(value, label, errors);
  if (!STATIC_PATHS.has(result) && !INDICATOR_PATH.test(result)) {
    errors.push(`${label} must be an allowed fieldPath`);
  }
  return result;
}

function validateUniqueBy<T>(
  valuesToCheck: readonly T[],
  key: (value: T) => string,
  label: string,
  keyLabel: string,
  errors: string[],
): void {
  const seen = new Map<string, number>();
  for (const [index, value] of valuesToCheck.entries()) {
    const itemKey = key(value);
    const prior = seen.get(itemKey);
    if (prior !== undefined) {
      errors.push(
        `${label}[${index}].${keyLabel} duplicates ${label}[${prior}].${keyLabel}`,
      );
    } else {
      seen.set(itemKey, index);
    }
  }
}

function validateSortedBy<T>(
  valuesToCheck: readonly T[],
  key: (value: T) => string,
  message: string,
  errors: string[],
): void {
  for (let index = 1; index < valuesToCheck.length; index += 1) {
    if (compareText(key(valuesToCheck[index - 1]!), key(valuesToCheck[index]!)) > 0) {
      errors.push(message);
      return;
    }
  }
}

function validateUniqueSortedStrings(
  valuesToCheck: readonly string[],
  label: string,
  errors: string[],
): void {
  const firstIndex = new Map<string, number>();
  let orderReported = false;
  for (const [index, value] of valuesToCheck.entries()) {
    const prior = firstIndex.get(value);
    if (prior !== undefined) {
      errors.push(`${label}[${index}] duplicates ${label}[${prior}]`);
    } else {
      firstIndex.set(value, index);
    }
    if (
      !orderReported &&
      index > 0 &&
      compareText(valuesToCheck[index - 1]!, value) > 0
    ) {
      errors.push(`${label} must be unique and sorted`);
      orderReported = true;
    }
  }
}

function matchIdentities(
  runId: string,
  register: BasicSourceRegisterV2,
  facts: BasicExtractedFactsV2,
  draft: BasicMarketOverviewDraft,
  report: BasicCollectionReviewReportV2,
  errors: string[],
): void {
  for (const [label, candidate] of [
    ["sourceRegister.runId", register.runId],
    ["extractedFacts.runId", facts.runId],
    ["reviewReport.runId", report.runId],
  ] as const) if (candidate !== runId) errors.push(`${label} must match runId`);
  for (const [label, candidate] of [
    ["extractedFacts.countryCode", facts.countryCode],
    ["marketOverviewDraft.countryCode", draft.countryCode],
    ["reviewReport.countryCode", report.countryCode],
  ] as const) if (candidate !== register.countryCode) {
    errors.push(`${label} must match sourceRegister.countryCode`);
  }
}

function frozenResult(
  data: BasicCollectionAuditBundleV2 | null,
  errors: readonly string[],
  summary: BasicCollectionAuditSummary,
): BasicCollectionAuditParseResultV2 {
  return deepFreezeBasicOfflineValue({ data, errors: [...errors], summary });
}

function summaryFor(data: BasicCollectionAuditBundleV2): BasicCollectionAuditSummary {
  return {
    countryCode: data.sourceRegister.countryCode,
    runId: data.runId,
    sourceCount: data.sourceRegister.sources.length,
    factCount: data.extractedFacts.facts.length,
  };
}

function countSummary(data: BasicCollectionAuditBundleV2): BasicCollectionAuditSummary {
  return {
    countryCode: "",
    runId: "",
    sourceCount: data.sourceRegister.sources.length,
    factCount: data.extractedFacts.facts.length,
  };
}

function buildSummary(value: BasicCollectionJsonValue): BasicCollectionAuditSummary {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return emptySummary();
  const register = value.sourceRegister;
  const facts = value.extractedFacts;
  return {
    countryCode: "",
    runId: "",
    sourceCount: isRecord(register) && Array.isArray(register.sources) ? register.sources.length : 0,
    factCount: isRecord(facts) && Array.isArray(facts.facts) ? facts.facts.length : 0,
  };
}

function isRecord(value: BasicCollectionJsonValue | undefined): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function emptySummary(): BasicCollectionAuditSummary {
  return { countryCode: "", runId: "", sourceCount: 0, factCount: 0 };
}

function keyList(keys: readonly string[]): string {
  return keys.length === 1
    ? keys[0]!
    : `${keys.slice(0, -1).join(", ")}, and ${keys.at(-1)}`;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
