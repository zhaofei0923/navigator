import { describe, expect, it } from "vitest";
import { basic60MetricLabel, basic60UnitLabel, formatBasic60MetricValue } from "@/lib/basic60/presentation";
import type { Basic60Metric } from "@/lib/basic60/types";

const metric: Basic60Metric = {
  metric_code: "renewable_share_capacity_pct",
  label: "可再生能源装机占比",
  value: 42.56,
  unit: "PERCENT",
  period: { start: "2025-01-01", end: "2025-12-31", label: "2025" },
  value_status: "available",
  null_reason: null,
  quality_status: "passed",
  freshness_status: "current",
};

describe("formatBasic60MetricValue", () => {
  it("keeps percentages as percent points", () => {
    expect(formatBasic60MetricValue(metric, "zh-CN")).toBe("42.56%");
  });

  it("never renders a pending value as zero", () => {
    expect(
      formatBasic60MetricValue(
        { ...metric, value: null, value_status: "pending", null_reason: "not collected" },
        "en",
      ),
    ).toBe("Not available");
  });

  it("keeps negative growth values and genuine zero values", () => {
    expect(formatBasic60MetricValue({ ...metric, value: -3.25 }, "en")).toBe("-3.25%");
    expect(formatBasic60MetricValue({ ...metric, value: 0 }, "zh-CN")).toBe("0%");
  });

  it("does not display an unavailable value even if a number is present", () => {
    expect(formatBasic60MetricValue({ ...metric, value_status: "unavailable" }, "zh-CN")).toBe("暂无数据");
  });
});

describe("product indicator labels", () => {
  it("formats supported technical unit codes into user-facing units", () => {
    expect(basic60UnitLabel("COUNT", "zh-CN")).toBe("人");
    expect(basic60UnitLabel("COUNT", "en")).toBe("people");
    expect(basic60UnitLabel("USD_PER_PERSON", "en")).toBe("USD/person");
  });

  it("resolves omitted indicators without exposing field codes", () => {
    expect(basic60MetricLabel("electricity_demand_gwh", "zh-CN")).toBe("用电需求");
    expect(basic60MetricLabel("electricity_demand_gwh", "en")).toBe("Electricity demand");
    expect(basic60MetricLabel("unrecognized_internal_code", "en")).toBe("Other indicator");
  });
});
