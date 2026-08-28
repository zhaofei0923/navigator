import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Basic60CountryDetailPage from "@/app/(basic60)/basic60/(private)/countries/[code]/page";
import { Basic60ApiError } from "@/lib/basic60/api";
import type { Basic60CountryDetail, Basic60Locale, Basic60Meta, Basic60Metric } from "@/lib/basic60/types";

const meta: Basic60Meta = {
  release_id: "BASIC60-PRIVATE-R1",
  release_profile: "basic60_private",
  formal_gate_status: "pending",
  coverage_level: "Basic",
  as_of: "2026-08-26",
  result_count: 1,
};

const country: Basic60CountryDetail = {
  code: "ZAF",
  iso2: "ZA",
  name_zh: "南非",
  name_en: "South Africa",
  region_code: "Africa",
  coverage_level: "Basic",
  last_reviewed_at: "2026-08-26T09:00:00+08:00",
  opportunity_level: "pending",
  policy_friendliness_level: "pending",
  risk_assessment_status: "unknown",
  risk_level: null,
  latest_metrics: [],
  capitals: [
    { name: "Cape Town", role: "legislative", display_order: 2, valid_from: null, valid_to: null },
    { name: "Pretoria", role: "administrative", display_order: 1, valid_from: null, valid_to: null },
    { name: "Bloemfontein", role: "judicial", display_order: 3, valid_from: null, valid_to: null },
  ],
  local_names: [{ locale: "en", text: "Republic of South Africa", preferred: true, translation_status: "reviewed" }],
  languages: [
    { code: "und-01", name_en: "English", name_local: "English", status: "official" },
    { code: "und-02", name_en: "Zulu", name_local: "isiZulu", status: "official" },
  ],
  currencies: [{ code: "ZAR", name_en: "South African Rand", legal_tender: true, valid_from: null, valid_to: null }],
  timezones: [{ iana_code: "Africa/Johannesburg", primary: true }],
  admin_structures: [{ admin_level: 1, unit_type: "province", unit_count: 9, as_of_year: 2025, status: "reviewed" }],
  macro: [{
    metric_code: "gdp_growth_pct",
    label: "经济增长率",
    value: -3.25,
    unit: "PERCENT",
    period: { start: "2024-01-01", end: "2024-12-31", label: "2024" },
    value_status: "available",
    null_reason: null,
    quality_status: "reviewed",
    freshness_status: "current",
  }],
  energy: [{
    metric_code: "electricity_demand_gwh",
    label: "用电需求",
    value: null,
    unit: "GWH",
    period: { start: "2025-01-01", end: "2025-12-31", label: "2025" },
    value_status: "pending",
    null_reason: "no_reliable_uniform_public_value",
    quality_status: "pending",
    freshness_status: "pending",
  }],
};

const mocks = vi.hoisted(() => ({
  getBasic60Country: vi.fn(),
  getRequestLocale: vi.fn(),
  notFound: vi.fn(() => { throw new Error("NEXT_HTTP_ERROR_FALLBACK;404"); }),
  energyCharts: vi.fn(),
  macroCharts: vi.fn(),
  loadOverview: vi.fn(),
  marketOverview: vi.fn(),
}));

vi.mock("@/components/country-data-charts", () => ({
  CountryEnergyCharts: mocks.energyCharts,
  CountryMacroCharts: mocks.macroCharts,
}));

vi.mock("@/lib/market-content/api", () => ({ loadCountryMarketOverview: mocks.loadOverview }));
vi.mock("@/components/country-market-content", () => ({
  CountryMarketOverview: mocks.marketOverview,
  MarketOverviewLoading: () => <div role="status">Loading renewable energy market overview</div>,
}));

vi.mock("@/lib/basic60/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/basic60/api")>()),
  getBasic60Country: mocks.getBasic60Country,
}));

vi.mock("@/lib/i18n/server", () => ({
  getRequestLocale: mocks.getRequestLocale,
}));

vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
}));

describe("Basic60CountryDetailPage market scope", () => {
  beforeEach(() => {
    vi.stubEnv("NAVIGATOR_RUNTIME_PROFILE", "approved_basic60_demo");
    mocks.getRequestLocale.mockReset();
    mocks.getBasic60Country.mockReset().mockRejectedValue(
      new Basic60ApiError("temporarily unavailable", 503),
    );
    mocks.notFound.mockClear();
    mocks.loadOverview.mockReset().mockResolvedValue({ status: "unavailable" });
    mocks.marketOverview.mockReset().mockImplementation(({ locale }: { locale: Basic60Locale }) => <article id="market-overview" aria-label="market overview"><h2>{locale === "en" ? "Renewable energy market overview" : "新能源市场概述"}</h2></article>);
    mocks.energyCharts.mockReset().mockImplementation(({ locale }: { locale: Basic60Locale; metrics: Basic60Metric[]; countryCode: string }) => <section aria-label="energy charts"><h2>{locale === "en" ? "Energy structure" : "能源结构"}</h2></section>);
    mocks.macroCharts.mockReset().mockImplementation(({ locale }: { locale: Basic60Locale; metrics: Basic60Metric[]; countryCode: string }) => <section aria-label="macro charts"><h2>{locale === "en" ? "Macroeconomic trends" : "宏观经济趋势"}</h2></section>);
  });

  afterEach(() => { vi.unstubAllEnvs(); });

  it.each([
    ["zh-CN", "返回首页地图"],
    ["en", "Back to homepage map"],
  ])("links to the overseas overview in %s without a hardcoded count", async (locale, back) => {
    mocks.getRequestLocale.mockResolvedValue(locale);

    render(await Basic60CountryDetailPage({ params: Promise.resolve({ code: "BRA" }) }));

    expect(screen.getByRole("link", { name: back })).toHaveAttribute("href", "/?country=BRA#markets");
    expect(screen.queryByText(/60国|60-country/)).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(locale === "en" ? "Data is temporarily unavailable" : "暂时无法加载数据");
    expect(screen.queryByText("temporarily unavailable", { exact: true })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: locale === "en" ? "Retry" : "重新加载" }).closest("form")).toHaveAttribute("action", "/countries/BRA");
    expect(mocks.energyCharts).not.toHaveBeenCalled();
    expect(mocks.macroCharts).not.toHaveBeenCalled();
    expect(mocks.notFound).not.toHaveBeenCalled();
  });

  it.each(["zh-CN", "en"] as const)("places one independently loaded overview before unchanged charts and retains expandable country details in %s", async (locale) => {
    mocks.getRequestLocale.mockResolvedValue(locale);
    mocks.getBasic60Country.mockResolvedValue({ meta, data: country });

    const { container } = render(await Basic60CountryDetailPage({ params: Promise.resolve({ code: "ZAF" }) }));

    expect(screen.getByRole("heading", { level: 1, name: locale === "en" ? "South Africa" : "南非" })).toBeInTheDocument();
    expect(container.querySelector(".country-detail-subtitle")).toHaveTextContent(locale === "en" ? "南非 · Africa · ZAF" : "South Africa · 非洲 · ZAF");
    expect(container.querySelector(".country-code-large")).toBeNull();
    expect(container.querySelector(".basic60-metric-grid")).toBeNull();
    expect(screen.getByText("2026-08-26")).not.toBeVisible();
    const disclosure = container.querySelector("details");
    expect(disclosure).not.toHaveAttribute("open");
    await userEvent.click(screen.getByText(locale === "en" ? "More country details" : "更多国家档案"));
    expect(disclosure).toHaveAttribute("open");
    const details = within(disclosure as HTMLDetailsElement);
    expect(details.getByText("2026-08-26")).toBeVisible();
    expect(details.getByText(locale === "en" ? "Administrative capital" : "行政首都")).toBeVisible();
    expect(details.getByText(locale === "en" ? "Legislative capital" : "立法首都")).toBeVisible();
    expect(details.getByText(locale === "en" ? "Judicial capital" : "司法首都")).toBeVisible();
    expect(details.getByText("Cape Town")).toBeVisible();
    expect(details.getByText("Bloemfontein")).toBeVisible();
    expect(details.getByText("Africa/Johannesburg")).toBeVisible();
    expect(details.getByText("English")).toBeVisible();
    expect(details.getByText("Zulu")).toBeVisible();
    expect(details.getByText("isiZulu")).toBeVisible();
    expect(details.getByText("ISO2 · ZA")).toBeVisible();
    expect(details.getByText("ISO3 · ZAF")).toBeVisible();
    expect(details.getByText("9 · province")).toBeVisible();
    expect(details.getByText("Republic of South Africa")).toBeVisible();
    expect(container).not.toHaveTextContent("und-01");
    expect(container).not.toHaveTextContent(/BASIC60|Basic|审核|发布|pending|unknown|private.?trial|reviewed|no_reliable/i);
    expect(container).not.toHaveTextContent(/用电需求|Electricity demand|0 GWh/i);
    expect(container).not.toHaveTextContent(locale === "en" ? "Coming soon" : "即将上线");
    expect(container.querySelector(".country-assessment")).toBeNull();
    expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual(locale === "en"
      ? ["Renewable energy market overview", "Energy structure", "Macroeconomic trends"]
      : ["新能源市场概述", "能源结构", "宏观经济趋势"]);
    expect(mocks.energyCharts.mock.calls[0][0]).toEqual({ metrics: country.energy, locale, countryCode: "ZAF" });
    expect(mocks.macroCharts.mock.calls[0][0]).toEqual({ metrics: country.macro, locale, countryCode: "ZAF" });
    expect(mocks.loadOverview).toHaveBeenCalledExactlyOnceWith("ZAF", locale);
    expect(mocks.marketOverview).toHaveBeenCalledOnce();
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(container.querySelector(".country-profile-summary")?.nextElementSibling).toHaveAttribute("id", "market-overview");
    expect(container.querySelector('a[href*="market-report"]')).toBeNull();
    expect(screen.getByRole("link", { name: locale === "en" ? "Back to homepage map" : "返回首页地图" })).toHaveAttribute("href", "/?country=ZAF#markets");
    expect(screen.getByRole("link", { name: locale === "en" ? "Expansion tools" : "出海工具" })).toHaveAttribute("href", "/tools?country=ZAF");
    expect(screen.getByRole("link", { name: locale === "en" ? "Partners" : "合作伙伴" })).toHaveAttribute("href", "/partners?country=ZAF");
    expect(container.querySelector('a[href*="compare"]')).toBeNull();
  });

  it("keeps private detail actions inside the protected base path", async () => {
    vi.stubEnv("NAVIGATOR_RUNTIME_PROFILE", "basic60_private");
    mocks.getRequestLocale.mockResolvedValue("en");
    mocks.getBasic60Country.mockResolvedValue({ meta, data: country });
    render(await Basic60CountryDetailPage({ params: Promise.resolve({ code: "ZAF" }) }));
    expect(screen.getByRole("link", { name: "Back to homepage map" })).toHaveAttribute("href", "/basic60?country=ZAF#markets");
    expect(screen.getByRole("link", { name: "Expansion tools" })).toHaveAttribute("href", "/basic60/tools?country=ZAF");
    expect(screen.getByRole("link", { name: "Partners" })).toHaveAttribute("href", "/basic60/partners?country=ZAF");
    expect(mocks.marketOverview.mock.calls[0][0]).toMatchObject({ locale: "en" });
  });

  it.each(["CHN", "chn", "CN", "../../", "IDN%2Ffoo", "INDONESIA"])("rejects excluded or malformed country %s before requesting data", async (code) => {
    mocks.getRequestLocale.mockResolvedValue("zh-CN");

    await expect(
      Basic60CountryDetailPage({ params: Promise.resolve({ code }) }),
    ).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");

    expect(mocks.getBasic60Country).not.toHaveBeenCalled();
    expect(mocks.loadOverview).not.toHaveBeenCalled();
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });

  it("preserves an upstream 404 for a syntactically valid unknown country", async () => {
    mocks.getRequestLocale.mockResolvedValue("en");
    mocks.getBasic60Country.mockRejectedValue(new Basic60ApiError("not a target market", 404));
    await expect(Basic60CountryDetailPage({ params: Promise.resolve({ code: "ZZZ" }) })).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
    expect(mocks.getBasic60Country).toHaveBeenCalledWith("ZZZ", "en");
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });

  it("normalizes lower-case country codes and broad regions without changing source data", async () => {
    const asiaCountry = { ...country, code: "IDN", iso2: "ID", region_code: "Southeast Asia" };
    mocks.getRequestLocale.mockResolvedValue("zh-CN");
    mocks.getBasic60Country.mockResolvedValue({ meta, data: asiaCountry });
    const { container } = render(await Basic60CountryDetailPage({ params: Promise.resolve({ code: "idn" }) }));
    expect(mocks.getBasic60Country).toHaveBeenCalledWith("IDN", "zh-CN");
    expect(container.querySelector(".country-detail-subtitle")).toHaveTextContent("亚洲 · IDN");
    expect(container.querySelector(".country-detail-subtitle")).not.toHaveTextContent("Southeast Asia");
    expect(asiaCountry.region_code).toBe("Southeast Asia");
  });

  it.each([
    { label: "null", metrics: null },
    { label: "undefined", metrics: undefined },
    { label: "empty", metrics: [] },
  ])("passes $label metric collections to chart empty states without synthesizing observations", async ({ metrics }) => {
    mocks.getRequestLocale.mockResolvedValue("en");
    mocks.getBasic60Country.mockResolvedValue({ meta, data: { ...country, macro: metrics, energy: metrics } });
    render(await Basic60CountryDetailPage({ params: Promise.resolve({ code: "ZAF" }) }));
    expect(mocks.energyCharts.mock.calls[0][0]).toEqual({ metrics: [], locale: "en", countryCode: "ZAF" });
    expect(mocks.macroCharts.mock.calls[0][0]).toEqual({ metrics: [], locale: "en", countryCode: "ZAF" });
  });

  it("keeps the retry in the private path and does not expose an unexpected error", async () => {
    vi.stubEnv("NAVIGATOR_RUNTIME_PROFILE", "basic60_private");
    mocks.getRequestLocale.mockResolvedValue("en");
    mocks.getBasic60Country.mockRejectedValue(new Error("internal source license record"));
    const { container } = render(await Basic60CountryDetailPage({ params: Promise.resolve({ code: "ZAF" }) }));
    expect(screen.getByRole("button", { name: "Retry" }).closest("form")).toHaveAttribute("action", "/basic60/countries/ZAF");
    expect(container).not.toHaveTextContent("internal source license record");
  });

  it("does not wait for the overview before returning the real country charts", async () => {
    const pendingOverview = new Promise(() => {});
    mocks.loadOverview.mockReturnValue(pendingOverview);
    mocks.marketOverview.mockImplementation(() => { throw pendingOverview; });
    mocks.getRequestLocale.mockResolvedValue("en");
    mocks.getBasic60Country.mockResolvedValue({ meta, data: country });
    render(await Basic60CountryDetailPage({ params: Promise.resolve({ code: "ZAF" }) }));
    expect(screen.getByRole("heading", { name: "Energy structure" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Macroeconomic trends" })).toBeInTheDocument();
    expect(mocks.marketOverview.mock.calls[0][0].result).toBe(pendingOverview);
    expect(screen.getByRole("status")).toHaveTextContent("Loading renewable energy market overview");
  });
});
