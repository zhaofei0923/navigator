import { GOLDEN_MODULE_KEYS } from "./country-route-golden-data.js";
import type { CountryDataSnapshot } from "../country-api.js";

const updatedAt = "2026-01-15T00:00:00.000Z";

export const COUNTRY_SENSITIVE_GOLDEN_SNAPSHOT = {
  chineseCompanies: [],
  country: {
    code: "ZZ",
    coverageLevel: "STANDARD",
    flagEmoji: "",
    moduleCoverage: GOLDEN_MODULE_KEYS.map((moduleKey) => ({
      dataCount: moduleKey === "policy" ? 1 : 0,
      moduleKey,
      status: moduleKey === "policy" ? "PARTIAL" : "BUILDING",
      updatedAt,
    })),
    name: { en: "Testland", zh: "测试国家" },
    region: "southeast-asia",
    summary: { en: "Synthetic", zh: "合成" },
    updatedAt,
  },
  entryStrategy: null,
  knowledge: [],
  marketOverview: null,
  opportunities: [],
  partners: [],
  policy: [
    {
      aiUsable: true,
      approvalDecision: "private",
      artifactSha256: "private-sha",
      collectedAt: "2026-01-10T00:00:00.000Z",
      countryCode: "ZZ",
      credibility: "OFFICIAL",
      embeddingEn: [0.1],
      fileUrl: "/private/report.pdf",
      id: "policy-public",
      industryTags: ["solar"],
      policyType: "incentive",
      reviewStatus: "published",
      reviewerId: "private-reviewer",
      source: "Official source",
      sourceUrl: "https://example.test/source",
      stages: ["private"],
      techTags: [],
      title: { en: "", zh: "支持政策" },
      updatedAt: "2026-01-16T00:00:00.000Z",
    },
  ],
  projects: [],
  reports: [],
  risk: [],
} as const satisfies CountryDataSnapshot;

export const COUNTRY_SENSITIVE_GOLDEN_BODY = {
  data: {
    _i18nFallback: ["items[0].title"],
    items: [
      {
        aiUsable: true,
        collectedAt: "2026-01-10T00:00:00.000Z",
        countryCode: "ZZ",
        credibility: "OFFICIAL",
        id: "policy-public",
        industryTags: ["solar"],
        policyType: "incentive",
        reviewStatus: "published",
        source: "Official source",
        sourceUrl: "https://example.test/source",
        techTags: [],
        title: "支持政策",
        updatedAt: "2026-01-16T00:00:00.000Z",
      },
    ],
    moduleKey: "policy",
    status: "PARTIAL",
  },
  meta: {
    locale: "en",
    page: 1,
    pageSize: 20,
    textMode: "localized",
    total: 1,
  },
  success: true,
} as const;

export const COUNTRY_SENSITIVE_RAW_GOLDEN_BODY = {
  data: {
    items: [
      {
        aiUsable: true,
        collectedAt: "2026-01-10T00:00:00.000Z",
        countryCode: "ZZ",
        credibility: "OFFICIAL",
        id: "policy-public",
        industryTags: ["solar"],
        policyType: "incentive",
        reviewStatus: "published",
        source: "Official source",
        sourceUrl: "https://example.test/source",
        techTags: [],
        title: { en: "", zh: "支持政策" },
        updatedAt: "2026-01-16T00:00:00.000Z",
      },
    ],
    moduleKey: "policy",
    status: "PARTIAL",
  },
  meta: {
    locale: "en",
    page: 1,
    pageSize: 20,
    textMode: "raw",
    total: 1,
  },
  success: true,
} as const;
