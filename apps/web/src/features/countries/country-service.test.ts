import { describe, expect, test } from "vitest";

import { MODULE_KEYS } from "@navigator/shared-types/schema";

import {
  buildBuildingModuleResponse,
  buildCountryDetailResponse,
  buildCountryModuleResponse,
  buildCountriesResponse,
  filterCountryCatalog,
  getFilterOptions,
  localizeCountryCard,
} from "./country-service.js";

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
        summary: { en: "", zh: "测试摘要" },
        techTags: [],
        updatedAt: "2026-01-15T00:00:00Z",
      },
      "en",
    );

    expect(country).toMatchObject({
      name: "测试国家",
      summary: "测试摘要",
      _i18nFallback: ["name", "summary"],
    });
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

  test("builds localized list module payload from published items only", () => {
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
