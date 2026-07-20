import type {
  BasicProfile,
  BasicProfileCategoryKey,
  BasicProfileField,
} from "@navigator/shared-types/basic-profile";
import type { LocalizedText } from "@navigator/shared-types/i18n";

import type { BasicCollectionAuditBundleV3 } from "../collection/basic-collection-v3-contracts.js";
import { renderBasicNumericTemplate } from "./basic-bilingual-template.js";

export const BASIC_REVIEW_SECTION_KEYS = [
  "countryBasics",
  "electricityMarket",
  "energyAccess",
  "renewableCapacity",
  "solarResource",
  "windResource",
  "policyOverview",
  "marketSummary",
] as const satisfies readonly BasicProfileCategoryKey[];

const SECTION_TITLES: Readonly<Record<BasicProfileCategoryKey, LocalizedText>> = Object.freeze({
  countryBasics: Object.freeze({ zh: "国家基础", en: "Country basics" }),
  electricityMarket: Object.freeze({ zh: "电力市场", en: "Electricity market" }),
  energyAccess: Object.freeze({ zh: "能源可及性", en: "Energy access" }),
  renewableCapacity: Object.freeze({ zh: "可再生能源装机", en: "Renewable capacity" }),
  solarResource: Object.freeze({ zh: "太阳能资源", en: "Solar resource" }),
  windResource: Object.freeze({ zh: "风能资源", en: "Wind resource" }),
  policyOverview: Object.freeze({ zh: "政策概览", en: "Policy overview" }),
  marketSummary: Object.freeze({ zh: "市场摘要", en: "Market summary" }),
});

export interface BasicReviewCitation {
  readonly sourceId: string;
  readonly publisher: string;
  readonly title: LocalizedText;
  readonly url: string;
  readonly retrievedAt: string;
}

export interface BasicReviewField {
  readonly fieldPath: string;
  readonly key: string;
  readonly label: LocalizedText;
  readonly status: BasicProfileField["status"];
  readonly text: LocalizedText;
  readonly value: BasicProfileField["value"];
  readonly unit: string | null;
  readonly year: number | null;
  readonly checkedAt: string;
  readonly reason: LocalizedText | null;
  readonly note: LocalizedText | null;
  readonly citations: readonly BasicReviewCitation[];
}

export interface BasicReviewDifference {
  readonly fieldPath: string;
  readonly change: "added" | "changed" | "removed";
  readonly previous: BasicProfileField | null;
  readonly current: BasicProfileField | null;
}

export interface BasicReviewConflict {
  readonly fieldPath: string;
  readonly factIds: readonly string[];
  readonly resolution: "unresolved" | "resolved";
  readonly notes: string;
  readonly values: readonly Readonly<{
    factId: string;
    normalizedValues: readonly unknown[];
  }>[];
}

export interface BasicReviewModel {
  readonly schemaVersion: "basic-review-pack/v1";
  readonly countryCode: string;
  readonly runId: string;
  readonly candidateUpdatedAt: string;
  readonly sections: readonly Readonly<{
    key: BasicProfileCategoryKey;
    title: LocalizedText;
    fields: readonly BasicReviewField[];
  }>[];
  readonly missing: readonly Readonly<{
    fieldPath: string;
    checkedAt: string;
    reason: LocalizedText;
  }>[];
  readonly conflicts: readonly BasicReviewConflict[];
  readonly differences: readonly BasicReviewDifference[];
  readonly checklist: readonly Readonly<{
    key: string;
    label: LocalizedText;
    passed: boolean;
  }>[];
}

export interface BasicReviewModelInput {
  readonly candidate: BasicCollectionAuditBundleV3;
  readonly previousProfile: BasicProfile | null;
}

