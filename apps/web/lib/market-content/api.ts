import "server-only";

import type { Basic60Locale } from "@/lib/basic60/types";
import { isMarketOverviewEnvelope } from "@/lib/market-content/contract";
import type { MarketOverviewEnvelope, MarketOverviewResult } from "@/lib/market-content/types";

export class MarketOverviewApiError extends Error {
  constructor(public readonly status: number, public readonly code: string) {
    super("Market overview is unavailable.");
    this.name = "MarketOverviewApiError";
  }
}

export async function getCountryMarketOverview(code: string, locale: Basic60Locale): Promise<MarketOverviewEnvelope> {
  const countryCode = code.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(countryCode) || countryCode === "CHN") throw new MarketOverviewApiError(404, "COUNTRY_NOT_FOUND");
  if (locale !== "zh-CN" && locale !== "en") throw new MarketOverviewApiError(422, "MARKET_CONTENT_INVALID_LOCALE");
  const apiKey = process.env.BASIC60_API_KEY?.trim();
  if (!apiKey) throw new MarketOverviewApiError(503, "MARKET_CONTENT_NOT_CONFIGURED");
  let target: URL;
  try {
    const base = new URL(process.env.BASIC60_API_BASE_URL || "http://localhost:8001");
    if ((base.protocol !== "http:" && base.protocol !== "https:") || base.username || base.password) throw new Error("Invalid API origin");
    target = new URL(`/api/v1/countries/${countryCode}/market-overview`, base);
    target.searchParams.set("locale", locale);
  } catch {
    throw new MarketOverviewApiError(503, "MARKET_CONTENT_NOT_CONFIGURED");
  }

  let response: Response;
  try {
    response = await fetch(target, {
      method: "GET",
      headers: { Accept: "application/json", "X-Private-Trial-Key": apiKey },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new MarketOverviewApiError(502, "MARKET_CONTENT_UPSTREAM_UNAVAILABLE");
  }
  let payload: unknown;
  try { payload = await response.json(); } catch { throw new MarketOverviewApiError(502, "MARKET_CONTENT_INVALID"); }
  if (!response.ok) {
    const errorCode = typeof payload === "object" && payload !== null && "error" in payload &&
      typeof payload.error === "object" && payload.error !== null && "code" in payload.error &&
      typeof payload.error.code === "string" ? payload.error.code : "MARKET_CONTENT_UNAVAILABLE";
    const allowed = ["MARKET_CONTENT_UNAVAILABLE", "MARKET_CONTENT_INVALID", "COUNTRY_NOT_FOUND"];
    throw new MarketOverviewApiError(response.status, allowed.includes(errorCode) ? errorCode : "MARKET_CONTENT_UNAVAILABLE");
  }
  if (!isMarketOverviewEnvelope(payload, countryCode, locale)) throw new MarketOverviewApiError(502, "MARKET_CONTENT_INVALID");
  return payload;
}

export async function loadCountryMarketOverview(code: string, locale: Basic60Locale): Promise<MarketOverviewResult> {
  try { return { status: "ready", envelope: await getCountryMarketOverview(code, locale) }; } catch { return { status: "unavailable" }; }
}
