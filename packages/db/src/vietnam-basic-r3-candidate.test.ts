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
const COUNTRY_DIRECTORY = "vietnam";
const COUNTRY_CODE = "VN";
const RUN_ID = "data-basic-vn-20260715-r3";
const CATALOG_VERSION = "2026-07-15.1";
const CATALOG_SHA256 =
  "ddb53c6b6fb82bc7dd050475a04b147f3ffa43b76886974591e950f829872f92";
const SOURCE_IDS = [
  "vietnam-chinhphu-adjusted-pdp8-2025",
  "vietnam-evn-annual-report-2024-2025",
  "world-bank-country",
  "world-bank-gdp",
  "world-bank-gdp-growth",
  "world-bank-population",
] as const;
const CATALOG_SOURCE_IDS = [
  "indonesia-esdm-2025-performance",
  "indonesia-esdm-national-energy-policy-2025",
  ...SOURCE_IDS,
] as const;
const SOURCE_BINDINGS = [
  {
    sourceId: "vietnam-chinhphu-adjusted-pdp8-2025",
    sourceName: "Government of Viet Nam",
    sourceUrl:
      "https://xaydungchinhsach.chinhphu.vn/quyet-dinh-768-qd-ttg-thu-tuong-chinh-phu-phe-duyet-dieu-chinh-quy-hoach-dien-viii-119250417074054718.htm",
    retrievedAt: "2026-07-15T02:25:31.107Z",
    publishedAt: "2025-04-21T02:37:00.000Z",
    contentSha256: "57c8cb91e332edb77b8bf61925eae86e0d9cbe67054f1100fb3a2b8a34bb8203",
    sourceFamily: "government",
  },
  {
    sourceId: "vietnam-evn-annual-report-2024-2025",
    sourceName: "Vietnam Electricity (EVN)",
    sourceUrl:
      "https://en.evn.com.vn/userfile/files/2026/4/AnnualRepot2025_V23-20260408155435105.pdf",
    retrievedAt: "2026-07-15T02:25:34.300Z",
    publishedAt: "2026-01-08T07:34:00.000Z",
    contentSha256: "304153ae8bbf9b980f36ef474d187aef887a506b70c165de5f02f9bdacb00e26",
    sourceFamily: "grid-operator",
  },
  {
    sourceId: "world-bank-country",
    sourceName: "World Bank",
    sourceUrl: "https://api.worldbank.org/v2/country/VN?format=json",
    retrievedAt: "2026-07-15T02:28:00.830Z",
    publishedAt: null,
    contentSha256: "7ddd064eb77613024ad050f7b885a61c239c01692ec59ef4b352ed100f2b7525",
    sourceFamily: "international-organization",
  },
  {
    sourceId: "world-bank-gdp",
    sourceName: "World Bank",
    sourceUrl:
      "https://api.worldbank.org/v2/country/VN/indicator/NY.GDP.MKTP.CD?source=2&format=json&mrv=1&per_page=1",
    retrievedAt: "2026-07-15T02:28:01.115Z",
    publishedAt: null,
    contentSha256: "8207ac3f39f657ab8c90afde221b14a145b64070135ab4f844c0756e0f4924d0",
    sourceFamily: "international-organization",
  },
  {
    sourceId: "world-bank-gdp-growth",
    sourceName: "World Bank",
    sourceUrl:
      "https://api.worldbank.org/v2/country/VN/indicator/NY.GDP.MKTP.KD.ZG?source=2&format=json&mrv=1&per_page=1",
    retrievedAt: "2026-07-15T02:28:01.392Z",
    publishedAt: null,
    contentSha256: "605c665f5fea2a027f5949711abbc7709471cbbe210ebeeaa167e74b8eafe4a3",
    sourceFamily: "international-organization",
  },
  {
    sourceId: "world-bank-population",
    sourceName: "World Bank",
    sourceUrl:
      "https://api.worldbank.org/v2/country/VN/indicator/SP.POP.TOTL?source=2&format=json&mrv=1&per_page=1",
    retrievedAt: "2026-07-15T02:28:00.322Z",
    publishedAt: null,
    contentSha256: "6d8d2fb8892816b4ecf6fc9833722adfa055c05f77ec8d5af01187d0de537644",
    sourceFamily: "international-organization",
  },
] as const;
const ARTIFACT_HASHES = {
  "extracted-facts.json": "ca66fb3f8ee67c69ae9f33b4d941bf84209311cee139b68ed0a84d15ea9b99ce",
  "market-overview.draft.json": "3aa83f37cf0177e043d3ed0d5493c6193cb68e9f8dd33c75a46958a0079b5a95",
  "review-report.json": "163107e63f1ae72288dc10c8ed0770f94f9b93bf3dd896e67f0870f588492a1e",
  "source-register.json": "9a164b73048b290a2fd964a292158149d722adcd6edc54d4fea1d67f6cb879a3",
} as const;
const SUMMARY = {
  zh: "越南2024年电力系统总装机82,387兆瓦，其中可再生能源装机21,447兆瓦；全年发电与购电总量为308,732百万千瓦时。调整后的电力规划VIII列明了2030年风电、光伏和储能发展区间。",
  en: "Viet Nam's power system had 82,387 MW of installed capacity in 2024, including 21,447 MW of renewables; total power production and purchases reached 308,732 million kWh. The adjusted Power Development Plan VIII sets 2030 ranges for wind, solar, and storage.",
} as const;
const ENERGY_DEMAND = {
  zh: "2024年发电与购电总量为308,732百万千瓦时，2023年为280,814百万千瓦时。调整后的电力规划VIII预计2030年商品电量（售电量）为500.4至557.8十亿千瓦时。",
  en: "Total power production and purchases were 308,732 million kWh in 2024, compared with 280,814 million kWh in 2023. The adjusted Power Development Plan VIII projects electricity sales of 500.4-557.8 billion kWh in 2030.",
} as const;
const RENEWABLE_TARGET = {
  zh: "调整后的电力规划VIII提出，非水电可再生能源发电占比在2030年达到28%至36%、2050年达到74%至75%。到2030年，陆上及近岸风电装机为26,066至38,029兆瓦，光伏装机为46,459至73,416兆瓦，电池储能为10,000至16,300兆瓦，并形成两个跨区域可再生能源产业和服务中心。",
  en: "The adjusted Power Development Plan VIII targets a non-hydro renewable generation share of 28%-36% in 2030 and 74%-75% in 2050. By 2030, it calls for 26,066-38,029 MW of onshore and nearshore wind, 46,459-73,416 MW of solar, 10,000-16,300 MW of battery storage, and two inter-regional renewable energy industry and service centers.",
} as const;
const INDICATORS = [
  { label: { zh: "总装机容量", en: "Total installed capacity" }, value: "82387", unit: "MW", year: 2024 },
  { label: { zh: "可再生能源装机容量", en: "Installed renewable capacity" }, value: "21447", unit: "MW", year: 2024 },
  { label: { zh: "发电与购电总量", en: "Total power production and purchases" }, value: "308732", unit: "million kWh", year: 2024 },
] as const;
const INDICATOR_PATHS = INDICATORS.flatMap((_indicator, index) => [
  `marketOverview.keyIndicators[${index}].label`,
  `marketOverview.keyIndicators[${index}].unit`,
  `marketOverview.keyIndicators[${index}].value`,
  `marketOverview.keyIndicators[${index}].year`,
]);

