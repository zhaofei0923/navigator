import {
  BASIC_COLLECTION_BLOCKER_CODES,
  BASIC_COLLECTION_REQUIRED_STATIC_FACT_PATHS,
  type BasicCollectionAuditBundle,
  type BasicCollectionBlockerCode,
  type BasicExtractedFact,
  type BasicMarketOverviewDraft,
} from "./basic-collection-contracts.js";

const INDICATOR_FACT_PATH =
  /^marketOverview\.keyIndicators\[(0|[1-9]\d*)\]\.(label|value|unit|year)$/;

export interface BasicCollectionAuditClassification {
  blockers: BasicCollectionBlockerCode[];
  errors: string[];
  readyForHumanReview: boolean;
}

export function classifyBasicCollectionAuditBundle(
  bundle: BasicCollectionAuditBundle,
): BasicCollectionAuditClassification {
  const errors: string[] = [];
  const blockerSet = new Set<BasicCollectionBlockerCode>();
  const sourcesById = new Map(
    bundle.sourceRegister.sources.map((source) => [source.sourceId, source]),
  );
  const sourceIds = new Set(sourcesById.keys());
  const factIds = new Set(bundle.extractedFacts.facts.map((fact) => fact.factId));
  const factPaths = new Set(bundle.extractedFacts.facts.map((fact) => fact.fieldPath));
  const firstFactIndexByPath = new Map<string, number>();
  const passedSourceIds = new Set(
    bundle.reviewReport.sourceChecks
      .filter(({ status }) => status === "passed")
      .map(({ sourceId }) => sourceId),
  );
  const evidenceSourceIds = new Set<string>();

  for (const [index, fact] of bundle.extractedFacts.facts.entries()) {
    const firstFactIndex = firstFactIndexByPath.get(fact.fieldPath);
    if (firstFactIndex === undefined) {
      firstFactIndexByPath.set(fact.fieldPath, index);
    } else {
      errors.push(
        `extractedFacts.facts[${index}].fieldPath duplicates extractedFacts.facts[${firstFactIndex}].fieldPath`,
      );
    }
    for (const [evidenceIndex, evidence] of fact.evidence.entries()) {
      evidenceSourceIds.add(evidence.sourceId);
      const source = sourcesById.get(evidence.sourceId);
      if (source === undefined) {
        errors.push(`extractedFacts.facts[${index}].evidence[${evidenceIndex}].sourceId must reference a registered sourceId`);
      } else if (!source.evidenceLocators.includes(evidence.locator)) {
        errors.push(
          `extractedFacts.facts[${index}].evidence[${evidenceIndex}].locator must match a registered evidenceLocator for ${evidence.sourceId}`,
        );
      }
    }
    validateCandidateNormalizedValues(bundle, fact, index, errors);
    if (fact.status === "missing") blockerSet.add("MISSING_REQUIRED_FACT");
    if (fact.status === "conflict") blockerSet.add("UNRESOLVED_CONFLICT");
    if (fact.status === "untrusted") blockerSet.add("UNTRUSTED_INPUT");
  }

  if (bundle.reviewReport.missingFields.length > 0) {
    blockerSet.add("MISSING_REQUIRED_FACT");
  }
  for (const requiredPath of requiredFactPaths(bundle.marketOverviewDraft)) {
    if (!factPaths.has(requiredPath)) {
      blockerSet.add("MISSING_REQUIRED_FACT");
    }
  }
  for (const sourceId of evidenceSourceIds) {
    if (!passedSourceIds.has(sourceId)) {
      blockerSet.add("UNTRUSTED_INPUT");
    }
  }
  for (const [index, conflict] of bundle.reviewReport.conflicts.entries()) {
    for (const [factIndex, factId] of conflict.factIds.entries()) {
      if (!factIds.has(factId)) {
        errors.push(`reviewReport.conflicts[${index}].factIds[${factIndex}] must reference a registered factId`);
      }
    }
    if (conflict.resolution === "unresolved") blockerSet.add("UNRESOLVED_CONFLICT");
  }
  for (const [index, sourceCheck] of bundle.reviewReport.sourceChecks.entries()) {
    if (!sourceIds.has(sourceCheck.sourceId)) {
      errors.push(`reviewReport.sourceChecks[${index}].sourceId must reference a registered sourceId`);
    }
    if (sourceCheck.status === "failed") blockerSet.add("UNTRUSTED_INPUT");
  }
  for (const [index, risk] of bundle.reviewReport.injectionRisks.entries()) {
    if (!sourceIds.has(risk.sourceId)) {
      errors.push(`reviewReport.injectionRisks[${index}].sourceId must reference a registered sourceId`);
    }
    blockerSet.add("UNTRUSTED_INPUT");
  }
  for (const source of bundle.sourceRegister.sources) {
    if (
      source.discoveryOnly ||
      source.accessStatus !== "open" ||
      source.credibility === "UNVERIFIED" ||
      source.promptInjectionRisk !== "none"
    ) {
      blockerSet.add("UNTRUSTED_INPUT");
    }
  }
  if (bundle.marketOverviewDraft.credibility === "UNVERIFIED") {
    blockerSet.add("UNTRUSTED_INPUT");
  }

  const blockers = BASIC_COLLECTION_BLOCKER_CODES.filter((code) => blockerSet.has(code));
  validateReportReadiness(bundle, blockers, errors);
  return {
    blockers,
    errors,
    readyForHumanReview:
      errors.length === 0 &&
      blockers.length === 0 &&
      bundle.reviewReport.status === "ready-for-human-review" &&
      bundle.reviewReport.publicationRecommendation === "request-human-review",
  };
}

