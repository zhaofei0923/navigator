import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { BASIC_COLLECTION_REQUIRED_STATIC_FACT_PATHS } from "./collection/basic-collection-contracts.js";
import { BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION } from "./collection/basic-collection-v2-contracts.js";
import { validateBasicCollectionAuditBundleV2 } from "./collection/basic-collection-v2-validator.js";
import { loadBasicCollectionAuditBundleVersioned } from "./collection/basic-collection-versioned-loader.js";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const COUNTRY_DIRECTORY = "indonesia";
const COUNTRY_CODE = "ID";
const RUN_ID = "data-basic-id-20260711-r2";
const CATALOG_VERSION = "2026-07-13.1";
const CATALOG_SHA256 =
  "f8d404e342262ee44a7cb3a1099029131b3fc188494e6ad0fd9c846611513d12";
const SOURCE_IDS = [
  "indonesia-esdm-2025-performance",
  "indonesia-esdm-national-energy-policy-2025",
  "world-bank-country",
  "world-bank-gdp",
  "world-bank-gdp-growth",
  "world-bank-population",
] as const;
const ARTIFACT_NAMES = [
  "extracted-facts.json",
  "market-overview.draft.json",
  "review-report.json",
  "source-register.json",
] as const;
const INDICATOR_PATHS = [0, 1, 2].flatMap((index) => [
  `marketOverview.keyIndicators[${index}].label`,
  `marketOverview.keyIndicators[${index}].unit`,
  `marketOverview.keyIndicators[${index}].value`,
  `marketOverview.keyIndicators[${index}].year`,
]);

describe("Indonesia Basic r2 candidate", () => {
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
      throw new Error("expected Indonesia candidate to use the v2 audit contract");
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
        schemaVersion: BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION,
        runId: RUN_ID,
        countryCode: COUNTRY_CODE,
        catalogVersion: CATALOG_VERSION,
        catalogSha256: CATALOG_SHA256,
      },
      extractedFacts: {
        schemaVersion: BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION,
        runId: RUN_ID,
        countryCode: COUNTRY_CODE,
      },
      reviewReport: {
        schemaVersion: BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION,
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

    expect(bundle.sourceRegister.sources.map(({ sourceId }) => sourceId)).toEqual(
      SOURCE_IDS,
    );
    expect(bundle.reviewReport.sourceChecks).toHaveLength(SOURCE_IDS.length);
    expect(bundle.reviewReport.sourceChecks.map(({ sourceId }) => sourceId)).toEqual(
      SOURCE_IDS,
    );
    expect(bundle.reviewReport.sourceChecks.every(({ status }) => status === "passed"))
      .toBe(true);

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
      evidence: [{
        sourceId: "world-bank-country",
        locator: "json:/1/0/name",
        rawValue: "Indonesia",
        normalizedValue: { zh: "印度尼西亚", en: "Indonesia" },
      }],
    });
    expect(factsByPath.get("country.region")).toMatchObject({
      evidence: [{ normalizedValue: "southeast-asia" }],
    });
    expect(factsByPath.get("country.summary")).toMatchObject({
      evidence: [
        {
          normalizedValue: {
            zh: "印度尼西亚2025年可再生能源占能源结构15.75%，可再生能源装机15,630兆瓦，人均用电量1,584千瓦时；同期电源装机容量继续扩大。",
            en: "In 2025, renewables accounted for 15.75% of Indonesia's energy mix, installed renewable capacity reached 15,630 MW, and electricity consumption was 1,584 kWh per capita; generation capacity also continued to expand.",
          },
        },
        {
          normalizedValue: {
            zh: "印度尼西亚2025年可再生能源占能源结构15.75%，可再生能源装机15,630兆瓦，人均用电量1,584千瓦时；同期电源装机容量继续扩大。",
            en: "In 2025, renewables accounted for 15.75% of Indonesia's energy mix, installed renewable capacity reached 15,630 MW, and electricity consumption was 1,584 kWh per capita; generation capacity also continued to expand.",
          },
        },
      ],
    });

    expect(bundle.marketOverviewDraft).toMatchObject({
      overview: {
        zh: "2025年能源与矿产领域投资为317亿美元，其中电力46亿美元、可再生能源与节能24亿美元。可再生能源装机达到15,630兆瓦，其中太阳能1,494兆瓦、风电152兆瓦。",
        en: "Energy and mineral investment reached USD 31.7 billion in 2025, including USD 4.6 billion in electricity and USD 2.4 billion in renewables and conservation. Installed renewable capacity reached 15,630 MW, including 1,494 MW of solar and 152 MW of wind.",
      },
      energyDemand: {
        zh: "2025年人均用电量为1,584千瓦时，高于2024年的1,411千瓦时；电源装机容量同比增加7吉瓦至107.51吉瓦。",
        en: "Electricity consumption per capita was 1,584 kWh in 2025, up from 1,411 kWh in 2024; installed generation capacity increased by 7 GW to 107.51 GW.",
      },
      renewableTarget: {
        zh: "2025年《国家能源政策》将新能源和可再生能源占比目标设为2030年19%至23%、2040年36%至40%、2050年53%至55%、2060年70%至72%。能源矿产资源部报告2025年实际占比为15.75%。",
        en: "The 2025 National Energy Policy sets new and renewable energy share targets of 19%-23% in 2030, 36%-40% in 2040, 53%-55% in 2050, and 70%-72% in 2060. The Ministry reported a 15.75% share in 2025.",
      },
      population: 285721236,
      gdp: 1445642584163.81,
      gdpGrowth: 5.10808904438025,
      keyIndicators: [
        {
          label: { zh: "可再生能源占比", en: "Renewable energy mix share" },
          value: "15.75",
          unit: "%",
          year: 2025,
        },
        {
          label: { zh: "可再生能源装机容量", en: "Installed renewable capacity" },
          value: "15630",
          unit: "MW",
          year: 2025,
        },
        {
          label: { zh: "人均用电量", en: "Electricity consumption per capita" },
          value: "1584",
          unit: "kWh/person",
          year: 2025,
        },
      ],
      reviewStatus: "draft",
      aiUsable: false,
      countryCode: COUNTRY_CODE,
      industryTags: ["grid", "solar", "wind"],
      techTags: [],
    });

    const stagingDirectory = join(
      REPO_ROOT,
      "data",
      "staging",
      COUNTRY_DIRECTORY,
      RUN_ID,
    );
    expect(readdirSync(stagingDirectory).sort(compareText)).toEqual(ARTIFACT_NAMES);
    expect(existsSync(join(stagingDirectory, "collection-manifest.json"))).toBe(false);
    expect(existsSync(join(REPO_ROOT, "data", COUNTRY_DIRECTORY, "collection-manifest.json")))
      .toBe(false);
  });
});

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