describe("Vietnam Basic r3 candidate", () => {
  test("locks the reviewed catalog while preserving the Indonesia run identity", () => {
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

    const indonesia = loadBasicCollectionAuditBundleVersioned(
      REPO_ROOT,
      "indonesia",
      "data-basic-id-20260711-r2",
    );
    expect(indonesia.sourceRegister).toMatchObject({
      catalogVersion: "2026-07-13.1",
      catalogSha256: "f8d404e342262ee44a7cb3a1099029131b3fc188494e6ad0fd9c846611513d12",
    });
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
      throw new Error("expected Vietnam candidate to use the v2 audit contract");
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
        rawValue: "Viet Nam",
        normalizedValue: { zh: "越南", en: "Viet Nam" },
      }],
    });
    expect(factsByPath.get("country.region")).toMatchObject({
      extractionMethod: "manual",
      evidence: [{ normalizedValue: "southeast-asia" }],
    });
    for (const evidence of factsByPath.get("country.summary")?.evidence ?? []) {
      expect(evidence.normalizedValue).toEqual(SUMMARY);
    }
    expect(factsByPath.get("marketOverview.gdp")).toMatchObject({
      extractionMethod: "deterministic",
      evidence: [{ normalizedValue: 514697215165.065, unit: "current US$", year: 2025 }],
    });
    expect(factsByPath.get("marketOverview.gdpGrowth")).toMatchObject({
      extractionMethod: "deterministic",
      evidence: [{ normalizedValue: 8.01882998978245, unit: "%", year: 2025 }],
    });
    expect(factsByPath.get("marketOverview.population")).toMatchObject({
      extractionMethod: "deterministic",
      evidence: [{ normalizedValue: 101598527, unit: "people", year: 2025 }],
    });
    expect(factsByPath.get("marketOverview.energyDemand")).toEqual({
      factId: expect.any(String),
      fieldPath: "marketOverview.energyDemand",
      status: "candidate",
      evidence: [
        {
          sourceId: "vietnam-chinhphu-adjusted-pdp8-2025",
          locator: "html:article-body#paragraph-079-commercial-electricity-2030",
          rawValue: {
            commercialElectricity2030BillionKWh: [500.4, 557.8],
          },
          normalizedValue: ENERGY_DEMAND,
          unit: null,
          year: null,
        },
        {
          sourceId: "vietnam-evn-annual-report-2024-2025",
          locator: "pdf:page=6#power-generation-sources-total-2023-2024",
          rawValue: {
            "2023": 280814,
            "2024": 308732,
            unit: "million kWh",
          },
          normalizedValue: ENERGY_DEMAND,
          unit: null,
          year: null,
        },
      ],
      extractionMethod: "manual",
      uncertainty: null,
    });
    expect(factsByPath.get("marketOverview.renewableTarget")?.evidence).toHaveLength(5);
    for (const evidence of factsByPath.get("marketOverview.renewableTarget")?.evidence ?? []) {
      expect(evidence.normalizedValue).toEqual(RENEWABLE_TARGET);
    }
    expect(factsByPath.get("marketOverview.industryTags")?.evidence.map((evidence) =>
      evidence.locator
    )).toEqual([
      "html:article-body#paragraph-085-smart-grid",
      "html:article-body#paragraph-093-wind",
      "html:article-body#paragraph-109-solar",
      "html:article-body#paragraph-125-battery-storage",
    ]);
    expect(factsByPath.get("marketOverview.techTags")).toMatchObject({
      extractionMethod: "manual",
      evidence: [
        { locator: "html:article-body#paragraph-099-onshore-nearshore-wind" },
        { locator: "html:article-body#paragraph-102-offshore-wind" },
      ],
    });

    expect(bundle.marketOverviewDraft).toMatchObject({
      population: 101598527,
      gdp: 514697215165.065,
      gdpGrowth: 8.01882998978245,
      renewableTarget: RENEWABLE_TARGET,
      keyIndicators: INDICATORS,
      source: "Vietnam Electricity (EVN)",
      sourceUrl:
        "https://en.evn.com.vn/userfile/files/2026/4/AnnualRepot2025_V23-20260408155435105.pdf",
      collectedAt: "2026-07-15T02:28:01.392Z",
      updatedAt: "2026-01-08T07:34:00.000Z",
      credibility: "OFFICIAL",
      reviewStatus: "draft",
      aiUsable: false,
      countryCode: COUNTRY_CODE,
      industryTags: ["grid", "solar", "storage", "wind"],
      techTags: ["offshore-wind", "onshore-wind"],
    });
    expect(bundle.marketOverviewDraft.energyDemand).toEqual(ENERGY_DEMAND);
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
    expect(existsSync(join(stagingDirectory, "collection-manifest.json"))).toBe(false);
    expect(existsSync(join(REPO_ROOT, "data", COUNTRY_DIRECTORY))).toBe(true);
    expect(existsSync(join(REPO_ROOT, "data", "approvals", COUNTRY_DIRECTORY))).toBe(true);
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
