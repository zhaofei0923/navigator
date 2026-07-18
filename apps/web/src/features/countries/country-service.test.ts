import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import { MODULE_KEYS } from "@navigator/shared-types/schema";

import {
  buildBuildingModuleResponse,
  buildCountryDetailResponse,
  buildCountryModuleResponse,
  buildCountriesResponse,
  buildCountrySignals,
  filterCountryCatalog,
  getFilterOptions,
  localizeCountryCard,
} from "./country-service.js";
import type {
  CountryModuleDataRegistry,
  CountryModuleDataSeed,
  CountryModuleRecord,
  CountrySeedBundle,
} from "./country-seed-registry.js";

const P1_6D_ARTIFACT_FILE_NAMES = [
  "source-register.json",
  "extracted-facts.json",
  "market-overview.draft.json",
  "review-report.json",
] as const;

const P1_6D_FORBIDDEN_RESPONSE_KEYS = [
  "boundaryVerdict",
  "artifacts",
  "stages",
  "sourceRegister",
  "extractedFacts",
  "reviewReport",
  "rawCache",
  "cachePath",
] as const;

const P1_6D_SERIALIZED_PATH_MARKERS = [
  "data/staging",
  "collection-manifest.json",
  ".cache/basic-country",
] as const;

const P1_6D_PRODUCTION_IDENTIFIER_PATTERNS = [
  /\bboundaryVerdict\b/,
  /\bartifacts\b/,
  /\bstages\b/,
  /\bsourceRegister\b/,
  /\bextractedFacts\b/,
  /\breviewReport\b/,
  /\brawCache\b/,
  /\bcachePath\b/,
] as const;

function collectOwnKeys(
  value: unknown,
  keys = new Set<string>(),
  visited = new WeakSet<object>(),
): Set<string> {
  if (value === null || typeof value !== "object" || visited.has(value)) {
    return keys;
  }

  visited.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      collectOwnKeys(item, keys, visited);
    }
    return keys;
  }

  for (const key of Object.keys(value)) {
    keys.add(key);
    collectOwnKeys(
      (value as Record<string, unknown>)[key],
      keys,
      visited,
    );
  }

  return keys;
}

function expectNoP1_6DFields(value: unknown) {
  const responseKeys = collectOwnKeys(value);

  for (const forbiddenKey of P1_6D_FORBIDDEN_RESPONSE_KEYS) {
    expect(responseKeys).not.toContain(forbiddenKey);
  }

  const serialized = JSON.stringify(value) ?? "";

  for (const fileName of P1_6D_ARTIFACT_FILE_NAMES) {
    expect(serialized).not.toContain(fileName);
  }

  for (const pathMarker of P1_6D_SERIALIZED_PATH_MARKERS) {
    expect(serialized).not.toContain(pathMarker);
  }
}

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

function expectNoP1_6DWebImportsOrFields(source: string) {
  expect(source).not.toMatch(
    /(?:from|import)\s*["'][^"']*@navigator\/db(?:["'/])/,
  );
  expect(source).not.toMatch(/\bbasic-offline-dry-run\b/);

  for (const fileName of P1_6D_ARTIFACT_FILE_NAMES) {
    expect(source).not.toContain(fileName);
  }

  for (const pattern of P1_6D_PRODUCTION_IDENTIFIER_PATTERNS) {
    expect(source).not.toMatch(pattern);
  }

  for (const pathMarker of P1_6D_SERIALIZED_PATH_MARKERS) {
    expect(source).not.toContain(pathMarker);
  }
}

function emptyModuleData(): CountryModuleDataRegistry {
  return Object.fromEntries(
    MODULE_KEYS.map((moduleKey) => [moduleKey, null]),
  ) as CountryModuleDataRegistry;
}

function syntheticBundle(
  moduleData: Partial<Record<(typeof MODULE_KEYS)[number], CountryModuleDataSeed>>,
): CountrySeedBundle {
  return {
    country: {
      code: "ZZ",
      coverageLevel: "COMPLETE",
      flagEmoji: "",
      moduleCoverage: [],
      name: { en: "Testland", zh: "测试国家" },
      region: "southeast-asia",
      summary: { en: "Synthetic country", zh: "合成国家" },
      updatedAt: "2026-01-15T00:00:00Z",
    },
    moduleData: {
      ...emptyModuleData(),
      ...moduleData,
    },
    tagSources: [],
  };
}

