import { describe, expect, test } from "vitest";

import { MODULE_KEYS, type ModuleKey } from "./schema.js";
import type { CountryDataSnapshot, JsonObject } from "./country-api.js";
import {
  formatCountriesResponse,
  formatCountryDetailResponse,
  formatCountryModuleResponse,
  getCountryFilterOptions,
  sortCountrySnapshots,
} from "./country-formatter.js";

function moduleCoverage(
  statuses: Partial<Record<ModuleKey, "BUILDING" | "PARTIAL" | "COMPLETE">> = {},
): readonly JsonObject[] {
  return MODULE_KEYS.map((moduleKey) => ({
    dataCount: statuses[moduleKey] === undefined ? 0 : 1,
    moduleKey,
    status: statuses[moduleKey] ?? "BUILDING",
    updatedAt: "2026-01-15T00:00:00.000Z",
  }));
}

function countrySnapshot(options: {
  code: string;
  name: string;
  region: string;
}): CountryDataSnapshot {
  return {
    chineseCompanies: [],
    country: {
      code: options.code,
      coverageLevel: "BASIC",
      flagEmoji: "",
      moduleCoverage: moduleCoverage(),
      name: { en: options.name, zh: options.name },
      region: options.region,
      summary: { en: `${options.name} summary`, zh: `${options.name}摘要` },
      updatedAt: "2026-01-15T00:00:00.000Z",
    },
    entryStrategy: null,
    knowledge: [],
    marketOverview: null,
    opportunities: [],
    partners: [],
    policy: [],
    projects: [],
    reports: [],
    risk: [],
  };
}

function richSnapshot(): CountryDataSnapshot {
  const publicMeta = {
    aiUsable: true,
    collectedAt: "2026-01-10T00:00:00.000Z",
    countryCode: "ID",
    credibility: "OFFICIAL",
    industryTags: ["solar", "wind"],
    reviewStatus: "published",
    source: "Official source",
    sourceUrl: "https://example.test/source",
    techTags: ["onshore-wind"],
    updatedAt: "2026-01-16T00:00:00.000Z",
  } as const;

  return {
    chineseCompanies: [],
    country: {
      code: "ID",
      coverageLevel: "STANDARD",
      flagEmoji: "🇮🇩",
      moduleCoverage: moduleCoverage({
        "ai-advisor": "PARTIAL",
        "entry-strategy": "PARTIAL",
        "market-overview": "COMPLETE",
        opportunities: "PARTIAL",
        policy: "PARTIAL",
        projects: "PARTIAL",
        reports: "PARTIAL",
        risk: "PARTIAL",
      }),
      name: { en: "Indonesia", zh: "印度尼西亚" },
      region: "southeast-asia",
      summary: { en: "", zh: "印尼摘要" },
      updatedAt: "2026-01-15T00:00:00.000Z",
    },
    entryStrategy: {
      ...publicMeta,
      id: "entry-1",
      overview: { en: "Entry overview", zh: "进入概览" },
      recommendedMode: { en: "Joint venture", zh: "合资" },
      steps: [],
    },
    knowledge: [
      {
        ...publicMeta,
        content: { en: "Allowed knowledge", zh: "可用知识" },
        embeddingEn: [0.1],
        embeddingZh: [0.2],
        id: "knowledge-allowed",
        sourceModule: "policy",
      },
      {
        ...publicMeta,
        aiUsable: false,
        content: { en: "Not AI usable", zh: "不可用于AI" },
        id: "knowledge-disabled",
        sourceModule: "risk",
      },
      {
        ...publicMeta,
        content: { en: "Unverified", zh: "未核验" },
        credibility: "UNVERIFIED",
        id: "knowledge-unverified",
        sourceModule: "risk",
      },
    ],
    marketOverview: {
      ...publicMeta,
      energyDemand: { en: "Demand", zh: "需求" },
      id: "market-1",
      keyIndicators: [
        {
          authorizedPublication: true,
          decision: "approved",
          label: { en: "", zh: "装机" },
          reviewerId: "reviewer-private",
          safeIndicatorNote: "visible",
          unit: "MW",
          value: "100",
          year: 2026,
        },
      ],
      overview: { en: "Market overview", zh: "市场概览" },
      renewableTarget: { en: "Target", zh: "目标" },
    },
    opportunities: [
      { ...publicMeta, id: "opportunity-1", title: { en: "Solar", zh: "光伏" } },
    ],
    partners: [],
    policy: [
      {
        ...publicMeta,
        artifactSha256: "private-artifact-sha",
        authorizedPublication: true,
        decidedAt: "2026-01-16T01:00:00.000Z",
        decision: "approved",
        embeddingEn: [0.1],
        fileUrl: "/private/report.pdf",
        humanDecision: "publish",
        id: "policy-public",
        policyType: "incentive",
        reviewerId: "reviewer-private",
        safeLookingSentinel: "must-not-cross-boundary",
        submission: { id: "submission-private" },
        title: { en: "", zh: "支持政策" },
      },
      {
        ...publicMeta,
        id: "policy-draft",
        reviewStatus: "draft",
        title: { en: "Draft", zh: "草稿" },
      },
      {
        ...publicMeta,
        credibility: "UNVERIFIED",
        id: "policy-unverified",
        title: { en: "Unverified", zh: "未核验" },
      },
      {
        ...publicMeta,
        countryCode: "VN",
        id: "policy-wrong-country",
        title: { en: "Wrong country", zh: "错误国家" },
      },
    ],
    projects: [
      { ...publicMeta, id: "project-1", name: { en: "Project", zh: "项目" } },
    ],
    reports: [
      {
        ...publicMeta,
        abstract: { en: "Report", zh: "报告" },
        fileUrl: "/private/report.pdf",
        id: "report-1",
        title: { en: "Report", zh: "报告" },
      },
    ],
    risk: [
      {
        ...publicMeta,
        id: "risk-1",
        level: "HIGH",
        title: { en: "Risk", zh: "风险" },
      },
    ],
  };
}

