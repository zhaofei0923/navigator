import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { BASIC_COLLECTION_REQUIRED_STATIC_FACT_PATHS } from "./collection/basic-collection-contracts.js";
import { BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION } from "./collection/basic-collection-v2-contracts.js";
import { validateBasicCollectionAuditBundleV2 } from "./collection/basic-collection-v2-validator.js";
import { loadBasicCollectionAuditBundleVersioned } from "./collection/basic-collection-versioned-loader.js";
import { parseBasicSourceCatalog } from "./collection/basic-source-catalog.js";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const COUNTRY_DIRECTORY = "saudi-arabia";
const COUNTRY_CODE = "SA";
const RUN_ID = "data-basic-sa-20260717-r1";
const CATALOG_VERSION = "2026-07-17.1";
const CATALOG_SHA256 =
  "3c174b76efe8c637436c52f473911d6409d79ac2e057eb251bb860dba4c417e7";
const SOURCE_IDS = [
  "saudi-gastat-electrical-energy-statistics-2024",
  "saudi-gastat-renewable-energy-statistics-2024",
  "saudi-spa-energy-storage-2025",
  "world-bank-country",
  "world-bank-gdp",
  "world-bank-gdp-growth",
  "world-bank-population",
] as const;
const CATALOG_SOURCE_IDS = [
  "indonesia-esdm-2025-performance",
  "indonesia-esdm-national-energy-policy-2025",
  ...SOURCE_IDS.slice(0, 3),
  "vietnam-chinhphu-adjusted-pdp8-2025",
  "vietnam-evn-annual-report-2024-2025",
  ...SOURCE_IDS.slice(3),
] as const;
const SOURCE_BINDINGS = [
  {
    sourceId: "saudi-gastat-electrical-energy-statistics-2024",
    sourceName: "General Authority for Statistics",
    sourceUrl:
      "https://www.stats.gov.sa/documents/20117/2435281/Electrical%2BEnergy%2BStatistics%2B2024%2BEN.pdf/fe9d3d6f-809b-cdb9-7559-3f2a21f4e415?t=1765087585713",
    retrievedAt: "2026-07-17T10:52:18.388Z",
    publishedAt: null,
    contentSha256: "3c82b4f6ad9756666aae2f3c48fa6bd2ec9b87e7ef2fe97654925acf67c70f08",
    sourceFamily: "official-statistics",
  },
  {
    sourceId: "saudi-gastat-renewable-energy-statistics-2024",
    sourceName: "General Authority for Statistics",
    sourceUrl: "https://stats.gov.sa/en/w/news/63",
    retrievedAt: "2026-07-17T10:52:19.646Z",
    publishedAt: "2025-07-14T00:00:00.000Z",
    contentSha256: "bcbade6afaac6c5dabd86d93ef9d435b5e3b58aa35954602fad9d0caa81e8d1e",
    sourceFamily: "official-statistics",
  },
  {
    sourceId: "saudi-spa-energy-storage-2025",
    sourceName: "Saudi Press Agency",
    sourceUrl: "https://www.spa.gov.sa/w2261911",
    retrievedAt: "2026-07-17T10:52:22.590Z",
    publishedAt: "2025-02-14T00:00:00.000Z",
    contentSha256: "9db5d89402dec1ee503f857caa5defe16e395f5b28f9f22735924b26ab936fca",
    sourceFamily: "government",
  },
  {
    sourceId: "world-bank-country",
    sourceName: "World Bank",
    sourceUrl: "https://api.worldbank.org/v2/country/SA?format=json",
    retrievedAt: "2026-07-17T10:52:24.042Z",
    publishedAt: null,
    contentSha256: "e9f415ea3b1582982322ae249e1b7fafb69b66e4fb7f6e67bb54eac64a009b14",
    sourceFamily: "international-organization",
  },
  {
    sourceId: "world-bank-gdp",
    sourceName: "World Bank",
    sourceUrl:
      "https://api.worldbank.org/v2/country/SA/indicator/NY.GDP.MKTP.CD?source=2&format=json&mrv=1&per_page=1",
    retrievedAt: "2026-07-17T10:52:24.337Z",
    publishedAt: null,
    contentSha256: "f764cd5795938dd306e8530b9411869b69fc97d630cd2146a49f24fd44c9bf46",
    sourceFamily: "international-organization",
  },
  {
    sourceId: "world-bank-gdp-growth",
    sourceName: "World Bank",
    sourceUrl:
      "https://api.worldbank.org/v2/country/SA/indicator/NY.GDP.MKTP.KD.ZG?source=2&format=json&mrv=1&per_page=1",
    retrievedAt: "2026-07-17T10:52:24.645Z",
    publishedAt: null,
    contentSha256: "67a552c62764e006d0ff3266fbbdb5cb4f134595bc6033deb045a29bd6cf781c",
    sourceFamily: "international-organization",
  },
  {
    sourceId: "world-bank-population",
    sourceName: "World Bank",
    sourceUrl:
      "https://api.worldbank.org/v2/country/SA/indicator/SP.POP.TOTL?source=2&format=json&mrv=1&per_page=1",
    retrievedAt: "2026-07-17T10:52:24.968Z",
    publishedAt: null,
    contentSha256: "a6f25b124f08643533d245b650279ce8e549d63b03cb5b06e94c8c4a585c0e8d",
    sourceFamily: "international-organization",
  },
] as const;
const ARTIFACT_HASHES = {
  "extracted-facts.json": "7a423661d5b7bd2d43c7f81b39131eeea47fb82cf62624343d976128eb4d36d1",
  "market-overview.draft.json": "567821ee55b5fd04cf4db198ee8a25629ec459a8f4542ae57185d478b800c92a",
  "review-report.json": "a375cc5b759f3e1b619a3c1826adb0eaad48c5779a44a816a387fd021e301ee9",
  "source-register.json": "fcc3de285225f2e26a04f82b72e53caf69df605971fd2eb10b0eacbe2e884711",
} as const;
const WORLD_BANK_VALUES = {
  gdp: { value: 1276942933333.33, unit: "current US$", year: 2025 },
  gdpGrowth: { value: 4.50246560191663, unit: "%", year: 2025 },
  population: { value: 36973555, unit: "people", year: 2025 },
} as const;
const SUMMARY = {
  zh: "沙特阿拉伯2024年许可发电总装机容量为92.5吉瓦，可再生能源项目投运容量为6,551兆瓦，电网受电量为402,628吉瓦时。官方资料列明了2030年可再生能源发电占比和储能容量目标。",
  en: "Saudi Arabia recorded 92.5 GW of total licensed generation capacity, 6,551 MW of operational renewable project capacity, and 402,628 GWh of electrical energy sent to the network in 2024. Official sources state renewable generation and storage capacity targets for 2030.",
} as const;
const OVERVIEW = {
  zh: "2024年许可发电总装机容量为92.5吉瓦。投运的10个可再生能源项目总容量为6,551兆瓦，其中太阳能6,151兆瓦、风电400兆瓦。到2030年，储能容量目标最高为48吉瓦时，已有26吉瓦时项目完成招标。",
  en: "Total licensed generation capacity was 92.5 GW in 2024. Ten operational renewable energy projects had 6,551 MW of combined capacity, including 6,151 MW of solar and 400 MW of wind. The 2030 storage capacity target is up to 48 GWh, with 26 GWh of projects tendered.",
} as const;
const ENERGY_DEMAND = {
  zh: "2024年电网受电量为402,628吉瓦时，较2023年约增长5.7%；用电量为340,430吉瓦时，同比增长4.1%。",
  en: "Electrical energy sent to the network was 402,628 GWh in 2024, approximately 5.7% higher than in 2023; electricity consumption was 340,430 GWh, an annual increase of 4.1%.",
} as const;
const RENEWABLE_TARGET = {
  zh: "到2030年，可再生能源发电量占总发电量的目标为50%，储能容量目标最高为48吉瓦时；已有26吉瓦时储能项目完成招标并处于不同开发阶段。",
  en: "By 2030, the target is for renewables to generate 50% of total electricity and for storage capacity to reach up to 48 GWh; 26 GWh of storage projects have been tendered and are at various stages of development.",
} as const;
const INDICATORS = [
  { label: { zh: "许可发电总装机容量", en: "Total licensed generation capacity" }, value: "92.5", unit: "GW", year: 2024 },
  { label: { zh: "可再生能源项目投运容量", en: "Operational renewable project capacity" }, value: "6551", unit: "MW", year: 2024 },
  { label: { zh: "电网受电量", en: "Electrical energy sent to the network" }, value: "402628", unit: "GWh", year: 2024 },
] as const;
const INDICATOR_PATHS = INDICATORS.flatMap((_indicator, index) => [
  `marketOverview.keyIndicators[${index}].label`,
  `marketOverview.keyIndicators[${index}].unit`,
  `marketOverview.keyIndicators[${index}].value`,
  `marketOverview.keyIndicators[${index}].year`,
]);

