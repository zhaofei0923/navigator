import {
  BASIC_COLLECTION_BLOCKER_CODES,
  BASIC_COLLECTION_REQUIRED_STATIC_FACT_PATHS,
  type BasicCollectionAuditSummary,
  type BasicCollectionBlockerCode,
  type BasicCollectionJsonValue,
} from "./basic-collection-contracts.js";
import {
  type BasicCollectionAuditBundleV2,
  type BasicCollectionAuditValidationResultV2,
  type BasicCollectionReviewReportV2,
  type BasicExtractedFactV2,
  type BasicFactEvidenceV2,
} from "./basic-collection-v2-contracts.js";
import { parseBasicCollectionAuditBundleV2 } from "./basic-collection-v2-parser.js";
import { validateBasicV2FactOwnership } from "./basic-v2-fact-ownership.js";
import {
  deepFreezeBasicOfflineValue,
  deeplyEqualBasicOfflineValue,
} from "./basic-offline-value.js";

const INDICATOR_PATH =
  /^marketOverview\.keyIndicators\[(0|[1-9]\d*)\]\.(label|value|unit|year)$/;
const INDICATOR_KEYS = ["label", "value", "unit", "year"] as const;
const EMPTY_SUMMARY: BasicCollectionAuditSummary = {
  countryCode: "",
  runId: "",
  sourceCount: 0,
  factCount: 0,
};

export function validateBasicCollectionAuditBundleV2(
  value: unknown,
): BasicCollectionAuditValidationResultV2 {
  try {
    const parsed = parseBasicCollectionAuditBundleV2(value);
    if (parsed.data === null) return invalid(parsed.errors, parsed.summary);
    const classified = classify(parsed.data);
    if (classified.errors.length > 0) {
      return invalid(classified.errors, parsed.summary, classified.blockers);
    }
    return deepFreezeBasicOfflineValue({
      valid: true,
      data: parsed.data,
      errors: [] as const,
      readyForHumanReview: classified.readyForHumanReview,
      blockers: classified.blockers,
      summary: parsed.summary,
    });
  } catch {
    return invalid(["bundle must be a safely parseable v2 audit bundle"], EMPTY_SUMMARY);
  }
}

function classify(bundle: BasicCollectionAuditBundleV2): {
  readonly blockers: readonly BasicCollectionBlockerCode[];
  readonly errors: readonly string[];
  readonly readyForHumanReview: boolean;
} {
  const errors = [...validateBasicV2FactOwnership(bundle.extractedFacts.facts)];
  const blockerSet = new Set<BasicCollectionBlockerCode>();
  const sourcesById = new Map(
    bundle.sourceRegister.sources.map((source) => [source.sourceId, source]),
  );
  const sourceIds = new Set(sourcesById.keys());
  const factIds = new Set(bundle.extractedFacts.facts.map(({ factId }) => factId));
  const factPaths = new Set<string>();
  const firstFactIndex = new Map<string, number>();

  for (const [index, fact] of bundle.extractedFacts.facts.entries()) {
    const prior = firstFactIndex.get(fact.fieldPath);
    if (prior === undefined) firstFactIndex.set(fact.fieldPath, index);
    else errors.push(
      `extractedFacts.facts[${index}].fieldPath duplicates extractedFacts.facts[${prior}].fieldPath`,
    );
    factPaths.add(fact.fieldPath);
    validateEvidenceOrder(fact, index, errors);
    for (const [evidenceIndex, evidence] of fact.evidence.entries()) {
      const source = sourcesById.get(evidence.sourceId);
      if (source === undefined) {
        errors.push(`extractedFacts.facts[${index}].evidence[${evidenceIndex}].sourceId must reference a registered sourceId`);
      } else if (!source.evidenceLocators.includes(evidence.locator)) {
        errors.push(`extractedFacts.facts[${index}].evidence[${evidenceIndex}].locator must match a registered evidenceLocator`);
      }
    }
    validateCandidateValues(bundle, fact, index, errors);
    if (fact.status === "missing") blockerSet.add("MISSING_REQUIRED_FACT");
    if (fact.status === "conflict") blockerSet.add("UNRESOLVED_CONFLICT");
    if (fact.status === "untrusted") blockerSet.add("UNTRUSTED_INPUT");
  }

  const missingFields = deriveMissingFields(bundle.extractedFacts.facts, factPaths);
  if (missingFields.length > 0) blockerSet.add("MISSING_REQUIRED_FACT");
  if (!sameStrings(bundle.reviewReport.missingFields, missingFields)) {
    errors.push("reviewReport.missingFields must exactly match sorted missing material");
  }
  validateIndicatorCoverage(bundle, errors);

  validateConflicts(bundle, factIds, errors);
  validateSourceChecks(bundle, sourceIds, blockerSet, errors);
  validateInjectionRisks(bundle, sourcesById, blockerSet, errors);

  for (const source of bundle.sourceRegister.sources) {
    if (
      source.discoveryOnly || source.accessStatus !== "open" ||
      source.credibility === "UNVERIFIED" || source.promptInjectionRisk !== "none"
    ) blockerSet.add("UNTRUSTED_INPUT");
  }
  if (bundle.marketOverviewDraft.credibility === "UNVERIFIED") {
    blockerSet.add("UNTRUSTED_INPUT");
  }

  const blockers = BASIC_COLLECTION_BLOCKER_CODES.filter((code) => blockerSet.has(code));
  validateReportState(bundle.reviewReport, blockers, errors);
  return {
    blockers,
    errors,
    readyForHumanReview:
      errors.length === 0 && blockers.length === 0 &&
      bundle.reviewReport.status === "ready-for-human-review" &&
      bundle.reviewReport.publicationRecommendation === "request-human-review",
  };
}

