import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { BASIC_COLLECTION_REQUIRED_STATIC_FACT_PATHS } from "./collection/basic-collection-contracts.js";
import { BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION } from "./collection/basic-collection-v2-contracts.js";
import { validateBasicCollectionAuditBundleV2 } from "./collection/basic-collection-v2-validator.js";
import { loadBasicCollectionAuditBundleVersioned } from "./collection/basic-collection-versioned-loader.js";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const COUNTRY_DIRECTORY = "south-africa";
const COUNTRY_CODE = "ZA";
const RUN_ID = "data-basic-za-20260717-r1";
const CATALOG_VERSION = "2026-07-17.2";
const CATALOG_SHA256 =
  "6d4c6a27367eb36e4fe20df8fe78a9c9a9e865f84af563a22e31069c176d6f0a";
const SOURCE_IDS = [
  "south-africa-eskom-results-presentation-2025",
  "south-africa-government-irp-2025",
  "south-africa-government-rmippp-hybrid-projects-2023",
  "world-bank-country",
  "world-bank-gdp",
  "world-bank-gdp-growth",
  "world-bank-population",
] as const;
const SOURCE_BINDINGS = [
  {
    sourceId: "south-africa-eskom-results-presentation-2025",
    retrievedAt: "2026-07-17T16:14:44.039Z",
    contentSha256: "85192e6a0da922be7fbdf5a6f985193043bac8e7450db844fbd35bc4c1c72c18",
    sourceFamily: "grid-operator",
  },
  {
    sourceId: "south-africa-government-irp-2025",
    retrievedAt: "2026-07-17T16:14:47.506Z",
    contentSha256: "82690b0dec299326c538888ebdf515515b1cd522490db08d03c7bdecf4b93da4",
    sourceFamily: "government",
  },
  {
    sourceId: "south-africa-government-rmippp-hybrid-projects-2023",
    retrievedAt: "2026-07-17T16:14:52.987Z",
    contentSha256: "897d8c29dd37ae192d4d9f54b0de5c02e6969707fffc323c4032ef892fb43237",
    sourceFamily: "government",
  },
  {
    sourceId: "world-bank-country",
    retrievedAt: "2026-07-17T16:14:54.768Z",
    contentSha256: "fefa34282d0ae0f5287744a1d7c3383c751b7a3ca2ad64bf08cac12da1c7c157",
    sourceFamily: "international-organization",
  },
  {
    sourceId: "world-bank-gdp",
    retrievedAt: "2026-07-17T16:15:15.975Z",
    contentSha256: "a53c054fdc3956399fd4bb6127c898bafbc3b7ee0e8038197c8218a406a7f926",
    sourceFamily: "international-organization",
  },
  {
    sourceId: "world-bank-gdp-growth",
    retrievedAt: "2026-07-17T16:15:17.173Z",
    contentSha256: "df84507dcaaac50672a9647791ff07f4e2b03121dec51d52a183d8f5f221fc64",
    sourceFamily: "international-organization",
  },
  {
    sourceId: "world-bank-population",
    retrievedAt: "2026-07-17T16:15:15.746Z",
    contentSha256: "13d8e9ca3882b26e12553b213737dd92c4f300aac03299d8f5ebcad88697af1f",
    sourceFamily: "international-organization",
  },
] as const;
const INDICATORS = [
  {
    label: { zh: "Eskom售电量", en: "Eskom electricity sales volume" },
    value: "189.7",
    unit: "TWh",
    year: 2025,
  },
  {
    label: { zh: "Eskom自发电量", en: "Eskom-only energy sent out" },
    value: "195702",
    unit: "GWh",
    year: 2025,
  },
  {
    label: { zh: "规划新增风电容量", en: "Planned wind additions" },
    value: "43041",
    unit: "MW",
    year: 2042,
  },
] as const;
const INDICATOR_PATHS = INDICATORS.flatMap((_indicator, index) => [
  `marketOverview.keyIndicators[${index}].label`,
  `marketOverview.keyIndicators[${index}].unit`,
  `marketOverview.keyIndicators[${index}].value`,
  `marketOverview.keyIndicators[${index}].year`,
]);
const ARTIFACT_HASHES = {
  "extracted-facts.json": "342d2f7db3428e3b59af995329753c7016968e0f864565b8348db7daef8bc36b",
  "market-overview.draft.json": "de3527d18aa616fab178f77fbb30ee823253f87b537c336a3192fed8e88bbe4b",
  "review-report.json": "d73547abfafe31b3277261397aabbda6b05ceccfc71f54e3003e03d697f4964b",
  "source-register.json": "52737f24e2b2daba6208a75ce6b3beb7c731f3a2c80ac7a268f7aa7f46740e0d",
} as const;

