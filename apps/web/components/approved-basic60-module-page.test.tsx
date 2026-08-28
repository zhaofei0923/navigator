import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApprovedBasic60ModulePage, ApprovedBasic60ToolPlaceholder, ApprovedBasic60ToolsHub, approvedBasic60CountryParam } from "@/components/approved-basic60-module-page";

const INTERNAL = /BASIC60|已审核|已批准|合成数据|模块预览|\bBasic\b|\bdemo\b|\bsynthetic\b|\bapproved\b|\breviewed\b/i;
const FEATURES = [
  { step: "assistant", zh: "AI出海顾问", en: "AI Expansion Advisor" },
  { step: "solar-storage", zh: "光储方案", en: "Solar & Storage Concept" },
  { step: "feasibility", zh: "可研报告", en: "Feasibility Report" },
  { step: "tenders", zh: "项目投标机会", en: "Project & Tender Opportunities" },
] as const;

describe("three expansion tool groups and partners", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(["zh-CN", "en"] as const)("renders three tools with nested project-planning tasks in %s", (locale) => {
    const zh = locale === "zh-CN";
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { container } = render(<ApprovedBasic60ToolsHub locale={locale} countryCode="idn" />);
    expect(screen.getByRole("heading", { level: 1, name: zh ? "出海工具" : "Expansion tools" })).toBeInTheDocument();
    const groups = screen.getByRole("list", { name: zh ? "三个出海工具方向" : "Three expansion tool areas" });
    expect(within(groups).getAllByRole("listitem")).toHaveLength(3);
    expect(within(groups).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "/tools/assistant?country=IDN", "/tools?country=IDN#project-planning", "/tools/tenders?country=IDN",
    ]);
    const planning = screen.getByRole("region", { name: zh ? "项目方案制作" : "Project Planning" });
    expect(within(planning).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "/tools/solar-storage?country=IDN", "/tools/feasibility?country=IDN",
    ]);
    expect(screen.getByLabelText(zh ? "目标市场" : "Target market")).toHaveTextContent("IDN");
    expect(container.textContent).not.toMatch(INTERNAL);
    expect(screen.getAllByRole("link").some((link) => /compare|policies|risks/.test(link.getAttribute("href") ?? ""))).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each(FEATURES.flatMap((feature) => [
    { ...feature, locale: "zh-CN" as const, title: feature.zh },
    { ...feature, locale: "en" as const, title: feature.en },
  ]))("keeps $step as an honest planned feature in $locale", ({ step, locale, title }) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { container } = render(<ApprovedBasic60ToolPlaceholder step={step} locale={locale} countryCode="BRA" />);
    expect(screen.getByRole("heading", { level: 1, name: title })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(locale === "zh-CN" ? "即将上线" : "Coming soon");
    const journey = screen.getByRole("navigation");
    expect(within(journey).getAllByRole("link")).toHaveLength(3);
    expect(screen.getByRole("link", { name: locale === "zh-CN" ? /返回首页地图/ : /Back to the home map/ })).toHaveAttribute("href", "/?country=BRA#markets");
    expect(container.querySelector("input, textarea")).toBeNull();
    expect(container.textContent).not.toMatch(INTERNAL);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each(["zh-CN", "en"] as const)("keeps partners as a planned service with country context in %s", (locale) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { container } = render(<ApprovedBasic60ModulePage kind="partners" locale={locale} countryCode="IDN" />);
    expect(screen.getByRole("heading", { level: 1, name: locale === "zh-CN" ? "合作伙伴" : "Partners" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(locale === "zh-CN" ? "伙伴名录与对接功能正在建设中" : "Partner profiles and connection services are in development");
    expect(container.textContent).not.toMatch(INTERNAL);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each(["CHN", "bad-code", "../IDN"])("does not propagate invalid country %s", (countryCode) => {
    render(<ApprovedBasic60ToolsHub locale="zh-CN" countryCode={countryCode} />);
    expect(screen.getByLabelText("目标市场")).toHaveTextContent("尚未选择目标市场");
    expect(screen.getAllByRole("link").some((link) => link.getAttribute("href")?.includes("country="))).toBe(false);
  });

  it("keeps all compatibility links within the private route prefix", () => {
    render(<ApprovedBasic60ToolsHub locale="zh-CN" countryCode="BRA" basePath="/basic60" />);
    expect(screen.getByRole("link", { name: "了解功能 · 项目方案制作" })).toHaveAttribute("href", "/basic60/tools?country=BRA#project-planning");
    expect(screen.getByRole("link", { name: "了解功能 · 光储方案" })).toHaveAttribute("href", "/basic60/tools/solar-storage?country=BRA");
    expect(screen.getByRole("link", { name: /返回首页地图/ })).toHaveAttribute("href", "/basic60?country=BRA#markets");
  });

  it("normalizes repeated country parameters without accepting China", () => {
    expect(approvedBasic60CountryParam([" idn ", "BRA"])).toBe("IDN");
    expect(approvedBasic60CountryParam("CHN")).toBeNull();
    expect(approvedBasic60CountryParam(undefined)).toBeNull();
    expect(approvedBasic60CountryParam("invalid")).toBeNull();
  });
});
