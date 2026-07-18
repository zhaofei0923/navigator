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
const COUNTRY_DIRECTORY = "brazil";
const COUNTRY_CODE = "BR";
const R1_RUN_ID = "data-basic-br-20260717-r1";
const R2_RUN_ID = "data-basic-br-20260718-r2";
const CATALOG_VERSION = "2026-07-17.2";
const CATALOG_SHA256 =
  "6d4c6a27367eb36e4fe20df8fe78a9c9a9e865f84af563a22e31069c176d6f0a";
const SOURCE_IDS = [
  "brazil-epe-ben-2026-summary",
  "brazil-ipea-ods7-renewable-target",
  "world-bank-country",
  "world-bank-gdp",
  "world-bank-gdp-growth",
  "world-bank-population",
] as const;
const SOURCE_BINDINGS = [
  { sourceId: "brazil-epe-ben-2026-summary", sourceName: "Empresa de Pesquisa Energetica (EPE)", sourceUrl: "https://www.epe.gov.br/pt/imprensa/noticias/epe-publica-o-relatorio-sintese-do-balanco-energetico-nacional-2026", retrievedAt: "2026-07-18T02:15:39.781Z", publishedAt: "2026-06-03T00:00:00.000Z", contentSha256: "133d98ebe4f228110620a07b86313f4cc34ffcae63caf5d0501fe8c6bc57da9f", sourceFamily: "energy-authority" },
  { sourceId: "brazil-ipea-ods7-renewable-target", sourceName: "Institute for Applied Economic Research (IPEA)", sourceUrl: "https://www.ipea.gov.br/ods/ods7.html", retrievedAt: "2026-07-18T02:15:42.439Z", publishedAt: null, contentSha256: "1236c59d4dc783d8d145645a661fbf9aafb9e0643298f1e1374b1b5225e42569", sourceFamily: "government" },
  { sourceId: "world-bank-country", sourceName: "World Bank", sourceUrl: "https://api.worldbank.org/v2/country/BR?format=json", retrievedAt: "2026-07-18T02:15:43.243Z", publishedAt: null, contentSha256: "9ba15dd0206c394794295ee818cf986c12a513a306723785cc845ea8aeaa1669", sourceFamily: "international-organization" },
  { sourceId: "world-bank-gdp", sourceName: "World Bank", sourceUrl: "https://api.worldbank.org/v2/country/BR/indicator/NY.GDP.MKTP.CD?source=2&format=json&mrv=1&per_page=1", retrievedAt: "2026-07-18T02:15:43.530Z", publishedAt: null, contentSha256: "1e7e6d6c24d45edea5ad6c7d51ca1b55b1e731a13f3048eecdd6a67698368534", sourceFamily: "international-organization" },
  { sourceId: "world-bank-gdp-growth", sourceName: "World Bank", sourceUrl: "https://api.worldbank.org/v2/country/BR/indicator/NY.GDP.MKTP.KD.ZG?source=2&format=json&mrv=1&per_page=1", retrievedAt: "2026-07-18T02:15:43.804Z", publishedAt: null, contentSha256: "737fe896e4c99bea79476a144828fb99f20ab974ce446501b989c9dd9d4fa04d", sourceFamily: "international-organization" },
  { sourceId: "world-bank-population", sourceName: "World Bank", sourceUrl: "https://api.worldbank.org/v2/country/BR/indicator/SP.POP.TOTL?source=2&format=json&mrv=1&per_page=1", retrievedAt: "2026-07-18T02:15:44.080Z", publishedAt: null, contentSha256: "df53cd21ccfcaff8d86b226e32a32161cd44e1a73008d6f07c4d735d46fab1ba", sourceFamily: "international-organization" },
] as const;
const SOURCE_CHECKS = [
  {
    sourceId: "brazil-epe-ben-2026-summary",
    status: "passed",
    notes: "Completed audit against the fresh r2 EPE capture retrieved at 2026-07-18T02:15:39.781Z with SHA-256 133d98ebe4f228110620a07b86313f4cc34ffcae63caf5d0501fe8c6bc57da9f. Source identity, publishedAt 2026-06-03, CC BY 4.0 treatment, approved 2025 electricity facts and qualifiers, and prompt-injection status were verified. The 86.8 and 86.6 renewable-mix figures use non-comparable definitions; both are excluded from candidate facts, copy, and indicators. The 20.4 TWh figure is only the increase in internal supply, is not a total, and is not used as a total.",
  },
  {
    sourceId: "brazil-ipea-ods7-renewable-target",
    status: "passed",
    notes: "Completed audit against the fresh r2 IPEA capture retrieved at 2026-07-18T02:15:42.439Z with SHA-256 1236c59d4dc783d8d145645a661fbf9aafb9e0643298f1e1374b1b5225e42569. Source identity, qualitative Meta 7.2 Brasil wording, national energy-matrix scope, non-numeric and non-electricity-specific qualifiers, license treatment, and prompt-injection status were verified; no independent legal-status claim was added.",
  },
  {
    sourceId: "world-bank-country",
    status: "passed",
    notes: "Completed audit against the fresh r2 World Bank country capture retrieved at 2026-07-18T02:15:43.243Z with SHA-256 9ba15dd0206c394794295ee818cf986c12a513a306723785cc845ea8aeaa1669. The BR country identity and English name Brazil were verified.",
  },
  {
    sourceId: "world-bank-gdp",
    status: "passed",
    notes: "Completed audit against the fresh r2 World Bank GDP capture retrieved at 2026-07-18T02:15:43.530Z with SHA-256 1e7e6d6c24d45edea5ad6c7d51ca1b55b1e731a13f3048eecdd6a67698368534. The 2025 GDP value 2279920092492.13 current US$ was verified.",
  },
  {
    sourceId: "world-bank-gdp-growth",
    status: "passed",
    notes: "Completed audit against the fresh r2 World Bank GDP-growth capture retrieved at 2026-07-18T02:15:43.804Z with SHA-256 737fe896e4c99bea79476a144828fb99f20ab974ce446501b989c9dd9d4fa04d. The 2025 annual GDP-growth value 2.2857464902475% was verified.",
  },
  {
    sourceId: "world-bank-population",
    status: "passed",
    notes: "Completed audit against the fresh r2 World Bank population capture retrieved at 2026-07-18T02:15:44.080Z with SHA-256 df53cd21ccfcaff8d86b226e32a32161cd44e1a73008d6f07c4d735d46fab1ba. The 2025 population value 212812405 was verified.",
  },
] as const;
const R1_ARTIFACT_HASHES = {
  "extracted-facts.json": "27dc9ecea66a05537a640eb387331cccfdde939720360978bef82fffa0b959dd",
  "market-overview.draft.json": "10f1d093f4fc76bd6d50082ef3a4a353ee9218d7a4ec6578433cd343de4c60a9",
  "review-report.json": "9c6886c4f855cb8e7053b6b5e5c33a42fc8eed65ef0cc71717ad83f6fc42b43d",
  "source-register.json": "1416669e59c990c08064df9045855b4940818853aeaa2cae31289f3352b92f0a",
} as const;
const R1_TEST_SHA256 =
  "1cac85b95faa8017b0504581827d5aadb4a8f01b16a77b0833d2da0fe3f70099";