describe("South Africa Basic r1 candidate", () => {
  test("locks the generated v2 candidate at the human-review gate", () => {
    const bundle = loadBasicCollectionAuditBundleVersioned(
      REPO_ROOT,
      COUNTRY_DIRECTORY,
      RUN_ID,
    );

    expect(bundle.sourceRegister.schemaVersion).toBe(
      BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION,
    );
    if (bundle.sourceRegister.schemaVersion !== BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION) {
      throw new Error("expected South Africa candidate to use the v2 audit contract");
    }
    expect(validateBasicCollectionAuditBundleV2(bundle)).toMatchObject({
      valid: true,
      readyForHumanReview: true,
      blockers: [],
      errors: [],
    });
    expect(bundle).toMatchObject({
      countryDirectory: COUNTRY_DIRECTORY,
      runId: RUN_ID,
      sourceRegister: {
        runId: RUN_ID,
        countryCode: COUNTRY_CODE,
        catalogVersion: CATALOG_VERSION,
        catalogSha256: CATALOG_SHA256,
      },
      extractedFacts: { runId: RUN_ID, countryCode: COUNTRY_CODE },
      reviewReport: {
        runId: RUN_ID,
        countryCode: COUNTRY_CODE,
        status: "ready-for-human-review",
        missingFields: [],
        conflicts: [],
        injectionRisks: [],
        publicationRecommendation: "request-human-review",
        humanDecision: null,
      },
      marketOverviewDraft: {
        reviewStatus: "draft",
        aiUsable: false,
        countryCode: COUNTRY_CODE,
        industryTags: ["grid", "solar", "storage", "wind"],
        techTags: ["onshore-wind"],
        keyIndicators: INDICATORS,
      },
    });

    expect(bundle.sourceRegister.sources.map((source) => ({
      sourceId: source.sourceId,
      retrievedAt: source.retrievedAt,
      contentSha256: source.contentSha256,
      sourceFamily: source.sourceFamily,
    }))).toEqual(SOURCE_BINDINGS);
    expect(bundle.sourceRegister.sources.every((source) =>
      source.credibility === "OFFICIAL" &&
      source.accessStatus === "open" &&
      source.promptInjectionRisk === "none"
    )).toBe(true);
    expect(bundle.reviewReport.sourceChecks.map(({ sourceId, status }) => ({
      sourceId,
      status,
    }))).toEqual(SOURCE_IDS.map((sourceId) => ({ sourceId, status: "passed" })));

    const sourceLocators = new Map(bundle.sourceRegister.sources.map((source) => [
      source.sourceId,
      new Set(source.evidenceLocators),
    ]));
    const factsByPath = new Map(bundle.extractedFacts.facts.map((fact) => [
      fact.fieldPath,
      fact,
    ]));
    const expectedPaths = [
      ...BASIC_COLLECTION_REQUIRED_STATIC_FACT_PATHS,
      ...INDICATOR_PATHS,
    ].sort(compareText);
    expect([...factsByPath.keys()]).toEqual(expectedPaths);
    for (const fieldPath of expectedPaths) {
      const fact = factsByPath.get(fieldPath);
      expect(fact, fieldPath).toMatchObject({ status: "candidate" });
      expect(fact?.evidence.length, fieldPath).toBeGreaterThan(0);
      for (const evidence of fact?.evidence ?? []) {
        expect(sourceLocators.get(evidence.sourceId)?.has(evidence.locator), fieldPath)
          .toBe(true);
      }
    }

    expect(factsByPath.get("marketOverview.population")).toMatchObject({
      extractionMethod: "deterministic",
      evidence: [{ normalizedValue: 64747319, unit: "people", year: 2025 }],
    });
    expect(factsByPath.get("marketOverview.gdp")).toMatchObject({
      extractionMethod: "deterministic",
      evidence: [{ normalizedValue: 427184325997.307, unit: "current US$", year: 2025 }],
    });
    expect(factsByPath.get("marketOverview.gdpGrowth")).toMatchObject({
      extractionMethod: "deterministic",
      evidence: [{ normalizedValue: 1.11462608103956, unit: "%", year: 2025 }],
    });
    expect(factsByPath.get("marketOverview.keyIndicators[0].value")).toMatchObject({
      extractionMethod: "manual",
      evidence: [{
        sourceId: "south-africa-eskom-results-presentation-2025",
        locator: "pdf:page=18#slide-17-sales-volumes-fy2025",
        rawValue: 189.7,
        normalizedValue: "189.7",
        unit: "TWh",
        year: 2025,
      }],
    });
    expect(factsByPath.get("marketOverview.keyIndicators[1].value")).toMatchObject({
      extractionMethod: "manual",
      evidence: [{
        sourceId: "south-africa-eskom-results-presentation-2025",
        locator: "pdf:page=11#slide-10-eskom-only-energy-sent-out-fy2025",
        rawValue: 195702,
        normalizedValue: "195702",
        unit: "GWh",
        year: 2025,
      }],
    });
    expect(factsByPath.get("marketOverview.keyIndicators[2].value")).toMatchObject({
      extractionMethod: "manual",
      evidence: [{
        sourceId: "south-africa-government-irp-2025",
        locator: "pdf:page=40#printed-31-balanced-plan-wind-additions-2026-2042",
        rawValue: 43041,
        normalizedValue: "43041",
        unit: "MW",
        year: 2042,
      }],
    });

    for (const text of [
      bundle.marketOverviewDraft.overview,
      bundle.marketOverviewDraft.energyDemand,
      bundle.marketOverviewDraft.renewableTarget,
      ...bundle.marketOverviewDraft.keyIndicators.map(({ label }) => label),
    ]) assertBilingual(text);
    expect(bundle.marketOverviewDraft.energyDemand.en).toContain("excluding wheeling");
    expect(bundle.marketOverviewDraft.renewableTarget.en).toContain("cumulative plan");

    const stagingDirectory = join(REPO_ROOT, "data", "staging", COUNTRY_DIRECTORY, RUN_ID);
    expect(readdirSync(stagingDirectory).sort(compareText)).toEqual(
      Object.keys(ARTIFACT_HASHES),
    );
    expect(hashArtifacts(stagingDirectory, Object.keys(ARTIFACT_HASHES))).toEqual(
      ARTIFACT_HASHES,
    );
    expect(existsSync(join(stagingDirectory, "collection-manifest.json"))).toBe(false);
    expect(existsSync(join(REPO_ROOT, "data", COUNTRY_DIRECTORY))).toBe(false);
    expect(existsSync(join(REPO_ROOT, "data", "approvals", COUNTRY_DIRECTORY))).toBe(false);
  });
});

function hashArtifacts(
  directory: string,
  names: readonly string[],
): Readonly<Record<string, string>> {
  return Object.fromEntries(names.map((name) => [
    name,
    createHash("sha256").update(readFileSync(join(directory, name))).digest("hex"),
  ]));
}

function assertBilingual(value: unknown): void {
  expect(value).toMatchObject({ zh: expect.any(String), en: expect.any(String) });
  if (typeof value !== "object" || value === null) throw new Error("expected bilingual value");
  const localized = value as Readonly<Record<string, unknown>>;
  expect(String(localized.zh).trim()).not.toBe("");
  expect(String(localized.en).trim()).not.toBe("");
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
