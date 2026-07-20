import type {
  BasicCollectionAuditSummary,
  BasicCollectionJsonValue,
} from "./basic-collection-contracts.js";
import {
  BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION,
  type BasicExtractedFactV2,
} from "./basic-collection-v2-contracts.js";
import { parseBasicCollectionAuditBundleV2 } from "./basic-collection-v2-parser.js";
import {
  BASIC_COLLECTION_AUDIT_V3_SCHEMA_VERSION,
  BASIC_V3_PROFILE_FACT_PATH_PREFIX,
  parseBasicV3ProfileFactPath,
  type BasicCollectionAuditBundleV3,
  type BasicCollectionAuditParseResultV3,
  type BasicExtractedFactV3,
} from "./basic-collection-v3-contracts.js";
import { snapshotBasicBoundedJsonValue } from "./basic-bounded-json.js";
import {
  basicMarketOverviewDraftV2ValueFromUnknown,
  parseBasicMarketOverviewDraftV3ForAudit,
} from "./basic-market-overview-draft-v3-parser.js";
import { deepFreezeBasicOfflineValue } from "./basic-offline-value.js";

const BUNDLE_KEYS = [
  "countryDirectory", "runId", "sourceRegister", "extractedFacts",
  "marketOverviewDraft", "reviewReport",
] as const;
const FACT_KEYS = [
  "factId", "fieldPath", "status", "evidence", "extractionMethod", "uncertainty",
] as const;
const EVIDENCE_KEYS = [
  "sourceId", "locator", "rawValue", "normalizedValue", "unit", "year",
] as const;
const V3_SNAPSHOT_BUDGETS = Object.freeze({
  maximumObjectProperties: 512,
  maximumTotalNodes: 131_072,
});

export function parseBasicCollectionAuditBundleV3(
  value: unknown,
): BasicCollectionAuditParseResultV3 {
  const snapshot = snapshotBasicBoundedJsonValue(
    value,
    () => undefined,
    V3_SNAPSHOT_BUDGETS,
  );
  if (!snapshot.valid) {
    return frozenResult(null, ["bundle must be a bounded JSON value"], emptySummary());
  }
  const summary = buildSummary(snapshot.data);
  if (!isExactRecord(snapshot.data, BUNDLE_KEYS)) {
    return frozenResult(null, ["bundle must have exactly the v3 audit bundle keys"], summary);
  }

  const errors: string[] = [];
  const raw = snapshot.data;
  const sourceRegister = record(raw.sourceRegister);
  const extractedFacts = record(raw.extractedFacts);
  const reviewReport = record(raw.reviewReport);
  validateV3EnvelopeVersion(sourceRegister, "sourceRegister", errors);
  validateV3EnvelopeVersion(extractedFacts, "extractedFacts", errors);
  validateV3EnvelopeVersion(reviewReport, "reviewReport", errors);

  const parsedDraft = parseBasicMarketOverviewDraftV3ForAudit(raw.marketOverviewDraft);
  errors.push(...parsedDraft.errors);

  const factsValue = extractedFacts?.facts;
  const baseFactValues: BasicCollectionJsonValue[] = [];
  const profileFacts: BasicExtractedFactV3[] = [];
  if (!Array.isArray(factsValue)) {
    errors.push("extractedFacts.facts must be a standard JSON array");
  } else {
    for (const [index, factValue] of factsValue.entries()) {
      const factRecord = record(factValue);
      const fieldPath = factRecord?.fieldPath;
      if (
        typeof fieldPath === "string" &&
        fieldPath.startsWith(BASIC_V3_PROFILE_FACT_PATH_PREFIX)
      ) {
        const parsed = parseProfileFact(factValue, index, errors);
        if (parsed !== null) profileFacts.push(parsed);
      } else {
        baseFactValues.push(factValue);
      }
    }
  }

  const v2Candidate = {
    ...raw,
    sourceRegister: sourceRegister === null ? raw.sourceRegister : {
      ...sourceRegister,
      schemaVersion: BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION,
    },
    extractedFacts: extractedFacts === null ? raw.extractedFacts : {
      ...extractedFacts,
      schemaVersion: BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION,
      facts: baseFactValues,
    },
    marketOverviewDraft: basicMarketOverviewDraftV2ValueFromUnknown(
      raw.marketOverviewDraft,
    ),
    reviewReport: reviewReport === null ? raw.reviewReport : {
      ...reviewReport,
      schemaVersion: BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION,
    },
  };
  const parsedV2 = parseBasicCollectionAuditBundleV2(v2Candidate);
  errors.push(...parsedV2.errors);
  validateAllFactIdentitiesAndOrder(factsValue, errors);

  if (
    errors.length > 0 || parsedV2.data === null || parsedDraft.data === null ||
    sourceRegister === null || extractedFacts === null || reviewReport === null
  ) return frozenResult(null, errors, summary);

  const data: BasicCollectionAuditBundleV3 = {
    countryDirectory: parsedV2.data.countryDirectory,
    runId: parsedV2.data.runId,
    sourceRegister: {
      ...parsedV2.data.sourceRegister,
      schemaVersion: BASIC_COLLECTION_AUDIT_V3_SCHEMA_VERSION,
    },
    extractedFacts: {
      schemaVersion: BASIC_COLLECTION_AUDIT_V3_SCHEMA_VERSION,
      runId: parsedV2.data.extractedFacts.runId,
      countryCode: parsedV2.data.extractedFacts.countryCode,
      facts: [...parsedV2.data.extractedFacts.facts, ...profileFacts].sort(
        (left, right) => compareText(left.fieldPath, right.fieldPath),
      ),
    },
    marketOverviewDraft: parsedDraft.data,
    reviewReport: {
      ...parsedV2.data.reviewReport,
      schemaVersion: BASIC_COLLECTION_AUDIT_V3_SCHEMA_VERSION,
    },
  };
  return frozenResult(data, [], summaryFor(data));
}

