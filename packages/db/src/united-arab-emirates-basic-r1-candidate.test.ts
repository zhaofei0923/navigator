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
const COUNTRY_DIRECTORY = "united-arab-emirates";
const COUNTRY_CODE = "AE";
const RUN_ID = "data-basic-ae-20260717-r1";
const CURRENT_CATALOG_VERSION = "2026-07-20.1";
const CURRENT_CATALOG_SHA256 =
  "6afa620bfef537573e7a52522fa0ef10e4d23bb1a1b291e28401628370f2c249";
const CANDIDATE_CATALOG_VERSION = "2026-07-17.2";
const CANDIDATE_CATALOG_SHA256 =
  "6d4c6a27367eb36e4fe20df8fe78a9c9a9e865f84af563a22e31069c176d6f0a";
const CURRENT_CATALOG_SOURCE_IDS = [
  "brazil-epe-ben-2026-summary",
  "brazil-ipea-ods7-renewable-target",
  "indonesia-esdm-2025-performance",
  "indonesia-esdm-national-energy-policy-2025",
  "saudi-gastat-electrical-energy-statistics-2024",
  "saudi-gastat-renewable-energy-statistics-2024",
  "saudi-spa-energy-storage-2025",
  "south-africa-eskom-results-presentation-2025",
  "south-africa-government-irp-2025",
  "south-africa-government-rmippp-hybrid-projects-2023",
  "uae-admo-barakah-unit-4-2024",
  "uae-admo-wind-program-2023",
  "uae-government-energy-strategy-2050",
  "vietnam-chinhphu-adjusted-pdp8-2025",
  "vietnam-evn-annual-report-2024-2025",
  "world-bank-country",
  "world-bank-electricity-access",
  "world-bank-gdp",
  "world-bank-gdp-growth",
  "world-bank-gdp-per-capita",
  "world-bank-population",
] as const;
const STRATEGY_URL =
  "https://u.ae/en/about-the-uae/strategies-initiatives-and-awards/strategies-plans-and-visions/environment-and-energy/uae-energy-strategy-2050";
