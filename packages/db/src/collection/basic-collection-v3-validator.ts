import type {
  BasicCollectionAuditSummary,
  BasicCollectionBlockerCode,
  BasicCollectionJsonValue,
} from "./basic-collection-contracts.js";
import { BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION } from "./basic-collection-v2-contracts.js";
import { validateBasicCollectionAuditBundleV2 } from "./basic-collection-v2-validator.js";
import {
  BASIC_V3_PROFILE_FACT_PATH_PREFIX,
  BASIC_V3_PROFILE_CATEGORY_KEYS,
  basicV3ProfileFactPath,
  parseBasicV3ProfileFactPath,
  type BasicCollectionAuditBundleV3,
  type BasicCollectionAuditValidationResultV3,
  type BasicExtractedFactV3,
} from "./basic-collection-v3-contracts.js";
import { parseBasicCollectionAuditBundleV3 } from "./basic-collection-v3-parser.js";
import { basicMarketOverviewDraftV2FromV3 } from "./basic-market-overview-draft-v3-parser.js";
import {
  deepFreezeBasicOfflineValue,
  deeplyEqualBasicOfflineValue,
} from "./basic-offline-value.js";

const EMPTY_SUMMARY: BasicCollectionAuditSummary = {
  countryCode: "",
  runId: "",
  sourceCount: 0,
  factCount: 0,
};

export function validateBasicCollectionAuditBundleV3(
  value: unknown,
): BasicCollectionAuditValidationResultV3 {
  try {
    const parsed = parseBasicCollectionAuditBundleV3(value);
    if (parsed.data === null) return invalid(parsed.errors, parsed.summary);

    const v2Validation = validateBasicCollectionAuditBundleV2(toV2Bundle(parsed.data));
    const profileErrors = validateProfileFacts(parsed.data);
    const errors = [
      ...(v2Validation.valid ? [] : v2Validation.errors),
      ...profileErrors,
    ];
    if (errors.length > 0) {
      return invalid(errors, parsed.summary, v2Validation.blockers);
    }
    return deepFreezeBasicOfflineValue({
      valid: true,
      data: parsed.data,
      errors: [] as const,
      readyForHumanReview: v2Validation.readyForHumanReview,
      blockers: [...v2Validation.blockers],
      summary: parsed.summary,
    });
  } catch {
    return invalid(
      ["bundle must be a safely parseable v3 audit bundle"],
      EMPTY_SUMMARY,
    );
  }
}

function validateProfileFacts(bundle: BasicCollectionAuditBundleV3): string[] {
  const errors: string[] = [];
  const facts = bundle.extractedFacts.facts.filter(({ fieldPath }) =>
    fieldPath.startsWith(BASIC_V3_PROFILE_FACT_PATH_PREFIX)
  );
  const factsByPath = new Map<string, BasicExtractedFactV3[]>();
  for (const fact of facts) {
    const existing = factsByPath.get(fact.fieldPath) ?? [];
    existing.push(fact);
    factsByPath.set(fact.fieldPath, existing);
  }

  const fieldsByPath = new Map<string, BasicCollectionAuditBundleV3[
    "marketOverviewDraft"
  ]["basicProfile"]["categories"][typeof BASIC_V3_PROFILE_CATEGORY_KEYS[number]]["fields"][number]>();
  for (const category of BASIC_V3_PROFILE_CATEGORY_KEYS) {
    for (const field of bundle.marketOverviewDraft.basicProfile.categories[category].fields) {
      const path = basicV3ProfileFactPath(category, field.key);
      fieldsByPath.set(path, field);
      if ((factsByPath.get(path)?.length ?? 0) !== 1) {
        errors.push(`draft profile field ${path} must have exactly one fact`);
      }
    }
  }

  const profileSources = new Map(
    bundle.marketOverviewDraft.basicProfile.sources.map((source) => [source.id, source]),
  );
  const auditSources = new Map(
    bundle.sourceRegister.sources.map((source) => [source.sourceId, source]),
  );
  for (const [factIndex, fact] of facts.entries()) {
    const parsedPath = parseBasicV3ProfileFactPath(fact.fieldPath);
    const field = fieldsByPath.get(fact.fieldPath);
    if (parsedPath === null || field === undefined) {
      errors.push(`profile fact ${fact.fieldPath} must resolve to exactly one draft field`);
      continue;
    }
    validateProfileEvidence(
      fact,
      factIndex,
      field,
      auditSources,
      errors,
    );
    for (const sourceId of field.sourceIds) {
      const source = profileSources.get(sourceId);
      if (source !== undefined && field.checkedAt < source.retrievedAt.slice(0, 10)) {
        errors.push(
          `profile field ${fact.fieldPath}.checkedAt must be no earlier than every referenced source retrievedAt calendar date`,
        );
      }
    }
  }
  return errors;
}

