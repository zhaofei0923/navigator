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
  test("uses the approved Indonesia seed as the current country catalog", () => {
    const response = buildCountriesResponse({ locale: "en" });

    expect(response.data.map((country) => country.code)).toEqual(["ID"]);
    expect(response.data[0]).toMatchObject({
      coverageLevel: "COMPLETE",
      name: "Indonesia",
      region: "southeast-asia",
    });
  });

  test("keeps module coverage from the seed data", () => {
    const response = buildCountriesResponse({ locale: "en" });
    const aiCoverage = response.data[0]?.moduleCoverage.find(
      (item) => item.moduleKey === "ai-advisor",
    );

    expect(aiCoverage).toEqual({
      dataCount: 20,
      moduleKey: "ai-advisor",
      status: "COMPLETE",
      updatedAt: "2026-01-15T00:00:00Z",
    });
  });

  test("filters countries by coverage level", () => {
    const result = filterCountryCatalog({ coverageLevel: "COMPLETE" });

    expect(result.map((country) => country.code)).toEqual(["ID"]);
  });

  test("filters countries by region and tags", () => {
    const result = filterCountryCatalog({
      industryTags: ["solar"],
      region: "southeast-asia",
      techTags: ["pv-module"],
    });

    expect(result.map((country) => country.code)).toEqual(["ID"]);
  });

  test("builds localized API response with aligned meta", () => {
    const response = buildCountriesResponse({
      coverageLevel: "COMPLETE",
      locale: "en",
    });

    expect(response).toMatchObject({
      success: true,
      meta: {
        locale: "en",
        page: 1,
        pageSize: 20,
        textMode: "localized",
        total: 1,
      },
    });
    expect(response.data.map((country) => country.name)).toEqual(["Indonesia"]);
    expect(response.data[0]).not.toHaveProperty("industryTags");
    expect(response.data[0]).not.toHaveProperty("techTags");
    expect(response.data[0]?.signals).toMatchObject({
      opportunityLevel: "HIGH",
      policyFriendliness: "MEDIUM",
      recommendedEntryMode:
        "Start with local channel partners plus project-based EPC co-development, then assess asset-light assembly or a joint venture after traction matures.",
      recommendedPriority: "EXPLORE",
      riskLevel: "HIGH",
      sourceCount: expect.any(Number),
      updatedAt: "2026-01-15T00:00:00Z",
    });
    expect(response.data[0]?.signals.sources).toEqual(
      expect.arrayContaining([
        "P1-2 manually curated Indonesia seed baseline; sourceUrl null because this is an internal sample fixture for schema and coverage validation",
      ]),
    );
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
        recommendedEntryMode: {
          en: "Start with local channel partners plus project-based EPC co-development, then assess asset-light assembly or a joint venture after traction matures.",
          zh: "推荐以本地渠道伙伴 + 项目型 EPC 联合开发起步，成熟后再评估轻资产组装或合资。",
        },
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
      regions: ["southeast-asia"],
      industryTags: expect.arrayContaining(["solar", "storage", "ev", "grid"]),
      techTags: expect.arrayContaining(["pv-module", "lfp"]),
    });
  });

  test("builds localized country detail with ten module coverage entries", () => {
    const response = buildCountryDetailResponse("ID", { locale: "en" });

    expect(response).toMatchObject({
      success: true,
      meta: { locale: "en", textMode: "localized" },
      data: {
        code: "ID",
        coverageLevel: "COMPLETE",
        name: "Indonesia",
        region: "southeast-asia",
      },
    });
    expect(response?.data.moduleCoverage.map((item) => item.moduleKey)).toEqual(
      MODULE_KEYS,
    );
    expect(response?.data).not.toHaveProperty("industryTags");
    expect(response?.data).not.toHaveProperty("techTags");
  });

  test("returns null country detail for unknown ISO code", () => {
    expect(buildCountryDetailResponse("ZZ", { locale: "en" })).toBeNull();
  });

  test("builds localized list module payload from public verified items only", () => {
    const response = buildCountryModuleResponse("ID", "policy", {
      locale: "en",
    });

    expect(response).toMatchObject({
      success: true,
      data: {
        moduleKey: "policy",
        status: "COMPLETE",
        _i18nFallback: [],
      },
      meta: {
        locale: "en",
        page: 1,
        pageSize: 20,
        textMode: "localized",
        total: 5,
      },
    });
    expect(response?.data.items).toHaveLength(5);
    expect(response?.data.items?.[0]).toMatchObject({
      id: "id_pol_001",
      title: "Renewable power procurement framework",
    });
    expect(response?.data.items?.map((item) => item.id)).not.toContain(
      "id_pol_anti_draft_001",
    );
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
        zh: expect.stringContaining("印尼是东南亚"),
        en: expect.stringContaining("Indonesia is one"),
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

  test("summarizes AI advisor readiness without exposing chunks or embeddings", () => {
    const response = buildCountryModuleResponse("ID", "ai-advisor", {
      locale: "en",
    });
    const firstItem = response?.data.items?.[0];

    expect(response?.meta.total).toBe(1);
    expect(firstItem).toMatchObject({
      content: expect.stringContaining("Advisor-ready knowledge"),
      id: "ai-advisor-readiness",
      usableChunkCount: 20,
    });
    expect(firstItem).not.toHaveProperty("embeddingZh");
    expect(firstItem).not.toHaveProperty("embeddingEn");
    expect(firstItem).not.toMatchObject({
      id: "id_know_001",
    });
    expect(response?.data.items?.map((item) => item.id)).not.toContain(
      "id_know_anti_unverified_001",
    );
  });

  test("omits report file URLs from public module responses", () => {
    const response = buildCountryModuleResponse("ID", "reports", {
      locale: "en",
    });

    expect(response?.data.items?.[0]).toMatchObject({
      accessLevel: "FREE",
      id: "id_report_001",
      title: "Indonesia clean-energy market entry brief",
    });
    expect(response?.data.items?.[0]).not.toHaveProperty("fileUrl");
    expect(response?.data.items?.[1]).toMatchObject({
      accessLevel: "MEMBER",
      id: "id_report_002",
    });
    expect(response?.data.items?.[1]).not.toHaveProperty("fileUrl");
  });
});