const SOURCE_IDS = [
  "uae-admo-barakah-unit-4-2024",
  "uae-admo-wind-program-2023",
  "uae-government-energy-strategy-2050",
  "world-bank-country",
  "world-bank-gdp",
  "world-bank-gdp-growth",
  "world-bank-population",
] as const;
const SOURCE_BINDINGS = [
  {
    sourceId: "uae-admo-barakah-unit-4-2024",
    sourceName: "Abu Dhabi Media Office",
    sourceUrl:
      "https://www.mediaoffice.abudhabi/en/energy/unit-4-of-abu-dhabis-barakah-nuclear-energy-plant-begins-commercial-operations",
    retrievedAt: "2026-07-17T16:18:59.197Z",
    publishedAt: "2024-09-05T00:00:00.000Z",
    contentSha256:
      "fdb8290e2425ee2fc7e46fb616ae0f17a0d23a18aea6a82536c3fb8daa2f0d60",
    sourceFamily: "government",
  },
  {
    sourceId: "uae-admo-wind-program-2023",
    sourceName: "Abu Dhabi Media Office",
    sourceUrl:
      "https://www.mediaoffice.abudhabi/en/energy/on-behalf-of-the-uae-president-khaled-bin-mohamed-bin-zayed-inaugurates-uae-wind-program",
    retrievedAt: "2026-07-17T16:19:01.816Z",
    publishedAt: "2023-10-05T00:00:00.000Z",
    contentSha256:
      "527f5dc47235a1e415b2bad5bcc33eb6ed05b24ecfbdaa1070da4e68aa6a5ff3",
    sourceFamily: "government",
  },
  {
    sourceId: "uae-government-energy-strategy-2050",
    sourceName: "Government of the United Arab Emirates",
    sourceUrl: STRATEGY_URL,
    retrievedAt: "2026-07-17T16:19:04.861Z",
    publishedAt: "2024-12-30T00:00:00.000Z",
    contentSha256:
      "4ce5db3455fa1246d5d745852be074e11a6dae3630707f4f9876066ed448a780",
    sourceFamily: "government",
  },
  {
    sourceId: "world-bank-country",
    sourceName: "World Bank",
    sourceUrl: "https://api.worldbank.org/v2/country/AE?format=json",
    retrievedAt: "2026-07-17T16:19:06.814Z",
    publishedAt: null,
    contentSha256:
      "37338e2f806e62b7fd567763fc4c53946c7e21ab1bed7c1adf166bf6cf1f5db2",
    sourceFamily: "international-organization",
  },
  {
    sourceId: "world-bank-gdp",
    sourceName: "World Bank",
    sourceUrl:
      "https://api.worldbank.org/v2/country/AE/indicator/NY.GDP.MKTP.CD?source=2&format=json&mrv=1&per_page=1",
    retrievedAt: "2026-07-17T16:19:42.472Z",
    publishedAt: null,
    contentSha256:
      "00bb8fec20143dccb75586a2eab16ea96d34e001092ecbce29c984a318324e7a",
    sourceFamily: "international-organization",
  },
  {
    sourceId: "world-bank-gdp-growth",
    sourceName: "World Bank",
    sourceUrl:
      "https://api.worldbank.org/v2/country/AE/indicator/NY.GDP.MKTP.KD.ZG?source=2&format=json&mrv=1&per_page=1",
    retrievedAt: "2026-07-17T16:20:40.444Z",
    publishedAt: null,
    contentSha256:
      "b9de8024c348a7ff23094f2c5ebfeba6dbbd50e2c342b947a1181500f769363b",
    sourceFamily: "international-organization",
  },
  {
    sourceId: "world-bank-population",
    sourceName: "World Bank",
    sourceUrl:
      "https://api.worldbank.org/v2/country/AE/indicator/SP.POP.TOTL?source=2&format=json&mrv=1&per_page=1",
    retrievedAt: "2026-07-17T16:20:42.440Z",
    publishedAt: null,
    contentSha256:
      "e07bf7b1ac682bbb6e6bc5a69d299d64df3e3f1a834b668643c91d6dfa8b9772",
    sourceFamily: "international-organization",
  },
] as const;
const ARTIFACT_NAMES = [
  "extracted-facts.json",
  "market-overview.draft.json",
  "review-report.json",
  "source-register.json",
] as const;
const ARTIFACT_SHA256 = {
  "extracted-facts.json":
    "f26bea5b799e2b5e3014b90783438d28f292424e4a927504992cb1f3384639e7",
  "market-overview.draft.json":
    "aa8ca2e01f0240abc7923cae991bf981a9d8982ff155c8ff9684b31db3255bfe",
  "review-report.json":
    "35da3331817a19d59b5b7c0ca01036117ff10095cff5be863171367e3f504b5c",
  "source-register.json":
    "2430b3c80beb1d33de61aa0af82174d4c8a5d66ead95c38b4e6390e3f5cfd842",
} as const;
const SUMMARY = {
  zh: "阿拉伯联合酋长国的巴拉卡核电站每年发电40太瓦时，可提供该国高达25%的电力；并网的阿联酋风电项目风电容量为103.5兆瓦。更新后的《阿联酋能源战略2050》列明了2030年可再生能源和清洁能源目标。",
  en: "The United Arab Emirates' Barakah Nuclear Energy Plant generates 40 TWh per year and provides up to 25% of the country's electricity; the grid-connected UAE Wind Program has 103.5 MW of wind capacity. The updated UAE Energy Strategy 2050 states renewable and clean-energy targets for 2030.",
} as const;
const OVERVIEW = {
  zh: "巴拉卡核电站每年发电40太瓦时，可提供阿联酋高达25%的电力。并网的阿联酋风电项目在四个地点拥有103.5兆瓦风电容量，其中Sir Bani Yas为45兆瓦风电并配有14兆瓦峰值太阳能，Delma和Al Sila各27兆瓦，Al Halah为4.5兆瓦。更新后的能源战略设定了2030年可再生能源和清洁能源目标。",
  en: "The Barakah Nuclear Energy Plant generates 40 TWh per year and provides up to 25% of UAE electricity. The grid-connected UAE Wind Program has 103.5 MW of wind capacity across four sites: 45 MW of wind plus 14 MWp of solar at Sir Bani Yas, 27 MW at Delma, 27 MW at Al Sila, and 4.5 MW at Al Halah. The updated energy strategy sets renewable and clean-energy targets for 2030.",
} as const;
const ENERGY_DEMAND = {
  zh: "官方资料称，巴拉卡核电站每年发电40太瓦时，可提供阿联酋高达25%的电力；这两个数值仅描述巴拉卡的发电量和供电占比，不用于推算全国总发电量。更新后的能源战略还设定，到2030年能源效率较2019年提高42%至45%。",
  en: "The official source states that the Barakah plant generates 40 TWh per year and provides up to 25% of UAE electricity; these figures describe Barakah generation and its electricity share only and are not used to derive total national generation. The updated strategy also targets a 42-45% improvement in energy efficiency by 2030 compared with 2019.",
} as const;
const RENEWABLE_TARGET = {
  zh: "更新后的《阿联酋能源战略2050》目标到2030年将可再生能源贡献提高至三倍。该战略另将清洁能源装机从14.2吉瓦提高到19.8吉瓦，并提出清洁能源装机占总能源结构30%、清洁能源发电贡献达到32%；这里的“清洁能源”包括核能，不等同于“可再生能源”。",
  en: "The updated UAE Energy Strategy 2050 aims to triple the contribution of renewable energy by 2030. Separately, it targets an increase in installed clean-energy capacity from 14.2 GW to 19.8 GW, clean capacity at 30% of the total energy mix, and a 32% clean-energy contribution to electricity generation; clean energy includes nuclear and is not equivalent to renewable energy.",
} as const;
const INDICATORS = [
  {
    label: { zh: "巴拉卡年发电量", en: "Barakah annual electricity generation" },
    value: "40",
    unit: "TWh/year",
    year: 2024,
  },
  {
    label: {
      zh: "2030年清洁能源装机容量目标",
      en: "2030 installed clean-energy capacity target",
    },
    value: "19.8",
    unit: "GW",
    year: 2030,
  },
  {
    label: { zh: "阿联酋风电项目风电容量", en: "UAE Wind Program wind capacity" },
    value: "103.5",
    unit: "MW",
    year: 2023,
  },
] as const;
const INDICATOR_PATHS = INDICATORS.flatMap((_indicator, index) => [
  `marketOverview.keyIndicators[${index}].label`,
  `marketOverview.keyIndicators[${index}].unit`,
  `marketOverview.keyIndicators[${index}].value`,
  `marketOverview.keyIndicators[${index}].year`,
]);
type EvidencePath = readonly [sourceId: string, locator: string];
const ALL_CAPTURE_EVIDENCE = SOURCE_IDS.map((sourceId) =>
  [sourceId, "capture:/retrievedAt"] as const
);
const ALL_CREDIBILITY_EVIDENCE = SOURCE_IDS.map((sourceId) =>
  [sourceId, "metadata:/credibility"] as const
);
const MANUAL_PUBLISHED_EVIDENCE = SOURCE_IDS.slice(0, 3).map((sourceId) =>
  [sourceId, "metadata:/publishedAt"] as const
);
const BARAKAH_INDICATOR_EVIDENCE = [[
  "uae-admo-barakah-unit-4-2024",
  "html:article-date-and-body#barakah-annual-generation-2024",
]] as const;
const CLEAN_CAPACITY_INDICATOR_EVIDENCE = [[
  "uae-government-energy-strategy-2050",
  "html:article-body#installed-clean-energy-capacity-target-2030",
]] as const;
const WIND_INDICATOR_EVIDENCE = [[
  "uae-admo-wind-program-2023",
  "html:article-date-and-body#wind-program-capacity-2023",
]] as const;
const EXPECTED_EVIDENCE_PATHS: Readonly<
  Record<string, readonly EvidencePath[]>