const R2_ARTIFACT_HASHES = {
  "extracted-facts.json": "6c8cb2023f9b2e41afc06bc6d129db7289d7b6b81b2af8171f3eeac3681918d2",
  "market-overview.draft.json": "2fcfa2d31c616ec99876a268330fd0c73e07e63c6a1fd1b0402de7927c1099e2",
  "review-report.json": "645e074ba71650fa250d792245fe0397f0f0b678292abce71744350c2fc3511e",
  "source-register.json": "22b7800d29ad39408e62c2c84d78c643b3d70ed081dca528a15708c895bfced5",
} as const;
const WORLD_BANK_VALUES = {
  gdp: { value: 2279920092492.13, unit: "current US$", year: 2025 },
  gdpGrowth: { value: 2.2857464902475, unit: "%", year: 2025 },
  population: { value: 212812405, unit: "people", year: 2025 },
} as const;
const EMPTY_TECH_TAGS_LOCATOR =
  "html:article-body#product-taxonomy-solar-and-wind-industry-categories";
const INDUSTRY_TAGS_LOCATOR = "html:article-body#solar-pv-and-wind-2025";
const EMPTY_TECH_TAGS_RAW_VALUE = {
  solarPvGenerationTWh: 88.1,
  solarPvInstalledCapacityMW: 64793,
  windGenerationTWh: 116.5,
  windInstalledCapacityMW: 34707,
} as const;
const EXPECTED_EVIDENCE_LOCATORS = {
  "country.code": ["world-bank-country|json:/1/0/iso2Code"],
  "country.flagEmoji": ["world-bank-country|json:/1/0/iso2Code"],
  "country.name": ["world-bank-country|json:/1/0/name"],
  "country.region": ["brazil-epe-ben-2026-summary|html:article-body#brazil-energy-balance-2026"],
  "country.summary": ["brazil-epe-ben-2026-summary|html:article-body#electricity-highlights-2025"],
  "country.updatedAt": ["brazil-epe-ben-2026-summary|metadata:/publishedAt"],
  "marketOverview.collectedAt": SOURCE_IDS.map((sourceId) => `${sourceId}|capture:/retrievedAt`),
  "marketOverview.countryCode": ["world-bank-country|json:/1/0/iso2Code"],
  "marketOverview.credibility": SOURCE_IDS.map((sourceId) => `${sourceId}|metadata:/credibility`),
  "marketOverview.energyDemand": ["brazil-epe-ben-2026-summary|html:article-body#final-electricity-consumption-growth-2025"],
  "marketOverview.gdp": ["world-bank-gdp|json:/1/0/value"],
  "marketOverview.gdpGrowth": ["world-bank-gdp-growth|json:/1/0/value"],
  "marketOverview.industryTags": [`brazil-epe-ben-2026-summary|${INDUSTRY_TAGS_LOCATOR}`],
  "marketOverview.keyIndicators[0].label": ["brazil-epe-ben-2026-summary|html:article-body#final-electricity-consumption-growth-2025"],
  "marketOverview.keyIndicators[0].unit": ["brazil-epe-ben-2026-summary|html:article-body#final-electricity-consumption-growth-2025"],
  "marketOverview.keyIndicators[0].value": ["brazil-epe-ben-2026-summary|html:article-body#final-electricity-consumption-growth-2025"],
  "marketOverview.keyIndicators[0].year": ["brazil-epe-ben-2026-summary|html:article-body#final-electricity-consumption-growth-2025"],
  "marketOverview.keyIndicators[1].label": ["brazil-epe-ben-2026-summary|html:article-body#solar-pv-generation-and-capacity-2025"],
  "marketOverview.keyIndicators[1].unit": ["brazil-epe-ben-2026-summary|html:article-body#solar-pv-generation-and-capacity-2025"],
  "marketOverview.keyIndicators[1].value": ["brazil-epe-ben-2026-summary|html:article-body#solar-pv-generation-and-capacity-2025"],
  "marketOverview.keyIndicators[1].year": ["brazil-epe-ben-2026-summary|html:article-body#solar-pv-generation-and-capacity-2025"],
  "marketOverview.keyIndicators[2].label": ["brazil-epe-ben-2026-summary|html:article-body#wind-generation-and-capacity-2025"],
  "marketOverview.keyIndicators[2].unit": ["brazil-epe-ben-2026-summary|html:article-body#wind-generation-and-capacity-2025"],
  "marketOverview.keyIndicators[2].value": ["brazil-epe-ben-2026-summary|html:article-body#wind-generation-and-capacity-2025"],
  "marketOverview.keyIndicators[2].year": ["brazil-epe-ben-2026-summary|html:article-body#wind-generation-and-capacity-2025"],
  "marketOverview.overview": ["brazil-epe-ben-2026-summary|html:article-body#electricity-highlights-2025"],
  "marketOverview.population": ["world-bank-population|json:/1/0/value"],
  "marketOverview.renewableTarget": ["brazil-ipea-ods7-renewable-target|html:meta-7-2-brasil#renewable-energy-national-energy-matrix-2030"],
  "marketOverview.source": ["brazil-epe-ben-2026-summary|metadata:/sourceName"],
  "marketOverview.sourceUrl": ["brazil-epe-ben-2026-summary|metadata:/sourceUrl"],
  "marketOverview.techTags": [`brazil-epe-ben-2026-summary|${EMPTY_TECH_TAGS_LOCATOR}`],
  "marketOverview.updatedAt": ["brazil-epe-ben-2026-summary|metadata:/publishedAt"],
} as const;
const SUMMARY = {
  zh: "巴西2025年最终电力消费同比增长2.7%；太阳能光伏发电量为88.1太瓦时、装机容量为64,793兆瓦，风电发电量为116.5太瓦时、装机容量为34,707兆瓦。风电和太阳能合计占总发电量的26.4%，微型和小型分布式发电占7.0%。",
  en: "Brazil's final electricity consumption grew 2.7% year on year in 2025. Solar PV generation was 88.1 TWh with 64,793 MW of installed capacity, while wind generation was 116.5 TWh with 34,707 MW. Wind and solar together accounted for 26.4% of total generation, and micro and mini distributed generation accounted for 7.0%.",
} as const;
const OVERVIEW = {
  zh: "EPE的2025年数据表明，太阳能光伏发电量为88.1太瓦时、装机容量为64,793兆瓦，风电发电量为116.5太瓦时、装机容量为34,707兆瓦。风电和太阳能合计占总发电量的26.4%，微型和小型分布式发电占7.0%。",
  en: "EPE data for 2025 show solar PV generation of 88.1 TWh and installed capacity of 64,793 MW, alongside wind generation of 116.5 TWh and installed capacity of 34,707 MW. Wind and solar together accounted for 26.4% of total generation, while micro and mini distributed generation accounted for 7.0%.",
} as const;
const ENERGY_DEMAND = {
  zh: "2025年最终电力消费同比增长2.7%。",
  en: "Final electricity consumption grew 2.7% year on year in 2025.",
} as const;
const RENEWABLE_TARGET = {
  zh: "巴西提出到2030年维持可再生能源在全国能源矩阵中的高占比。这是定性目标，不是数值目标，也不特指电力矩阵。",
  en: "Brazil's stated target is to maintain a high share of renewable energy in the national energy matrix by 2030. This is a qualitative target, not a numeric target and not specific to the electricity matrix.",
} as const;
const RENEWABLE_TARGET_UNCERTAINTY =
  "IPEA states a qualitative target for the national energy matrix; it is not numeric, not electricity-specific, and is not characterized here as a legal obligation.";
