import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CountryMarketOverview, MarketOverviewLoading } from "@/components/country-market-content";
import { overviewFixture } from "@/test-support/market-content-fixtures";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

describe("single country market-overview article", () => {
  beforeEach(() => { router.refresh.mockReset(); });

  it.each(["zh-CN", "en"] as const)("shows one readable full-text article with original paragraph order in %s", async (locale) => {
    const envelope = overviewFixture(locale);
    const { container } = render(await CountryMarketOverview({ result: Promise.resolve({ status: "ready", envelope }), locale }));
    const article = screen.getByRole("article", { name: envelope.data.title });
    expect(article).toHaveAttribute("id", "market-overview");
    expect(article).toHaveAttribute("lang", locale);
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(within(article).getAllByRole("heading")).toHaveLength(1);
    expect(within(article).getByRole("heading", { level: 2, name: envelope.data.title })).toBeInTheDocument();
    const paragraphs = [...article.querySelectorAll(".market-overview-body > p")];
    expect(paragraphs.map((paragraph) => paragraph.textContent)).toEqual(envelope.data.paragraphs);
    for (const paragraph of envelope.data.paragraphs) expect(within(article).getByText(paragraph)).toBeVisible();
    expect(screen.getByText(envelope.data.disclaimer)).toBeVisible();
    expect(screen.getByText("2026-08-27")).toHaveAttribute("dateTime", "2026-08-27");
    expect(screen.getByRole("button", { name: locale === "en" ? "Print / Save as PDF" : "打印 / 保存为 PDF" })).toBeInTheDocument();
    expect(container.querySelector("table, details, summary, [class*=rating], [class*=score], .market-summary, .market-analysis-sections")).toBeNull();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(container).not.toHaveTextContent(/source_ref|evidence|content_version|OVERVIEW-IDN|已审核|BASIC60|Basic|risk_level|进入难度|Entry difficulty|阅读完整国别报告|Read the full country report/);
  });

  it.each([7, 8])("renders all %i paragraphs without truncation or a read-more layer", async (count) => {
    const envelope = overviewFixture("zh-CN", "IDN", count);
    const { container } = render(await CountryMarketOverview({ result: Promise.resolve({ status: "ready", envelope }), locale: "zh-CN" }));
    expect(container.querySelectorAll(".market-overview-body > p")).toHaveLength(count);
    expect(screen.getByText(envelope.data.paragraphs[count - 1])).toBeVisible();
    expect(container.querySelector("details")).toBeNull();
  });

  it("escapes text instead of converting API prose into HTML or source links", async () => {
    const envelope = overviewFixture("en");
    envelope.data.paragraphs[0] = "<script>alert('not markup')</script>";
    envelope.data.disclaimer = "<img src=x onerror=alert(1)>";
    const { container } = render(await CountryMarketOverview({ result: Promise.resolve({ status: "ready", envelope }), locale: "en" }));
    expect(screen.getByText(envelope.data.paragraphs[0])).toBeVisible();
    expect(screen.getByText(envelope.data.disclaimer)).toBeVisible();
    expect(container.querySelector("script, img, a")).toBeNull();
  });

  it.each(["zh-CN", "en"] as const)("keeps missing or revoked content neutral, anchored and retryable in %s", async (locale) => {
    const { container } = render(await CountryMarketOverview({ result: Promise.resolve({ status: "unavailable" }), locale }));
    const en = locale === "en";
    expect(screen.getByRole("article", { name: en ? "Renewable energy market overview" : "新能源市场概述" })).toHaveAttribute("id", "market-overview");
    expect(screen.getAllByRole("heading")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent(en ? "Renewable energy market overview is unavailable" : "新能源市场概述暂不可用");
    expect(screen.getByRole("status")).toHaveTextContent(en ? "Country profiles and data charts remain available independently." : "国家档案和数据图表仍可独立查看。");
    expect(container.querySelector(".market-overview-body, time")).toBeNull();
    expect(screen.queryByRole("button", { name: en ? "Print / Save as PDF" : "打印 / 保存为 PDF" })).not.toBeInTheDocument();
    expect(container).not.toHaveTextContent(/审核|草稿|撤销|revoked|draft|unpublished|source|evidence|OVERVIEW-IDN|synthetic/i);
    await userEvent.click(screen.getByRole("button", { name: en ? "Reload" : "重新加载" }));
    expect(router.refresh).toHaveBeenCalledOnce();
  });

  it("handles an unexpectedly rejected load without exposing the exception", async () => {
    const { container } = render(await CountryMarketOverview({ result: Promise.reject(new Error("private source and hash")), locale: "en" }));
    expect(screen.getByRole("status")).toHaveTextContent("Renewable energy market overview is unavailable");
    expect(container).not.toHaveTextContent(/private source|hash/);
  });

  it.each(["zh-CN", "en"] as const)("preserves the overview anchor and accessible loading state in %s", (locale) => {
    render(<MarketOverviewLoading locale={locale} />);
    expect(screen.getByRole("article", { name: locale === "en" ? "Renewable energy market overview" : "新能源市场概述" })).toHaveAttribute("id", "market-overview");
    expect(screen.getByRole("article")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent(locale === "en" ? "Loading renewable energy market overview" : "正在加载新能源市场概述");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
