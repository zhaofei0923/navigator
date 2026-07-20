import {
  BASIC_PROFILE_REQUIRED_FIELD_KEYS,
  type BasicProfileCategoryKey,
  type BasicProfileField,
  type BasicProfileSource,
} from "@navigator/shared-types/basic-profile";

import type { BasicCollectionAuditBundleV2 } from "../collection/basic-collection-v2-contracts.js";
import { materializeBasicProfile } from "../collection/basic-profile-fact-materializer.js";
import { compareText, nonEmptyLocalizedText, type ReviewedGlobalProfileInput } from "./basic-batch-production-input.js";

export function assembleProductionBasicProfile(input: Readonly<{
  baseBundle: BasicCollectionAuditBundleV2;
  additiveWorldBank: readonly Readonly<{
    profileSource: BasicProfileSource;
    field: Readonly<{ category: BasicProfileCategoryKey; field: BasicProfileField }>;
  }>[];
  reviewedProfile: ReviewedGlobalProfileInput;
}>) {
  const baseProfile = profileProjectionFromBase(input.baseBundle);
  return materializeBasicProfile({
    sources: [
      ...baseProfile.sources,
      ...input.additiveWorldBank.map(({ profileSource }) => profileSource),
      ...input.reviewedProfile.sources,
    ].sort((left, right) => compareText(left.id, right.id)),
    updatedAt: input.reviewedProfile.updatedAt,
    fields: sortProfileFields([
      ...baseProfile.fields,
      ...input.additiveWorldBank.map(({ field }) => field),
      ...input.reviewedProfile.fields,
    ]),
  });
}

function sortProfileFields(
  fields: readonly Readonly<{ category: BasicProfileCategoryKey; field: BasicProfileField }>[],
) {
  return [...fields].sort((left, right) => {
    if (left.category !== right.category) return compareText(left.category, right.category);
    const keys = BASIC_PROFILE_REQUIRED_FIELD_KEYS[left.category];
    return keys.indexOf(left.field.key as never) - keys.indexOf(right.field.key as never);
  });
}

function profileProjectionFromBase(bundle: BasicCollectionAuditBundleV2): Readonly<{
  sources: readonly BasicProfileSource[];
  fields: readonly Readonly<{ category: "countryBasics"; field: BasicProfileField }>[];
}> {
  const definitions = [
    ["country.code", "countryCode", bundle.sourceRegister.countryCode],
    ["country.name", "countryName", undefined],
    ["country.region", "region", undefined],
    ["marketOverview.population", "population", bundle.marketOverviewDraft.population],
    ["marketOverview.gdp", "gdp", bundle.marketOverviewDraft.gdp],
    ["marketOverview.gdpGrowth", "gdpGrowth", bundle.marketOverviewDraft.gdpGrowth],
  ] as const;
  const auditById = new Map(bundle.sourceRegister.sources.map((source) => [source.sourceId, source]));
  const referencedSourceIds = new Set<string>();
  const fields = definitions.map(([fieldPath, key, projectedValue]) => {
    const fact = bundle.extractedFacts.facts.find((entry) => entry.fieldPath === fieldPath);
    if (fact?.status !== "candidate" || fact.evidence.length === 0) {
      throw new Error("basic batch base profile fact is invalid");
    }
    const observedValue = projectedValue === undefined ? fact.evidence[0]!.normalizedValue : projectedValue;
    const value = baseProfileValue(key, observedValue, bundle.sourceRegister.countryCode);
    const sourceIds = [...new Set(fact.evidence.map(({ sourceId }) => sourceId))].sort(compareText);
    const sources = sourceIds.map((sourceId) => {
      const source = auditById.get(sourceId);
      if (source === undefined) throw new Error("basic batch base profile source is invalid");
      referencedSourceIds.add(sourceId);
      return source;
    });
    const unavailable = value === null;
    const firstEvidence = fact.evidence[0]!;
    return Object.freeze({
      category: "countryBasics" as const,
      field: Object.freeze({
        key,
        label: basicProfileLabel(key),
        status: unavailable ? "NOT_AVAILABLE" as const : "AVAILABLE" as const,
        value,
        unit: unavailable ? null : firstEvidence.unit,
        year: unavailable ? null : firstEvidence.year,
        sourceIds: Object.freeze(sourceIds),
        checkedAt: sources.map(({ retrievedAt }) => retrievedAt.slice(0, 10)).sort(compareText).at(-1)!,
        reason: unavailable ? Object.freeze({
          zh: "World Bank 已核查，但最近记录无可用数值",
          en: "World Bank was checked, but the latest record has no available value",
        }) : null,
        note: null,
      }),
    });
  });
  const sources = [...referencedSourceIds].sort(compareText).map((sourceId) => {
    const source = auditById.get(sourceId)!;
    return Object.freeze({
      id: source.sourceId,
      publisher: source.sourceName,
      title: Object.freeze({ zh: source.sourceName, en: source.sourceName }),
      url: source.sourceUrl,
      publishedAt: source.publishedAt,
      retrievedAt: source.retrievedAt,
      credibility: source.credibility,
    });
  });
  return Object.freeze({ sources: Object.freeze(sources), fields: Object.freeze(fields) });
}

function baseProfileValue(key: string, value: unknown, countryCode: string): BasicProfileField["value"] {
  if (key === "countryCode") {
    if (value !== countryCode) throw new Error("basic batch base profile value is invalid");
    return countryCode;
  }
  if (key === "countryName") {
    if (!nonEmptyLocalizedText(value)) throw new Error("basic batch base profile value is invalid");
    return value;
  }
  if (key === "region") {
    if (typeof value !== "string" || value.trim() === "") throw new Error("basic batch base profile value is invalid");
    return value;
  }
  if (value === null || (typeof value === "number" && Number.isFinite(value))) return value;
  throw new Error("basic batch base profile value is invalid");
}

function worldBankLabel(key: string): Readonly<{ zh: string; en: string }> {
  const labels: Record<string, Readonly<{ zh: string; en: string }>> = {
    population: { zh: "人口", en: "Population" },
    gdp: { zh: "国内生产总值", en: "GDP" },
    gdpPerCapita: { zh: "人均国内生产总值", en: "GDP per capita" },
    gdpGrowth: { zh: "国内生产总值增长率", en: "GDP growth" },
    electricityAccess: { zh: "通电率", en: "Access to electricity" },
  };
  return labels[key] ?? (() => { throw new Error("world bank BASIC field is invalid"); })();
}

function basicProfileLabel(key: string): Readonly<{ zh: string; en: string }> {
  const labels: Record<string, Readonly<{ zh: string; en: string }>> = {
    countryCode: { zh: "国家代码", en: "Country code" },
    countryName: { zh: "国家名称", en: "Country name" },
    region: { zh: "区域", en: "Region" },
  };
  return labels[key] ?? worldBankLabel(key);
}
