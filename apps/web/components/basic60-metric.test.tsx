import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Basic60MetricCard } from "@/components/basic60-metric";
import type { Basic60Metric } from "@/lib/basic60/types";

const metric: Basic60Metric = {
  metric_code: "renewable_capacity_mw",
  label: "可再生能源装机",
  value: 1250,
  unit: "MW",
  period: { start: "2025-01-01", end: "2025-12-31", label: "2025" },
  value_status: "available",
  null_reason: null,
  quality_status: "passed",
  freshness_status: "current",
};

describe("Basic60MetricCard", () => {
  it.each(["zh-CN", "en"] as const)("shows values, units and the period without workflow metadata in %s", (locale) => {
    render(<Basic60MetricCard metric={metric} locale={locale} />);

    const card = screen.getByRole("article");
    expect(card).toHaveTextContent("1,250 MW");
    expect(card).toHaveTextContent("2025");
    expect(screen.getByText(locale === "en" ? "Unit" : "单位")).toBeInTheDocument();
    expect(card).not.toHaveTextContent("来源");
    expect(card).not.toHaveTextContent("Source");
    expect(card).not.toHaveTextContent("source_ref");
    expect(card).not.toHaveTextContent(/已发布|Published|已审核|reviewed|passed|Basic|pending/i);
  });

  it.each(["zh-CN", "en"] as const)("uses a plain missing-data label and hides technical null reasons in %s", (locale) => {
    render(<Basic60MetricCard metric={{ ...metric, value: null, value_status: "pending", null_reason: "no_reliable_uniform_public_value" }} locale={locale} />);

    const card = screen.getByRole("article");
    expect(card).toHaveTextContent(locale === "en" ? "Not available" : "暂无数据");
    expect(card).toHaveTextContent("MW");
    expect(card).toHaveTextContent("2025");
    expect(card).not.toHaveTextContent(/pending|no_reliable|0 MW|已发布|Published/i);
  });

  it("keeps a genuine zero distinct from missing data", () => {
    render(<Basic60MetricCard metric={{ ...metric, value: 0 }} locale="zh-CN" />);

    expect(screen.getByRole("article")).toHaveTextContent("0 MW");
    expect(screen.queryByText("暂无数据")).not.toBeInTheDocument();
  });

  it.each(["zh-CN", "en"] as const)("does not show internal placeholders for a missing reporting period in %s", (locale) => {
    render(<Basic60MetricCard metric={{ ...metric, value: null, value_status: "pending", period: { start: "2026-08-22", end: "2026-08-22", label: "pending" } }} locale={locale} />);

    const card = screen.getByRole("article");
    expect(card).toHaveTextContent(locale === "en" ? "Not available" : "暂无数据");
    expect(card).not.toHaveTextContent(/pending|unknown|2025|0 MW/i);
  });
});
