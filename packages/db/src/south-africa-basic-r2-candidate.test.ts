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
const R1_RUN_ID = "data-basic-za-20260717-r1";
const R2_RUN_ID = "data-basic-za-20260718-r2";
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
    sourceName: "Eskom Holdings SOC Ltd",
    sourceUrl: "https://www.eskom.co.za/wp-content/uploads/2025/09/Eskom-results-presentation-2025.pdf",
    retrievedAt: "2026-07-18T01:24:25.891Z",
    publishedAt: null,
    contentSha256: "85192e6a0da922be7fbdf5a6f985193043bac8e7450db844fbd35bc4c1c72c18",
    sourceFamily: "grid-operator",
    evidenceLocators: [
      "capture:/retrievedAt",
      "metadata:/credibility",
      "pdf:page=11#slide-10-eskom-only-energy-sent-out-fy2025",
      "pdf:page=18#slide-17-sales-volumes-fy2025",
    ],
  },
  {
    sourceId: "south-africa-government-irp-2025",
    sourceName: "Government of South Africa",
    sourceUrl: "https://www.gov.za/sites/default/files/gcis_document/202510/53596gon6767.pdf",
    retrievedAt: "2026-07-18T01:24:29.319Z",
    publishedAt: "2025-10-28T00:00:00.000Z",
    contentSha256: "82690b0dec299326c538888ebdf515515b1cd522490db08d03c7bdecf4b93da4",
    sourceFamily: "government",
    evidenceLocators: [
      "capture:/retrievedAt",
      "metadata:/credibility",
      "metadata:/publishedAt",
      "metadata:/sourceName",
      "metadata:/sourceUrl",
      "pdf:page=1#government-notice-6767-28-october-2025",
      "pdf:page=39#printed-30-current-base-capacity",
      "pdf:page=40#printed-31-balanced-plan-additions-2026-2042",
      "pdf:page=40#printed-31-balanced-plan-wind-additions-2026-2042",
    ],
  },
  {
    sourceId: "south-africa-government-rmippp-hybrid-projects-2023",
    sourceName: "Government of South Africa",
    sourceUrl: "https://www.gov.za/news/media-statements/minister-gwede-mantashe-signs-agreements-under-risk-mitigation-independent",
    retrievedAt: "2026-07-18T01:24:35.796Z",
    publishedAt: "2023-08-30T12:00:00.000Z",
    contentSha256: "bf176582a6ddd1769cf7ae67fac1bb8666b3911d2ab98e78515a34decbfe7bf1",
    sourceFamily: "government",
    evidenceLocators: [
      "capture:/retrievedAt",
      "html:body#rmippp-hybrid-projects-203mw",
      "metadata:/credibility",
      "metadata:/publishedAt",
    ],
  },
  {
    sourceId: "world-bank-country",
    sourceName: "World Bank",
    sourceUrl: "https://api.worldbank.org/v2/country/ZA?format=json",
    retrievedAt: "2026-07-18T01:24:36.498Z",
    publishedAt: null,
    contentSha256: "fefa34282d0ae0f5287744a1d7c3383c751b7a3ca2ad64bf08cac12da1c7c157",
    sourceFamily: "international-organization",
    evidenceLocators: [
      "capture:/retrievedAt",
      "json:/1/0/iso2Code",
      "json:/1/0/name",
      "metadata:/credibility",
    ],
  },
  {
    sourceId: "world-bank-gdp",
    sourceName: "World Bank",
    sourceUrl: "https://api.worldbank.org/v2/country/ZA/indicator/NY.GDP.MKTP.CD?source=2&format=json&mrv=1&per_page=1",
    retrievedAt: "2026-07-18T01:24:36.776Z",
    publishedAt: null,
    contentSha256: "a53c054fdc3956399fd4bb6127c898bafbc3b7ee0e8038197c8218a406a7f926",
    sourceFamily: "international-organization",
    evidenceLocators: ["capture:/retrievedAt", "json:/1/0/value", "metadata:/credibility"],
  },
  {
    sourceId: "world-bank-gdp-growth",
    sourceName: "World Bank",
    sourceUrl: "https://api.worldbank.org/v2/country/ZA/indicator/NY.GDP.MKTP.KD.ZG?source=2&format=json&mrv=1&per_page=1",
    retrievedAt: "2026-07-18T01:24:37.073Z",
    publishedAt: null,
    contentSha256: "df84507dcaaac50672a9647791ff07f4e2b03121dec51d52a183d8f5f221fc64",
    sourceFamily: "international-organization",
    evidenceLocators: ["capture:/retrievedAt", "json:/1/0/value", "metadata:/credibility"],
  },
  {
    sourceId: "world-bank-population",
    sourceName: "World Bank",
    sourceUrl: "https://api.worldbank.org/v2/country/ZA/indicator/SP.POP.TOTL?source=2&format=json&mrv=1&per_page=1",
    retrievedAt: "2026-07-18T01:24:37.309Z",
    publishedAt: null,
    contentSha256: "13d8e9ca3882b26e12553b213737dd92c4f300aac03299d8f5ebcad88697af1f",
    sourceFamily: "international-organization",
    evidenceLocators: ["capture:/retrievedAt", "json:/1/0/value", "metadata:/credibility"],
  },
] as const;
const INDICATORS = [
  { label: { zh: "Eskom售电量", en: "Eskom electricity sales volume" }, value: "189.7", unit: "TWh", year: 2025 },
  { label: { zh: "Eskom口径送出电量", en: "Eskom-only energy sent out" }, value: "195702", unit: "GWh", year: 2025 },
  { label: { zh: "2026至2042年累计规划新增风电", en: "Cumulative planned wind additions, 2026-2042" }, value: "43041", unit: "MW", year: 2042 },
] as const;
const SUMMARY = {
  zh: "南非电力系统以Eskom为主要电网运营商。Eskom在2025财年的售电量为189.7太瓦时，Eskom口径送出电量为195,702吉瓦时。2025年10月28日发布的政府《综合资源计划2025》显示，当前基础包括已投运、在建及视为于2025年投运的容量，其中风电5,344兆瓦、并网太阳能3,646兆瓦；该计划提出2026至2042年累计规划新增风电43,041兆瓦和太阳能28,713兆瓦。2023年公告的两个混合可再生能源项目总计203兆瓦，采用光伏、陆上风电和储能技术。",
  en: "South Africa's power system is served by Eskom as its principal grid operator. Eskom reported 189.7 TWh of sales volumes and 195,702 GWh of Eskom-only energy sent out in FY2025. The government Integrated Resource Plan 2025, published on 28 October 2025, states that its current base includes installed, under-construction, and deemed-online-in-2025 capacity, including 5,344 MW of wind and 3,646 MW of grid-tied solar; it sets cumulative planned additions of 43,041 MW of wind and 28,713 MW of solar for 2026-2042. A 2023 announcement covered two hybrid renewable projects totaling 203 MW using solar PV, onshore wind, and battery storage.",
} as const;
const OVERVIEW = {
  zh: "Eskom在2025财年的售电量为189.7太瓦时，Eskom口径送出电量为195,702吉瓦时。《综合资源计划2025》的当前基础包括已投运、在建及视为于2025年投运的容量，其中风电5,344兆瓦、并网太阳能3,646兆瓦；2023年RMIPPPP公告的两个混合可再生能源项目共203兆瓦，采用光伏、陆上风电和储能。",
  en: "Eskom reported 189.7 TWh of sales volumes and 195,702 GWh of Eskom-only energy sent out in FY2025. The Integrated Resource Plan 2025 current base includes installed, under-construction, and deemed-online-in-2025 capacity, including 5,344 MW of wind and 3,646 MW of grid-tied solar; a 2023 RMIPPPP announcement covered two hybrid renewable projects totaling 203 MW using solar PV, onshore wind, and battery storage.",
} as const;
const ENERGY_DEMAND = {
  zh: "Eskom在2025财年的售电量为189.7太瓦时，2024财年为183.3太瓦时，同比增长3.5%。Eskom口径送出电量为195,702吉瓦时，2024财年为184,576吉瓦时。",
  en: "Eskom sales volumes were 189.7 TWh in FY2025 versus 183.3 TWh in FY2024, a 3.5% increase. Eskom-only energy sent out was 195,702 GWh versus 184,576 GWh.",
} as const;
const RENEWABLE_TARGET = {
  zh: "《综合资源计划2025》的平衡方案提出，2026至2042年累计规划新增太阳能28,713兆瓦、风电43,041兆瓦。这些数值是规划中的累计新增容量，不代表已建成或已采购容量。",
  en: "The Integrated Resource Plan 2025 balanced plan sets cumulative planned additions of 28,713 MW of solar and 43,041 MW of wind for 2026-2042. These are planned cumulative additions, not built or procured capacity.",
} as const;
const R1_ARTIFACT_HASHES = {
  "extracted-facts.json": "342d2f7db3428e3b59af995329753c7016968e0f864565b8348db7daef8bc36b",
  "market-overview.draft.json": "de3527d18aa616fab178f77fbb30ee823253f87b537c336a3192fed8e88bbe4b",
  "review-report.json": "d73547abfafe31b3277261397aabbda6b05ceccfc71f54e3003e03d697f4964b",
  "source-register.json": "52737f24e2b2daba6208a75ce6b3beb7c731f3a2c80ac7a268f7aa7f46740e0d",
} as const;
const R2_ARTIFACT_HASHES = {
  "extracted-facts.json": "dc8387ad8569037d799e59b0be8502647bf2719d7b9395962d56901f9df1250c",
  "market-overview.draft.json": "16ea4b33672b0c5ff4ad025eca1ca8d2ca0ceb36f95bf8c8f8d7da93c6b91536",
  "review-report.json": "f73b93f10e3dc0d40eac7f918745bde855f11d49fed5a0259ea2fefa27e92a33",
  "source-register.json": "7a99e47484e038a708201981035da50de7309f09ede5ab235ad4f32151001e3f",
} as const;

