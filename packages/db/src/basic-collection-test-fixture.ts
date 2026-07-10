import { readFileSync } from "node:fs";

import type {
  BasicCollectionAuditBundle,
  BasicCollectionJsonValue,
  BasicCollectionReviewReport,
  BasicExtractedFacts,
  BasicMarketOverviewDraft,
} from "./collection/basic-collection-contracts.js";
import { BASIC_COLLECTION_AUDIT_SCHEMA_VERSION } from "./collection/basic-collection-contracts.js";
import { validateBasicCollectionAuditBundle } from "./collection/basic-collection-validator.js";

export type BasicCollectionFixtureScenario =
  | "normal"
  | "missing"
  | "conflict"
  | "untrusted";

export function readBasicCollectionAuditFixture(
  scenario: BasicCollectionFixtureScenario,
): BasicCollectionAuditBundle {
  const fixtureUrl = new URL(
    `../fixtures/basic-collection/${scenario}.json`,
    import.meta.url,
  );
  const fixture = JSON.parse(readFileSync(fixtureUrl, "utf8")) as unknown;
  const result = validateBasicCollectionAuditBundle(fixture);
  if (!result.valid) {
    throw new Error(result.errors.join("\n"));
  }
  return result.data;
}

export function createBasicCollectionAuditFixture(
): BasicCollectionAuditBundle {
  const runId = "run-001";
  const countryCode = "XZ";
  const marketOverviewDraft: BasicMarketOverviewDraft = {
    overview: { zh: "市场概览", en: "Market overview" },
    population: 1000000,
    gdp: 25000000000,
    gdpGrowth: 5.2,
    energyDemand: { zh: "能源需求", en: "Energy demand" },
    renewableTarget: { zh: "可再生能源目标", en: "Renewable target" },
    keyIndicators: [
      {
        label: { zh: "装机容量", en: "Installed capacity" },
        value: "20",
        unit: "GW",
        year: 2025,
      },
    ],
    source: "Official source",
    sourceUrl: "https://example.com/market-overview",
    collectedAt: "2026-07-09T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z",
    credibility: "OFFICIAL",
    reviewStatus: "draft",
    aiUsable: false,
    countryCode,
    industryTags: ["solar"],
    techTags: ["pv-module"],
  };
  return {
    countryDirectory: "example-land",
    runId,
    sourceRegister: {
      schemaVersion: BASIC_COLLECTION_AUDIT_SCHEMA_VERSION,
      runId,
      countryCode,
      sources: [createSource("source-1"), createSource("source-2")],
    },
    extractedFacts: createFacts(runId, countryCode, marketOverviewDraft),
    marketOverviewDraft,
    reviewReport: createReviewReport(runId, countryCode),
  };
}

function createSource(sourceId: string) {
  return {
    sourceId,
    sourceName: `Source ${sourceId}`,
    sourceUrl: `https://example.com/${sourceId}`,
    retrievedAt: "2026-07-09T00:00:00Z",
    publishedAt: "2026-07-08T00:00:00Z",
    contentSha256:
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    evidenceLocators: ["page 1"],
    sourceFamily: "official-statistics" as const,
    accessStatus: "open" as const,
    accessNotes: null,
    credibility: "OFFICIAL" as const,
    discoveryOnly: false,
    promptInjectionRisk: "none" as const,
  };
}

function createFacts(
  runId: string,
  countryCode: string,
  draft: BasicMarketOverviewDraft,
): BasicExtractedFacts {
  const indicator = draft.keyIndicators[0];
  if (indicator === undefined) {
    throw new Error("fixture key indicator is required");
  }
  const factValues: Array<readonly [string, BasicCollectionJsonValue]> = [
    ["marketOverview.population", draft.population],
    ["country.code", countryCode],
    ["country.name", { zh: "示例国家", en: "Example Land" }],
    ["country.summary", { zh: "示例摘要", en: "Example summary" }],
    ["country.region", "TEST_REGION"],
    ["country.flagEmoji", "XZ"],
    ["country.updatedAt", draft.updatedAt],
    ["marketOverview.overview", { ...draft.overview }],
    ["marketOverview.gdp", draft.gdp],
    ["marketOverview.gdpGrowth", draft.gdpGrowth],
    ["marketOverview.energyDemand", { ...draft.energyDemand }],
    ["marketOverview.renewableTarget", { ...draft.renewableTarget }],
    ["marketOverview.source", draft.source],
    ["marketOverview.sourceUrl", draft.sourceUrl],
    ["marketOverview.collectedAt", draft.collectedAt],
    ["marketOverview.updatedAt", draft.updatedAt],
    ["marketOverview.credibility", draft.credibility],
    ["marketOverview.countryCode", draft.countryCode],
    ["marketOverview.industryTags", [...draft.industryTags]],
    ["marketOverview.techTags", [...draft.techTags]],
    ["marketOverview.keyIndicators[0].label", { ...indicator.label }],
    ["marketOverview.keyIndicators[0].value", indicator.value],
    ["marketOverview.keyIndicators[0].unit", indicator.unit],
    ["marketOverview.keyIndicators[0].year", indicator.year],
  ];
  return {
    schemaVersion: BASIC_COLLECTION_AUDIT_SCHEMA_VERSION,
    runId,
    countryCode,
    facts: factValues.map(([fieldPath, normalizedValue], index) => ({
      factId: `fact-${index + 1}`,
      fieldPath,
      status: "candidate",
      evidence: [createEvidence("source-1", normalizedValue)],
      extractionMethod: "deterministic",
      uncertainty: null,
    })),
  };
}

function createEvidence(
  sourceId: string,
  normalizedValue: BasicCollectionJsonValue,
) {
  return {
    sourceId,
    locator: "table 1",
    rawValue: normalizedValue,
    normalizedValue,
    unit: null,
    year: null,
  };
}

function createReviewReport(
  runId: string,
  countryCode: string,
): BasicCollectionReviewReport {
  return {
    schemaVersion: BASIC_COLLECTION_AUDIT_SCHEMA_VERSION,
    runId,
    countryCode,
    status: "ready-for-human-review",
    missingFields: [],
    conflicts: [],
    sourceChecks: [
      { sourceId: "source-1", status: "passed", notes: null },
      { sourceId: "source-2", status: "passed", notes: null },
    ],
    injectionRisks: [],
    publicationRecommendation: "request-human-review",
    humanDecision: null,
  };
}
