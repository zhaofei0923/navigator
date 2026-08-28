import { describe, expect, it } from "vitest";
import { toBasic60MarketView } from "@/lib/basic60/market-view";
import type { Basic60CountrySummary } from "@/lib/basic60/types";

const country: Basic60CountrySummary = {
  code: "IDN",
  iso2: "ID",
  name_zh: "印度尼西亚",
  name_en: "Indonesia",
  region_code: "Asia",
  coverage_level: "Basic",
  last_reviewed_at: "2026-08-26T00:00:00Z",
  opportunity_level: "pending",
  policy_friendliness_level: "pending",
  risk_assessment_status: "unknown",
  risk_level: null,
  latest_metrics: [
    {
      metric_code: "gdp_current_usd",
      label: "国内生产总值",
      value: 1_400_000_000_000,
      unit: "USD",
      period: { start: "2024-01-01", end: "2024-12-31", label: "2024" },
      value_status: "available",
      null_reason: null,
      quality_status: "reviewed",
      freshness_status: "current",
    },
    {
      metric_code: "renewable_capacity_mw",
      label: "可再生能源装机",
      value: 14_300,
      unit: "MW",
      period: { start: "2024-01-01", end: "2024-12-31", label: "2024" },
      value_status: "available",
      null_reason: null,
      quality_status: "reviewed",
      freshness_status: "current",
    },
    {
      metric_code: "electricity_demand_gwh",
      label: "用电需求",
      value: null,
      unit: "GWH",
      period: { start: "2024-01-01", end: "2024-12-31", label: "2024" },
      value_status: "pending",
      null_reason: "not_collected",
      quality_status: "pending",
      freshness_status: "pending",
    },
  ],
};

describe("toBasic60MarketView", () => {
  it("keeps reviewed identity and observed metrics without inventing assessment fields", () => {
    const view = toBasic60MarketView(country, "zh-CN");

    expect(view).toMatchObject({
      code: "IDN",
      name: "印度尼西亚",
      alternateName: "Indonesia",
      region: "Asia",
      coverageLevel: "Basic",
      availableMetricCount: 2,
      metricCount: 3,
    });
    expect(view.featuredMetrics.map((metric) => metric.code)).toEqual([
      "renewable_capacity_mw",
      "gdp_current_usd",
    ]);
    expect(view).not.toHaveProperty("summary");
    expect(view).not.toHaveProperty("readiness");
    expect(view).not.toHaveProperty("score");
    expect(view).not.toHaveProperty("source_ref");
  });
});
