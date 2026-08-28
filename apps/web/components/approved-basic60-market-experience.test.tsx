import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovedBasic60MarketExperience, type HomeMarket } from "@/components/approved-basic60-market-experience";
import type { CountryGlobeMarker } from "@/components/country-globe";
import type { Basic60Locale } from "@/lib/basic60/types";
import { LocaleProvider } from "@/lib/i18n/client";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, useSearchParams: () => new URLSearchParams(window.location.search) }));
vi.mock("next/dynamic", () => ({
  default: () => function MockGlobe({ markers, selectedCode, focusCode, showLocator, onSelect, onOpenCountry }: {
    markers: readonly CountryGlobeMarker[];
    selectedCode: string;
    focusCode?: string;
    showLocator?: boolean;
    onSelect: (code: string) => void;
    onOpenCountry: (code: string) => void;
  }) {
    return <div data-testid="globe" data-selected={selectedCode} data-focus={focusCode} data-locator={String(showLocator)}>
      {markers.map((marker) => <button key={marker.code} onClick={() => onSelect(marker.code)} onDoubleClick={() => onOpenCountry(marker.code)}>{marker.name}</button>)}
    </div>;
  },
}));

const market = (code: string, name: string, region: string): HomeMarket => ({
  code, name, alternateName: code, region, featuredMetrics: [],
});
const countries: HomeMarket[] = [
  { ...market("IDN", "印度尼西亚", "Southeast Asia"), featuredMetrics: [{ code: "renewable_capacity_mw", label: "可再生能源装机", value: "14,300 MW", period: "2024" }] },
  market("VNM", "越南", "Southeast Asia"),
  market("BRA", "巴西", "Latin America"),
  market("CHN", "中国", "East Asia"),
  market("KAZ", "哈萨克斯坦", "Central Asia"),
  market("SAU", "沙特阿拉伯", "Middle East"),
  market("DEU", "德国", "Europe"),
  market("TUR", "土耳其", "Europe / West Asia"),
  market("KEN", "肯尼亚", "East Africa"),
  market("NGA", "尼日利亚", "West Africa"),
  market("USA", "美国", "North America"),
  market("AUS", "澳大利亚", "Oceania"),
];
function show({ locale = "zh-CN", initialCountryCode = "", dataStatus = "ready", basePath = "", markets = countries }: {
  locale?: Basic60Locale;
  initialCountryCode?: string;
  dataStatus?: "ready" | "error" | "empty" | "loading";
  basePath?: "" | "/basic60";
  markets?: HomeMarket[];
} = {}) {
  return render(<LocaleProvider initialLocale={locale}><ApprovedBasic60MarketExperience countries={markets} locale={locale} initialCountryCode={initialCountryCode} dataStatus={dataStatus} basePath={basePath} /></LocaleProvider>);
}

