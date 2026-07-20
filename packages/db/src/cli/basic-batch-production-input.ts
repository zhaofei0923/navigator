import { createHash } from "node:crypto";

import type {
  BasicProfileCategoryKey,
  BasicProfileField,
  BasicProfileSource,
} from "@navigator/shared-types/basic-profile";

import { BASIC_GLOBAL_SOURCE_IDS } from "../collection/adapters/basic-global-source-pack.js";
import { parseBasicProfileTabularSnapshot } from "../collection/adapters/basic-profile-tabular.js";
import type { BasicSourceRecord } from "../collection/basic-collection-contracts.js";
import { bindReviewedManualProfileCaptures } from "./basic-batch-manual-profile.js";

export const COUNTRY_INPUT_ERROR = "basic batch country input is invalid";

const GLOBAL_SOURCE_POLICIES = Object.freeze({
  "ember-electricity": {
    publisher: "Ember", url: "https://ember-energy.org/data/electricity-data-explorer/",
    family: "verified-research", category: "electricityMarket",
    fields: ["electricityConsumption", "electricityMix", "renewableGenerationShare", "totalGeneration"],
  },
  "global-solar-atlas": {
    publisher: "World Bank ESMAP", url: "https://globalsolaratlas.info/",
    family: "international-organization", category: "solarResource",
    fields: ["ghi", "pvout", "solarPotentialSummary"],
  },
  "global-wind-atlas": {
    publisher: "World Bank ESMAP", url: "https://globalwindatlas.info/",
    family: "international-organization", category: "windResource",
    fields: ["offshoreWindClass", "onshoreWindClass"],
  },
  "irenastat-capacity": {
    publisher: "International Renewable Energy Agency (IRENA)",
    url: "https://pxweb.irena.org/pxweb/en/IRENASTAT/",
    family: "international-organization", category: "renewableCapacity",
    fields: ["hydroCapacity", "solarCapacity", "totalRenewableCapacity", "windCapacity"],
  },
} as const);

export interface ReviewedGlobalProfileInput {
  readonly updatedAt: string;
  readonly sources: readonly BasicProfileSource[];
  readonly auditSources: readonly BasicSourceRecord[];
  readonly fields: readonly Readonly<{
    category: BasicProfileCategoryKey;
    field: BasicProfileField;
  }>[];
}

export function parseProductionCountryInput(
  countryCode: string,
  value: unknown,
  globalCaptures: ReadonlyMap<string, Uint8Array>,
  manualCaptures: ReadonlyMap<string, Uint8Array>,
): Readonly<{ candidateConfigPath: string; reviewedProfile: ReviewedGlobalProfileInput }> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) countryInputInvalid();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== "candidateConfigPath,globalSourceSha256,manualProfile,reviewedGlobalProfile") {
    countryInputInvalid();
  }
  const hashes = record.globalSourceSha256;
  if (typeof hashes !== "object" || hashes === null || Array.isArray(hashes)) countryInputInvalid();
  const hashRecord = hashes as Record<string, unknown>;
  if (!sameStrings(Object.keys(hashRecord).sort(), [...globalCaptures.keys()].sort())) countryInputInvalid();
  for (const [sourceId, bytes] of globalCaptures) {
    if (hashRecord[sourceId] !== sha256(bytes)) countryInputInvalid();
  }
  if (
    typeof record.candidateConfigPath !== "string" ||
    !record.candidateConfigPath.startsWith(".cache/basic-country/") ||
    record.candidateConfigPath.includes("..")
  ) countryInputInvalid();
  const reviewedRecord = parseProfileInputRecord(record.reviewedGlobalProfile);
  const manualRecord = parseProfileInputRecord(record.manualProfile);
  const reviewedProfile = bindReviewedGlobalProfileSnapshots(countryCode, globalCaptures, {
    updatedAt: reviewedRecord.updatedAt,
    sources: reviewedRecord.sources as never,
    auditSources: reviewedRecord.auditSources as never,
    fields: reviewedRecord.fields as never,
  });
  return Object.freeze({
    candidateConfigPath: record.candidateConfigPath,
    reviewedProfile: bindReviewedManualProfileCaptures(countryCode, manualCaptures, reviewedProfile, {
      updatedAt: manualRecord.updatedAt,
      sources: manualRecord.sources as never,
      auditSources: manualRecord.auditSources as never,
      fields: manualRecord.fields as never,
    }),
  });
}