> = {
  "country.code": [["world-bank-country", "json:/1/0/iso2Code"]],
  "country.flagEmoji": [["world-bank-country", "json:/1/0/iso2Code"]],
  "country.name": [["world-bank-country", "json:/1/0/name"]],
  "country.region": [[
    "uae-government-energy-strategy-2050",
    "html:page-title#uae-energy-strategy-2050",
  ]],
  "country.summary": [[
    "uae-admo-barakah-unit-4-2024",
    "html:article-body#barakah-generation-and-electricity-share",
  ], [
    "uae-admo-wind-program-2023",
    "html:article-body#wind-program-grid-capacity",
  ], [
    "uae-government-energy-strategy-2050",
    "html:article-body#renewable-and-clean-energy-targets-2030",
  ]],
  "country.updatedAt": MANUAL_PUBLISHED_EVIDENCE,
  "marketOverview.collectedAt": ALL_CAPTURE_EVIDENCE,
  "marketOverview.countryCode": [["world-bank-country", "json:/1/0/iso2Code"]],
  "marketOverview.credibility": ALL_CREDIBILITY_EVIDENCE,
  "marketOverview.energyDemand": [[
    "uae-admo-barakah-unit-4-2024",
    "html:article-body#barakah-generation-and-electricity-share",
  ], [
    "uae-government-energy-strategy-2050",
    "html:article-body#energy-efficiency-target-2030",
  ]],
  "marketOverview.gdp": [["world-bank-gdp", "json:/1/0/value"]],
  "marketOverview.gdpGrowth": [["world-bank-gdp-growth", "json:/1/0/value"]],
  "marketOverview.industryTags": [[
    "uae-admo-wind-program-2023",
    "html:article-body#wind-program-grid-wind-and-solar",
  ]],
  "marketOverview.keyIndicators[0].label": BARAKAH_INDICATOR_EVIDENCE,
  "marketOverview.keyIndicators[0].unit": BARAKAH_INDICATOR_EVIDENCE,
  "marketOverview.keyIndicators[0].value": BARAKAH_INDICATOR_EVIDENCE,
  "marketOverview.keyIndicators[0].year": BARAKAH_INDICATOR_EVIDENCE,
  "marketOverview.keyIndicators[1].label": CLEAN_CAPACITY_INDICATOR_EVIDENCE,
  "marketOverview.keyIndicators[1].unit": CLEAN_CAPACITY_INDICATOR_EVIDENCE,
  "marketOverview.keyIndicators[1].value": CLEAN_CAPACITY_INDICATOR_EVIDENCE,
  "marketOverview.keyIndicators[1].year": CLEAN_CAPACITY_INDICATOR_EVIDENCE,
  "marketOverview.keyIndicators[2].label": WIND_INDICATOR_EVIDENCE,
  "marketOverview.keyIndicators[2].unit": WIND_INDICATOR_EVIDENCE,
  "marketOverview.keyIndicators[2].value": WIND_INDICATOR_EVIDENCE,
  "marketOverview.keyIndicators[2].year": WIND_INDICATOR_EVIDENCE,
  "marketOverview.overview": [[
    "uae-admo-barakah-unit-4-2024",
    "html:article-body#barakah-generation-and-electricity-share",
  ], [
    "uae-admo-wind-program-2023",
    "html:article-body#wind-program-four-sites",
  ], [
    "uae-government-energy-strategy-2050",
    "html:article-body#renewable-and-clean-energy-targets-2030",
  ]],
  "marketOverview.population": [["world-bank-population", "json:/1/0/value"]],
  "marketOverview.renewableTarget": [[
    "uae-government-energy-strategy-2050",
    "html:article-body#renewable-and-clean-energy-targets-2030",
  ]],
  "marketOverview.source": [[
    "uae-government-energy-strategy-2050",
    "metadata:/sourceName",
  ]],
  "marketOverview.sourceUrl": [[
    "uae-government-energy-strategy-2050",
    "metadata:/sourceUrl",
  ]],
  "marketOverview.techTags": [[
    "uae-admo-wind-program-2023",
    "html:article-body#wind-program-industry-taxonomy-mapping",
  ]],
  "marketOverview.updatedAt": MANUAL_PUBLISHED_EVIDENCE,
};

