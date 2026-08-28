import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CountryEnergyCharts, CountryMacroCharts } from "@/components/country-data-charts";
import type { EnergyComposition, MacroChartSeries } from "@/lib/basic60/chart-data";
import type { Basic60Locale, Basic60Metric } from "@/lib/basic60/types";

type PlotProps = { series?: MacroChartSeries; composition?: EnergyComposition; locale: Basic60Locale };
const plots = vi.hoisted(() => ({ macro: vi.fn(), energy: vi.fn(), loading: false }));

// Exercise chart containers and their boundaries without a DOM measurement or
// SVG-library dependency. The plot components have their own interaction tests.
vi.mock("next/dynamic", () => ({
  default: (_loader: unknown, options: { loading: ComponentType }) => {
    function DynamicPlot(props: PlotProps) {
      if (plots.loading) {
        const Loading = options.loading;
        return <Loading />;
      }
      return props.series ? plots.macro(props) : plots.energy(props);
    }
    return DynamicPlot;
  },
}));

function metric(code: string, value: number | null, unit: string, year: number, overrides: Partial<Basic60Metric> = {}): Basic60Metric {
  return {
    metric_code: code,
    label: "untrusted source label",
    value,
    unit,
    period: { start: `${year}-01-01`, end: `${year}-12-31`, label: String(year) },
    value_status: value === null ? "pending" : "available",
    null_reason: value === null ? "internal_source_evidence_missing" : null,
    quality_status: "reviewed",
    freshness_status: "current",
    ...overrides,
  };
}

const macroDefinitions = [
  { code: "gdp_current_usd", unit: "USD", values: [965_123_456_789.25, 987_000_000_000, 1_100_000_000_000, 1_200_000_000_000, 1_245_678_901_234.5] },
  { code: "gdp_growth_pct", unit: "PERCENT", values: [-5.7, 0, 3.04, -1.125, 4.125] },
  { code: "gdp_per_capita_current_usd", unit: "USD_PER_PERSON", values: [2_456.78, 2_789.12, 3_456.25, 3_890.5, 4_567.891] },
  { code: "inflation_cpi_pct", unit: "PERCENT", values: [1.9, 110.55, -0.5, 0, 193.45678] },
  { code: "fdi_net_inflows_usd", unit: "USD", values: [800_010_000.25, -100_020.5, 0, 191, 425] },
  { code: "official_exchange_rate_lcu_per_usd", unit: "LCU_PER_USD", values: [0.6937541234567, 0, 0.78, 0.85, 0.9] },
];
const macro = macroDefinitions.flatMap(({ code, unit, values }) => values.map((value, index) => metric(code, value, unit, 2020 + index)));
const energy = [
  metric("electricity_installed_capacity_mw", 1_000.5, "MW", 2025),
  metric("renewable_capacity_mw", 250.125, "MW", 2025),
  metric("renewable_share_capacity_pct", 25, "PERCENT", 2025),
  metric("electricity_generation_gwh", 2_000.5, "GWH", 2023),
  metric("renewable_generation_gwh", 400.1, "GWH", 2023),
  metric("renewable_share_generation_pct", 20, "PERCENT", 2023),
  metric("electricity_demand_gwh", 123_456, "GWH", 2024),
];

function openDetails(panel: HTMLElement) {
  const summary = panel.querySelector("summary") as HTMLElement;
  return userEvent.click(summary);
}

