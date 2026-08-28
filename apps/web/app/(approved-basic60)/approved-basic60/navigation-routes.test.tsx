import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CountriesPage from "@/app/(approved-basic60)/approved-basic60/countries/page";
import ComparePage from "@/app/(approved-basic60)/approved-basic60/compare/page";
import PoliciesPage from "@/app/(approved-basic60)/approved-basic60/policies/page";
import RisksPage from "@/app/(approved-basic60)/approved-basic60/risks/page";
import OpportunitiesPage from "@/app/(approved-basic60)/approved-basic60/opportunities/page";
import TendersPage from "@/app/(approved-basic60)/approved-basic60/tenders/page";
import PartnersPage from "@/app/(approved-basic60)/approved-basic60/partners/page";
import PrivateHomePage from "@/app/(basic60)/basic60/(private)/page";
import PrivateToolsPage from "@/app/(basic60)/basic60/(private)/tools/page";
import PrivatePartnersPage from "@/app/(basic60)/basic60/(private)/partners/page";
import PrivateAssistantPage from "@/app/(basic60)/basic60/(private)/tools/assistant/page";
import PrivateSolarPage from "@/app/(basic60)/basic60/(private)/tools/solar-storage/page";
import PrivateFeasibilityPage from "@/app/(basic60)/basic60/(private)/tools/feasibility/page";
import PrivateTendersPage from "@/app/(basic60)/basic60/(private)/tools/tenders/page";

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  marketProps: vi.fn(),
  redirect: vi.fn((href: string) => { throw new Error("redirect:" + href); }),
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/approved-basic60/page-context", () => ({ approvedBasic60PageContext: mocks.context }));
vi.mock("@/components/approved-basic60-market-page", () => ({
  ApprovedBasic60MarketPage: (props: { basePath: string; searchParams: unknown }) => {
    mocks.marketProps(props);
    return <div data-testid="market-home" data-base={props.basePath} />;
  },
}));
vi.mock("@/components/approved-basic60-module-page", () => ({
  ApprovedBasic60ModulePage: ({ countryCode, basePath = "", kind }: { countryCode?: string | null; basePath?: string; kind: string }) =>
    <div data-testid="module" data-country={countryCode} data-base={basePath} data-module={kind} />,
  ApprovedBasic60ToolsHub: ({ countryCode, basePath = "" }: { countryCode?: string | null; basePath?: string }) =>
    <div data-testid="module" data-country={countryCode} data-base={basePath} data-module="tools" />,
  ApprovedBasic60ToolPlaceholder: ({ countryCode, basePath = "", step }: { countryCode?: string | null; basePath?: string; step: string }) =>
    <div data-testid="module" data-country={countryCode} data-base={basePath} data-module={step} />,
}));

describe("product route wrappers", () => {
  beforeEach(() => {
    mocks.context.mockReset().mockResolvedValue({ locale: "en", countryCode: "BRA" });
    mocks.marketProps.mockClear();
    mocks.redirect.mockClear();
  });

  it.each([
    ["countries", CountriesPage, "/?country=BRA#markets"],
    ["compare", ComparePage, "/?country=BRA#markets"],
    ["policies", PoliciesPage, "/tools?country=BRA"],
    ["risks", RisksPage, "/tools?country=BRA"],
    ["opportunities", OpportunitiesPage, "/tools/tenders?country=BRA"],
    ["tenders", TendersPage, "/tools/tenders?country=BRA"],
  ] as const)("retired %s wrapper cannot render an old page", async (_name, Page, destination) => {
    const searchParams = Promise.resolve({ country: "BRA" });
    await expect(Page({ searchParams })).rejects.toThrow("redirect:" + destination);
    expect(mocks.redirect).toHaveBeenCalledWith(destination);
    expect(mocks.context).toHaveBeenCalledWith(searchParams);
  });

  it.each([
    ["partners", PartnersPage, ""],
    ["tools", PrivateToolsPage, "/basic60"],
    ["partners", PrivatePartnersPage, "/basic60"],
    ["assistant", PrivateAssistantPage, "/basic60"],
    ["solar-storage", PrivateSolarPage, "/basic60"],
    ["feasibility", PrivateFeasibilityPage, "/basic60"],
    ["tenders", PrivateTendersPage, "/basic60"],
  ] as const)("preserves country and base path for %s", async (moduleName, Page, basePath) => {
    render(await Page({ searchParams: Promise.resolve({ country: "BRA" }) }));
    expect(screen.getByTestId("module")).toHaveAttribute("data-country", "BRA");
    expect(screen.getByTestId("module")).toHaveAttribute("data-base", basePath);
    expect(screen.getByTestId("module")).toHaveAttribute("data-module", moduleName);
  });

  it("renders the protected private homepage instead of redirecting to its retired list", () => {
    const searchParams = Promise.resolve({ country: "BRA" });
    render(PrivateHomePage({ searchParams }));
    expect(screen.getByTestId("market-home")).toHaveAttribute("data-base", "/basic60");
    expect(mocks.marketProps).toHaveBeenCalledWith({ basePath: "/basic60", searchParams });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