function validateProfileEvidence(
  fact: BasicExtractedFactV3,
  factIndex: number,
  field: BasicCollectionAuditBundleV3["marketOverviewDraft"]["basicProfile"][
    "categories"
  ][typeof BASIC_V3_PROFILE_CATEGORY_KEYS[number]]["fields"][number],
  auditSources: ReadonlyMap<
    string,
    BasicCollectionAuditBundleV3["sourceRegister"]["sources"][number]
  >,
  errors: string[],
): void {
  const evidenceSourceIds = new Set(fact.evidence.map(({ sourceId }) => sourceId));
  if (!sameSet(evidenceSourceIds, new Set(field.sourceIds))) {
    errors.push(
      `profile fact ${fact.fieldPath} evidence sourceId set must equal field sourceIds`,
    );
  }
  for (const [evidenceIndex, evidence] of fact.evidence.entries()) {
    if (!deeplyEqualBasicOfflineValue(evidence.normalizedValue, field)) {
      errors.push(
        `profile fact ${fact.fieldPath} evidence[${evidenceIndex}].normalizedValue must equal the complete draft field object`,
      );
    }
    const source = auditSources.get(evidence.sourceId);
    if (source === undefined) {
      errors.push(
        `profile fact ${fact.fieldPath} evidence[${evidenceIndex}].sourceId must reference a registered sourceId`,
      );
    } else if (!source.evidenceLocators.includes(evidence.locator)) {
      errors.push(
        `profile fact ${fact.fieldPath} evidence[${evidenceIndex}].locator must match a registered evidenceLocator`,
      );
    }
    if (
      evidenceIndex > 0 &&
      compareEvidence(fact.evidence[evidenceIndex - 1]!, evidence) >= 0
    ) {
      errors.push(
        `extractedFacts profile fact ${factIndex} evidence must be unique and sorted`,
      );
    }
  }
}

function toV2Bundle(bundle: BasicCollectionAuditBundleV3) {
  return {
    countryDirectory: bundle.countryDirectory,
    runId: bundle.runId,
    sourceRegister: {
      ...bundle.sourceRegister,
      schemaVersion: BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION,
    },
    extractedFacts: {
      ...bundle.extractedFacts,
      schemaVersion: BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION,
      facts: bundle.extractedFacts.facts.filter(({ fieldPath }) =>
        !fieldPath.startsWith(BASIC_V3_PROFILE_FACT_PATH_PREFIX)
      ),
    },
    marketOverviewDraft: basicMarketOverviewDraftV2FromV3(
      bundle.marketOverviewDraft,
    ),
    reviewReport: {
      ...bundle.reviewReport,
      schemaVersion: BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION,
    },
  };
}

function compareEvidence(
  left: BasicExtractedFactV3["evidence"][number],
  right: BasicExtractedFactV3["evidence"][number],
): number {
  return compareText(left.sourceId, right.sourceId) ||
    compareText(left.locator, right.locator) ||
    compareText(canonicalJson(left.rawValue), canonicalJson(right.rawValue)) ||
    compareText(canonicalJson(left.normalizedValue), canonicalJson(right.normalizedValue)) ||
    compareText(left.unit ?? "", right.unit ?? "") ||
    compareNumber(left.year, right.year);
}

function canonicalJson(value: BasicCollectionJsonValue): string {
  if (value === null) return "null";
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : JSON.stringify(value);
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort(compareText).map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(value[key]!)}`).join(",")}}`;
}

function compareNumber(left: number | null, right: number | null): number {
  if (left === null) return right === null ? 0 : -1;
  if (right === null) return 1;
  return left - right;
}

function sameSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function invalid(
  errors: readonly string[],
  summary: Readonly<BasicCollectionAuditSummary>,
  blockers: readonly BasicCollectionBlockerCode[] = [],
): BasicCollectionAuditValidationResultV3 {
  return deepFreezeBasicOfflineValue({
    valid: false,
    data: null,
    errors: errors.length === 0 ? ["bundle must be structurally valid"] : [...errors],
    readyForHumanReview: false,
    blockers: [...blockers],
    summary: { ...summary },
  });
}
