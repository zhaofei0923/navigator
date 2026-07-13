import { BASIC_COLLECTION_REQUIRED_STATIC_FACT_PATHS } from "./basic-collection-contracts.js";
import {
  BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION,
  type BasicCollectionAuditAssemblyInputV2,
  type BasicCollectionAuditBundleV2,
  type BasicCollectionReviewReportV2,
  type BasicExtractedFactV2,
} from "./basic-collection-v2-contracts.js";
import { snapshotBasicBoundedJsonValue } from "./basic-bounded-json.js";
import { validateBasicCollectionAuditBundleV2 } from "./basic-collection-v2-validator.js";

const INPUT_KEYS = [
  "countryDirectory",
  "runId",
  "catalogVersion",
  "catalogSha256",
  "sourceRegister",
  "extractedFacts",
  "marketOverviewDraft",
  "sourceChecks",
  "injectionRisks",
] as const;
const INPUT_KEY_SET = new Set<string>(INPUT_KEYS);
const INDICATOR_KEYS = ["label", "value", "unit", "year"] as const;
const ERROR = "Basic audit v2 assembly failed";

export function assembleBasicCollectionAuditBundleV2(
  input: BasicCollectionAuditAssemblyInputV2,
): BasicCollectionAuditBundleV2 {
  try {
    const snapshot = snapshotBasicBoundedJsonValue(input);
    if (!snapshot.valid || !hasExactInputKeys(snapshot.data)) invalid();
    const material = snapshot.data as unknown as BasicCollectionAuditAssemblyInputV2;
    if (
      material.catalogVersion !== material.sourceRegister.catalogVersion ||
      material.catalogSha256 !== material.sourceRegister.catalogSha256 ||
      material.runId !== material.sourceRegister.runId ||
      material.runId !== material.extractedFacts.runId
    ) invalid();

    const blocked = validateBasicCollectionAuditBundleV2(
      buildBundle(material, "blocked"),
    );
    if (blocked.valid) return blocked.data;

    const ready = validateBasicCollectionAuditBundleV2(
      buildBundle(material, "ready"),
    );
    if (!ready.valid || !ready.readyForHumanReview || ready.blockers.length > 0) invalid();
    return ready.data;
  } catch {
    throw new Error(ERROR);
  }
}

function buildBundle(
  input: BasicCollectionAuditAssemblyInputV2,
  mode: "blocked" | "ready",
): BasicCollectionAuditBundleV2 {
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
  input: BasicCollectionAuditAssemblyInputV2,
  mode: "blocked" | "ready",
): BasicCollectionReviewReportV2 {
  const blocked = mode === "blocked";
  return {
    schemaVersion: BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION,
    runId: input.runId,
    countryCode: input.sourceRegister.countryCode,
    status: blocked ? "blocked" : "ready-for-human-review",
    missingFields: deriveMissingFields(
      input.extractedFacts.facts,
      input.marketOverviewDraft.keyIndicators.length,
    ),
    conflicts: input.extractedFacts.facts
      .filter(({ status }) => status === "conflict")
      .sort(compareFacts)
      .map((fact) => ({
        fieldPath: fact.fieldPath,
        factIds: [fact.factId],
        resolution: "unresolved" as const,
        notes: "unresolved evidence conflict",
      })),
    sourceChecks: [...input.sourceChecks].sort(compareSourceChecks),
    injectionRisks: [...input.injectionRisks].sort(compareRisks),
    publicationRecommendation: blocked ? "do-not-publish" : "request-human-review",
    humanDecision: null,
  };
}

function deriveMissingFields(
  facts: readonly BasicExtractedFactV2[],
  indicatorCount: number,
): readonly string[] {
  const paths = new Set(facts.map(({ fieldPath }) => fieldPath));
  const missing = new Set(
    facts.filter(({ status }) => status === "missing").map(({ fieldPath }) => fieldPath),
  );
  for (const path of BASIC_COLLECTION_REQUIRED_STATIC_FACT_PATHS) {
    if (!paths.has(path)) missing.add(path);
  }
  for (let index = 0; index < indicatorCount; index += 1) {
    for (const key of INDICATOR_KEYS) {
      const path = `marketOverview.keyIndicators[${index}].${key}`;
      if (!paths.has(path)) missing.add(path);
    }
  }
  return [...missing].sort(compareText);
}

function compareFacts(left: BasicExtractedFactV2, right: BasicExtractedFactV2): number {
  return compareText(left.fieldPath, right.fieldPath) || compareText(left.factId, right.factId);
}

function compareSourceChecks(
  left: BasicCollectionAuditAssemblyInputV2["sourceChecks"][number],
  right: BasicCollectionAuditAssemblyInputV2["sourceChecks"][number],
): number {
  return compareText(left.sourceId, right.sourceId) || compareText(left.status, right.status) ||
    compareText(left.notes ?? "", right.notes ?? "");
}

function compareRisks(
  left: BasicCollectionAuditAssemblyInputV2["injectionRisks"][number],
  right: BasicCollectionAuditAssemblyInputV2["injectionRisks"][number],
): number {
  return compareText(left.sourceId, right.sourceId) || compareText(left.locator, right.locator) ||
    compareText(left.severity, right.severity) || compareText(left.details, right.details);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function hasExactInputKeys(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    Object.keys(value).length === INPUT_KEYS.length &&
    Object.keys(value).every((key) => INPUT_KEY_SET.has(key));
}

function invalid(): never {
  throw new Error(ERROR);
}