describe("South Africa Basic r2 candidate", () => {
  test("keeps the rejected r1 staging artifacts byte-identical", () => {
    const directory = join(REPO_ROOT, "data", "staging", COUNTRY_DIRECTORY, R1_RUN_ID);
    expect(readdirSync(directory).sort(compareText)).toEqual(Object.keys(R1_ARTIFACT_HASHES));
    expect(hashArtifacts(directory, Object.keys(R1_ARTIFACT_HASHES))).toEqual(R1_ARTIFACT_HASHES);
  });

  test("uses fresh committed source-register identity for every r1 source", () => {
    const r1 = loadBasicCollectionAuditBundleVersioned(REPO_ROOT, COUNTRY_DIRECTORY, R1_RUN_ID);
    const r2 = loadBasicCollectionAuditBundleVersioned(REPO_ROOT, COUNTRY_DIRECTORY, R2_RUN_ID);
    const r1Sources = new Map(r1.sourceRegister.sources.map((source) => [source.sourceId, source]));
    const r2Sources = new Map(r2.sourceRegister.sources.map((source) => [source.sourceId, source]));

    for (const sourceId of SOURCE_IDS) {
      const r1Source = r1Sources.get(sourceId);
      const r2Source = r2Sources.get(sourceId);
      expect(r1Source, `${sourceId} r1 source`).toBeDefined();
      expect(r2Source, `${sourceId} r2 source`).toBeDefined();
      if (r1Source === undefined || r2Source === undefined) throw new Error("missing source");
      expect(Date.parse(r2Source.retrievedAt)).toBeGreaterThan(Date.parse(r1Source.retrievedAt));
      expect(r2Source.contentSha256).toMatch(/^[0-9a-f]{64}$/);
      expect({
        retrievedAt: r2Source.retrievedAt,
        contentSha256: r2Source.contentSha256,
      }).not.toEqual({
        retrievedAt: r1Source.retrievedAt,
        contentSha256: r1Source.contentSha256,
      });
    }
  });

  test("locks r2 source bindings, evidence, corrections, and candidate-only boundaries", () => {
    const bundle = loadBasicCollectionAuditBundleVersioned(REPO_ROOT, COUNTRY_DIRECTORY, R2_RUN_ID);
    expect(bundle.sourceRegister.schemaVersion).toBe(BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION);
    expect(validateBasicCollectionAuditBundleV2(bundle)).toMatchObject({
      valid: true,
      readyForHumanReview: true,
      blockers: [],
      errors: [],
      summary: { countryCode: COUNTRY_CODE, runId: R2_RUN_ID, sourceCount: 7, factCount: 32 },
    });
    expect(bundle).toMatchObject({
      countryDirectory: COUNTRY_DIRECTORY,
      runId: R2_RUN_ID,
      sourceRegister: { runId: R2_RUN_ID, countryCode: COUNTRY_CODE, catalogVersion: CATALOG_VERSION, catalogSha256: CATALOG_SHA256 },
      reviewReport: { status: "ready-for-human-review", publicationRecommendation: "request-human-review", humanDecision: null, missingFields: [], conflicts: [], injectionRisks: [] },
      marketOverviewDraft: {
        overview: OVERVIEW,
        population: 64747319,
        gdp: 427184325997.307,
        gdpGrowth: 1.11462608103956,
        energyDemand: ENERGY_DEMAND,
        renewableTarget: RENEWABLE_TARGET,
        keyIndicators: INDICATORS,
        source: "Government of South Africa",
        sourceUrl: "https://www.gov.za/sites/default/files/gcis_document/202510/53596gon6767.pdf",
        collectedAt: "2026-07-18T01:24:37.309Z",
        updatedAt: "2025-10-28T00:00:00.000Z",
        credibility: "OFFICIAL",
        reviewStatus: "draft",
        aiUsable: false,
        countryCode: COUNTRY_CODE,
        industryTags: ["grid", "solar", "storage", "wind"],
        techTags: ["onshore-wind"],
      },
    });
    expect(bundle.sourceRegister.sources.map((source) => ({
      sourceId: source.sourceId,
      sourceName: source.sourceName,
      sourceUrl: source.sourceUrl,
      retrievedAt: source.retrievedAt,
      publishedAt: source.publishedAt,
      contentSha256: source.contentSha256,
      sourceFamily: source.sourceFamily,
      evidenceLocators: source.evidenceLocators,
    }))).toEqual(SOURCE_BINDINGS);
    expect(bundle.sourceRegister.sources.every((source) =>
      source.credibility === "OFFICIAL" && source.accessStatus === "open" && source.promptInjectionRisk === "none"
    )).toBe(true);
    expect(bundle.reviewReport.sourceChecks.map(({ sourceId, status }) => ({ sourceId, status })))
      .toEqual(SOURCE_IDS.map((sourceId) => ({ sourceId, status: "passed" })));

    const factsByPath = new Map(bundle.extractedFacts.facts.map((fact) => [fact.fieldPath, fact]));
    const indicatorPaths = INDICATORS.flatMap((_indicator, index) => [
      `marketOverview.keyIndicators[${index}].label`,
      `marketOverview.keyIndicators[${index}].unit`,
      `marketOverview.keyIndicators[${index}].value`,
      `marketOverview.keyIndicators[${index}].year`,
    ]);
    const expectedPaths = [...BASIC_COLLECTION_REQUIRED_STATIC_FACT_PATHS, ...indicatorPaths].sort(compareText);
    expect([...factsByPath.keys()]).toEqual(expectedPaths);
    const locators = new Map(bundle.sourceRegister.sources.map((source) => [source.sourceId, new Set(source.evidenceLocators)]));
    for (const fieldPath of expectedPaths) {
      const fact = factsByPath.get(fieldPath);
      expect(fact, fieldPath).toMatchObject({ status: "candidate" });
      expect(fact?.evidence.length, fieldPath).toBeGreaterThan(0);
      for (const evidence of fact?.evidence ?? []) expect(locators.get(evidence.sourceId)?.has(evidence.locator)).toBe(true);
    }
    for (const evidence of factsByPath.get("country.summary")?.evidence ?? []) {
      expect(evidence.normalizedValue).toEqual(SUMMARY);
    }
    expect(factsByPath.get("marketOverview.keyIndicators[1].value")).toMatchObject({
      extractionMethod: "manual",
      evidence: [{ sourceId: "south-africa-eskom-results-presentation-2025", locator: "pdf:page=11#slide-10-eskom-only-energy-sent-out-fy2025", rawValue: 195702, normalizedValue: "195702", unit: "GWh", year: 2025 }],
    });
    expect(factsByPath.get("marketOverview.keyIndicators[2].value")).toMatchObject({
      extractionMethod: "manual",
      evidence: [{ sourceId: "south-africa-government-irp-2025", locator: "pdf:page=40#printed-31-balanced-plan-wind-additions-2026-2042", rawValue: 43041, normalizedValue: "43041", unit: "MW", year: 2042 }],
    });
    expect(factsByPath.get("country.updatedAt")).toMatchObject({
      extractionMethod: "deterministic",
      evidence: [
        {
          sourceId: "south-africa-government-irp-2025",
          locator: "metadata:/publishedAt",
          rawValue: "2025-10-28T00:00:00.000Z",
          normalizedValue: "2025-10-28T00:00:00.000Z",
        },
        {
          sourceId: "south-africa-government-rmippp-hybrid-projects-2023",
          locator: "metadata:/publishedAt",
          rawValue: "2023-08-30T12:00:00.000Z",
          normalizedValue: "2025-10-28T00:00:00.000Z",
        },
      ],
    });
    expect(bundle.marketOverviewDraft.overview.zh).toContain("当前基础包括已投运、在建及视为于2025年投运的容量");
    expect(bundle.marketOverviewDraft.overview.en).toContain("includes installed, under-construction, and deemed-online-in-2025 capacity");
    const draftText = JSON.stringify(bundle.marketOverviewDraft);
    expect(draftText).not.toContain("自发");
    expect(draftText).not.toContain("net of pumping");
    expect(draftText).not.toContain("excluding wheeling");

    const directory = join(REPO_ROOT, "data", "staging", COUNTRY_DIRECTORY, R2_RUN_ID);
    expect(readdirSync(directory).sort(compareText)).toEqual(Object.keys(R2_ARTIFACT_HASHES));
    expect(hashArtifacts(directory, Object.keys(R2_ARTIFACT_HASHES))).toEqual(R2_ARTIFACT_HASHES);
    expect(existsSync(join(directory, "collection-manifest.json"))).toBe(false);
    expect(existsSync(join(REPO_ROOT, "data", COUNTRY_DIRECTORY))).toBe(true);
    expect(existsSync(join(REPO_ROOT, "data", "approvals", COUNTRY_DIRECTORY))).toBe(true);
    expect(existsSync(join(
      REPO_ROOT,
      "data",
      "approvals",
      COUNTRY_DIRECTORY,
      `${R1_RUN_ID}.json`,
    ))).toBe(false);
    expect(existsSync(join(
      REPO_ROOT,
      "data",
      "approvals",
      COUNTRY_DIRECTORY,
      `${R2_RUN_ID}.json`,
    ))).toBe(true);
  });
});

function hashArtifacts(directory: string, names: readonly string[]): Readonly<Record<string, string>> {
  return Object.fromEntries(names.map((name) => [name, createHash("sha256").update(readFileSync(join(directory, name))).digest("hex")]));
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