function publicRecord(
  id: string,
  extra: CountryModuleRecord = {},
): CountryModuleRecord {
  return {
    aiUsable: true,
    collectedAt: "2026-01-10T00:00:00Z",
    countryCode: "ZZ",
    credibility: "ESTIMATED",
    id,
    reviewStatus: "published",
    source: "Synthetic public source",
    updatedAt: "2026-01-15T00:00:00Z",
    ...extra,
  };
}

function publicRecordWithoutCredibility(
  id: string,
  extra: CountryModuleRecord = {},
): CountryModuleRecord {
  const { credibility, ...record } = publicRecord(id, extra);

  void credibility;

  return record;
}

describe("country explorer service", () => {
  test("checks P1-6D response fields by own key rather than business text", () => {
    expect(() =>
      expectNoP1_6DFields({
        data: [
          {
            summary:
              "Delivery stages and supporting artifacts are ordinary business text.",
          },
        ],
      }),
    ).not.toThrow();
    expect(() =>
      expectNoP1_6DFields({ data: [{ nested: { stages: [] } }] }),
    ).toThrow();
  });

  test("uses every approved Basic publication as the current country catalog", () => {
    const response = buildCountriesResponse({ locale: "en" });

    expect(response.data.map((country) => country.code)).toEqual([
      "ID",
      "VN",
      "SA",
      "AE",
      "BR",
    ]);
    expect(response.data[0]).toMatchObject({
      coverageLevel: "BASIC",
      name: "Indonesia",
      region: "southeast-asia",
    });
    expect(response.data[1]).toMatchObject({
      coverageLevel: "BASIC",
      name: "Viet Nam",
      region: "southeast-asia",
    });
    expect(response.data[2]).toMatchObject({
      coverageLevel: "BASIC",
      name: "Saudi Arabia",
      region: "middle-east",
    });
    expect(response.data[3]).toMatchObject({
      coverageLevel: "BASIC",
      name: "United Arab Emirates",
      region: "middle-east",
    });
    expect(response.data[4]).toMatchObject({
      coverageLevel: "BASIC",
      name: "Brazil",
      region: "latin-america",
    });
  });

  test("keeps module coverage from the seed data", () => {
    const response = buildCountriesResponse({ locale: "en" });
    const aiCoverage = response.data[0]?.moduleCoverage.find(
      (item) => item.moduleKey === "ai-advisor",
    );

    expect(aiCoverage).toEqual({
      dataCount: 0,
      moduleKey: "ai-advisor",
      status: "BUILDING",
      updatedAt: "2026-01-09T00:00:00.000Z",
    });
  });

  test("filters countries by coverage level", () => {
    const result = filterCountryCatalog({ coverageLevel: "BASIC" });

    expect(result.map((country) => country.code)).toEqual([
      "ID",
      "VN",
      "SA",
      "AE",
      "BR",
    ]);
    expect(filterCountryCatalog({ coverageLevel: "COMPLETE" })).toEqual([]);
  });

  test("filters countries by region and tags", () => {
    const result = filterCountryCatalog({
      industryTags: ["solar", "wind"],
      region: "southeast-asia",
    });

    expect(result.map((country) => country.code)).toEqual(["ID", "VN"]);
    expect(filterCountryCatalog({ region: "latin-america" }).map(
      (country) => country.code,
    )).toEqual(["BR"]);
    expect(filterCountryCatalog({ techTags: ["pv-module"] })).toEqual([]);
  });

  test("builds localized API response with aligned meta", () => {
    const response = buildCountriesResponse({
      coverageLevel: "BASIC",
      locale: "en",
    });

    expect(response).toMatchObject({
      success: true,
      meta: {
        locale: "en",
        page: 1,
        pageSize: 20,
        textMode: "localized",
        total: 5,
      },
    });
    expect(response.data.map((country) => country.name)).toEqual([
      "Indonesia",
      "Viet Nam",
      "Saudi Arabia",
      "United Arab Emirates",
      "Brazil",
    ]);
    expect(response.data[0]).not.toHaveProperty("industryTags");
    expect(response.data[0]).not.toHaveProperty("techTags");
    expect(response.data[0]?.signals).toMatchObject({
      opportunityLevel: "DATA_BUILDING",
      policyFriendliness: "DATA_BUILDING",
      recommendedEntryMode: null,
      recommendedPriority: "DATA_BUILDING",
      riskLevel: "DATA_BUILDING",
      sourceCount: 0,
      updatedAt: "2026-01-09T00:00:00.000Z",
    });
    expect(response.data[0]?.signals.sources).toEqual([]);
  });

  test("records fallback fields when country business text is untranslated", () => {
    const country = localizeCountryCard(
      {
        code: "ZZ",
        coverageLevel: "BASIC",
        flagEmoji: "",
        industryTags: [],
        moduleCoverage: [],
        name: { en: "", zh: "测试国家" },
        region: "southeast-asia",
        signals: {
          opportunityLevel: "DATA_BUILDING",
          policyFriendliness: "DATA_BUILDING",
          recommendedEntryMode: { en: "", zh: "测试进入模式" },
          recommendedPriority: "DATA_BUILDING",
          riskLevel: "DATA_BUILDING",
          sourceCount: 0,
          sources: [],
          updatedAt: "2026-01-15T00:00:00Z",
        },
        summary: { en: "", zh: "测试摘要" },
        techTags: [],
        updatedAt: "2026-01-15T00:00:00Z",
      },
      "en",
    );

    expect(country).toMatchObject({
      name: "测试国家",
      signals: {
        recommendedEntryMode: "测试进入模式",
      },
      summary: "测试摘要",
      _i18nFallback: ["name", "summary", "signals.recommendedEntryMode"],
    });
  });

  test("keeps high-risk countries as explore priority even with strong opportunity evidence", () => {
    const signals = buildCountrySignals(
      syntheticBundle({
        opportunities: Array.from({ length: 5 }, (_, index) =>
          publicRecord(`opp-${index + 1}`),
        ),
        risk: [publicRecord("risk-high", { level: "HIGH" })],
      }),
    );

    expect(signals).toMatchObject({
      opportunityLevel: "HIGH",
      recommendedPriority: "EXPLORE",
      riskLevel: "HIGH",
    });
  });

  test("returns data-building signals and null entry mode when evidence is absent", () => {
    const signals = buildCountrySignals(syntheticBundle({}));

    expect(signals).toEqual({
      opportunityLevel: "DATA_BUILDING",
      policyFriendliness: "DATA_BUILDING",
      recommendedEntryMode: null,
      recommendedPriority: "DATA_BUILDING",
      riskLevel: "DATA_BUILDING",
      sourceCount: 0,
      sources: [],
      updatedAt: "2026-01-15T00:00:00Z",
    });
  });

  test("excludes published UNVERIFIED and missing-credibility ordinary records from signals", () => {
    const signals = buildCountrySignals(
      syntheticBundle({
        opportunities: [
          publicRecord("opp-public", { source: "public opportunity" }),
          publicRecord("opp-unverified", {
            credibility: "UNVERIFIED",
            source: "unverified opportunity",
          }),
          publicRecordWithoutCredibility("opp-missing-credibility", {
            source: "missing credibility opportunity",
          }),
        ],
        policy: [
          publicRecord("policy-public", {
            policyType: "incentive",
            source: "public policy",
          }),
          publicRecord("policy-unverified", {
            credibility: "UNVERIFIED",
            policyType: "tax",
            source: "unverified policy",
          }),
          publicRecordWithoutCredibility("policy-missing-credibility", {
            policyType: "permit",
            source: "missing credibility policy",
          }),
        ],
      }),
    );

    expect(signals.sources).toEqual(["public opportunity", "public policy"]);
    expect(signals.sources).not.toContain("unverified opportunity");
    expect(signals.sources).not.toContain("missing credibility opportunity");
    expect(signals.sources).not.toContain("unverified policy");
    expect(signals.sources).not.toContain("missing credibility policy");
  });

  test("builds raw API response with LocalizedText business fields", () => {
    const response = buildCountriesResponse(
      {
        locale: "en",
      },
      "raw",
    );

    expect(response.meta.textMode).toBe("raw");
    expect(response.data[0]).toMatchObject({
      name: { zh: "印度尼西亚", en: "Indonesia" },
      signals: {
        recommendedEntryMode: null,
      },
      summary: {
        zh: expect.any(String),
        en: expect.any(String),
      },
    });
    expect(response.data[0]).not.toHaveProperty("industryTags");
    expect(response.data[0]).not.toHaveProperty("techTags");
  });

  test("exposes filter options from the catalog", () => {
    expect(getFilterOptions()).toMatchObject({
      coverageLevels: ["BASIC", "STANDARD", "COMPLETE"],
      regions: ["southeast-asia", "middle-east", "latin-america"],
      industryTags: ["solar", "wind", "storage", "grid"],
      techTags: ["onshore-wind", "offshore-wind"],
    });
  });

  test("builds localized country detail with ten module coverage entries", () => {
    const response = buildCountryDetailResponse("ID", { locale: "en" });

    expect(response).toMatchObject({
      success: true,
      meta: { locale: "en", textMode: "localized" },
      data: {
        code: "ID",
        coverageLevel: "BASIC",
        name: "Indonesia",
        region: "southeast-asia",
      },
    });
    expect(response?.data.moduleCoverage.map((item) => item.moduleKey)).toEqual(
      MODULE_KEYS,
    );
    expect(response?.data).not.toHaveProperty("industryTags");
    expect(response?.data).not.toHaveProperty("techTags");
    expectNoP1_6DFields(response);
  });

  test("serves published Vietnam data in both locales while AI remains BUILDING", () => {
    const english = buildCountryDetailResponse("VN", { locale: "en" });
    const chinese = buildCountryDetailResponse("VN", { locale: "zh-CN" });
    const aiAdvisor = buildCountryModuleResponse("VN", "ai-advisor", {
      locale: "en",
    });

    expect(english?.data).toMatchObject({
      code: "VN",
      coverageLevel: "BASIC",
      name: "Viet Nam",
      summary: expect.stringContaining("82,387 MW"),
    });
    expect(chinese?.data).toMatchObject({
      code: "VN",
      coverageLevel: "BASIC",
      name: "越南",
      summary: expect.stringContaining("82,387兆瓦"),
    });
    expect(aiAdvisor).toMatchObject({
      data: { moduleKey: "ai-advisor", status: "BUILDING", items: [] },
      meta: { total: 0 },
    });
  });

  test("serves published Saudi data in both locales while AI remains BUILDING", () => {
    const english = buildCountryDetailResponse("SA", { locale: "en" });
    const chinese = buildCountryDetailResponse("SA", { locale: "zh-CN" });
    const aiAdvisor = buildCountryModuleResponse("SA", "ai-advisor", {
      locale: "en",
    });

    expect(english?.data).toMatchObject({
      code: "SA",
      coverageLevel: "BASIC",
      name: "Saudi Arabia",
      summary: expect.stringContaining("approximately 92.5 GW"),
    });
    expect(chinese?.data).toMatchObject({
      code: "SA",
      coverageLevel: "BASIC",
      name: "沙特阿拉伯",
      summary: expect.stringContaining("约为92.5吉瓦"),
    });
    expect(aiAdvisor).toMatchObject({
      data: { moduleKey: "ai-advisor", status: "BUILDING", items: [] },
      meta: { total: 0 },
    });
  });

  test("serves published UAE data in both locales while AI remains BUILDING", () => {
    const english = buildCountryDetailResponse("AE", { locale: "en" });
    const chinese = buildCountryDetailResponse("AE", { locale: "zh-CN" });
    const aiAdvisor = buildCountryModuleResponse("AE", "ai-advisor", {
      locale: "en",
    });

    expect(english?.data).toMatchObject({
      code: "AE",
      coverageLevel: "BASIC",
      name: "United Arab Emirates",
      summary: expect.stringContaining("generates 40 TWh per year"),
    });
    expect(chinese?.data).toMatchObject({
      code: "AE",
      coverageLevel: "BASIC",
      name: "阿拉伯联合酋长国",
      summary: expect.stringContaining("每年发电40太瓦时"),
    });
    expect(aiAdvisor).toMatchObject({
      data: { moduleKey: "ai-advisor", status: "BUILDING", items: [] },
      meta: { total: 0 },
    });
  });

  test("serves published Brazil data in both locales while AI remains BUILDING", () => {
    const english = buildCountryDetailResponse("BR", { locale: "en" });
    const chinese = buildCountryDetailResponse("BR", { locale: "zh-CN" });
    const aiAdvisor = buildCountryModuleResponse("BR", "ai-advisor", {
      locale: "en",
    });

    expect(english?.data).toMatchObject({
      code: "BR",
      coverageLevel: "BASIC",
      name: "Brazil",
      summary: expect.stringContaining(
        "final electricity consumption grew 2.7% year on year in 2025",
      ),
    });
    expect(chinese?.data).toMatchObject({
      code: "BR",
      coverageLevel: "BASIC",
      name: "巴西",
      summary: expect.stringContaining("2025年最终电力消费同比增长2.7%"),
    });
    expect(aiAdvisor).toMatchObject({
      data: { moduleKey: "ai-advisor", status: "BUILDING", items: [] },
      meta: { total: 0 },
    });
  });

  test("builds a raw country detail without P1-6D audit or runtime fields", () => {
    const response = buildCountryDetailResponse("ID", { locale: "en" }, "raw");

    expect(response).toMatchObject({
      success: true,
      meta: { locale: "en", textMode: "raw" },
      data: {
        code: "ID",
        coverageLevel: "BASIC",
        name: { zh: "印度尼西亚", en: "Indonesia" },
      },
    });
    expect(response?.data.moduleCoverage).toHaveLength(10);
    expectNoP1_6DFields(response);
  });

  test("keeps the Web country boundary on the canonical seed and service", () => {
    const sources = [
      readSource("./country-service.ts"),
      readSource("./country-seed-registry.ts"),
      readSource("../../app/api/v1/countries/[code]/route.ts"),
    ];

    for (const source of sources) {
      expectNoP1_6DWebImportsOrFields(source);
    }
  });

  test("returns null country detail for unknown ISO code", () => {
    expect(buildCountryDetailResponse("ZZ", { locale: "en" })).toBeNull();
  });

  test("returns a BUILDING policy placeholder without legacy records", () => {
    const response = buildCountryModuleResponse("ID", "policy", {
      locale: "en",
    });

    expect(response).toMatchObject({
      success: true,
      data: {
        moduleKey: "policy",
        status: "BUILDING",
        _i18nFallback: [],
      },
      meta: {
        locale: "en",
        page: 1,
        pageSize: 20,
        textMode: "localized",
        total: 0,
      },
    });
    expect(response?.data.items).toEqual([]);
    expect(JSON.stringify(response)).not.toContain("id_pol_001");
    expect(JSON.stringify(response)).not.toContain("id_pol_anti_draft_001");
  });

  test("builds raw object module payload with LocalizedText fields", () => {
    const response = buildCountryModuleResponse(
      "ID",
      "market-overview",
      { locale: "zh-CN" },
      "raw",
    );

    expect(response?.data.item).toMatchObject({
      overview: {
        zh: expect.stringContaining("可再生能源装机达到15,630兆瓦"),
        en: expect.stringContaining("Installed renewable capacity reached 15,630 MW"),
      },
    });
    expect(response?.meta.textMode).toBe("raw");
    expect(response?.data._i18nFallback).toBeUndefined();
  });

  test("builds BUILDING module placeholder without treating it as an error", () => {
    const response = buildBuildingModuleResponse(
      "reports",
      "BUILDING",
      "en",
      1,
      20,
      "localized",
    );

    expect(response).toEqual({
      data: {
        _i18nFallback: [],
        items: [],
        moduleKey: "reports",
        status: "BUILDING",
      },
      meta: {
        locale: "en",
        page: 1,
        pageSize: 20,
        textMode: "localized",
        total: 0,
      },
      success: true,
    });
  });

  test("keeps AI advisor BUILDING without legacy chunks or readiness records", () => {
    const response = buildCountryModuleResponse("ID", "ai-advisor", {
      locale: "en",
    });
    expect(response).toMatchObject({
      data: { moduleKey: "ai-advisor", status: "BUILDING", items: [] },
      meta: { total: 0 },
    });
    expect(JSON.stringify(response)).not.toContain("ai-advisor-readiness");
    expect(JSON.stringify(response)).not.toContain("id_know_001");
    expect(JSON.stringify(response)).not.toContain("embeddingZh");
  });

  test("keeps reports BUILDING without legacy report records or file URLs", () => {
    const response = buildCountryModuleResponse("ID", "reports", {
      locale: "en",
    });

    expect(response).toMatchObject({
      data: { moduleKey: "reports", status: "BUILDING", items: [] },
      meta: { total: 0 },
    });
    expect(JSON.stringify(response)).not.toContain("id_report_001");
    expect(JSON.stringify(response)).not.toContain("fileUrl");
  });
});