export function bindReviewedGlobalProfileSnapshots(
  countryCode: string,
  globalCaptures: ReadonlyMap<string, Uint8Array>,
  reviewedProfile: ReviewedGlobalProfileInput,
): ReviewedGlobalProfileInput {
  try {
    if (!/^[A-Z]{2}$/.test(countryCode)) countryInputInvalid();
    const capturedIds = [...globalCaptures.keys()].sort(compareText);
    const requiredIds = [...BASIC_GLOBAL_SOURCE_IDS].sort(compareText);
    if (!sameStrings(capturedIds, requiredIds)) countryInputInvalid();
    if (!isRfc3339(reviewedProfile.updatedAt)) countryInputInvalid();
    const fields = [...reviewedProfile.fields];
    uniqueById(fields, ({ category, field }) => `${category}.${field.key}`);
    const auditsById = uniqueById(reviewedProfile.auditSources, ({ sourceId }) => sourceId);
    const sourcesById = uniqueById(reviewedProfile.sources, ({ id }) => id);
    if (
      !sameStrings([...auditsById.keys()].sort(compareText), requiredIds) ||
      !sameStrings([...sourcesById.keys()].sort(compareText), requiredIds)
    ) countryInputInvalid();

    for (const sourceId of requiredIds) {
      const bytes = globalCaptures.get(sourceId);
      const audit = auditsById.get(sourceId);
      const source = sourcesById.get(sourceId);
      if (bytes === undefined || audit === undefined || source === undefined) countryInputInvalid();
      const rows = parseBasicProfileTabularSnapshot(bytes, countryCode);
      const policy = GLOBAL_SOURCE_POLICIES[sourceId as keyof typeof GLOBAL_SOURCE_POLICIES];
      const locators = rows.map(({ locator }) => locator).sort(compareText);
      const sourceFields = fields.filter(({ field }) => field.sourceIds.includes(sourceId));
      if (
        rows.length === 0 || new Set(locators).size !== locators.length ||
        audit.contentSha256 !== sha256(bytes) || policy === undefined ||
        source.publisher !== policy.publisher || !nonEmptyLocalizedText(source.title) ||
        !isRfc3339(source.retrievedAt) || source.url !== policy.url ||
        audit.sourceFamily !== policy.family || audit.credibility !== "OFFICIAL" ||
        rows.some(({ category }) => category !== policy.category) ||
        !sameStrings(rows.map(({ key }) => key).sort(compareText), [...policy.fields].sort(compareText)) ||
        !sameStrings([...audit.evidenceLocators].sort(compareText), locators) ||
        audit.sourceId !== source.id || audit.sourceName !== source.publisher ||
        audit.sourceUrl !== source.url || audit.retrievedAt !== source.retrievedAt ||
        audit.publishedAt !== source.publishedAt || audit.credibility !== source.credibility ||
        audit.accessStatus !== "open" || audit.discoveryOnly ||
        audit.promptInjectionRisk !== "none" || sourceFields.length !== rows.length ||
        sourceFields.some(({ field }) => !sameStrings(field.sourceIds, [sourceId]) || !nonEmptyLocalizedText(field.label)) ||
        rows.some(({ status, year }) => status === "AVAILABLE" &&
          (year === null || year > Number(audit.retrievedAt.slice(0, 4))))
      ) countryInputInvalid();
      const fieldsByPath = uniqueById(sourceFields, ({ category, field }) => `${category}.${field.key}`);
      for (const row of rows) {
        const entry = fieldsByPath.get(`${row.category}.${row.key}`);
        if (
          entry === undefined || entry.field.status !== row.status ||
          !sameJson(entry.field.value, row.value) || entry.field.unit !== row.unit ||
          entry.field.year !== row.year || !sameJson(entry.field.reason, row.reason) ||
          entry.field.checkedAt !== audit.retrievedAt.slice(0, 10) || entry.field.note !== null
        ) countryInputInvalid();
      }
    }
    return Object.freeze({
      updatedAt: reviewedProfile.updatedAt,
      sources: Object.freeze(reviewedProfile.sources.map((source) => Object.freeze(source))),
      auditSources: Object.freeze(reviewedProfile.auditSources.map((source) => Object.freeze(source))),
      fields: Object.freeze(fields),
    });
  } catch {
    throw new Error(COUNTRY_INPUT_ERROR);
  }
}

function parseProfileInputRecord(value: unknown): Readonly<{
  updatedAt: string; sources: readonly unknown[]; auditSources: readonly unknown[]; fields: readonly unknown[];
}> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) countryInputInvalid();
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !== "auditSources,fields,sources,updatedAt" ||
    typeof record.updatedAt !== "string" || !Array.isArray(record.sources) ||
    !Array.isArray(record.auditSources) || !Array.isArray(record.fields)
  ) countryInputInvalid();
  return { updatedAt: record.updatedAt, sources: record.sources, auditSources: record.auditSources, fields: record.fields };
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function uniqueById<T>(values: readonly T[], id: (value: T) => string): ReadonlyMap<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    const key = id(value);
    if (result.has(key)) countryInputInvalid();
    result.set(key, value);
  }
  return result;
}

export function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function nonEmptyLocalizedText(value: unknown): value is Readonly<{ zh: string; en: string }> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).sort().join(",") === "en,zh" &&
    typeof record.zh === "string" && record.zh.trim().length > 0 &&
    typeof record.en === "string" && record.en.trim().length > 0;
}

export function countryInputInvalid(): never {
  throw new Error(COUNTRY_INPUT_ERROR);
}

function isRfc3339(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) && Number.isFinite(Date.parse(value));
}
