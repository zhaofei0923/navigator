import {
  BASIC_COLLECTION_BLOCKER_CODES,
  type BasicCollectionAuditBundle,
  type BasicCollectionBlockerCode,
} from "./basic-collection-contracts.js";

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
  const sourceIds = new Set(bundle.sourceRegister.sources.map((source) => source.sourceId));
  const factIds = new Set(bundle.extractedFacts.facts.map((fact) => fact.factId));

  for (const [index, fact] of bundle.extractedFacts.facts.entries()) {
    for (const [evidenceIndex, evidence] of fact.evidence.entries()) {
      if (!sourceIds.has(evidence.sourceId)) {
        errors.push(`extractedFacts.facts[${index}].evidence[${evidenceIndex}].sourceId must reference a registered sourceId`);
      }
    }
    if (fact.status === "missing") blockerSet.add("MISSING_REQUIRED_FACT");
    if (fact.status === "conflict") blockerSet.add("UNRESOLVED_CONFLICT");
    if (fact.status === "untrusted") blockerSet.add("UNTRUSTED_INPUT");
  }

  if (bundle.reviewReport.missingFields.length > 0) {
    blockerSet.add("MISSING_REQUIRED_FACT");
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
    if (report.status !== "ready-for-human-review") {
      errors.push("reviewReport.status must be ready-for-human-review when no blockers exist");
    }
    if (report.publicationRecommendation !== "request-human-review") {
      errors.push("reviewReport.publicationRecommendation must be request-human-review when no blockers exist");
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
