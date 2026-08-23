import { describe, expect, it } from "vitest";
import type { ComparisonCountry, CountrySummary } from "@/lib/types";
import {
  comparisonTrendLabel,
  getDimensionLeaderCodes,
  orderComparisonCountries,
  resolveComparisonSelection,
} from "./comparison-model";

describe("comparisonTrendLabel", () => {
  it("localizes stable comparison enums without changing localized API copy", () => {
    expect(comparisonTrendLabel("near_group", "zh-CN")).toBe("接近本组均值");
    expect(comparisonTrendLabel("above_group", "en")).toBe("Above group average");
    expect(comparisonTrendLabel("保持稳定", "zh-CN")).toBe("保持稳定");
  });
});

const summaries = ["ZAF", "KEN", "EGY"].map((code, index) => ({
  data_origin: "synthetic_demo" as const,
  code,
  name_zh: `市场${index + 1}`,
  name_en: `Market ${index + 1}`,
  region: "Demo region",
  currency: "DEM",
  summary: "Synthetic summary",
  scores: {
    market_attractiveness: 70,
    policy_certainty: 70,
    project_activity: 70,
    partner_maturity: 70,
    risk_controllability: 70,
  },
  dimension_deltas: {},
})) satisfies CountrySummary[];

const comparisonCountries = [
  comparisonCountry("ZAF", 82, 1),
  comparisonCountry("KEN", 82, 2),
] satisfies ComparisonCountry[];

describe("comparison model", () => {
  it("preserves valid /compare?countries=A,B order and fills missing or invalid markets", () => {
    expect(resolveComparisonSelection(summaries, "ken,zaf")).toEqual(["KEN", "ZAF"]);
    expect(resolveComparisonSelection(summaries, "unknown,EGY")).toEqual(["EGY", "ZAF"]);
    expect(resolveComparisonSelection(summaries, "ZAF,ZAF")).toEqual(["ZAF", "KEN"]);
    expect(resolveComparisonSelection(summaries.slice(0, 1), "ZAF")).toBeNull();
  });

  it("identifies tied dimension leaders and keeps result cards in A/B order", () => {
    expect(Array.from(getDimensionLeaderCodes(comparisonCountries, "market_attractiveness"))).toEqual([
      "ZAF",
      "KEN",
    ]);
    expect(orderComparisonCountries(comparisonCountries, ["KEN", "ZAF"]).map((country) => country.country_code)).toEqual([
      "KEN",
      "ZAF",
    ]);
  });
});

function comparisonCountry(code: string, marketScore: number, rank: number): ComparisonCountry {
  return {
    data_origin: "synthetic_demo",
    rank,
    country_code: code,
    name_zh: code,
    name_en: code,
    scores: {
      market_attractiveness: marketScore,
      policy_certainty: rank === 1 ? 77 : 71,
      project_activity: 70,
      partner_maturity: 69,
      risk_controllability: 66,
    },
    dimension_deltas: {},
    trend: "Stable",
    overall_score: 74,
    reason: "Synthetic reason",
  };
}
