import type {
  BasicProfile,
  BasicProfileCategories,
} from "@navigator/shared-types/basic-profile";

import { createBasicCollectionAuditV2Fixture } from "./basic-collection-test-fixture.js";

const PROFILE_FIELD_ENTRIES = [
  ["countryBasics", "countryClassification", "Example classification"],
  ["electricityMarket", "annualElectricitySales", 125],
  ["energyAccess", "electricityAccess", 98.5],
  ["renewableCapacity", "installedRenewableCapacity", 20],
  ["solarResource", "solarResourceSummary", "Example solar resource"],
  ["windResource", "windResourceSummary", "Example wind resource"],
  ["policyOverview", "renewablePolicySummary", "Example renewable policy"],
  ["marketSummary", "marketReadiness", "Example market readiness"],
] as const;

export function createBasicCollectionAuditV3Fixture() {
  const v2 = createBasicCollectionAuditV2Fixture();
  const categories = Object.fromEntries(PROFILE_FIELD_ENTRIES.map(
    ([category, key, value]) => [category, {
      fields: [{
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
      }],
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
    const field = categories[category].fields[0]!;
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