describe("country chart containers", () => {
  beforeEach(() => {
    plots.loading = false;
    plots.macro.mockReset().mockImplementation(({ series }: PlotProps) => <div data-testid="macro-plot" data-metric={series?.code} />);
    plots.energy.mockReset().mockImplementation(({ composition }: PlotProps) => <div data-testid="energy-plot" data-kind={composition?.key} />);
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it.each(["zh-CN", "en"] as const)("shows two energy and six macro panels with actual reporting periods in %s", (locale) => {
    const { container } = render(<><CountryEnergyCharts metrics={energy} locale={locale} countryCode="IDN" /><CountryMacroCharts metrics={macro} locale={locale} countryCode="IDN" /></>);
    expect(container.querySelectorAll(".country-energy-panel")).toHaveLength(2);
    expect(container.querySelectorAll(".country-macro-panel")).toHaveLength(6);
    expect(plots.energy).toHaveBeenCalledTimes(2);
    expect(plots.macro).toHaveBeenCalledTimes(6);
    expect(screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual(locale === "en"
      ? ["Installed capacity mix", "Generation mix", "GDP", "GDP growth", "GDP per capita", "CPI inflation", "FDI net inflows", "Official exchange rate"]
      : ["电力装机结构", "发电结构", "国内生产总值", "GDP增长率", "人均GDP", "CPI通胀率", "FDI净流入", "官方汇率"]);
    expect(screen.getByText("2025 · MW")).toBeInTheDocument();
    expect(screen.getByText("2023 · GWh")).toBeInTheDocument();
    expect(screen.getByText(locale === "en" ? "2020–2024" : "2020—2024")).toBeInTheDocument();
    const disclosures = [...container.querySelectorAll("details")];
    expect(disclosures).toHaveLength(8);
    for (const disclosure of disclosures) {
      expect(disclosure).not.toHaveAttribute("open");
      expect(disclosure.firstElementChild?.tagName).toBe("SUMMARY");
      expect(disclosure.querySelector("table")).not.toBeVisible();
    }
    expect(container).not.toHaveTextContent(/用电需求|Electricity demand|BASIC60|Basic|已审核|来源|source_ref|untrusted source label|reviewed|pending|internal_source|quality_status/i);
  });

  it.each(["zh-CN", "en"] as const)("retains full precision and native, keyboard-readable macro data tables in %s", async (locale) => {
    render(<CountryMacroCharts metrics={macro} locale={locale} countryCode="IDN" />);
    const gdp = screen.getByRole("article", { name: locale === "en" ? "GDP" : "国内生产总值" });
    const table = gdp.querySelector("table") as HTMLTableElement;
    expect(table).not.toBeVisible();
    await openDetails(gdp);
    expect(table).toBeVisible();
    expect(within(table).getByRole("cell", { name: "965,123,456,789.25" })).toBeInTheDocument();
    expect(within(table).getByRole("cell", { name: "1,245,678,901,234.5" })).toBeInTheDocument();
    expect(table).not.toHaveTextContent(/万|亿|[0-9](?:K|M|B|T)\b/);
    expect(gdp.querySelector('[role="region"]')).toHaveAttribute("tabindex", "0");
    expect(within(table).getAllByRole("rowheader").map((cell) => cell.textContent)).toEqual(["2020", "2021", "2022", "2023", "2024"]);

    const growth = screen.getByRole("article", { name: locale === "en" ? "GDP growth" : "GDP增长率" });
    await openDetails(growth);
    expect(within(growth).getByRole("cell", { name: "-5.7" })).toBeInTheDocument();
    expect(within(growth).getByRole("cell", { name: "0" })).toBeInTheDocument();
    const fdi = screen.getByRole("article", { name: locale === "en" ? "FDI net inflows" : "FDI净流入" });
    await openDetails(fdi);
    expect(within(fdi).getByRole("cell", { name: "-100,020.5" })).toBeInTheDocument();
    const inflation = screen.getByRole("article", { name: locale === "en" ? "CPI inflation" : "CPI通胀率" });
    await openDetails(inflation);
    expect(within(inflation).getByRole("cell", { name: "193.45678" })).toBeInTheDocument();
    const exchange = screen.getByRole("article", { name: locale === "en" ? "Official exchange rate" : "官方汇率" });
    await openDetails(exchange);
    expect(within(exchange).getByRole("cell", { name: "0.6937541234567" })).toBeInTheDocument();
    await openDetails(gdp);
    expect(table).not.toBeVisible();
  });

  it.each(["zh-CN", "en"] as const)("keeps original energy precision and labels the calculated remainder in %s", async (locale) => {
    render(<CountryEnergyCharts metrics={energy} locale={locale} countryCode="IDN" />);
    const capacity = screen.getByRole("article", { name: locale === "en" ? "Installed capacity mix" : "电力装机结构" });
    await openDetails(capacity);
    const table = within(capacity).getByRole("table");
    expect(within(table).getByRole("cell", { name: "1,000.5" })).toBeInTheDocument();
    expect(within(table).getByRole("cell", { name: "250.125" })).toBeInTheDocument();
    expect(within(table).getByRole("cell", { name: "750.375" })).toBeInTheDocument();
    expect(within(table).getByRole("cell", { name: "25" })).toBeInTheDocument();
    expect(within(table).getByText(locale === "en" ? "Calculated" : "计算值")).toBeVisible();
    expect(within(capacity).getByText(locale === "en" ? "Other sources are calculated as the total minus renewables." : "其他电源按总量减去可再生能源计算。")).toBeVisible();
    expect(within(table).getAllByRole("row")).toHaveLength(5);
    expect(capacity.querySelector('[role="region"]')).toHaveAttribute("tabindex", "0");
    expect(table).not.toHaveTextContent(/万|亿|source_ref|internal_source/);
  });

  it.each(["zh-CN", "en"] as const)("preserves unavailable years as gaps while keeping genuine zero values in %s", async (locale) => {
    const metrics = [
      metric("official_exchange_rate_lcu_per_usd", 0.69, "LCU_PER_USD", 2020),
      metric("official_exchange_rate_lcu_per_usd", 0, "LCU_PER_USD", 2021),
      metric("official_exchange_rate_lcu_per_usd", 0.85, "LCU_PER_USD", 2023),
      metric("official_exchange_rate_lcu_per_usd", null, "LCU_PER_USD", 2024),
    ];
    render(<CountryMacroCharts metrics={metrics} locale={locale} countryCode="LKA" />);
    const panel = screen.getByRole("article", { name: locale === "en" ? "Official exchange rate" : "官方汇率" });
    await openDetails(panel);
    const table = within(panel).getByRole("table");
    const unavailable = locale === "en" ? "Not available" : "暂无数据";
    expect(within(table).getByRole("row", { name: new RegExp(`2022 ${unavailable}`) })).toBeInTheDocument();
    expect(within(table).getByRole("row", { name: new RegExp(`2024 ${unavailable}`) })).toBeInTheDocument();
    expect(within(table).getByRole("row", { name: /2021 0 / })).toBeInTheDocument();
    const series = plots.macro.mock.calls[0][0].series as MacroChartSeries;
    expect(series.points.map((point) => point.value)).toEqual([0.69, 0, null, 0.85, null]);
    expect(series.latest?.year).toBe(2023);
    expect(table).not.toHaveTextContent(/pending|internal_source|NaN|undefined/);
  });

  it.each(["zh-CN", "en"] as const)("shows honest empty states and still offers data details in %s", async (locale) => {
    const { container } = render(<><CountryEnergyCharts metrics={[]} locale={locale} countryCode="IDN" /><CountryMacroCharts metrics={[]} locale={locale} countryCode="IDN" /></>);
    expect(plots.energy).not.toHaveBeenCalled();
    expect(plots.macro).not.toHaveBeenCalled();
    expect(screen.getAllByRole("status")).toHaveLength(8);
    const panel = screen.getByRole("article", { name: locale === "en" ? "GDP" : "国内生产总值" });
    await openDetails(panel);
    expect(within(panel).getByRole("table")).toHaveTextContent(locale === "en" ? "Not available" : "暂无数据");
    expect(container).not.toHaveTextContent(/2020|2024|2025|0 MW|0 GWh|NaN|undefined/);
  });

  it.each(["zh-CN", "en"] as const)("localizes lazy-chart loading states through the surrounding provider in %s", (locale) => {
    plots.loading = true;
    render(<><CountryEnergyCharts metrics={energy} locale={locale} countryCode="IDN" /><CountryMacroCharts metrics={macro} locale={locale} countryCode="IDN" /></>);
    expect(screen.getAllByRole("status")).toHaveLength(8);
    for (const state of screen.getAllByRole("status")) expect(state).toHaveTextContent(locale === "en" ? "Loading chart" : "正在加载图表");
    expect(plots.energy).not.toHaveBeenCalled();
    expect(plots.macro).not.toHaveBeenCalled();
  });

  it.each([
    { label: "mismatched units", observations: [metric("gdp_current_usd", 100.125, "USD", 2023), metric("gdp_current_usd", 200.5, "MW", 2024)] },
    { label: "duplicate year", observations: [metric("gdp_current_usd", 100.125, "USD", 2024), metric("gdp_current_usd", 200.5, "USD", 2024)] },
  ])("does not plot $label macro data but preserves both observations in the detail table", async ({ observations }) => {
    render(<CountryMacroCharts metrics={observations} locale="en" countryCode="IDN" />);
    expect(plots.macro).not.toHaveBeenCalled();
    const panel = screen.getByRole("article", { name: "GDP" });
    expect(within(panel).getByRole("status")).toBeInTheDocument();
    await openDetails(panel);
    const table = within(panel).getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(within(table).getByRole("cell", { name: "100.125" })).toBeInTheDocument();
    expect(within(table).getByRole("cell", { name: "200.5" })).toBeInTheDocument();
    if (observations[1].unit === "MW") expect(within(table).getByRole("cell", { name: "MW" })).toBeInTheDocument();
  });

  it("retains source years and values when energy components belong to different reporting periods", async () => {
    const observations = [energy[0], metric("renewable_capacity_mw", 250.125, "MW", 2024), energy[2]];
    render(<CountryEnergyCharts metrics={observations} locale="zh-CN" countryCode="IDN" />);
    expect(plots.energy).not.toHaveBeenCalled();
    const panel = screen.getByRole("article", { name: "电力装机结构" });
    expect(within(panel).getByRole("status")).toHaveTextContent("统计期或单位不一致");
    await openDetails(panel);
    const table = within(panel).getByRole("table");
    expect(within(table).getByRole("row", { name: /可再生能源装机容量 2024 250.125 MW/ })).toBeInTheDocument();
    expect(within(table).getByRole("row", { name: /电力装机容量 2025 1,000.5 MW/ })).toBeInTheDocument();
    expect(table).not.toHaveTextContent(/其他电源|计算值/);
  });

  it("never puts the capacity unit on an incompatible total, while the table keeps the original unit", async () => {
    const observations = [{ ...energy[0], unit: "GWH" }, energy[1], energy[2]];
    render(<CountryEnergyCharts metrics={observations} locale="en" countryCode="IDN" />);
    const panel = screen.getByRole("article", { name: "Installed capacity mix" });
    expect(panel.querySelector(".country-energy-total")).not.toHaveTextContent("1,000.50 MW");
    expect(panel.querySelector(".country-energy-total")).toHaveTextContent("Not available");
    expect(plots.energy).not.toHaveBeenCalled();
    await openDetails(panel);
    expect(within(panel).getByRole("row", { name: /Installed electricity capacity 2025 1,000.5 GWh/ })).toBeInTheDocument();
  });

  it.each([
    { label: "inconsistent share", observations: [energy[0], energy[1], { ...energy[2], value: 80 }] },
    { label: "negative renewable value", observations: [energy[0], { ...energy[1], value: -250.125 }, energy[2]] },
    { label: "duplicate total", observations: [energy[0], { ...energy[0], value: 1_001.5 }, energy[1], energy[2]] },
  ])("rejects an energy ring with $label without discarding its underlying data", async ({ observations }) => {
    render(<CountryEnergyCharts metrics={observations} locale="en" countryCode="IDN" />);
    expect(plots.energy).not.toHaveBeenCalled();
    const panel = screen.getByRole("article", { name: "Installed capacity mix" });
    expect(within(panel).getByRole("status")).toHaveTextContent("This chart is unavailable");
    await openDetails(panel);
    const table = within(panel).getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(observations.length + 1);
    expect(table).not.toHaveTextContent(/Calculated|Other sources/);
    for (const observation of observations) expect(table).toHaveTextContent(new Intl.NumberFormat("en", { maximumSignificantDigits: 21 }).format(observation.value as number));
  });

  it.each(["zh-CN", "en"] as const)("retains data details when chart rendering fails, and resets the boundary on country change in %s", async (locale) => {
    const expectedError = new Error("restricted source hash must not reach the page");
    plots.energy.mockImplementation(() => { throw expectedError; });
    plots.macro.mockImplementation(() => { throw expectedError; });
    const caughtError = vi.fn();
    const charts = (countryCode: string) => <><CountryEnergyCharts metrics={energy} locale={locale} countryCode={countryCode} /><CountryMacroCharts metrics={macro} locale={locale} countryCode={countryCode} /></>;
    const { container, rerender } = render(charts("IDN"), { onCaughtError: caughtError });
    expect(caughtError).toHaveBeenCalled();
    expect(screen.getAllByRole("alert")).toHaveLength(8);
    expect(screen.getAllByRole("button", { name: locale === "en" ? "Reload" : "重新加载" })).toHaveLength(8);
    expect(container).not.toHaveTextContent(expectedError.message);
    const gdp = screen.getByRole("article", { name: locale === "en" ? "GDP" : "国内生产总值" });
    await openDetails(gdp);
    expect(within(gdp).getByRole("cell", { name: "965,123,456,789.25" })).toBeInTheDocument();
    const capacity = screen.getByRole("article", { name: locale === "en" ? "Installed capacity mix" : "电力装机结构" });
    await openDetails(capacity);
    expect(within(capacity).getByRole("cell", { name: "250.125" })).toBeInTheDocument();

    plots.energy.mockImplementation(() => <div data-testid="energy-plot" />);
    plots.macro.mockImplementation(() => <div data-testid="macro-plot" />);
    rerender(charts("VNM"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("energy-plot")).toHaveLength(2);
    expect(screen.getAllByTestId("macro-plot")).toHaveLength(6);
  });
});