describe("country response formatter", () => {
  test("sorts shuffled snapshots independently of repository order", () => {
    const snapshots = [
      countrySnapshot({ code: "ZA", name: "South Africa", region: "africa" }),
      countrySnapshot({ code: "AE", name: "United Arab Emirates", region: "middle-east" }),
      countrySnapshot({ code: "VN", name: "Viet Nam", region: "southeast-asia" }),
      countrySnapshot({ code: "BR", name: "Brazil", region: "latin-america" }),
      countrySnapshot({ code: "ID", name: "Indonesia", region: "southeast-asia" }),
      countrySnapshot({ code: "SA", name: "Saudi Arabia", region: "middle-east" }),
    ];

    expect(sortCountrySnapshots(snapshots).map(({ country }) => country.code)).toEqual([
      "ID",
      "VN",
      "SA",
      "AE",
      "BR",
      "ZA",
    ]);
    expect(
      formatCountriesResponse([...snapshots].reverse(), { locale: "en" }).data.map(
        ({ code }) => code,
      ),
    ).toEqual(["ID", "VN", "SA", "AE", "BR", "ZA"]);
  });

  test("requires every requested tag and preserves pagination metadata", () => {
    const matching = richSnapshot();
    const partial = countrySnapshot({
      code: "VN",
      name: "Viet Nam",
      region: "southeast-asia",
    });
    const response = formatCountriesResponse([partial, matching], {
      industryTags: ["solar", "wind"],
      locale: "en",
      page: 1,
      pageSize: 1,
      techTags: ["onshore-wind"],
    });

    expect(response.data.map(({ code }) => code)).toEqual(["ID"]);
    expect(response.meta).toEqual({
      locale: "en",
      page: 1,
      pageSize: 1,
      textMode: "localized",
      total: 1,
    });
    expect(getCountryFilterOptions([matching])).toMatchObject({
      industryTags: ["solar", "wind"],
      techTags: ["onshore-wind"],
    });
  });

  test("keeps raw bilingual text and omits fallback markers", () => {
    const response = formatCountryDetailResponse(
      richSnapshot(),
      { locale: "en" },
      "raw",
    );

    expect(response?.data.name).toEqual({ en: "Indonesia", zh: "印度尼西亚" });
    expect(response?.data.summary).toEqual({ en: "", zh: "印尼摘要" });
    expect(response?.data).not.toHaveProperty("_i18nFallback");
  });

  test("records complete localized fallback paths", () => {
    const detail = formatCountryDetailResponse(richSnapshot(), { locale: "en" });
    const market = formatCountryModuleResponse(
      richSnapshot(),
      "market-overview",
      { locale: "en" },
    );
    const policy = formatCountryModuleResponse(
      richSnapshot(),
      "policy",
      { locale: "en" },
    );

    expect(detail?.data).toMatchObject({
      summary: "印尼摘要",
      _i18nFallback: ["summary"],
    });
    expect(market?.data._i18nFallback).toEqual([
      "item.keyIndicators[0].label",
    ]);
    expect(policy?.data._i18nFallback).toEqual(["items[0].title"]);
  });

  test("filters non-public records and fail-closes public response fields", () => {
    const rawPolicy = formatCountryModuleResponse(
      richSnapshot(),
      "policy",
      { locale: "en" },
      "raw",
    );
    const localizedPolicy = formatCountryModuleResponse(
      richSnapshot(),
      "policy",
      { locale: "en" },
    );
    const rawMarket = formatCountryModuleResponse(
      richSnapshot(),
      "market-overview",
      { locale: "en" },
      "raw",
    );
    const localizedMarket = formatCountryModuleResponse(
      richSnapshot(),
      "market-overview",
      { locale: "en" },
    );

    expect(rawPolicy?.meta.total).toBe(1);
    expect(rawPolicy?.data.items?.map(({ id }) => id)).toEqual(["policy-public"]);
    expect(rawMarket?.data.item).toMatchObject({
      keyIndicators: [{ safeIndicatorNote: "visible" }],
    });
    expect(localizedMarket?.data.item).toMatchObject({
      keyIndicators: [{ safeIndicatorNote: "visible" }],
    });
    for (const forbidden of [
      "artifactSha256",
      "authorizedPublication",
      "decidedAt",
      "decision",
      "embeddingEn",
      "embeddingZh",
      "fileUrl",
      "humanDecision",
      "reviewerId",
      "safeLookingSentinel",
      "submission",
    ]) {
      for (const response of [
        rawPolicy,
        localizedPolicy,
        rawMarket,
        localizedMarket,
      ]) {
        expect(JSON.stringify(response)).not.toContain(forbidden);
      }
    }
  });

  test("applies the additional AI-usable filter without exposing source content", () => {
    const response = formatCountryModuleResponse(
      richSnapshot(),
      "ai-advisor",
      { locale: "en" },
    );

    expect(response).toMatchObject({
      data: {
        items: [
          {
            id: "ai-advisor-readiness",
            usableChunkCount: 1,
            usableSourceModules: ["policy"],
          },
        ],
        moduleKey: "ai-advisor",
        status: "PARTIAL",
      },
      meta: { total: 1 },
    });
    expect(JSON.stringify(response)).not.toContain("Allowed knowledge");
    expect(JSON.stringify(response)).not.toContain("Not AI usable");
  });

  test("preserves signals and BUILDING/unknown behavior", () => {
    const list = formatCountriesResponse([richSnapshot()], { locale: "en" });
    const buildingSnapshot = countrySnapshot({
      code: "VN",
      name: "Viet Nam",
      region: "southeast-asia",
    });
    const building = formatCountryModuleResponse(
      buildingSnapshot,
      "reports",
      { locale: "en", page: 2, pageSize: 5 },
    );

    expect(list.data[0]?.signals).toMatchObject({
      opportunityLevel: "MEDIUM",
      policyFriendliness: "MEDIUM",
      recommendedEntryMode: "Joint venture",
      recommendedPriority: "EXPLORE",
      riskLevel: "HIGH",
      sourceCount: 1,
      sources: ["Official source"],
      updatedAt: "2026-01-16T00:00:00.000Z",
    });
    expect(building).toEqual({
      data: {
        _i18nFallback: [],
        items: [],
        moduleKey: "reports",
        status: "BUILDING",
      },
      meta: {
        locale: "en",
        page: 2,
        pageSize: 5,
        textMode: "localized",
        total: 0,
      },
      success: true,
    });
    expect(formatCountryDetailResponse(null, { locale: "en" })).toBeNull();
  });
});
