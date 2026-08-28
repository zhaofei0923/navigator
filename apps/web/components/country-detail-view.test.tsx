import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CountryDetailView } from "@/components/country-detail-view";
import { LocaleProvider } from "@/lib/i18n";
import type { CountryDetail } from "@/lib/types";

const mocks = vi.hoisted(() => ({
  useDemoQuery: vi.fn(),
  refresh: vi.fn(),
  reload: vi.fn(),
}));

vi.mock("@/hooks/use-demo-query", () => ({ useDemoQuery: mocks.useDemoQuery }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("next/dynamic", () => ({
  default: () => function MockRadar() {
    return <div data-testid="radar-visualization" />;
  },
}));

const country: CountryDetail = {
  data_origin: "synthetic_demo",
  code: "ZAF",
  name_zh: "南非",
  name_en: "South Africa",
  region: "Southern Africa",
  currency: "ZAR",
  summary: "Synthetic market summary",
  scores: {
    market_attractiveness: 82,
    policy_certainty: 70,
    project_activity: 78,
    partner_maturity: 74,
    risk_controllability: 63,
  },
  dimension_deltas: { market_attractiveness: 2 },
  signals: [],
  reasons: [{
    data_origin: "synthetic_demo",
    reason_id: "reason-1",
    country_code: "ZAF",
    kind: "market",
    title: "Synthetic reason",
    detail: "A ranked synthetic entry reason.",
    rank: 1,
  }],
  risks: [{
    data_origin: "synthetic_demo",
    risk_id: "risk-1",
    country_code: "ZAF",
    title: "Synthetic risk",
    category: "delivery",
    severity: 3,
    likelihood: 2,
    detail: "A synthetic delivery risk.",
    mitigation: "Review locally.",
  }],
  actions: [{
    data_origin: "synthetic_demo",
    action_id: "action-1",
    country_code: "ZAF",
    priority: 1,
    title: "Validate the synthetic assumption",
    detail: "Synthetic next step",
    owner_hint: "Demo owner",
  }],
};

describe("CountryDetailView task journey", () => {
  beforeEach(() => {
    mocks.useDemoQuery.mockReset();
    mocks.useDemoQuery.mockReturnValue({
      data: country,
      loading: false,
      error: null,
      reload: mocks.reload,
    });
  });

  it("prioritizes the decision snapshot and carries ISO3 context into every related task", () => {
    render(
      <LocaleProvider initialLocale="zh-CN">
        <CountryDetailView code="ZAF" />
      </LocaleProvider>,
    );

    const judgement = screen.getByRole("heading", { name: "市场判断快照" });
    const decision = screen.getByRole("complementary", { name: "决策摘要" });
    expect(judgement.compareDocumentPosition(decision) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    expect(screen.getByRole("link", { name: /AI 市场判断/ })).toHaveAttribute("href", "/tools/assistant?country=ZAF");
    expect(screen.getByRole("link", { name: /光储方案/ })).toHaveAttribute("href", "/tools/solar-storage?country=ZAF");
    expect(screen.getByRole("link", { name: /可研草案/ })).toHaveAttribute("href", "/tools/feasibility?country=ZAF");
    expect(screen.getByRole("link", { name: /投标准备/ })).toHaveAttribute("href", "/tools/tenders?country=ZAF");
    expect(screen.getByRole("link", { name: /返回首页地图/ })).toHaveAttribute("href", "/?country=ZAF#markets");
    expect(screen.getByRole("link", { name: /出海工具/ })).toHaveAttribute("href", "/tools?country=ZAF");
    expect(screen.getByRole("link", { name: /合作伙伴/ })).toHaveAttribute("href", "/partners?country=ZAF");
    expect(screen.queryByRole("link", { name: /对比|比较/ })).not.toBeInTheDocument();
    expect(screen.getByText(/不会调用真实数据或外部模型/)).toBeInTheDocument();
  });

  it("renders the journey copy in English without resetting the market context", () => {
    render(
      <LocaleProvider initialLocale="en">
        <CountryDetailView code="ZAF" />
      </LocaleProvider>,
    );

    expect(screen.getByText("Current demo market")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Market decision snapshot" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Feasibility draft/ })).toHaveAttribute("href", "/tools/feasibility?country=ZAF");
    expect(screen.getByText(/without real data or external model calls/)).toBeInTheDocument();
    expect(screen.queryByText("继续当前市场任务")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Back to homepage map/ })).toHaveAttribute("href", "/?country=ZAF#markets");
    expect(screen.getByRole("link", { name: /Partners/ })).toHaveAttribute("href", "/partners?country=ZAF");
    expect(screen.queryByRole("link", { name: /compar/i })).not.toBeInTheDocument();
  });

  it.each(["Service unavailable", null])("provides a homepage escape for an unavailable country: %s", (error) => {
    mocks.useDemoQuery.mockReturnValue({ data: null, loading: false, error, reload: mocks.reload });
    render(<LocaleProvider initialLocale="zh-CN"><CountryDetailView code="ZAF" /></LocaleProvider>);
    expect(screen.getByRole("link", { name: /返回首页地图/ })).toHaveAttribute("href", "/?country=ZAF#markets");
    expect(screen.queryByRole("link", { name: /对比|比较/ })).not.toBeInTheDocument();
  });
});
