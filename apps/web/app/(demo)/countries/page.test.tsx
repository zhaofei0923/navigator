import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CountriesPage from "./page";
import { LocaleProvider } from "@/lib/i18n";
import type { GlobeMarker } from "@/lib/types";

const mocks = vi.hoisted(() => ({
  useDemoQuery: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  reload: vi.fn(),
}));

vi.mock("@/hooks/use-demo-query", () => ({ useDemoQuery: mocks.useDemoQuery }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));
vi.mock("next/dynamic", () => ({
  default: () => function MockCountryGlobe() {
    return <div data-testid="country-globe" />;
  },
}));

const markers: GlobeMarker[] = [{
  data_origin: "synthetic_demo",
  code: "ZAF",
  name: "南非",
  lat: -30,
  lng: 24,
  summary: "Synthetic market summary",
  readiness: 78,
}];

describe("CountriesPage market context", () => {
  beforeEach(() => {
    mocks.useDemoQuery.mockReset();
    mocks.useDemoQuery.mockReturnValue({
      data: markers,
      loading: false,
      error: null,
      reload: mocks.reload,
    });
  });

  it("carries the selected globe market into detail and tools without comparison actions", () => {
    render(
      <LocaleProvider initialLocale="zh-CN">
        <CountriesPage />
      </LocaleProvider>,
    );

    expect(screen.getByText("当前演示市场")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /进入国家详情/ })).toHaveAttribute("href", "/countries/ZAF");
    expect(screen.getByRole("link", { name: /AI 市场判断/ })).toHaveAttribute("href", "/tools/assistant?country=ZAF");
    expect(screen.getByRole("link", { name: /光储方案/ })).toHaveAttribute("href", "/tools/solar-storage?country=ZAF");
    expect(screen.queryByRole("link", { name: /对比|比较/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link").some((link) => link.getAttribute("href")?.startsWith("/compare"))).toBe(false);
  });

  it("renders the market context and task labels in English", () => {
    render(
      <LocaleProvider initialLocale="en">
        <CountriesPage />
      </LocaleProvider>,
    );

    expect(screen.getByText("Current demo market")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /AI market assessment/ })).toHaveAttribute("href", "/tools/assistant?country=ZAF");
    expect(screen.queryByText("当前演示市场")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /compar/i })).not.toBeInTheDocument();
  });
});