function parseProfileFact(
  value: BasicCollectionJsonValue,
  index: number,
  errors: string[],
): BasicExtractedFactV3 | null {
  const label = `extractedFacts.facts[${index}]`;
  if (!isExactRecord(value, FACT_KEYS)) {
    errors.push(`${label} must have exactly the v3 fact keys`);
    return null;
  }
  const factId = nonblank(value.factId, `${label}.factId`, errors);
  const fieldPath = nonblank(value.fieldPath, `${label}.fieldPath`, errors);
  if (parseBasicV3ProfileFactPath(fieldPath) === null) {
    errors.push(`${label}.fieldPath must be an allowed v3 profile fieldPath`);
  }
  if (value.status !== "candidate") {
    errors.push(`${label}.status must be candidate for a v3 profile fact`);
  }
  const evidence = parseProfileEvidence(value.evidence, label, errors);
  const extractionMethod = value.extractionMethod;
  if (extractionMethod !== "deterministic" && extractionMethod !== "manual") {
    errors.push(`${label}.extractionMethod must be deterministic or manual`);
  }
  const uncertainty = value.uncertainty === null
    ? null
    : nonblank(value.uncertainty, `${label}.uncertainty`, errors);
  return {
    factId,
    fieldPath,
    status: "candidate",
    evidence,
    extractionMethod: extractionMethod === "manual" ? "manual" : "deterministic",
    uncertainty,
  };
}