describe("Navigator product home", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, "", "/");
  });

  it("starts in a global view with the approved positioning and three tool groups", () => {
    const { container } = show();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("从看清全球市场，到推动项目落地");
    expect(container).toHaveTextContent("提供市场研究、政策分析、出海工具与合作伙伴服务");
    expect(screen.getByTestId("globe")).toHaveAttribute("data-selected", "");
    expect(screen.getByTestId("globe")).toHaveAttribute("data-focus", "");
    expect(screen.getByTestId("globe")).toHaveAttribute("data-locator", "false");
    expect(screen.getByRole("combobox", { name: "国家" })).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "洲 / 主要区域" })).toHaveValue("");
    for (const title of ["AI出海顾问", "项目方案制作", "项目投标机会"]) {
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    }
    expect(screen.getAllByText("即将上线")).toHaveLength(3);
    expect(screen.queryByRole("link", { name: "查看国家数据" })).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/国家比较|市场比较|已审核|Basic|[0-9]+个海外市场|指标数量|可用指标/);
    expect(screen.getByRole("link", { name: "了解功能 · 项目方案制作" })).toHaveAttribute("href", "/tools#project-planning");
  });

  it("filters broad regions without automatically choosing a country", async () => {
    const user = userEvent.setup();
    show();
    const regions = screen.getByRole("combobox", { name: "洲 / 主要区域" });
    const select = screen.getByRole("combobox", { name: "国家" });
    expect(within(regions).getAllByRole("option").map((option) => option.textContent)).toEqual(["全部区域", "亚洲", "中东", "欧洲", "非洲", "北美洲", "拉丁美洲", "大洋洲"]);
    expect(screen.queryByRole("option", { name: "中国" })).not.toBeInTheDocument();
    await user.selectOptions(regions, "Asia");
    expect(select).toHaveValue("");
    expect(within(select).getAllByRole("option").map((option) => option.textContent)).toEqual(["请选择国家", "哈萨克斯坦", "印度尼西亚", "越南"]);
    await user.selectOptions(select, "IDN");
    expect(screen.getByTestId("globe")).toHaveAttribute("data-focus", "IDN");
    expect(screen.getByRole("link", { name: "查看印度尼西亚数据" })).toHaveAttribute("href", "/countries/IDN");
    expect(window.location.search).toBe("?country=IDN");
    expect(screen.queryByText("14,300 MW")).not.toBeInTheDocument();
    expect(screen.queryByText("2024")).not.toBeInTheDocument();
    await user.selectOptions(regions, "Europe");
    expect(select).toHaveValue("");
    expect(screen.getByTestId("globe")).toHaveAttribute("data-selected", "");
    expect(window.location.search).toBe("");
  });

  it("selects from the globe without moving its camera, and opens only on double-click", async () => {
    const user = userEvent.setup();
    show();
    await user.selectOptions(screen.getByRole("combobox", { name: "国家" }), "IDN");
    await user.click(screen.getByRole("button", { name: "德国" }));
    expect(screen.getByRole("combobox", { name: "洲 / 主要区域" })).toHaveValue("Europe");
    expect(screen.getByRole("combobox", { name: "国家" })).toHaveValue("DEU");
    expect(screen.getByTestId("globe")).toHaveAttribute("data-focus", "");
    expect(router.push).not.toHaveBeenCalled();
    await user.dblClick(screen.getByRole("button", { name: "德国" }));
    expect(router.push).toHaveBeenCalledExactlyOnceWith("/countries/DEU");
  });

  it("propagates the selected market to tools, partners and project-planning anchors", async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole("button", { name: "巴西" }));
    expect(screen.getByRole("link", { name: "进入出海工具" })).toHaveAttribute("href", "/tools?country=BRA");
    expect(screen.getByRole("link", { name: "了解合作伙伴" })).toHaveAttribute("href", "/partners?country=BRA");
    expect(screen.getByRole("link", { name: "了解功能 · 项目方案制作" })).toHaveAttribute("href", "/tools?country=BRA#project-planning");
    expect(screen.getAllByRole("link").some((link) => /compare|policies|risks/.test(link.getAttribute("href") ?? ""))).toBe(false);
  });

  it("uses Next-compatible history state and does not refocus a map selection", async () => {
    const user = userEvent.setup();
    const replaceState = vi.spyOn(window.history, "replaceState");
    show();
    await user.click(screen.getByRole("button", { name: "巴西" }));
    expect(replaceState).toHaveBeenLastCalledWith(null, "", "/?country=BRA");
    expect(screen.getByTestId("globe")).toHaveAttribute("data-focus", "");
    replaceState.mockRestore();
  });

  it("synchronizes same-instance route changes and subsequent server props", () => {
    const view = show({ initialCountryCode: "IDN" });
    const home = (code: string) => <LocaleProvider initialLocale="zh-CN"><ApprovedBasic60MarketExperience countries={countries} locale="zh-CN" initialCountryCode={code} /></LocaleProvider>;
    view.rerender(home("BRA"));
    expect(screen.getByRole("combobox", { name: "国家" })).toHaveValue("BRA");
    expect(screen.getByTestId("globe")).toHaveAttribute("data-focus", "BRA");
    window.history.replaceState(null, "", "/?country=DEU");
    view.rerender(home("BRA"));
    expect(screen.getByRole("combobox", { name: "国家" })).toHaveValue("DEU");
    window.history.replaceState(null, "", "/?country=CHN");
    view.rerender(home("BRA"));
    expect(screen.getByRole("combobox", { name: "国家" })).toHaveValue("");
  });

  it("restores a deep-linked market and browser-back selection", () => {
    show({ initialCountryCode: "bra" });
    expect(screen.getByRole("combobox", { name: "国家" })).toHaveValue("BRA");
    act(() => {
      window.history.replaceState({}, "", "/?country=DEU#markets");
      fireEvent.popState(window);
    });
    expect(screen.getByRole("combobox", { name: "国家" })).toHaveValue("DEU");
    expect(screen.getByRole("combobox", { name: "洲 / 主要区域" })).toHaveValue("Europe");
    expect(screen.getByTestId("globe")).toHaveAttribute("data-focus", "DEU");
  });

  it.each(["CHN", "ZZZ", "../IDN", "IDN<script>"])("does not select or propagate invalid initial country %s", (initialCountryCode) => {
    show({ initialCountryCode });
    expect(screen.getByTestId("globe")).toHaveAttribute("data-selected", "");
    expect(screen.getAllByRole("link").some((link) => link.getAttribute("href")?.includes("country="))).toBe(false);
    expect(screen.queryByRole("button", { name: "中国" })).not.toBeInTheDocument();
  });

  it.each(["error", "empty"] as const)("preserves the landing page and a working retry for %s data", async (dataStatus) => {
    const user = userEvent.setup();
    show({ dataStatus, markets: [] });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("从看清全球市场");
    expect(screen.getByRole("alert")).toHaveTextContent(dataStatus === "error" ? "国家数据暂时无法加载" : "暂无可展示的国家数据");
    expect(screen.queryByTestId("globe")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "进入出海工具" })).toHaveAttribute("href", "/tools");
    await user.click(screen.getByRole("button", { name: "重新加载数据" }));
    expect(router.refresh).toHaveBeenCalledOnce();
  });

  it("keeps the service introduction and tool links usable while data is loading", () => {
    show({ dataStatus: "loading", markets: [] });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("从看清全球市场");
    expect(screen.getByRole("status")).toHaveTextContent("正在加载国家数据");
    expect(screen.getByRole("link", { name: "进入出海工具" })).toHaveAttribute("href", "/tools");
    expect(screen.queryByRole("button", { name: "重新加载数据" })).not.toBeInTheDocument();
  });

  it("has equivalent English copy with no internal states or covered-country counts", () => {
    const { container } = show({ locale: "en" });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("From global market insight");
    expect(screen.getByRole("combobox", { name: "Continent / major region" })).toHaveValue("");
    expect(screen.getByRole("heading", { name: "AI Expansion Advisor" })).toBeInTheDocument();
    expect(screen.getAllByText("Coming soon")).toHaveLength(3);
    expect(container.textContent).not.toMatch(/Basic|reviewed|approved|comparison|release|\d+ overseas markets/i);
  });

  it("keeps legacy private paths within the authenticated surface", async () => {
    const user = userEvent.setup();
    show({ basePath: "/basic60", initialCountryCode: "IDN" });
    expect(screen.getByRole("link", { name: "查看印度尼西亚数据" })).toHaveAttribute("href", "/basic60/countries/IDN");
    expect(screen.getByRole("link", { name: "进入出海工具" })).toHaveAttribute("href", "/basic60/tools?country=IDN");
    await user.dblClick(screen.getByRole("button", { name: "巴西" }));
    expect(router.push).toHaveBeenCalledExactlyOnceWith("/basic60/countries/BRA");
  });

  it("clears a country independently while retaining the chosen region", async () => {
    const user = userEvent.setup();
    show({ initialCountryCode: "IDN" });
    await user.selectOptions(screen.getByRole("combobox", { name: "国家" }), "");
    expect(screen.getByRole("combobox", { name: "洲 / 主要区域" })).toHaveValue("Asia");
    expect(screen.getByRole("combobox", { name: "国家" })).toHaveValue("");
    expect(screen.getByRole("link", { name: "开始探索目标市场" })).toHaveAttribute("href", "/#markets");
  });

  it.each([
    { locale: "zh-CN", selected: false },
    { locale: "zh-CN", selected: true },
    { locale: "en", selected: false },
    { locale: "en", selected: true },
  ] as const)("removes only the hero actions and country summary in $locale with selected=$selected", ({ locale, selected }) => {
    const english = locale === "en";
    const countryName = english ? "Indonesia" : "印度尼西亚";
    const markets: HomeMarket[] = [{
      ...market("IDN", countryName, "Southeast Asia"),
      alternateName: english ? "印度尼西亚" : "Indonesia",
      featuredMetrics: [
        { code: "renewable_capacity_mw", label: english ? "Renewable capacity" : "可再生能源装机", value: "14,300 MW", period: "2024" },
        { code: "renewable_share_generation_pct", label: english ? "Renewable generation share" : "可再生能源发电占比", value: "18.55%", period: "2023" },
      ],
    }];
    const { container } = show({ locale, initialCountryCode: selected ? "IDN" : "", markets });
    const hero = container.querySelector(".landing-hero") as HTMLElement;
    const heroQueries = within(hero);
    expect(hero.querySelector(".landing-actions")).toBeNull();
    expect(heroQueries.queryByRole("link", { name: english ? "Explore target markets" : "探索目标市场" })).not.toBeInTheDocument();
    expect(heroQueries.queryByRole("link", { name: english ? "Explore expansion tools" : "了解出海工具" })).not.toBeInTheDocument();
    expect(hero.querySelector(".home-market-selection")).toBeNull();
    expect(hero.querySelector(".approved-basic60-country-identity")).toBeNull();
    expect(hero.querySelector(".approved-basic60-featured-metrics")).toBeNull();
    expect(hero.querySelector(".home-selection-hint")).toBeNull();
    expect(heroQueries.queryByRole("link", { name: english ? "View country data" : "查看国家数据" })).not.toBeInTheDocument();
    expect(heroQueries.queryByText("IDN", { exact: true })).not.toBeInTheDocument();
    expect(heroQueries.queryByText("14,300 MW")).not.toBeInTheDocument();
    expect(heroQueries.queryByText("18.55%")).not.toBeInTheDocument();
    expect(heroQueries.queryByText(english
      ? "Choose a country on the globe or use the selectors to explore your target market."
      : "从地球或筛选框选择国家，开始了解目标市场。")).not.toBeInTheDocument();

    expect(heroQueries.getByTestId("globe")).toHaveAttribute("data-selected", selected ? "IDN" : "");
    expect(heroQueries.getByRole("combobox", { name: english ? "Country" : "国家" })).toHaveValue(selected ? "IDN" : "");
    expect(heroQueries.getByRole("combobox", { name: english ? "Continent / major region" : "洲 / 主要区域" })).toHaveValue(selected ? "Asia" : "");
    expect(heroQueries.getByText(english ? "Click to select a country. Double-click to view its data." : "单击选择国家，双击查看国家数据。")).toBeInTheDocument();

    const flow = within(container.querySelector(".home-service-flow") as HTMLElement);
    expect(flow.getAllByRole("listitem")).toHaveLength(3);
    expect(flow.getByRole("link", { name: selected ? (english ? "View country data" : "查看国家数据") : (english ? "Choose a target market" : "选择目标市场") })).toHaveAttribute("href", selected ? "/countries/IDN" : "#markets");
    expect(flow.getByRole("link", { name: english ? "Explore expansion tools" : "进入出海工具" })).toHaveAttribute("href", selected ? "/tools?country=IDN" : "/tools");
    expect(flow.getByRole("link", { name: english ? "Explore partners" : "进入合作伙伴" })).toHaveAttribute("href", selected ? "/partners?country=IDN" : "/partners");
    expect(screen.getByRole("link", { name: english ? "Explore feature · Project Planning" : "了解功能 · 项目方案制作" })).toHaveAttribute("href", selected ? "/tools?country=IDN#project-planning" : "/tools#project-planning");

    const closing = within(container.querySelector(".home-closing") as HTMLElement);
    const closingLabel = selected ? (english ? `View data for ${countryName}` : `查看${countryName}数据`) : (english ? "Start exploring markets" : "开始探索目标市场");
    expect(closing.getByRole("link", { name: closingLabel })).toHaveAttribute("href", selected ? "/countries/IDN" : "/#markets");
  });
});
