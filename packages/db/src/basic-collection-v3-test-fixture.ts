import type {
  BasicProfile,
  BasicProfileCategoryKey,
  BasicProfileCategories,
} from "@navigator/shared-types/basic-profile";

import { createBasicCollectionAuditV2Fixture } from "./basic-collection-test-fixture.js";

const PROFILE_FIELDS = {
  countryBasics: [
    ["countryCode", "XZ"],
    ["countryName", { zh: "示例国家", en: "Example Land" }],
    ["region", { zh: "示例区域", en: "Example region" }],
    ["population", 1_000_000],
    ["gdp", 25_000_000_000],
    ["gdpPerCapita", 25_000],
    ["gdpGrowth", 5.2],
  ],
  electricityMarket: [
    ["totalGeneration", 125],
    ["electricityConsumption", 110],
    ["electricityMix", { zh: "示例电力结构", en: "Example electricity mix" }],
    ["renewableGenerationShare", 45],
  ],
  energyAccess: [["electricityAccess", 98.5]],
  renewableCapacity: [
    ["totalRenewableCapacity", 20],
    ["solarCapacity", 8],
    ["windCapacity", 5],
    ["hydroCapacity", 7],
  ],
  solarResource: [
    ["ghi", 5.1],
    ["pvout", 4.3],
    ["solarPotentialSummary", { zh: "示例太阳能潜力", en: "Example solar potential" }],
  ],
  windResource: [
    ["onshoreWindClass", "good"],
    ["offshoreWindClass", "very-good"],
    ["resourceSummary", { zh: "示例风能资源", en: "Example wind resource" }],
  ],
  policyOverview: [[
    "summary", { zh: "示例可再生能源政策", en: "Example renewable policy" },
  ]],
  marketSummary: [[
    "opportunitySummary", { zh: "示例市场机会", en: "Example market opportunity" },
  ]],
} as const;

const PROFILE_FIELD_ENTRIES = Object.entries(PROFILE_FIELDS).flatMap(
  ([category, fields]) => fields.map(([key, value]) => [category, key, value] as const),
);

export function createBasicCollectionAuditV3Fixture() {
  const v2 = createBasicCollectionAuditV2Fixture();
  const categories = Object.fromEntries(Object.entries(PROFILE_FIELDS).map(
    ([category, entries]) => [category, {
      fields: entries.map(([key, value]) => ({
        key,
        label: { zh: `${key} 中文标签`, en: `${key} label` },
        status: "AVAILABLE" as const,
        value,
        unit: typeof value === "number" ? "fixture-unit" : null,
        year: typeof value === "number" ? 2025 : null,
        sourceIds: ["source-1"],
        checkedAt: "2026-07-09",
        reason: null,
        note: null,
      })),
    }],
  )) as unknown as BasicProfileCategories;
  const basicProfile: BasicProfile = {
    schemaVersion: "basic-market-profile/v2" as const,
    categories,
    sources: [{
      id: "source-1",
      publisher: "Fixture Publisher",
      title: { zh: "合成来源", en: "Synthetic source" },
      url: "https://example.com/source-1",
      publishedAt: "2026-07-08T00:00:00Z",
      retrievedAt: "2026-07-09T00:00:00Z",
      credibility: "OFFICIAL" as const,
    }],
    updatedAt: "2026-07-10T00:00:00Z",
  };
  const profileFacts = PROFILE_FIELD_ENTRIES.map(([category, key]) => {
    const field = categories[category as BasicProfileCategoryKey].fields.find(
      (candidate) => candidate.key === key,
    )!;
    return {
      factId: `fact-profile-${category}-${key}`,
      fieldPath: `marketOverview.basicProfile.categories.${category}.fields.${key}`,
      status: "candidate" as const,
      evidence: [{
        sourceId: "source-1",
        locator: "table 1",
        rawValue: structuredClone(field),
        normalizedValue: structuredClone(field),
        unit: null,
        year: null,
      }],
      extractionMethod: "manual" as const,
      uncertainty: null,
    };
  });

  return {
    countryDirectory: v2.countryDirectory,
    runId: v2.runId,
    sourceRegister: {
      ...structuredClone(v2.sourceRegister),
      schemaVersion: "basic-country-audit/v3" as const,
    },
    extractedFacts: {
      ...structuredClone(v2.extractedFacts),
      schemaVersion: "basic-country-audit/v3" as const,
      facts: [...structuredClone(v2.extractedFacts.facts), ...profileFacts].sort(
        (left, right) => left.fieldPath < right.fieldPath
          ? -1
          : left.fieldPath > right.fieldPath ? 1 : 0,
      ),
    },
    marketOverviewDraft: {
      ...structuredClone(v2.marketOverviewDraft),
      basicProfile,
    },
    reviewReport: {
      ...structuredClone(v2.reviewReport),
      schemaVersion: "basic-country-audit/v3" as const,
    },
  };
}