function parseProfileEvidence(
  value: BasicCollectionJsonValue,
  factLabel: string,
  errors: string[],
): BasicExtractedFactV2["evidence"] {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${factLabel}.evidence must contain at least one item for candidate`);
    return [];
  }
  return value.flatMap((item, index) => {
    const label = `${factLabel}.evidence[${index}]`;
    if (!isExactRecord(item, EVIDENCE_KEYS)) {
      errors.push(`${label} must have exactly the v3 evidence keys`);
      return [];
    }
    return [{
      sourceId: nonblank(item.sourceId, `${label}.sourceId`, errors),
      locator: nonblank(item.locator, `${label}.locator`, errors),
      rawValue: item.rawValue,
      normalizedValue: item.normalizedValue,
      unit: item.unit === null ? null : nonblank(item.unit, `${label}.unit`, errors),
      year: nullableFiniteNumber(item.year, `${label}.year`, errors),
    }];
  });
}

function validateV3EnvelopeVersion(
  value: Record<string, BasicCollectionJsonValue> | null,
  label: string,
  errors: string[],
): void {
  if (value === null || value.schemaVersion !== BASIC_COLLECTION_AUDIT_V3_SCHEMA_VERSION) {
    errors.push(`${label}.schemaVersion must equal ${BASIC_COLLECTION_AUDIT_V3_SCHEMA_VERSION}`);
  }
}

function validateAllFactIdentitiesAndOrder(
  value: BasicCollectionJsonValue | undefined,
  errors: string[],
): void {
  if (!Array.isArray(value)) return;
  const factIds = new Map<string, number>();
  const paths = new Map<string, number>();
  let previousPath: string | undefined;
  for (const [index, item] of value.entries()) {
    const fact = record(item);
    if (fact === null || typeof fact.factId !== "string" || typeof fact.fieldPath !== "string") {
      continue;
    }
    const priorId = factIds.get(fact.factId);
    if (priorId !== undefined) {
      errors.push(`extractedFacts.facts[${index}].factId duplicates extractedFacts.facts[${priorId}].factId`);
    } else factIds.set(fact.factId, index);
    const priorPath = paths.get(fact.fieldPath);
    if (priorPath !== undefined) {
      errors.push(`extractedFacts.facts[${index}].fieldPath duplicates extractedFacts.facts[${priorPath}].fieldPath`);
    } else paths.set(fact.fieldPath, index);
    if (previousPath !== undefined && compareText(previousPath, fact.fieldPath) > 0) {
      errors.push("extractedFacts.facts must be unique and sorted by fieldPath");
      previousPath = undefined;
    } else previousPath = fact.fieldPath;
  }
}

function record(
  value: BasicCollectionJsonValue | undefined,
): Record<string, BasicCollectionJsonValue> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
}

function isExactRecord<const Keys extends readonly string[]>(
  value: BasicCollectionJsonValue,
  keys: Keys,
): value is Record<Keys[number], BasicCollectionJsonValue> {
  const candidate = record(value);
  if (candidate === null) return false;
  const actual = Object.keys(candidate);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function nonblank(
  value: BasicCollectionJsonValue,
  label: string,
  errors: string[],
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${label} must be a non-empty string`);
    return "";
  }
  return value;
}

function nullableFiniteNumber(
  value: BasicCollectionJsonValue,
  label: string,
  errors: string[],
): number | null {
  if (value === null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  errors.push(`${label} must be a finite number or null`);
  return null;
}

function buildSummary(value: BasicCollectionJsonValue): BasicCollectionAuditSummary {
  const bundle = record(value);
  const register = record(bundle?.sourceRegister);
  const facts = record(bundle?.extractedFacts);
  return {
    countryCode: "",
    runId: "",
    sourceCount: Array.isArray(register?.sources) ? register.sources.length : 0,
    factCount: Array.isArray(facts?.facts) ? facts.facts.length : 0,
  };
}

function summaryFor(data: BasicCollectionAuditBundleV3): BasicCollectionAuditSummary {
  return {
    countryCode: data.sourceRegister.countryCode,
    runId: data.runId,
    sourceCount: data.sourceRegister.sources.length,
    factCount: data.extractedFacts.facts.length,
  };
}

function emptySummary(): BasicCollectionAuditSummary {
  return { countryCode: "", runId: "", sourceCount: 0, factCount: 0 };
}

function frozenResult(
  data: BasicCollectionAuditBundleV3 | null,
  errors: readonly string[],
  summary: BasicCollectionAuditSummary,
): BasicCollectionAuditParseResultV3 {
  return deepFreezeBasicOfflineValue({ data, errors: [...errors], summary });
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