function validateIndicatorCoverage(
  bundle: BasicCollectionAuditBundleV2,
  errors: string[],
): void {
  const groups = new Map<number, Set<string>>();
  for (const fact of bundle.extractedFacts.facts) {
    const match = INDICATOR_PATH.exec(fact.fieldPath);
    if (match === null) continue;
    const index = Number(match[1]);
    const group = groups.get(index) ?? new Set<string>();
    group.add(match[2]!);
    groups.set(index, group);
  }
  const indices = [...groups.keys()].sort((left, right) => left - right);
  if (indices.length === 0) {
    errors.push("extractedFacts.facts must contain a complete indicator group at index 0");
    return;
  }
  for (const [position, index] of indices.entries()) {
    if (index !== position) {
      errors.push("extractedFacts.facts indicator indices must be contiguous from index 0");
      break;
    }
    const group = groups.get(index)!;
    if (!INDICATOR_KEYS.every((key) => group.has(key))) {
      errors.push(`extractedFacts.facts indicator index ${index} must contain label, value, unit, and year`);
    }
  }
  if (bundle.marketOverviewDraft.keyIndicators.length !== indices.length) {
    errors.push("marketOverviewDraft.keyIndicators must exactly match extracted indicator groups");
  }
}

function validateCandidateValues(
  bundle: BasicCollectionAuditBundleV2,
  fact: BasicExtractedFactV2,
  factIndex: number,
  errors: string[],
): void {
  if (fact.status !== "candidate") return;
  const first = fact.evidence[0]?.normalizedValue;
  for (const [evidenceIndex, evidence] of fact.evidence.entries()) {
    if (!deeplyEqualBasicOfflineValue(evidence.normalizedValue, first)) {
      errors.push(`extractedFacts.facts[${factIndex}].evidence[${evidenceIndex}].normalizedValue must deeply equal the candidate value`);
    }
  }
  if (fact.fieldPath === "country.code") {
    if (first !== bundle.sourceRegister.countryCode) {
      errors.push(`extractedFacts.facts[${factIndex}].normalizedValue must match sourceRegister.countryCode`);
    }
    return;
  }
  if (!fact.fieldPath.startsWith("marketOverview.")) return;
  const expected = draftValueAt(bundle.marketOverviewDraft, fact.fieldPath);
  if (!expected.found) {
    errors.push(`extractedFacts.facts[${factIndex}].fieldPath must identify a marketOverviewDraft value for candidate evidence`);
    return;
  }
  for (const [evidenceIndex, evidence] of fact.evidence.entries()) {
    if (!deeplyEqualBasicOfflineValue(evidence.normalizedValue, expected.value)) {
      errors.push(`extractedFacts.facts[${factIndex}].evidence[${evidenceIndex}].normalizedValue must deeply equal marketOverviewDraft.${fact.fieldPath.slice("marketOverview.".length)}`);
    }
  }
}