const INDICATORS = [
  { label: { zh: "最终电力消费同比增长", en: "Final electricity consumption year-on-year growth" }, value: "2.7", unit: "%", year: 2025 },
  { label: { zh: "太阳能光伏装机容量", en: "Solar PV installed capacity" }, value: "64793", unit: "MW", year: 2025 },
  { label: { zh: "风电装机容量", en: "Wind installed capacity" }, value: "34707", unit: "MW", year: 2025 },
] as const;
const INDICATOR_PATHS = INDICATORS.flatMap((_indicator, index) => [
  `marketOverview.keyIndicators[${index}].label`,
  `marketOverview.keyIndicators[${index}].unit`,
  `marketOverview.keyIndicators[${index}].value`,
  `marketOverview.keyIndicators[${index}].year`,
]);

describe("Brazil Basic r2 correction candidate", () => {
  test("preserves rejected r1 bytes and candidate test as immutable history", () => {
    expect(artifactHashes(R1_RUN_ID, R1_ARTIFACT_HASHES)).toEqual(R1_ARTIFACT_HASHES);
    expect(fileSha256(join(
      REPO_ROOT,
      "packages",
      "db",
      "src",
      "brazil-basic-r1-candidate.test.ts",
    ))).toBe(R1_TEST_SHA256);
  });

  test("keeps EPE taxonomy ownership at industryTags", () => {
    const catalog = parseBasicSourceCatalog(JSON.parse(readFileSync(
      new URL("../catalog/basic-source-catalog.json", import.meta.url),
      "utf8",
    )) as unknown);
    const epe = catalog.catalog.sources.find(
      ({ sourceId }) => sourceId === "brazil-epe-ben-2026-summary",
    );
    expect(epe?.fieldPaths).toContain("marketOverview.industryTags");
    expect(epe?.fieldPaths).not.toContain("marketOverview.techTags");
  });

  test("locks the sole current r2 draft-only audit bundle", () => {
    const bundle = loadBasicCollectionAuditBundleVersioned(
      REPO_ROOT,
      COUNTRY_DIRECTORY,
      R2_RUN_ID,
    );
    expect(bundle.sourceRegister.schemaVersion).toBe(
      BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION,
    );
    if (bundle.sourceRegister.schemaVersion !== BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION) {
      throw new Error("expected Brazil r2 candidate to use the v2 audit contract");
    }
    expect(validateBasicCollectionAuditBundleV2(bundle)).toMatchObject({
      valid: true,
      readyForHumanReview: true,
      blockers: [],
      errors: [],
      summary: {
        countryCode: COUNTRY_CODE,
        runId: R2_RUN_ID,
        sourceCount: 6,
        factCount: 32,
      },
    });
    expect(bundle).toMatchObject({
      countryDirectory: COUNTRY_DIRECTORY,
      runId: R2_RUN_ID,
      sourceRegister: {
        runId: R2_RUN_ID,
        countryCode: COUNTRY_CODE,
        catalogVersion: CATALOG_VERSION,
        catalogSha256: CATALOG_SHA256,
      },
      extractedFacts: { runId: R2_RUN_ID, countryCode: COUNTRY_CODE },
      reviewReport: {
        runId: R2_RUN_ID,
        countryCode: COUNTRY_CODE,
        status: "ready-for-human-review",
        missingFields: [],
        conflicts: [],
        injectionRisks: [],
        publicationRecommendation: "request-human-review",
        humanDecision: null,
      },
      marketOverviewDraft: {
        overview: OVERVIEW,
        population: WORLD_BANK_VALUES.population.value,
        gdp: WORLD_BANK_VALUES.gdp.value,
        gdpGrowth: WORLD_BANK_VALUES.gdpGrowth.value,
        energyDemand: ENERGY_DEMAND,
        renewableTarget: RENEWABLE_TARGET,
        keyIndicators: INDICATORS,
        source: "Empresa de Pesquisa Energetica (EPE)",
        sourceUrl: SOURCE_BINDINGS[0].sourceUrl,
        collectedAt: SOURCE_BINDINGS[5].retrievedAt,
        updatedAt: SOURCE_BINDINGS[0].publishedAt,
        credibility: "OFFICIAL",
        reviewStatus: "draft",
        aiUsable: false,
        countryCode: COUNTRY_CODE,
        industryTags: ["solar", "wind"],
        techTags: [],
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
    expect(bundle.reviewReport.sourceChecks).toEqual(SOURCE_CHECKS);
    expect(bundle.reviewReport.sourceChecks.every(({ notes }) =>
      typeof notes === "string" &&
      !/will be bound|pending before candidate generation/i.test(notes)
    )).toBe(true);

    const r1 = loadBasicCollectionAuditBundleVersioned(
      REPO_ROOT,
      COUNTRY_DIRECTORY,
      R1_RUN_ID,
    );
    const r1RetrievedAt = new Map(r1.sourceRegister.sources.map((source) => [
      source.sourceId,
      source.retrievedAt,
    ]));
    for (const source of bundle.sourceRegister.sources) {
      expect(Date.parse(source.retrievedAt), source.sourceId).toBeGreaterThan(
        Date.parse(r1RetrievedAt.get(source.sourceId) ?? ""),
      );
    }

    const factsByPath = new Map(bundle.extractedFacts.facts.map((fact) => [
      fact.fieldPath,
      fact,
    ]));
    const expectedPaths = [
      ...BASIC_COLLECTION_REQUIRED_STATIC_FACT_PATHS,
      ...INDICATOR_PATHS,
    ].sort(compareText);
    expect([...factsByPath.keys()]).toEqual(expectedPaths);
    const sourceLocators = new Map(bundle.sourceRegister.sources.map((source) => [
      source.sourceId,
      new Set(source.evidenceLocators),
    ]));
    for (const fieldPath of expectedPaths) {
      const fact = factsByPath.get(fieldPath);
      expect(fact, fieldPath).toMatchObject({ status: "candidate" });
      expect(fact?.evidence.length, fieldPath).toBeGreaterThan(0);
      for (const evidence of fact?.evidence ?? []) {
        expect(sourceLocators.get(evidence.sourceId)?.has(evidence.locator), fieldPath)
          .toBe(true);
      }
    }
    expect(Object.fromEntries(expectedPaths.map((fieldPath) => [
      fieldPath,
      (factsByPath.get(fieldPath)?.evidence ?? []).map(
        ({ sourceId, locator }) => `${sourceId}|${locator}`,
      ),
    ]))).toEqual(EXPECTED_EVIDENCE_LOCATORS);

    expect(factsByPath.get("country.name")).toMatchObject({
      extractionMethod: "manual",
      evidence: [{
        sourceId: "world-bank-country",
        locator: "json:/1/0/name",
        rawValue: "Brazil",
        normalizedValue: { zh: "巴西", en: "Brazil" },
      }],
    });
    expect(factsByPath.get("country.region")?.evidence[0]?.normalizedValue).toBe(
      "latin-america",
    );
    expect(factsByPath.get("country.summary")?.evidence[0]?.normalizedValue).toEqual(
      SUMMARY,
    );
    expect(factsByPath.get("marketOverview.gdp")).toMatchObject({
      extractionMethod: "deterministic",
      evidence: [{ normalizedValue: WORLD_BANK_VALUES.gdp.value, unit: "current US$", year: 2025 }],
    });
    expect(factsByPath.get("marketOverview.gdpGrowth")).toMatchObject({
      extractionMethod: "deterministic",
      evidence: [{ normalizedValue: WORLD_BANK_VALUES.gdpGrowth.value, unit: "%", year: 2025 }],
    });
    expect(factsByPath.get("marketOverview.population")).toMatchObject({
      extractionMethod: "deterministic",
      evidence: [{ normalizedValue: WORLD_BANK_VALUES.population.value, unit: "people", year: 2025 }],
    });
    const industryTags = factsByPath.get("marketOverview.industryTags");
    const techTags = factsByPath.get("marketOverview.techTags");
    expect(industryTags).toMatchObject({
      extractionMethod: "manual",
      evidence: [{
        sourceId: "brazil-epe-ben-2026-summary",
        locator: INDUSTRY_TAGS_LOCATOR,
        rawValue: { solarPvGenerationTWh: 88.1, windGenerationTWh: 116.5 },
        normalizedValue: ["solar", "wind"],
      }],
    });
    expect(techTags).toMatchObject({
      extractionMethod: "manual",
      uncertainty: "No exact registered product-level subtype is supported.",
      evidence: [{
        sourceId: "brazil-epe-ben-2026-summary",
        locator: EMPTY_TECH_TAGS_LOCATOR,
        rawValue: EMPTY_TECH_TAGS_RAW_VALUE,
        normalizedValue: [],
      }],
    });
    expect(techTags?.evidence[0]?.locator).not.toBe(industryTags?.evidence[0]?.locator);
    expect(techTags?.uncertainty).not.toBeNull();
    expect(JSON.stringify(techTags?.evidence[0]?.rawValue)).not.toContain(
      "productLevelSubtype",
    );
    expect(sourceLocators.get("brazil-epe-ben-2026-summary")?.has(
      EMPTY_TECH_TAGS_LOCATOR,
    )).toBe(true);

    expect(factsByPath.get("marketOverview.renewableTarget")).toMatchObject({
      extractionMethod: "manual",
      uncertainty: RENEWABLE_TARGET_UNCERTAINTY,
      evidence: [{
        sourceId: "brazil-ipea-ods7-renewable-target",
        locator: "html:meta-7-2-brasil#renewable-energy-national-energy-matrix-2030",
        normalizedValue: RENEWABLE_TARGET,
      }],
    });
    expect(bundle.marketOverviewDraft.renewableTarget.en).toContain(
      "not specific to the electricity matrix",
    );
    expect(bundle.marketOverviewDraft.renewableTarget.en).not.toMatch(
      /legal obligation|[0-9]+%/i,
    );
    expect(bundle.marketOverviewDraft).not.toHaveProperty("opportunities");
    const candidateFactsAndCopy = JSON.stringify({
      facts: bundle.extractedFacts,
      draft: bundle.marketOverviewDraft,
    });
    expect(candidateFactsAndCopy).not.toMatch(/20\.4|86\.8|86\.6/);
    for (const value of [
      bundle.marketOverviewDraft.overview,
      bundle.marketOverviewDraft.energyDemand,
      bundle.marketOverviewDraft.renewableTarget,
      ...bundle.marketOverviewDraft.keyIndicators.map(({ label }) => label),
    ]) assertBilingual(value);

    const stagingDirectory = join(
      REPO_ROOT,
      "data",
      "staging",
      COUNTRY_DIRECTORY,
      R2_RUN_ID,
    );
    expect(readdirSync(stagingDirectory).sort(compareText)).toEqual(
      Object.keys(R2_ARTIFACT_HASHES),
    );
    expect(artifactHashes(R2_RUN_ID, R2_ARTIFACT_HASHES)).toEqual(
      R2_ARTIFACT_HASHES,
    );
    expect(existsSync(join(stagingDirectory, "collection-manifest.json"))).toBe(false);
    expect(existsSync(join(REPO_ROOT, "data", COUNTRY_DIRECTORY))).toBe(false);
    expect(existsSync(join(REPO_ROOT, "data", "approvals", COUNTRY_DIRECTORY))).toBe(false);
  });
});

function artifactHashes(
  runId: string,
  expected: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const directory = join(REPO_ROOT, "data", "staging", COUNTRY_DIRECTORY, runId);
  return Object.fromEntries(Object.keys(expected).map((name) => [
    name,
    fileSha256(join(directory, name)),
  ]));
}

function fileSha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
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
