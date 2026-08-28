import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AssistantToolPage from "./assistant/page";
import SolarStorageToolPage from "./solar-storage/page";
import FeasibilityToolPage from "./feasibility/page";
import TenderToolPage from "./tenders/page";
import { LocaleProvider } from "@/lib/i18n";
import type { CountrySummary } from "@/lib/types";

const mocks = vi.hoisted(() => ({ useDemoQuery: vi.fn(), demoApi: vi.fn(), reload: vi.fn(), refresh: vi.fn() }));

vi.mock("@/hooks/use-demo-query", () => ({ useDemoQuery: mocks.useDemoQuery }));
vi.mock("@/lib/api-client", () => ({ demoApi: mocks.demoApi }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("country=ZAF"),
  useRouter: () => ({ refresh: mocks.refresh }),
}));

const country: CountrySummary = {
  data_origin: "synthetic_demo",
  code: "ZAF",
  name_zh: "南非",
  name_en: "South Africa",
  region: "Southern Africa",
  currency: "ZAR",
  summary: "Synthetic market summary",
  scores: {
    market_attractiveness: 70,
    policy_certainty: 70,
    project_activity: 70,
    partner_maturity: 70,
    risk_controllability: 70,
  },
  dimension_deltas: {},
};

describe("synthetic tool journey without market comparison", () => {
  beforeEach(() => {
    mocks.useDemoQuery.mockReset();
    mocks.demoApi.mockReset();
    mocks.useDemoQuery.mockImplementation((path: string) => ({
      data: path === "countries" ? [country] : [],
      loading: false,
      error: null,
      reload: mocks.reload,
    }));
  });

  it.each(["zh-CN", "en"] as const)("removes comparison actions from all four tools in %s", (locale) => {
    const { container } = render(
      <LocaleProvider initialLocale={locale}>
        <AssistantToolPage />
        <SolarStorageToolPage />
        <FeasibilityToolPage />
        <TenderToolPage />
      </LocaleProvider>,
    );
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(4);
    expect(screen.queryByRole("link", { name: /对比|比较|compar/i })).not.toBeInTheDocument();
    expect(container.querySelector('a[href^="/compare"]')).toBeNull();
    expect(screen.getByRole("link", { name: /返回首页地图|Back to homepage map/ })).toHaveAttribute("href", "/?country=ZAF#markets");
    expect(mocks.demoApi).not.toHaveBeenCalled();
  });
});
