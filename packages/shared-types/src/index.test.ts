import { describe, expect, test } from "vitest";

import {
  ACCESS_LEVELS,
  COVERAGE_LEVELS,
  CREDIBILITIES,
  INDUSTRY_TAGS,
  MODULE_COVERAGE_STATUSES,
  MODULE_KEYS,
  POLICY_TYPES,
  PROJECT_STATUSES,
  REGIONS,
  REVIEW_STATUSES,
  RISK_CATEGORIES,
  RISK_LEVELS,
  TECH_TAGS,
  isRiskCategory,
  pickLocale,
  type LocalizedText,
} from "./index.js";

const APPROVED_RISK_CATEGORIES = [
  "political",
  "economic",
  "legal",
  "exchange-rate",
  "operational",
  "social",
  "environmental",
] as const;

describe("@navigator/shared-types", () => {
  test("returns zh text for zh-CN without fallback", () => {
    const text: LocalizedText = { zh: "中文内容", en: "English content" };

    expect(pickLocale(text, "zh-CN")).toEqual({
      value: "中文内容",
      fallback: false,
    });
  });

  test("returns en text for en without fallback", () => {
    const text: LocalizedText = { zh: "中文内容", en: "English content" };

    expect(pickLocale(text, "en")).toEqual({
      value: "English content",
      fallback: false,
    });
  });

  test("falls back to en when zh is missing", () => {
    const text = { en: "English content" } as unknown as LocalizedText;

    expect(pickLocale(text, "zh-CN")).toEqual({
      value: "English content",
      fallback: true,
    });
  });

  test("falls back to zh when en is missing", () => {
    const text = { zh: "中文内容" } as unknown as LocalizedText;

    expect(pickLocale(text, "en")).toEqual({
      value: "中文内容",
      fallback: true,
    });
  });

  test("falls back when the primary text is blank", () => {
    const text: LocalizedText = { zh: "   ", en: "English content" };

    expect(pickLocale(text, "zh-CN")).toEqual({
      value: "English content",
      fallback: true,
    });
  });

  test("returns an empty fallback when all text is missing", () => {
    const text = {} as unknown as LocalizedText;

    expect(pickLocale(text, "zh-CN")).toEqual({
      value: "",
      fallback: true,
    });
  });

  test("returns an empty fallback for null or undefined text", () => {
    expect(pickLocale(null, "zh-CN")).toEqual({ value: "", fallback: true });
    expect(pickLocale(undefined, "en")).toEqual({
      value: "",
      fallback: true,
    });
  });

  test("exports fixed enum values from data-schema.md", () => {
    expect(COVERAGE_LEVELS).toEqual(["BASIC", "STANDARD", "COMPLETE"]);
    expect(MODULE_KEYS).toEqual([
      "market-overview",
      "policy",
      "risk",
      "opportunities",
      "projects",
      "partners",
      "chinese-companies",
      "entry-strategy",
      "ai-advisor",
      "reports",
    ]);
    expect(REVIEW_STATUSES).toEqual(["draft", "pending", "published"]);
    expect(CREDIBILITIES).toEqual([
      "OFFICIAL",
      "VERIFIED",
      "ESTIMATED",
      "UNVERIFIED",
    ]);
    expect(MODULE_COVERAGE_STATUSES).toEqual([
      "BUILDING",
      "PARTIAL",
      "COMPLETE",
    ]);
    expect(RISK_LEVELS).toEqual(["LOW", "MEDIUM", "HIGH"]);
    expect(PROJECT_STATUSES).toEqual([
      "PLANNING",
      "BIDDING",
      "CONSTRUCTION",
      "OPERATIONAL",
    ]);
    expect(ACCESS_LEVELS).toEqual(["FREE", "MEMBER", "PREMIUM"]);
    expect(INDUSTRY_TAGS).toEqual([
      "solar",
      "wind",
      "storage",
      "ev",
      "hydrogen",
      "grid",
      "bess-mfg",
      "epc",
    ]);
    expect(TECH_TAGS).toEqual([
      "pv-module",
      "inverter",
      "onshore-wind",
      "offshore-wind",
      "lfp",
      "ncm",
      "electrolyzer",
    ]);
    expect(REGIONS).toEqual([
      "southeast-asia",
      "south-asia",
      "middle-east",
      "africa",
      "latin-america",
      "europe",
      "central-asia",
    ]);
    expect(POLICY_TYPES).toEqual([
      "incentive",
      "tariff",
      "localization",
      "permit",
      "tax",
      "import-export",
    ]);

    expect(RISK_CATEGORIES).toEqual(APPROVED_RISK_CATEGORIES);
  });

  test("accepts only the approved risk category tokens", () => {
    for (const category of APPROVED_RISK_CATEGORIES) {
      expect(isRiskCategory(category), category).toBe(true);
    }
    for (const rejected of [
      "other",
      "Political",
      "exchange_rate",
      "environment",
      "",
      null,
      1,
    ]) {
      expect(isRiskCategory(rejected), String(rejected)).toBe(false);
    }
  });
});
