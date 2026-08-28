import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCountryMarketOverview, loadCountryMarketOverview, MarketOverviewApiError } from "@/lib/market-content/api";
import type { Basic60Locale } from "@/lib/basic60/types";
import { overviewFixture } from "@/test-support/market-content-fixtures";

const fetchMock = vi.fn();
describe("server-only single market-overview client", () => {
  beforeEach(() => {
    vi.stubEnv("BASIC60_API_BASE_URL", "http://market-api.test:8000");
    vi.stubEnv("BASIC60_API_KEY", "test-only-not-a-real-key");
    vi.stubGlobal("fetch", fetchMock.mockReset());
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it.each(["zh-CN", "en"] as const)("requests only the same-country overview with a private server header and no cache in %s", async (locale) => {
    const expected = overviewFixture(locale);
    fetchMock.mockResolvedValue(Response.json(expected));
    await expect(getCountryMarketOverview("idn", locale)).resolves.toEqual(expected);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`http://market-api.test:8000/api/v1/countries/IDN/market-overview?locale=${locale}`);
    expect(options).toMatchObject({ method: "GET", cache: "no-store", redirect: "error", headers: { Accept: "application/json", "X-Private-Trial-Key": "test-only-not-a-real-key" } });
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it.each(["CHN", "chn", "CN", "IDN/market-overview", "../IDN"])("rejects invalid or excluded country %s before requesting data", async (code) => {
    await expect(getCountryMarketOverview(code, "zh-CN")).rejects.toMatchObject({ status: 404, code: "COUNTRY_NOT_FOUND" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects invalid locale and missing configuration before network access", async () => {
    await expect(getCountryMarketOverview("IDN", "fr" as Basic60Locale)).rejects.toMatchObject({ status: 422 });
    vi.stubEnv("BASIC60_API_KEY", " ");
    await expect(getCountryMarketOverview("IDN", "en")).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["ftp://market-api.test", "invalid", "https://user:secret@market-api.test"])("refuses unsupported API configuration %s", async (url) => {
    vi.stubEnv("BASIC60_API_BASE_URL", url);
    await expect(getCountryMarketOverview("IDN", "en")).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { status: 404, code: "MARKET_CONTENT_UNAVAILABLE" },
    { status: 404, code: "COUNTRY_NOT_FOUND" },
    { status: 503, code: "MARKET_CONTENT_INVALID" },
  ])("retains safe status/code for $code without exposing backend details", async ({ status, code }) => {
    fetchMock.mockResolvedValue(Response.json({ error: { code, message: "restricted path and source", details: { secret: "hidden" } } }, { status }));
    const error = await getCountryMarketOverview("IDN", "en").catch((reason) => reason);
    expect(error).toBeInstanceOf(MarketOverviewApiError);
    expect(error).toMatchObject({ status, code, message: "Market overview is unavailable." });
    expect(JSON.stringify(error)).not.toMatch(/restricted|hidden|secret/);
  });

  it("does not propagate unknown backend codes or malformed error payloads", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: { code: "SECRET_SOURCE_HASH" } }, { status: 500 }));
    await expect(getCountryMarketOverview("IDN", "en")).rejects.toMatchObject({ status: 500, code: "MARKET_CONTENT_UNAVAILABLE" });
    fetchMock.mockResolvedValueOnce(Response.json(null, { status: 503 }));
    await expect(getCountryMarketOverview("IDN", "en")).rejects.toMatchObject({ status: 503, code: "MARKET_CONTENT_UNAVAILABLE" });
  });

  it("rejects wrong-country, wrong-locale, and archived-version content", async () => {
    fetchMock.mockResolvedValueOnce(Response.json(overviewFixture("en", "VNM")));
    await expect(getCountryMarketOverview("IDN", "en")).rejects.toMatchObject({ status: 502, code: "MARKET_CONTENT_INVALID" });
    fetchMock.mockResolvedValueOnce(Response.json(overviewFixture("zh-CN")));
    await expect(getCountryMarketOverview("IDN", "en")).rejects.toMatchObject({ status: 502, code: "MARKET_CONTENT_INVALID" });
    const old = overviewFixture("en");
    old.meta.content_version = "MARKET-IDN-20260827-R1";
    fetchMock.mockResolvedValueOnce(Response.json(old));
    await expect(getCountryMarketOverview("IDN", "en")).rejects.toMatchObject({ status: 502, code: "MARKET_CONTENT_INVALID" });
  });

  it.each([401, 403, 404, 410, 503])("keeps HTTP %i unavailable without probing old endpoints or using old drafts", async (status) => {
    fetchMock.mockResolvedValue(Response.json({ error: { code: "MARKET_CONTENT_UNAVAILABLE" } }, { status }));
    await expect(loadCountryMarketOverview("IDN", "en")).resolves.toEqual({ status: "unavailable" });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0][0])).toContain("/market-overview?locale=en");
  });

  it("rejects the legacy full-report body rather than adapting it as an overview", async () => {
    fetchMock.mockResolvedValue(Response.json({
      meta: overviewFixture("en").meta,
      data: { title: "Old report", introduction: "Old text", chapters: [], disclaimer: "Old draft" },
    }));
    await expect(loadCountryMarketOverview("IDN", "en")).resolves.toEqual({ status: "unavailable" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("returns neutral unavailable for invalid JSON and network failures", async () => {
    fetchMock.mockRejectedValueOnce(new Error("private network info"));
    await expect(loadCountryMarketOverview("IDN", "en")).resolves.toEqual({ status: "unavailable" });
    fetchMock.mockResolvedValueOnce(new Response("not JSON", { status: 200 }));
    await expect(loadCountryMarketOverview("IDN", "en")).resolves.toEqual({ status: "unavailable" });
  });

  it("keeps a valid new overview as one ready result", async () => {
    const envelope = overviewFixture("en");
    fetchMock.mockResolvedValue(Response.json(envelope));
    await expect(loadCountryMarketOverview("IDN", "en")).resolves.toEqual({ status: "ready", envelope });
  });
});
