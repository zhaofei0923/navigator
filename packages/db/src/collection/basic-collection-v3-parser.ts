import type {
  BasicCollectionAuditSummary,
  BasicCollectionJsonValue,
} from "./basic-collection-contracts.js";
import {
  BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION,
} from "./basic-collection-v2-contracts.js";
import { parseBasicCollectionAuditBundleV2 } from "./basic-collection-v2-parser.js";
import {
  BASIC_COLLECTION_AUDIT_V3_SCHEMA_VERSION,
  BASIC_V3_PROFILE_FACT_PATH_PREFIX,
  type BasicCollectionAuditBundleV3,
  type BasicCollectionAuditParseResultV3,
  type BasicExtractedFactV3,
} from "./basic-collection-v3-contracts.js";
import {
  basicCollectionRecord,
  compareBasicCollectionText,
  isExactBasicCollectionRecord,
  parseBasicV3ProfileFact,
  validateBasicV3FactIdentitiesAndOrder,
} from "./basic-collection-v3-parser-helpers.js";
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
  if (!isExactBasicCollectionRecord(snapshot.data, BUNDLE_KEYS)) {
    return frozenResult(null, ["bundle must have exactly the v3 audit bundle keys"], summary);
  }

  const errors: string[] = [];
  const raw = snapshot.data;
  const sourceRegister = basicCollectionRecord(raw.sourceRegister);
  const extractedFacts = basicCollectionRecord(raw.extractedFacts);
  const reviewReport = basicCollectionRecord(raw.reviewReport);
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
      const factRecord = basicCollectionRecord(factValue);
      const fieldPath = factRecord?.fieldPath;
      if (
        typeof fieldPath === "string" &&
        fieldPath.startsWith(BASIC_V3_PROFILE_FACT_PATH_PREFIX)
      ) {
        const parsed = parseBasicV3ProfileFact(factValue, index, errors);
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
  validateBasicV3FactIdentitiesAndOrder(factsValue, errors);

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
        (left, right) => compareBasicCollectionText(left.fieldPath, right.fieldPath),
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

function validateV3EnvelopeVersion(
  value: Record<string, BasicCollectionJsonValue> | null,
  label: string,
  errors: string[],
): void {
  if (value === null || value.schemaVersion !== BASIC_COLLECTION_AUDIT_V3_SCHEMA_VERSION) {
    errors.push(`${label}.schemaVersion must equal ${BASIC_COLLECTION_AUDIT_V3_SCHEMA_VERSION}`);
  }
}

function buildSummary(value: BasicCollectionJsonValue): BasicCollectionAuditSummary {
  const bundle = basicCollectionRecord(value);
  const register = basicCollectionRecord(bundle?.sourceRegister);
  const facts = basicCollectionRecord(bundle?.extractedFacts);
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
