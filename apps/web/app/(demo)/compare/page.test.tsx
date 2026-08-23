import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ComparePage from "./page";
import { LocaleProvider } from "@/lib/i18n";
import type { ComparisonResult, CountrySummary, DemoEnvelope } from "@/lib/types";

const mocks = vi.hoisted(() => ({
  useDemoQuery: vi.fn(),
  demoApi: vi.fn(),
  refresh: vi.fn(),
  reload: vi.fn(),
  search: "countries=KEN,ZAF",
}));

vi.mock("@/hooks/use-demo-query", () => ({ useDemoQuery: mocks.useDemoQuery }));
vi.mock("@/lib/api-client", () => ({ demoApi: mocks.demoApi }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
  useSearchParams: () => new URLSearchParams(mocks.search),
}));
vi.mock("next/dynamic", () => ({
  default: () => function MockRadar() {
    return <div data-testid="comparison-radar" />;
  },
}));

const summaries: CountrySummary[] = [
  countrySummary("ZAF", "南非", "South Africa"),
  countrySummary("KEN", "肯尼亚", "Kenya"),
];

describe("ComparePage decision view", () => {
  beforeEach(() => {
    mocks.useDemoQuery.mockReset();
    mocks.demoApi.mockReset();
    mocks.search = "countries=KEN,ZAF";
    mocks.useDemoQuery.mockReturnValue({
      data: summaries,
      loading: false,
      error: null,
      reload: mocks.reload,
    });
    mocks.demoApi.mockResolvedValue(comparisonEnvelope("zh-CN"));
  });

  it("keeps requested A/B identity, labels dimension leaders, and exposes a market-scoped next step", async () => {
    render(
      <LocaleProvider initialLocale="zh-CN">
        <ComparePage />
      </LocaleProvider>,
    );

    await waitFor(() => expect(mocks.demoApi).toHaveBeenCalledWith(
      "demo/country-comparisons?locale=zh-CN",
      expect.objectContaining({ body: JSON.stringify({ country_codes: ["KEN", "ZAF"] }) }),
    ));

    expect(await screen.findByRole("heading", { name: "市场身份与总体判断" })).toBeInTheDocument();
    expect(screen.getByRole("meter", { name: "市场 A · KEN · 市场吸引力" })).toHaveAttribute("aria-valuenow", "82");
    expect(screen.getAllByText("本维度领先").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: /继续 AI 判断/ })[0].getAttribute("href")).toMatch(/^\/tools\/assistant\?country=(ZAF|KEN)$/);
    expect(screen.getByText(/不构成投资建议/)).toBeInTheDocument();
  });

  it("renders comparison structure in English while preserving the query selection", async () => {
    mocks.demoApi.mockResolvedValue(comparisonEnvelope("en"));
    render(
      <LocaleProvider initialLocale="en">
        <ComparePage />
      </LocaleProvider>,
    );

    expect(await screen.findByRole("heading", { name: "Market identity and overall view" })).toBeInTheDocument();
    expect(screen.getByRole("meter", { name: "Market A · KEN · Market attractiveness" })).toBeInTheDocument();
    expect(screen.getAllByText("Dimension leader").length).toBeGreaterThan(0);
    expect(screen.queryByText("本维度领先")).not.toBeInTheDocument();
  });
});

function countrySummary(code: string, nameZh: string, nameEn: string): CountrySummary {
  return {
    data_origin: "synthetic_demo",
    code,
    name_zh: nameZh,
    name_en: nameEn,
    region: "Demo region",
    currency: "DEM",
    summary: "Synthetic summary",
    scores: scores(code === "KEN" ? 82 : 74),
    dimension_deltas: {},
  };
}

function comparisonEnvelope(locale: "zh-CN" | "en"): DemoEnvelope<ComparisonResult> {
  return {
    meta: {
      data_origin: "synthetic_demo",
      disclaimer: locale === "en" ? "Demo Data / Non-official Conclusions" : "演示数据 / 非正式结论",
      locale,
    },
    data: {
      data_origin: "synthetic_demo",
      comparison_id: "comparison-demo",
      recommendation: locale === "en" ? "Research Kenya first" : "优先研究肯尼亚",
      methodology: locale === "en" ? "Synthetic comparison method" : "合成对比方法",
      countries: [
        {
          data_origin: "synthetic_demo",
          rank: 1,
          country_code: "ZAF",
          name_zh: "南非",
          name_en: "South Africa",
          scores: scores(74),
          dimension_deltas: {},
          trend: locale === "en" ? "Stable" : "保持稳定",
          overall_score: 76,
          reason: locale === "en" ? "Synthetic South Africa reason" : "南非合成理由",
        },
        {
          data_origin: "synthetic_demo",
          rank: 2,
          country_code: "KEN",
          name_zh: "肯尼亚",
          name_en: "Kenya",
          scores: scores(82),
          dimension_deltas: {},
          trend: locale === "en" ? "Improving" : "持续改善",
          overall_score: 79,
          reason: locale === "en" ? "Synthetic Kenya reason" : "肯尼亚合成理由",
        },
      ],
    },
  };
}

function scores(marketAttractiveness: number) {
  return {
    market_attractiveness: marketAttractiveness,
    policy_certainty: 72,
    project_activity: 70,
    partner_maturity: 68,
    risk_controllability: 64,
  };
}
