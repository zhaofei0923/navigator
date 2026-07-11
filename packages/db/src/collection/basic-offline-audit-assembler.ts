import {
  BASIC_COLLECTION_AUDIT_SCHEMA_VERSION,
  BASIC_COLLECTION_REQUIRED_STATIC_FACT_PATHS,
  type BasicCollectionAuditBundle,
  type BasicCollectionReviewReport,
  type BasicExtractedFact,
  type BasicMarketOverviewDraft,
} from "./basic-collection-contracts.js";
import type { BasicCollectionAuditAssemblyInput } from "./basic-offline-dry-run-contracts.js";
import {
  deepFreezeBasicOfflineValue,
  isRecord,
  snapshotBasicOfflineValue,
} from "./basic-offline-value.js";
import { validateBasicCollectionAuditBundle } from "./basic-collection-validator.js";

const INPUT_KEYS = [
  "countryDirectory",
  "runId",
  "sourceRegister",
  "extractedFacts",
  "marketOverviewDraft",
  "sourceChecks",
  "injectionRisks",
] as const;
const INPUT_KEY_SET = new Set<string>(INPUT_KEYS);
const INDICATOR_FIELDS = ["label", "value", "unit", "year"] as const;
const ASSEMBLY_ERROR = "P1-6D audit assembly failed";

export function assembleBasicCollectionAuditBundle(
  input: BasicCollectionAuditAssemblyInput,
): BasicCollectionAuditBundle {
  try {
    const snapshot = snapshotBasicOfflineValue(input);
    if (!snapshot.valid || !hasExactInputKeys(snapshot.data)) throw new Error(ASSEMBLY_ERROR);
    const material = snapshot.data as unknown as BasicCollectionAuditAssemblyInput;
    const blockedBundle = buildBundle(material, "blocked");
    const blockedValidation = validateBasicCollectionAuditBundle(blockedBundle);
    if (!blockedValidation.valid) throw new Error(ASSEMBLY_ERROR);
    if (blockedValidation.blockers.length > 0) {
      return deepFreezeBasicOfflineValue(blockedValidation.data);
    }
    const readyValidation = validateBasicCollectionAuditBundle(buildBundle(material, "ready"));
    if (!readyValidation.valid || readyValidation.blockers.length > 0 || !readyValidation.readyForHumanReview) {
      throw new Error(ASSEMBLY_ERROR);
    }
    return deepFreezeBasicOfflineValue(readyValidation.data);
  } catch {
    throw new Error(ASSEMBLY_ERROR);
  }
}

function buildBundle(
  input: BasicCollectionAuditAssemblyInput,
  mode: "blocked" | "ready",
): BasicCollectionAuditBundle {
  return {
    countryDirectory: input.countryDirectory,
    runId: input.runId,
    sourceRegister: input.sourceRegister,
    extractedFacts: input.extractedFacts,
    marketOverviewDraft: input.marketOverviewDraft,
    reviewReport: buildReport(input, mode),
  };
}

function buildReport(
  input: BasicCollectionAuditAssemblyInput,
  mode: "blocked" | "ready",
): BasicCollectionReviewReport {
  const blocked = mode === "blocked";
  return {
    schemaVersion: BASIC_COLLECTION_AUDIT_SCHEMA_VERSION,
    runId: input.runId,
    countryCode: input.sourceRegister.countryCode,
    status: blocked ? "blocked" : "ready-for-human-review",
    missingFields: deriveMissingFields(input.extractedFacts.facts, input.marketOverviewDraft),
    conflicts: input.extractedFacts.facts
      .filter((fact) => fact.status === "conflict")
      .sort(compareFacts)
      .map((fact) => ({
        fieldPath: fact.fieldPath,
        factIds: [fact.factId],
        resolution: "unresolved" as const,
        notes: "unresolved evidence conflict",
      })),
    sourceChecks: [...input.sourceChecks],
    injectionRisks: [...input.injectionRisks],
    publicationRecommendation: blocked ? "do-not-publish" : "request-human-review",
    humanDecision: null,
  };
}

function deriveMissingFields(
  facts: readonly BasicExtractedFact[],
  draft: BasicMarketOverviewDraft,
): string[] {
  const paths = new Set(facts.map(({ fieldPath }) => fieldPath));
  const missing = new Set(
    facts.filter(({ status }) => status === "missing").map(({ fieldPath }) => fieldPath),
  );
  for (const requiredPath of requiredPaths(draft)) {
    if (!paths.has(requiredPath)) missing.add(requiredPath);
  }
  return [...missing].sort(compareText);
}

function requiredPaths(draft: BasicMarketOverviewDraft): string[] {
  const paths: string[] = [...BASIC_COLLECTION_REQUIRED_STATIC_FACT_PATHS];
  if (!Array.isArray(draft.keyIndicators)) return paths;
  for (const index of draft.keyIndicators.keys()) {
    for (const field of INDICATOR_FIELDS) {
      paths.push(`marketOverview.keyIndicators[${index}].${field}`);
    }
  }
  return paths;
}

function compareFacts(left: BasicExtractedFact, right: BasicExtractedFact): number {
  return compareText(left.fieldPath, right.fieldPath) || compareText(left.factId, right.factId);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function hasExactInputKeys(value: unknown): boolean {
  return isRecord(value) && Object.keys(value).length === INPUT_KEYS.length &&
    Object.keys(value).every((key) => INPUT_KEY_SET.has(key));
}