function validateConflicts(
  bundle: BasicCollectionAuditBundleV2,
  factIds: ReadonlySet<string>,
  errors: string[],
): void {
  if (!isSorted(bundle.reviewReport.conflicts, compareConflicts)) {
    errors.push("reviewReport.conflicts must be sorted by fieldPath and factIds");
  }
  const expected = bundle.extractedFacts.facts
    .filter(({ status }) => status === "conflict")
    .map((fact) => ({ fieldPath: fact.fieldPath, factId: fact.factId }))
    .sort((left, right) => compareText(left.fieldPath, right.fieldPath) || compareText(left.factId, right.factId));
  const actual = bundle.reviewReport.conflicts.map((conflict) => ({
    fieldPath: conflict.fieldPath,
    factId: conflict.factIds.length === 1 ? conflict.factIds[0]! : "",
  }));
  if (!deeplyEqualBasicOfflineValue(actual, expected)) {
    errors.push("reviewReport.conflicts must exactly match unresolved conflict facts");
  }
  for (const [index, conflict] of bundle.reviewReport.conflicts.entries()) {
    if (conflict.resolution !== "unresolved") {
      errors.push(`reviewReport.conflicts[${index}].resolution must be unresolved`);
    }
    if (!isUniqueSorted(conflict.factIds, compareText)) {
      errors.push(`reviewReport.conflicts[${index}].factIds must be unique and sorted`);
    }
    for (const [factIndex, factId] of conflict.factIds.entries()) {
      if (!factIds.has(factId)) {
        errors.push(`reviewReport.conflicts[${index}].factIds[${factIndex}] must reference a registered factId`);
      }
    }
  }
}

function validateSourceChecks(
  bundle: BasicCollectionAuditBundleV2,
  sourceIds: ReadonlySet<string>,
  blockers: Set<BasicCollectionBlockerCode>,
  errors: string[],
): void {
  if (!isSorted(bundle.reviewReport.sourceChecks, (left, right) =>
    compareText(left.sourceId, right.sourceId))) {
    errors.push("reviewReport.sourceChecks must be sorted by sourceId");
  }
  const coverage = new Map<string, BasicCollectionReviewReportV2["sourceChecks"][number][]>();
  const firstIndex = new Map<string, number>();
  for (const [index, check] of bundle.reviewReport.sourceChecks.entries()) {
    const prior = firstIndex.get(check.sourceId);
    if (prior !== undefined) {
      errors.push(
        `reviewReport.sourceChecks[${index}].sourceId duplicates reviewReport.sourceChecks[${prior}].sourceId`,
      );
    } else {
      firstIndex.set(check.sourceId, index);
    }
    if (!sourceIds.has(check.sourceId)) {
      errors.push(`reviewReport.sourceChecks[${index}].sourceId must reference a registered sourceId`);
    }
    const checks = coverage.get(check.sourceId) ?? [];
    checks.push(check);
    coverage.set(check.sourceId, checks);
    if (check.status === "failed") blockers.add("UNTRUSTED_INPUT");
  }
  for (const sourceId of sourceIds) {
    const checks = coverage.get(sourceId) ?? [];
    if (checks.length !== 1 || checks[0]?.status !== "passed") {
      blockers.add("UNTRUSTED_INPUT");
    }
  }
}

function validateInjectionRisks(
  bundle: BasicCollectionAuditBundleV2,
  sourcesById: ReadonlyMap<string, BasicCollectionAuditBundleV2["sourceRegister"]["sources"][number]>,
  blockers: Set<BasicCollectionBlockerCode>,
  errors: string[],
): void {
  if (!isSorted(bundle.reviewReport.injectionRisks, compareRisks)) {
    errors.push("reviewReport.injectionRisks must be sorted");
  }
  for (const [index, risk] of bundle.reviewReport.injectionRisks.entries()) {
    for (let prior = 0; prior < index; prior += 1) {
      if (compareRisks(bundle.reviewReport.injectionRisks[prior]!, risk) === 0) {
        errors.push(
          `reviewReport.injectionRisks[${index}] duplicates reviewReport.injectionRisks[${prior}]`,
        );
        break;
      }
    }
    const source = sourcesById.get(risk.sourceId);
    if (source === undefined) {
      errors.push(`reviewReport.injectionRisks[${index}].sourceId must reference a registered sourceId`);
    } else if (!source.evidenceLocators.includes(risk.locator)) {
      errors.push(`reviewReport.injectionRisks[${index}].locator must match a registered evidenceLocator`);
    }
    blockers.add("UNTRUSTED_INPUT");
  }
}