describe("United Arab Emirates Basic r1 candidate", () => {
  test("locks the reviewed catalog and generated candidate at the human-review gate", () => {
    const candidateDirectory = join(
      REPO_ROOT,
      "data",
      "staging",
      COUNTRY_DIRECTORY,
      RUN_ID,
    );
    expect(
      existsSync(candidateDirectory),
      "the UAE staging candidate must be generated by the native pipeline",
    ).toBe(true);
    if (!existsSync(candidateDirectory)) {
      throw new Error("UAE staging candidate is absent");
    }

    const catalog = parseBasicSourceCatalog(JSON.parse(readFileSync(
      new URL("../catalog/basic-source-catalog.json", import.meta.url),
      "utf8",
    )) as unknown);
    expect(catalog).toMatchObject({
      catalog: { catalogVersion: CURRENT_CATALOG_VERSION, countryMappings: [] },
      catalogSha256: CURRENT_CATALOG_SHA256,
    });
    expect(catalog.catalog.sources.map(({ sourceId }) => sourceId)).toEqual(
      CURRENT_CATALOG_SOURCE_IDS,
    );

    const bundle = loadBasicCollectionAuditBundleVersioned(
      REPO_ROOT,
      COUNTRY_DIRECTORY,
      RUN_ID,
    );
    expect(bundle.sourceRegister.schemaVersion).toBe(
      BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION,
    );
    if (bundle.sourceRegister.schemaVersion !== BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION) {
      throw new Error("expected UAE candidate to use the v2 audit contract");
    }
    expect(validateBasicCollectionAuditBundleV2(bundle)).toMatchObject({
      valid: true,
      readyForHumanReview: true,
      blockers: [],
      errors: [],
      summary: {
        countryCode: COUNTRY_CODE,
        runId: RUN_ID,
        sourceCount: 7,
        factCount: 32,
      },
    });
    expect(bundle).toMatchObject({
      countryDirectory: COUNTRY_DIRECTORY,
      runId: RUN_ID,
      sourceRegister: {
        runId: RUN_ID,
        countryCode: COUNTRY_CODE,
        catalogVersion: CANDIDATE_CATALOG_VERSION,
        catalogSha256: CANDIDATE_CATALOG_SHA256,
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
    expect(bundle.extractedFacts.facts).toHaveLength(32);
    expect([...factsByPath.keys()]).toEqual(expectedPaths);
    expect(Object.keys(EXPECTED_EVIDENCE_PATHS).sort(compareText)).toEqual(expectedPaths);
    for (const fieldPath of expectedPaths) {
      const fact = factsByPath.get(fieldPath);
      expect(fact, fieldPath).toMatchObject({ status: "candidate" });
      expect(fact?.evidence.length, fieldPath).toBeGreaterThan(0);
      expect(fact?.evidence.map(({ sourceId, locator }) => [sourceId, locator]), fieldPath)
        .toEqual(EXPECTED_EVIDENCE_PATHS[fieldPath]);
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
        rawValue: "United Arab Emirates",
        normalizedValue: { zh: "阿拉伯联合酋长国", en: "United Arab Emirates" },
      }],
    });
    expect(factsByPath.get("country.region")).toMatchObject({
      extractionMethod: "manual",
      uncertainty:
        "The official UAE source establishes the country identity; middle-east is a manual mapping to the project's region taxonomy.",
      evidence: [{
        sourceId: "uae-government-energy-strategy-2050",
        locator: "html:page-title#uae-energy-strategy-2050",
        rawValue: "UAE Energy Strategy 2050",
        normalizedValue: "middle-east",
      }],
    });
    expect(factsByPath.get("country.summary")).toMatchObject({
      extractionMethod: "manual",
      uncertainty:
        "The Barakah electricity share is explicitly up to 25 percent, and clean-energy targets include nuclear and are not treated as renewable-only targets.",
      evidence: [{
        sourceId: "uae-admo-barakah-unit-4-2024",
        rawValue: {
          annualElectricityGenerationTWh: 40,
          electricitySharePercent: 25,
          electricityShareQualifier: "up to",
        },
        normalizedValue: SUMMARY,
      }, {
        sourceId: "uae-admo-wind-program-2023",
        rawValue: {
          gridConnection: "UAE electricity grid",
          programWindCapacityMW: 103.5,
        },
        normalizedValue: SUMMARY,
      }, {
        sourceId: "uae-government-energy-strategy-2050",
        rawValue: {
          installedCleanEnergyCapacityTargetGW: 19.8,
          renewableShareTargetMultiplier: 3,
          targetYear: 2030,
        },
        normalizedValue: SUMMARY,
      }],
    });
    expect(factsByPath.get("marketOverview.energyDemand")).toMatchObject({
      extractionMethod: "manual",
      uncertainty:
        "The Barakah electricity share is explicitly up to 25 percent; no total national generation is derived from the reported 40 TWh annual generation.",
      evidence: [{
        sourceId: "uae-admo-barakah-unit-4-2024",
        rawValue: {
          annualElectricityGenerationTWh: 40,
          electricitySharePercent: 25,
          electricityShareQualifier: "up to",
        },
        normalizedValue: ENERGY_DEMAND,
      }, {
        sourceId: "uae-government-energy-strategy-2050",
        rawValue: {
          baselineYear: 2019,
          energyEfficiencyImprovementPercentRange: [42, 45],
          targetYear: 2030,
        },
        normalizedValue: ENERGY_DEMAND,
      }],
    });
    expect(factsByPath.get("marketOverview.overview")).toMatchObject({
      extractionMethod: "manual",
      uncertainty:
        "The Barakah share is explicitly up to 25 percent; clean energy includes nuclear and is kept distinct from renewable energy.",
      evidence: [{
        sourceId: "uae-admo-barakah-unit-4-2024",
        rawValue: {
          annualElectricityGenerationTWh: 40,
          electricitySharePercent: 25,
          electricityShareQualifier: "up to",
        },
        normalizedValue: OVERVIEW,
      }, {
        sourceId: "uae-admo-wind-program-2023",
        rawValue: {
          alHalahWindCapacityMW: 4.5,
          alSilaWindCapacityMW: 27,
          delmaWindCapacityMW: 27,
          programWindCapacityMW: 103.5,
          sirBaniYasSolarCapacityMWp: 14,
          sirBaniYasWindCapacityMW: 45,
        },
        normalizedValue: OVERVIEW,
      }, {
        sourceId: "uae-government-energy-strategy-2050",
        rawValue: {
          cleanEnergyGenerationSharePercent: 32,
          installedCleanEnergyCapacityBaselineGW: 14.2,
          installedCleanEnergyCapacitySharePercent: 30,
          installedCleanEnergyCapacityTargetGW: 19.8,
          renewableShareTargetMultiplier: 3,
          targetYear: 2030,
        },
        normalizedValue: OVERVIEW,
      }],
    });
    expect(factsByPath.get("marketOverview.renewableTarget")).toMatchObject({
      extractionMethod: "manual",
      uncertainty:
        "The strategy separately states renewable and clean-energy targets; clean energy includes nuclear and is not treated as renewable-only.",
      evidence: [{
        rawValue: {
          cleanEnergyGenerationSharePercent: 32,
          installedCleanEnergyCapacityBaselineGW: 14.2,
          installedCleanEnergyCapacitySharePercent: 30,
          installedCleanEnergyCapacityTargetGW: 19.8,
          renewableShareTargetMultiplier: 3,
          targetYear: 2030,
        },
        normalizedValue: RENEWABLE_TARGET,
      }],
    });

    expect(factsByPath.get("marketOverview.industryTags")).toMatchObject({
      extractionMethod: "manual",
      uncertainty: null,
      evidence: [{
        sourceId: "uae-admo-wind-program-2023",
        locator: "html:article-body#wind-program-grid-wind-and-solar",
        rawValue: {
          gridConnection: "UAE electricity grid",
          programWindCapacityMW: 103.5,
          sirBaniYasSolarCapacityMWp: 14,
        },
        normalizedValue: ["grid", "solar", "wind"],
      }],
    });
    expect(factsByPath.get("marketOverview.techTags")).toMatchObject({
      extractionMethod: "manual",
      uncertainty:
        "The reviewed source supports only broad grid, solar, and wind industry categories and does not support any exact registered product-level technology subtype.",
      evidence: [{
        sourceId: "uae-admo-wind-program-2023",
        locator: "html:article-body#wind-program-industry-taxonomy-mapping",
        rawValue: {
          gridConnection: "UAE electricity grid",
          sourceCategories: ["solar farm", "utility wind power"],
        },
        normalizedValue: [],
      }],
    });
    expect(
      factsByPath.get("marketOverview.techTags")?.evidence[0]?.locator,
    ).not.toBe(factsByPath.get("marketOverview.industryTags")?.evidence[0]?.locator);

    const worldBankFacts = [
      ["marketOverview.gdp", "world-bank-gdp", 552324919095.872, "current US$", 2024],
      ["marketOverview.gdpGrowth", "world-bank-gdp-growth", 3.99181200361831, "%", 2024],
      ["marketOverview.population", "world-bank-population", 11513149, "people", 2025],
    ] as const;
    for (const [fieldPath, sourceId, value, unit, year] of worldBankFacts) {
      expect(factsByPath.get(fieldPath), fieldPath).toMatchObject({
        extractionMethod: "deterministic",
        uncertainty: null,
        evidence: [{
          sourceId,
          locator: "json:/1/0/value",
          rawValue: value,
          normalizedValue: value,
          unit,
          year,
        }],
      });
    }

    const indicatorFacts = (index: number) =>
      ["label", "unit", "value", "year"].map((field) => {
        const fact = factsByPath.get(`marketOverview.keyIndicators[${index}].${field}`);
        const evidence = fact?.evidence[0];
        return {
          uncertainty: fact?.uncertainty,
          rawValue: evidence?.rawValue,
          normalizedValue: evidence?.normalizedValue,
          unit: evidence?.unit,
          year: evidence?.year,
        };
      });
    expect(indicatorFacts(0)).toEqual([
      {
        uncertainty:
          "The indicator records Barakah's reported annual generation only and does not derive total UAE generation.",
        rawValue: "The Barakah Plant is now generating 40TWh of electricity per year",
        normalizedValue: INDICATORS[0].label,
        unit: null,
        year: null,
      },
      {
        uncertainty: null,
        rawValue: "TWh of electricity per year",
        normalizedValue: "TWh/year",
        unit: "TWh/year",
        year: 2024,
      },
      {
        uncertainty:
          "The indicator records only Barakah's reported annual generation and does not derive total UAE generation from the separate up-to-25-percent electricity share.",
        rawValue: 40,
        normalizedValue: "40",
        unit: "TWh/year",
        year: 2024,
      },
      {
        uncertainty: null,
        rawValue: 2024,
        normalizedValue: 2024,
        unit: "TWh/year",
        year: 2024,
      },
    ]);
    const cleanTargetUncertainty =
      "This is a 2030 installed clean-energy capacity target; clean energy includes nuclear and is not equivalent to renewable energy.";
    expect(indicatorFacts(1)).toEqual([
      {
        uncertainty: cleanTargetUncertainty,
        rawValue: "increase the installed clean energy capacity from 14.2 GW to 19.8 GW by 2030",
        normalizedValue: INDICATORS[1].label,
        unit: null,
        year: null,
      },
      {
        uncertainty: cleanTargetUncertainty,
        rawValue: "GW",
        normalizedValue: "GW",
        unit: "GW",
        year: 2030,
      },
      {
        uncertainty: cleanTargetUncertainty,
        rawValue: 19.8,
        normalizedValue: "19.8",
        unit: "GW",
        year: 2030,
      },
      {
        uncertainty: cleanTargetUncertainty,
        rawValue: 2030,
        normalizedValue: 2030,
        unit: "GW",
        year: 2030,
      },
    ]);
    expect(indicatorFacts(2)).toEqual([
      {
        uncertainty: null,
        rawValue: "The 103.5-megawatt (MW) landmark project",
        normalizedValue: INDICATORS[2].label,
        unit: null,
        year: null,
      },
      {
        uncertainty: null,
        rawValue: "MW",
        normalizedValue: "MW",
        unit: "MW",
        year: 2023,
      },
      {
        uncertainty: null,
        rawValue: 103.5,
        normalizedValue: "103.5",
        unit: "MW",
        year: 2023,
      },
      {
        uncertainty: null,
        rawValue: 2023,
        normalizedValue: 2023,
        unit: "MW",
        year: 2023,
      },
    ]);

    expect(bundle.marketOverviewDraft).toMatchObject({
      population: 11513149,
      gdp: 552324919095.872,
      gdpGrowth: 3.99181200361831,
      overview: OVERVIEW,
      energyDemand: ENERGY_DEMAND,
      renewableTarget: RENEWABLE_TARGET,
      keyIndicators: INDICATORS,
      source: "Government of the United Arab Emirates",
      sourceUrl: STRATEGY_URL,
      collectedAt: "2026-07-17T16:20:42.440Z",
      updatedAt: "2024-12-30T00:00:00.000Z",
      credibility: "OFFICIAL",
      reviewStatus: "draft",
      aiUsable: false,
      countryCode: COUNTRY_CODE,
      industryTags: ["grid", "solar", "wind"],
      techTags: [],
    });
    for (const evidence of factsByPath.get("country.summary")?.evidence ?? []) {
      expect(evidence.normalizedValue).toEqual(SUMMARY);
    }
    for (const value of [
      SUMMARY,
      bundle.marketOverviewDraft.overview,
      bundle.marketOverviewDraft.energyDemand,
      bundle.marketOverviewDraft.renewableTarget,
      ...bundle.marketOverviewDraft.keyIndicators.map(({ label }) => label),
    ]) assertBilingual(value);

    expect(readdirSync(candidateDirectory).sort(compareText)).toEqual(ARTIFACT_NAMES);
    expect(hashArtifacts(candidateDirectory, ARTIFACT_NAMES)).toEqual(ARTIFACT_SHA256);
    expect(existsSync(join(candidateDirectory, "collection-manifest.json"))).toBe(false);
    expect(existsSync(join(REPO_ROOT, "data", COUNTRY_DIRECTORY))).toBe(true);
    expect(existsSync(join(REPO_ROOT, "data", "approvals", COUNTRY_DIRECTORY))).toBe(true);
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
  if (typeof value !== "object" || value === null) {
    throw new Error("expected bilingual value");
  }
  const localized = value as Readonly<Record<string, unknown>>;
  expect(String(localized.zh).trim()).not.toBe("");
  expect(String(localized.en).trim()).not.toBe("");
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
