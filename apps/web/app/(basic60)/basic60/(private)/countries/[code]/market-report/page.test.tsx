import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LegacyCountryReportRedirect from "@/app/(basic60)/basic60/(private)/countries/[code]/market-report/page";
import CanonicalCountryReportRedirect from "@/app/(demo)/countries/[code]/market-report/page";
import ApprovedCountryReportRedirect from "@/app/(approved-basic60)/approved-basic60/countries/[code]/market-report/page";
import { Basic60ApiError } from "@/lib/basic60/api";
import { marketCountryFixture } from "@/test-support/market-content-fixtures";

const mocks = vi.hoisted(() => ({
  getCountry: vi.fn(), locale: vi.fn(), loadOverview: vi.fn(),
  notFound: vi.fn(() => { throw new Error("NEXT_HTTP_ERROR_FALLBACK;404"); }),
  redirect: vi.fn((target: string) => { throw new Error("NEXT_REDIRECT:" + target); }),
}));
vi.mock("@/lib/basic60/api", async (original) => ({ ...(await original<typeof import("@/lib/basic60/api")>()), getBasic60Country: mocks.getCountry }));
vi.mock("@/lib/i18n/server", () => ({ getRequestLocale: mocks.locale }));
vi.mock("@/lib/market-content/api", () => ({ loadCountryMarketOverview: mocks.loadOverview }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound, redirect: mocks.redirect }));

describe("retired country-report routes", () => {
  beforeEach(() => {
    vi.stubEnv("NAVIGATOR_RUNTIME_PROFILE", "approved_basic60_demo");
    mocks.locale.mockReset().mockResolvedValue("zh-CN");
    mocks.getCountry.mockReset().mockResolvedValue({ data: marketCountryFixture });
    mocks.loadOverview.mockReset();
    mocks.notFound.mockClear();
    mocks.redirect.mockClear();
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  it.each(["zh-CN", "en"] as const)("redirects the same country to its overview while retaining request locale %s", async (locale) => {
    mocks.locale.mockResolvedValue(locale);
    await expect(LegacyCountryReportRedirect({ params: Promise.resolve({ code: "idn" }) })).rejects.toThrow("NEXT_REDIRECT:/countries/IDN#market-overview");
    expect(mocks.getCountry).toHaveBeenCalledExactlyOnceWith("IDN", locale);
    expect(mocks.redirect).toHaveBeenCalledExactlyOnceWith("/countries/IDN#market-overview");
    expect(mocks.loadOverview).not.toHaveBeenCalled();
  });

  it("keeps the private legacy redirect inside the protected prefix", async () => {
    vi.stubEnv("NAVIGATOR_RUNTIME_PROFILE", "basic60_private");
    await expect(LegacyCountryReportRedirect({ params: Promise.resolve({ code: "IDN" }) })).rejects.toThrow("NEXT_REDIRECT:/basic60/countries/IDN#market-overview");
    expect(mocks.redirect).toHaveBeenCalledWith("/basic60/countries/IDN#market-overview");
  });

  it.each(["CHN", "chn", "CN", "../IDN", "IDN%2fmarket-report", "IDN#other"])("rejects excluded or malformed country %s before requesting data", async (code) => {
    await expect(LegacyCountryReportRedirect({ params: Promise.resolve({ code }) })).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
    expect(mocks.getCountry).not.toHaveBeenCalled();
    expect(mocks.loadOverview).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("keeps a valid-looking but unknown or withdrawn country as a 404", async () => {
    mocks.getCountry.mockRejectedValue(new Basic60ApiError("unknown country", 404));
    await expect(LegacyCountryReportRedirect({ params: Promise.resolve({ code: "ZZZ" }) })).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it.each([new Basic60ApiError("private source details", 503), new Error("private network")])("lets the detail page own temporary errors without loading old content", async (error) => {
    mocks.getCountry.mockRejectedValue(error);
    await expect(LegacyCountryReportRedirect({ params: Promise.resolve({ code: "IDN" }) })).rejects.toThrow("NEXT_REDIRECT:/countries/IDN#market-overview");
    expect(mocks.redirect).toHaveBeenCalledWith("/countries/IDN#market-overview");
    expect(mocks.loadOverview).not.toHaveBeenCalled();
  });

  it("shares one redirect implementation with the approved alias", () => {
    expect(ApprovedCountryReportRedirect).toBe(LegacyCountryReportRedirect);
  });

  it("prevents the synthetic runtime from requesting real content through the old report URL", async () => {
    vi.stubEnv("NAVIGATOR_RUNTIME_PROFILE", "synthetic_demo");
    await expect(CanonicalCountryReportRedirect({ params: Promise.resolve({ code: "IDN" }) })).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
    expect(mocks.getCountry).not.toHaveBeenCalled();
    expect(mocks.loadOverview).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("routes the approved canonical adapter to the same-country article", async () => {
    await expect(CanonicalCountryReportRedirect({ params: Promise.resolve({ code: "IDN" }) })).rejects.toThrow("NEXT_REDIRECT:/countries/IDN#market-overview");
  });
});
