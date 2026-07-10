import { readFileSync } from "node:fs";

import type {
  BasicCollectionAuditBundle,
  BasicCollectionReviewReport,
  BasicExtractedFacts,
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
  scenario: BasicCollectionFixtureScenario = "normal",
): BasicCollectionAuditBundle {
  const runId = "run-001";
  const countryCode = "XZ";
  return {
    countryDirectory: "example-land",
    runId,
    sourceRegister: {
      schemaVersion: BASIC_COLLECTION_AUDIT_SCHEMA_VERSION,
      runId,
      countryCode,
      sources: [createSource("source-1"), createSource("source-2")],
    },
    extractedFacts: createFacts(scenario, runId, countryCode),
    marketOverviewDraft: {
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
    },
    reviewReport: createReviewReport(scenario, runId, countryCode),
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
  scenario: BasicCollectionFixtureScenario,
  runId: string,
  countryCode: string,
): BasicExtractedFacts {
  const fact = {
    factId: "fact-1",
    fieldPath: "marketOverview.population",
    status: "candidate" as const,
    evidence: [createEvidence("source-1")],
    extractionMethod: "deterministic" as const,
    uncertainty: null,
  };
  if (scenario === "missing") {
    fact.fieldPath = "country.summary";
    return {
      schemaVersion: BASIC_COLLECTION_AUDIT_SCHEMA_VERSION,
      runId,
      countryCode,
      facts: [{ ...fact, status: "missing", evidence: [], uncertainty: "Not found" }],
    };
  }
  if (scenario === "conflict") {
    return {
      schemaVersion: BASIC_COLLECTION_AUDIT_SCHEMA_VERSION,
      runId,
      countryCode,
      facts: [{ ...fact, status: "conflict", evidence: [createEvidence("source-1"), createEvidence("source-2")] }],
    };
  }
  return {
    schemaVersion: BASIC_COLLECTION_AUDIT_SCHEMA_VERSION,
    runId,
    countryCode,
    facts: [fact],
  };
}

function createEvidence(sourceId: string) {
  return {
    sourceId,
    locator: "table 1",
    rawValue: 1000000,
    normalizedValue: 1000000,
    unit: "people",
    year: 2025,
  };
}

function createReviewReport(
  scenario: BasicCollectionFixtureScenario,
  runId: string,
  countryCode: string,
): BasicCollectionReviewReport {
  const blocked = scenario !== "normal";
  return {
    schemaVersion: BASIC_COLLECTION_AUDIT_SCHEMA_VERSION,
    runId,
    countryCode,
    status: blocked ? "blocked" : "ready-for-human-review",
    missingFields: scenario === "missing" ? ["country.summary"] : [],
    conflicts:
      scenario === "conflict"
        ? [
            {
              fieldPath: "marketOverview.population",
              factIds: ["fact-1"],
              resolution: "unresolved",
              notes: "Sources disagree",
            },
          ]
        : [],
    sourceChecks:
      scenario === "untrusted"
        ? [{ sourceId: "source-1", status: "failed", notes: "Integrity check failed" }]
        : [],
    injectionRisks:
      scenario === "untrusted"
        ? [
            {
              sourceId: "source-1",
              locator: "page 1",
              severity: "suspected",
              details: "Instruction-like text detected",
            },
          ]
        : [],
    publicationRecommendation: blocked ? "do-not-publish" : "request-human-review",
    humanDecision: null,
  };
}