function validateReportReadiness(
  bundle: BasicCollectionAuditBundle,
  blockers: readonly BasicCollectionBlockerCode[],
  errors: string[],
): void {
  const report = bundle.reviewReport;
  if (blockers.length === 0) {
    const requestsReview =
      report.status === "ready-for-human-review" &&
      report.publicationRecommendation === "request-human-review";
    const conservativelyBlocked =
      report.status === "blocked" &&
      report.publicationRecommendation === "do-not-publish";
    if (!requestsReview && !conservativelyBlocked) {
      errors.push(
        "reviewReport.status and reviewReport.publicationRecommendation must use an allowed no-blocker pairing",
      );
    }
    return;
  }
  if (report.status !== "blocked") {
    errors.push("reviewReport.status must be blocked when blockers exist");
  }
  if (report.publicationRecommendation !== "do-not-publish") {
    errors.push("reviewReport.publicationRecommendation must be do-not-publish when blockers exist");
  }
}

function requiredFactPaths(draft: BasicMarketOverviewDraft): string[] {
  const paths: string[] = [...BASIC_COLLECTION_REQUIRED_STATIC_FACT_PATHS];
  for (const index of draft.keyIndicators.keys()) {
    paths.push(
      `marketOverview.keyIndicators[${index}].label`,
      `marketOverview.keyIndicators[${index}].value`,
      `marketOverview.keyIndicators[${index}].unit`,
      `marketOverview.keyIndicators[${index}].year`,
    );
  }
  return paths;
}

function validateCandidateNormalizedValues(
  bundle: BasicCollectionAuditBundle,
  fact: BasicExtractedFact,
  factIndex: number,
  errors: string[],
): void {
  if (fact.status !== "candidate" || fact.fieldPath.startsWith("country.")) {
    return;
  }
  const expected = draftValueAt(bundle.marketOverviewDraft, fact.fieldPath);
  if (!expected.found) {
    errors.push(
      `extractedFacts.facts[${factIndex}].fieldPath must identify a marketOverviewDraft value for candidate evidence`,
    );
    return;
  }
  for (const [evidenceIndex, evidence] of fact.evidence.entries()) {
    if (!deeplyEqual(evidence.normalizedValue, expected.value)) {
      errors.push(
        `extractedFacts.facts[${factIndex}].evidence[${evidenceIndex}].normalizedValue must deeply equal marketOverviewDraft.${fact.fieldPath.slice("marketOverview.".length)}`,
      );
    }
  }
}

function draftValueAt(
  draft: BasicMarketOverviewDraft,
  fieldPath: string,
): { found: true; value: unknown } | { found: false } {
  const staticKey = fieldPath.slice("marketOverview.".length);
  if (isDraftStaticKey(staticKey)) {
    return { found: true, value: draft[staticKey] };
  }
  const indicatorMatch = INDICATOR_FACT_PATH.exec(fieldPath);
  if (indicatorMatch === null) return { found: false };
  const indicator = draft.keyIndicators[Number(indicatorMatch[1])];
  if (indicator === undefined) return { found: false };
  const key = indicatorMatch[2];
  if (key === "label") return { found: true, value: indicator.label };
  if (key === "value") return { found: true, value: indicator.value };
  if (key === "unit") return { found: true, value: indicator.unit };
  return { found: true, value: indicator.year };
}

function isDraftStaticKey(
  value: string,
): value is Exclude<keyof BasicMarketOverviewDraft, "keyIndicators" | "reviewStatus" | "aiUsable"> {
  return [
    "overview",
    "population",
    "gdp",
    "gdpGrowth",
    "energyDemand",
    "renewableTarget",
    "source",
    "sourceUrl",
    "collectedAt",
    "updatedAt",
    "credibility",
    "countryCode",
    "industryTags",
    "techTags",
  ].includes(value);
}

function deeplyEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => deeplyEqual(value, right[index]))
    );
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) => Object.hasOwn(right, key) && deeplyEqual(left[key], right[key]),
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