export function createBasicReviewModel(input: BasicReviewModelInput): BasicReviewModel {
  const profile = input.candidate.marketOverviewDraft.basicProfile;
  const sources = new Map(profile.sources.map((source) => [source.id, source]));
  const sections = BASIC_REVIEW_SECTION_KEYS.map((category) => Object.freeze({
    key: category,
    title: SECTION_TITLES[category],
    fields: Object.freeze(profile.categories[category].fields.map((field) => Object.freeze({
      fieldPath: fieldPath(category, field.key),
      key: field.key,
      label: field.label,
      status: field.status,
      text: textForField(field),
      value: field.value,
      unit: field.unit,
      year: field.year,
      checkedAt: field.checkedAt,
      reason: field.reason,
      note: field.note,
      citations: Object.freeze(field.sourceIds.map((sourceId) => {
        const source = sources.get(sourceId);
        if (source === undefined) throw new Error("BASIC review model input is invalid");
        return Object.freeze({
          sourceId,
          publisher: source.publisher,
          title: source.title,
          url: source.url,
          retrievedAt: source.retrievedAt,
        });
      })),
    }))),
  }));
  const missing = sections.flatMap((section) => section.fields
    .filter((field) => field.status === "NOT_AVAILABLE")
    .map((field) => Object.freeze({
      fieldPath: field.fieldPath,
      checkedAt: field.checkedAt,
      reason: field.reason!,
    })));
  const unresolvedConflictCount = input.candidate.reviewReport.conflicts.filter(
    ({ resolution }) => resolution === "unresolved",
  ).length;
  const facts = new Map(input.candidate.extractedFacts.facts.map((fact) => [fact.factId, fact]));

  return Object.freeze({
    schemaVersion: "basic-review-pack/v1",
    countryCode: input.candidate.sourceRegister.countryCode,
    runId: input.candidate.runId,
    candidateUpdatedAt: profile.updatedAt,
    sections: Object.freeze(sections),
    missing: Object.freeze(missing),
    conflicts: Object.freeze(input.candidate.reviewReport.conflicts.map((conflict) =>
      Object.freeze({
        ...conflict,
        factIds: Object.freeze([...conflict.factIds]),
        values: Object.freeze(conflict.factIds.map((factId) => Object.freeze({
          factId,
          normalizedValues: Object.freeze((facts.get(factId)?.evidence ?? []).map(
            ({ normalizedValue }) => normalizedValue,
          )),
        }))),
      }))),
    differences: Object.freeze(compareProfiles(profile, input.previousProfile)),
    checklist: Object.freeze([
      checklist("sourcesReviewed", "来源已逐项核查", "Sources reviewed", input.candidate.reviewReport.sourceChecks.every(({ status }) => status === "passed")),
      checklist("missingReviewed", "缺失项已有核查记录", "Missing items documented", missing.every(({ reason, checkedAt }) => reason.zh !== "" && reason.en !== "" && checkedAt !== "")),
      checklist("conflictsResolved", "冲突已人工处理", "Conflicts resolved", unresolvedConflictCount === 0),
      checklist("bilingualReviewed", "中英文已人工复核", "Bilingual text reviewed", false),
      checklist("basicOnly", "覆盖等级保持 BASIC", "Coverage remains BASIC", true),
      checklist("aiIsolated", "AI 数据保持隔离", "AI data remains isolated", input.candidate.marketOverviewDraft.aiUsable === false),
      checklist("humanApprovalRequired", "仍需逐国人工批准", "Per-country human approval still required", input.candidate.reviewReport.humanDecision === null),
    ]),
  });
}

function textForField(field: BasicProfileField): LocalizedText {
  if (field.status === "NOT_AVAILABLE") return field.reason!;
  if (typeof field.value === "number" && field.unit !== null && field.year !== null) {
    return renderBasicNumericTemplate({
      value: String(field.value),
      unit: field.unit,
      year: String(field.year),
      sourceIds: field.sourceIds,
    });
  }
  if (typeof field.value === "object" && field.value !== null) return field.value;
  const value = String(field.value);
  return Object.freeze({ zh: value, en: value });
}

function compareProfiles(
  current: BasicProfile,
  previous: BasicProfile | null,
): BasicReviewDifference[] {
  const currentFields = profileFields(current);
  const previousFields = previous === null ? new Map<string, BasicProfileField>() : profileFields(previous);
  const paths = [...new Set([...currentFields.keys(), ...previousFields.keys()])].sort();
  const differences: BasicReviewDifference[] = [];
  for (const path of paths) {
    const currentField = currentFields.get(path) ?? null;
    const previousField = previousFields.get(path) ?? null;
    if (previousField === null) {
      differences.push({ fieldPath: path, change: "added", previous: null, current: currentField });
    } else if (currentField === null) {
      differences.push({ fieldPath: path, change: "removed", previous: previousField, current: null });
    } else if (JSON.stringify(previousField) !== JSON.stringify(currentField)) {
      differences.push({
        fieldPath: path, change: "changed", previous: previousField, current: currentField,
      });
    }
  }
  return differences;
}

function profileFields(profile: BasicProfile): Map<string, BasicProfileField> {
  return new Map(BASIC_REVIEW_SECTION_KEYS.flatMap((category) =>
    profile.categories[category].fields.map((field) => [fieldPath(category, field.key), field] as const)));
}

function fieldPath(category: BasicProfileCategoryKey, key: string): string {
  return `marketOverview.basicProfile.categories.${category}.fields.${key}`;
}

function checklist(key: string, zh: string, en: string, passed: boolean) {
  return Object.freeze({ key, label: Object.freeze({ zh, en }), passed });
}
