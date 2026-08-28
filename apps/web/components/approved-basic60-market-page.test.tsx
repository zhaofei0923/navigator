import { render, screen } from "@testing-library/react";
import { Suspense } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovedBasic60MarketPage } from "@/components/approved-basic60-market-page";
import type { Basic60CountrySummary, Basic60Locale } from "@/lib/basic60/types";

const mocks = vi.hoisted(() => ({ list: vi.fn(), locale: vi.fn(), props: vi.fn() }));
vi.mock("@/lib/basic60/api", () => ({ listBasic60Countries: mocks.list }));
vi.mock("@/lib/i18n/server", () => ({ getRequestLocale: mocks.locale }));
vi.mock("@/components/approved-basic60-market-experience", () => ({
  ApprovedBasic60MarketExperience: (props: unknown) => {
    mocks.props(props);
    return <div data-testid="home" />;
  },
}));
function country(code: string): Basic60CountrySummary {
  return {
    code, iso2: code === "CHN" ? "CN" : "ID",
    name_zh: code === "CHN" ? "中国" : "印度尼西亚", name_en: code === "CHN" ? "China" : "Indonesia",
    region_code: "Southeast Asia", coverage_level: "Basic", last_reviewed_at: "2026-08-26T00:00:00Z",
    opportunity_level: "pending", policy_friendliness_level: "pending", risk_assessment_status: "unknown", risk_level: null, latest_metrics: [],
  };
}

async function resolveHome(props: Parameters<typeof ApprovedBasic60MarketPage>[0] = {}) {
  const page = await ApprovedBasic60MarketPage(props);
  expect(page.type).toBe(Suspense);
  return page.props.children.type(page.props.children.props);
}

describe("approved home server boundary", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.locale.mockResolvedValue("zh-CN"); });
  it.each(["zh-CN", "en"] as const)("passes only display fields and a valid initial country in %s", async (locale: Basic60Locale) => {
    const response = { data: [country("CHN"), country("IDN")], meta: { release_id: "BASIC60-PRIVATE-R1", as_of: "2026-08-26" } };
    const original = structuredClone(response);
    mocks.locale.mockResolvedValue(locale);
    mocks.list.mockResolvedValue(response);
    render(await resolveHome({ searchParams: Promise.resolve({ country: "idn" }) }));
    expect(screen.getByTestId("home")).toBeInTheDocument();
    const props = mocks.props.mock.calls[0][0];
    expect(props).toMatchObject({ locale, initialCountryCode: "IDN", dataStatus: "ready", basePath: "" });
    expect(props.countries).toHaveLength(1);
    expect(props.countries[0]).toEqual({
      code: "IDN", name: locale === "en" ? "Indonesia" : "印度尼西亚", alternateName: locale === "en" ? "印度尼西亚" : "Indonesia", region: "Southeast Asia", featuredMetrics: [],
    });
    expect(props).not.toHaveProperty("release");
    expect(props.countries[0]).not.toHaveProperty("coverageLevel");
    expect(props.countries[0]).not.toHaveProperty("availableMetricCount");
    expect(response).toEqual(original);
    expect(mocks.list).toHaveBeenCalledExactlyOnceWith({ coverage_level: "Basic", limit: 100 }, locale);
  });

  it.each([undefined, "CHN", "ZZZ", "../IDN"])("does not preselect missing or invalid country %s", async (value) => {
    mocks.list.mockResolvedValue({ data: [country("IDN")] });
    render(await resolveHome({ searchParams: Promise.resolve({ country: value }) }));
    expect(mocks.props.mock.calls[0][0].initialCountryCode).toBe("");
  });

  it.each(["zh-CN", "en"] as const)("passes Zambia from the expanded API list with its localized display name in %s", async (locale) => {
    const zambia: Basic60CountrySummary = {
      ...country("IDN"), code: "ZMB", iso2: "ZM", name_zh: "赞比亚", name_en: "Zambia", region_code: "Southern Africa",
    };
    const response = { data: [country("CHN"), country("IDN"), zambia], meta: { release_id: "BASIC61-PRIVATE-R1", as_of: "2026-08-28" } };
    const original = structuredClone(response);
    mocks.locale.mockResolvedValue(locale);
    mocks.list.mockResolvedValue(response);
    render(await resolveHome({ searchParams: Promise.resolve({ country: "zmb" }) }));
    const props = mocks.props.mock.calls[0][0];
    expect(props).toMatchObject({ locale, initialCountryCode: "ZMB", dataStatus: "ready" });
    expect(props.countries).toHaveLength(2);
    expect(props.countries[1]).toEqual({
      code: "ZMB", name: locale === "en" ? "Zambia" : "赞比亚", alternateName: locale === "en" ? "赞比亚" : "Zambia", region: "Southern Africa", featuredMetrics: [],
    });
    expect(JSON.stringify(props)).not.toMatch(/BASIC61|source_ref|review_status|coverageLevel/);
    expect(response).toEqual(original);
    expect(mocks.list).toHaveBeenCalledExactlyOnceWith({ coverage_level: "Basic", limit: 100 }, locale);
  });

  it.each([{ data: [] }, { data: [country("CHN")] }])("keeps an empty home instead of replacing the page with an error", async ({ data }) => {
    mocks.list.mockResolvedValue({ data });
    render(await resolveHome());
    expect(mocks.props.mock.calls[0][0]).toMatchObject({ countries: [], dataStatus: "empty", initialCountryCode: "" });
  });

  it("preserves the home on API failure and never passes internal errors to the client", async () => {
    mocks.list.mockRejectedValue(new Error("internal contract failed secret"));
    render(await resolveHome());
    const props = mocks.props.mock.calls[0][0];
    expect(props).toMatchObject({ countries: [], dataStatus: "error" });
    expect(JSON.stringify(props)).not.toMatch(/secret|contract|Basic|release/);
  });

  it("supports private base paths and the first repeated country parameter", async () => {
    mocks.list.mockResolvedValue({ data: [country("IDN")] });
    render(await resolveHome({ basePath: "/basic60", searchParams: Promise.resolve({ country: ["IDN", "CHN"] }) }));
    expect(mocks.props.mock.calls[0][0]).toMatchObject({ initialCountryCode: "IDN", basePath: "/basic60" });
  });

  it("streams the complete introduction without waiting for the country API", async () => {
    mocks.list.mockReturnValue(new Promise(() => {}));
    const page = await ApprovedBasic60MarketPage({ basePath: "/basic60" });
    expect(page.type).toBe(Suspense);
    render(page.props.fallback);
    expect(mocks.props.mock.calls[0][0]).toMatchObject({ countries: [], dataStatus: "loading", basePath: "/basic60" });
    expect(mocks.list).not.toHaveBeenCalled();
  });
});