function validateEvidenceOrder(
  fact: BasicExtractedFactV2,
  factIndex: number,
  errors: string[],
): void {
  const label = `extractedFacts.facts[${factIndex}].evidence`;
  for (let index = 0; index < fact.evidence.length; index += 1) {
    const evidence = fact.evidence[index]!;
    if (
      index > 0 &&
      compareEvidence(fact.evidence[index - 1]!, evidence) > 0
    ) {
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

function validateReportState(
  report: BasicCollectionReviewReportV2,
  blockers: readonly BasicCollectionBlockerCode[],
  errors: string[],
): void {
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

function deriveMissingFields(
  facts: readonly BasicExtractedFactV2[],
  paths: ReadonlySet<string>,
): string[] {
  const missing = new Set(
    facts.filter(({ status }) => status === "missing").map(({ fieldPath }) => fieldPath),
  );
  for (const path of BASIC_COLLECTION_REQUIRED_STATIC_FACT_PATHS) {
    if (!paths.has(path)) missing.add(path);
  }
  return [...missing].sort(compareText);
}

function draftValueAt(
  draft: BasicCollectionAuditBundleV2["marketOverviewDraft"],
  fieldPath: string,
): { readonly found: true; readonly value: unknown } | { readonly found: false } {
  const key = fieldPath.slice("marketOverview.".length);
  if (isDraftStaticKey(key)) return { found: true, value: draft[key] };
  const match = INDICATOR_PATH.exec(fieldPath);
  if (match === null) return { found: false };
  const indicator = draft.keyIndicators[Number(match[1])];
  if (indicator === undefined) return { found: false };
  return { found: true, value: indicator[match[2] as keyof typeof indicator] };
}

function isDraftStaticKey(value: string): value is Exclude<
  keyof BasicCollectionAuditBundleV2["marketOverviewDraft"],
  "keyIndicators" | "reviewStatus" | "aiUsable"
> {
  return [
    "overview", "population", "gdp", "gdpGrowth", "energyDemand",
    "renewableTarget", "source", "sourceUrl", "collectedAt", "updatedAt",
    "credibility", "countryCode", "industryTags", "techTags",
  ].includes(value);
}

function compareConflicts(
  left: BasicCollectionReviewReportV2["conflicts"][number],
  right: BasicCollectionReviewReportV2["conflicts"][number],
): number {
  return compareText(left.fieldPath, right.fieldPath) ||
    compareText(left.factIds.join("\0"), right.factIds.join("\0"));
}

function compareSourceChecks(
  left: BasicCollectionReviewReportV2["sourceChecks"][number],
  right: BasicCollectionReviewReportV2["sourceChecks"][number],
): number {
  return compareText(left.sourceId, right.sourceId) || compareText(left.status, right.status) ||
    compareText(left.notes ?? "", right.notes ?? "");
}

function compareRisks(
  left: BasicCollectionReviewReportV2["injectionRisks"][number],
  right: BasicCollectionReviewReportV2["injectionRisks"][number],
): number {
  return compareText(left.sourceId, right.sourceId) || compareText(left.locator, right.locator) ||
    compareText(left.severity, right.severity) || compareText(left.details, right.details);
}

function compareEvidence(
  left: BasicFactEvidenceV2,
  right: BasicFactEvidenceV2,
): number {
  return compareText(left.sourceId, right.sourceId) ||
    compareText(left.locator, right.locator) ||
    compareText(canonicalJson(left.rawValue), canonicalJson(right.rawValue)) ||
    compareText(
      canonicalJson(left.normalizedValue),
      canonicalJson(right.normalizedValue),
    ) ||
    compareNullableText(left.unit, right.unit) ||
    compareNullableNumber(left.year, right.year);
}

function canonicalJson(value: BasicCollectionJsonValue): string {
  if (value === null) return "null";
  if (typeof value === "number") {
    return Object.is(value, -0) ? "-0" : JSON.stringify(value);
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort(compareText)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key]!)}`)
    .join(",")}}`;
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

function isSorted<T>(values: readonly T[], compare: (left: T, right: T) => number): boolean {
  return values.every((value, index) => index === 0 || compare(values[index - 1]!, value) <= 0);
}

function isUniqueSorted<T>(
  values: readonly T[],
  compare: (left: T, right: T) => number,
  key: (value: T) => string = (value) => JSON.stringify(value),
): boolean {
  const seen = new Set<string>();
  return isSorted(values, compare) && values.every((value) => {
    const itemKey = key(value);
    if (seen.has(itemKey)) return false;
    seen.add(itemKey);
    return true;
  });
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function invalid(
  errors: readonly string[],
  summary: Readonly<BasicCollectionAuditSummary>,
  blockers: readonly BasicCollectionBlockerCode[] = [],
): BasicCollectionAuditValidationResultV2 {
  return deepFreezeBasicOfflineValue({
    valid: false,
    data: null,
    errors: errors.length === 0 ? ["bundle must be structurally valid"] : [...errors],
    readyForHumanReview: false,
    blockers: [...blockers],
    summary: { ...summary },
  });
}

void (null as BasicCollectionJsonValue | null);