describe("Saudi Arabia Basic r1 candidate", () => {
  test("locks the reviewed source catalog", () => {
    const catalog = parseBasicSourceCatalog(JSON.parse(readFileSync(
      new URL("../catalog/basic-source-catalog.json", import.meta.url),
      "utf8",
    )) as unknown);
    expect(catalog).toMatchObject({
      catalog: { catalogVersion: CATALOG_VERSION, countryMappings: [] },
      catalogSha256: CATALOG_SHA256,
    });
    expect(catalog.catalog.sources.map(({ sourceId }) => sourceId)).toEqual(
      CATALOG_SOURCE_IDS,
    );
  });

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
      throw new Error("expected Saudi Arabia candidate to use the v2 audit contract");
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
    });

    expect(bundle.sourceRegister.sources.map((source) => ({
      sourceId: source.sourceId,
      sourceName: source.sourceName,
      sourceUrl: source.sourceUrl,
      retrievedAt: source.retrievedAt,
      publishedAt: source.publishedAt,
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

    expect(factsByPath.get("country.name")).toMatchObject({
      extractionMethod: "manual",
      evidence: [{
        sourceId: "world-bank-country",
        locator: "json:/1/0/name",
        rawValue: "Saudi Arabia",
        normalizedValue: { zh: "沙特阿拉伯", en: "Saudi Arabia" },
      }],
    });
    expect(factsByPath.get("country.region")).toMatchObject({
      extractionMethod: "manual",
      uncertainty: expect.stringContaining("taxonomy"),
      evidence: [{ normalizedValue: "middle-east" }],
    });
    for (const evidence of factsByPath.get("country.summary")?.evidence ?? []) {
      expect(evidence.normalizedValue).toEqual(SUMMARY);
    }
    expect(factsByPath.get("marketOverview.gdp")).toMatchObject({
      extractionMethod: "deterministic",
      evidence: [{
        normalizedValue: WORLD_BANK_VALUES.gdp.value,
        unit: WORLD_BANK_VALUES.gdp.unit,
        year: WORLD_BANK_VALUES.gdp.year,
      }],
    });
    expect(factsByPath.get("marketOverview.gdpGrowth")).toMatchObject({
      extractionMethod: "deterministic",
      evidence: [{
        normalizedValue: WORLD_BANK_VALUES.gdpGrowth.value,
        unit: WORLD_BANK_VALUES.gdpGrowth.unit,
        year: WORLD_BANK_VALUES.gdpGrowth.year,
      }],
    });
    expect(factsByPath.get("marketOverview.population")).toMatchObject({
      extractionMethod: "deterministic",
      evidence: [{
        normalizedValue: WORLD_BANK_VALUES.population.value,
        unit: WORLD_BANK_VALUES.population.unit,
        year: WORLD_BANK_VALUES.population.year,
      }],
    });
    expect(factsByPath.get("marketOverview.techTags")).toMatchObject({
      extractionMethod: "manual",
      uncertainty: expect.stringContaining("product-level technology taxonomy"),
    });
    expect(factsByPath.get("marketOverview.keyIndicators[0].value")).toMatchObject({
      extractionMethod: "manual",
      evidence: [{
        sourceId: "saudi-gastat-electrical-energy-statistics-2024",
        locator: "pdf:page=1#key-indicators-licensed-generation-capacity-2024",
        rawValue: 92.5,
        normalizedValue: "92.5",
        unit: "GW",
        year: 2024,
      }],
    });
    expect(factsByPath.get("marketOverview.keyIndicators[1].value")).toMatchObject({
      extractionMethod: "manual",
      evidence: [{
        sourceId: "saudi-gastat-renewable-energy-statistics-2024",
        locator: "html:page-title#operated-renewable-capacity-2024",
        rawValue: 6551,
        normalizedValue: "6551",
        unit: "MW",
        year: 2024,
      }],
    });
    expect(factsByPath.get("marketOverview.keyIndicators[2].value")).toMatchObject({
      extractionMethod: "manual",
      evidence: [{
        sourceId: "saudi-gastat-electrical-energy-statistics-2024",
        locator: "pdf:page=1#key-indicators-energy-sent-to-network-2024",
        rawValue: 402628,
        normalizedValue: "402628",
        unit: "GWh",
        year: 2024,
      }],
    });

    expect(bundle.marketOverviewDraft).toMatchObject({
      overview: OVERVIEW,
      population: WORLD_BANK_VALUES.population.value,
      gdp: WORLD_BANK_VALUES.gdp.value,
      gdpGrowth: WORLD_BANK_VALUES.gdpGrowth.value,
      energyDemand: ENERGY_DEMAND,
      renewableTarget: RENEWABLE_TARGET,
      keyIndicators: INDICATORS,
      source: "General Authority for Statistics",
      sourceUrl:
        "https://www.stats.gov.sa/documents/20117/2435281/Electrical%2BEnergy%2BStatistics%2B2024%2BEN.pdf/fe9d3d6f-809b-cdb9-7559-3f2a21f4e415?t=1765087585713",
      collectedAt: "2026-07-17T10:52:24.968Z",
      updatedAt: "2025-07-14T00:00:00.000Z",
      credibility: "OFFICIAL",
      reviewStatus: "draft",
      aiUsable: false,
      countryCode: COUNTRY_CODE,
      industryTags: ["grid", "solar", "storage", "wind"],
      techTags: [],
    });
    const factScopes = [...new Set(bundle.extractedFacts.facts.map(({ fieldPath }) => (
      fieldPath.split(/[.[\]]/, 1)[0]
    )))].sort(compareText);
    expect({
      factScopes,
      reviewStatus: bundle.marketOverviewDraft.reviewStatus,
      aiUsable: bundle.marketOverviewDraft.aiUsable,
    }).toEqual({ factScopes: ["country", "marketOverview"], reviewStatus: "draft", aiUsable: false });
    expect(bundle.marketOverviewDraft.industryTags).toEqual(["grid", "solar", "storage", "wind"]);
    for (const value of [
      bundle.marketOverviewDraft.overview,
      bundle.marketOverviewDraft.energyDemand,
      bundle.marketOverviewDraft.renewableTarget,
      ...bundle.marketOverviewDraft.keyIndicators.map(({ label }) => label),
    ]) assertBilingual(value);

    const stagingDirectory = join(REPO_ROOT, "data", "staging", COUNTRY_DIRECTORY, RUN_ID);
    expect(readdirSync(stagingDirectory).sort(compareText)).toEqual(
      Object.keys(ARTIFACT_HASHES),
    );
    expect(Object.fromEntries(Object.keys(ARTIFACT_HASHES).map((name) => [
      name,
      createHash("sha256").update(readFileSync(join(stagingDirectory, name))).digest("hex"),
    ]))).toEqual(ARTIFACT_HASHES);
    expect(bundle.marketOverviewDraft.reviewStatus).toBe("draft");
    expect(bundle.marketOverviewDraft.aiUsable).toBe(false);
    expect(bundle.reviewReport.humanDecision).toBeNull();
    expect(bundle.reviewReport.conflicts).toEqual([]);
    expect(bundle.reviewReport.injectionRisks).toEqual([]);
    expect(existsSync(join(stagingDirectory, "collection-manifest.json"))).toBe(false);
    expect(existsSync(join(REPO_ROOT, "data", COUNTRY_DIRECTORY))).toBe(false);
    expect(existsSync(join(REPO_ROOT, "data", "approvals", COUNTRY_DIRECTORY))).toBe(false);
  });
});

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
