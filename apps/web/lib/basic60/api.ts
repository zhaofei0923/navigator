import "server-only";

import { isBasic60Envelope } from "@/lib/basic60/contract";
import type {
  Basic60Comparison,
  Basic60ComparisonRequest,
  Basic60CountryDetail,
  Basic60CountrySummary,
  Basic60Envelope,
  Basic60ErrorEnvelope,
  Basic60Locale,
} from "@/lib/basic60/types";

export class Basic60ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "Basic60ApiError";
  }
}

function apiBaseUrl(): URL {
  const url = new URL(process.env.BASIC60_API_BASE_URL || "http://localhost:8001");
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("BASIC60_API_BASE_URL must use http or https");
  }
  return url;
}

function copy(locale: Basic60Locale) {
  return locale === "en"
    ? {
        configuration: "The Basic60 private data service is not configured.",
        unavailable: "The Basic60 private data service is temporarily unavailable.",
        invalid: "The Basic60 service returned an invalid private-trial response.",
        rejected: "A response outside the approved Basic60 private-trial release was blocked.",
      }
    : {
        configuration: "BASIC60 私有数据服务尚未配置。",
        unavailable: "BASIC60 私有数据服务暂时不可用。",
        invalid: "BASIC60 服务返回了无效的私有试用响应。",
        rejected: "已阻止不属于获准 BASIC60 私有试用版本的响应。",
      };
}

async function request<T>(
  path: string,
  locale: Basic60Locale,
  init?: { method?: "GET" | "POST"; body?: unknown },
): Promise<Basic60Envelope<T>> {
  const messages = copy(locale);
  const apiKey = process.env.BASIC60_API_KEY?.trim();
  if (!apiKey) throw new Basic60ApiError(messages.configuration, 503, "BASIC60_NOT_CONFIGURED");

  let target: URL;
  try {
    target = new URL(path, apiBaseUrl());
  } catch {
    throw new Basic60ApiError(messages.configuration, 503, "BASIC60_NOT_CONFIGURED");
  }

  let response: Response;
  try {
    response = await fetch(target, {
      method: init?.method ?? "GET",
      headers: {
        Accept: "application/json",
        "X-Private-Trial-Key": apiKey,
        ...(init?.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Basic60ApiError(messages.unavailable, 502, "BASIC60_UPSTREAM_UNAVAILABLE");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Basic60ApiError(messages.invalid, 502, "BASIC60_UPSTREAM_INVALID");
  }

  if (!response.ok) {
    const error = (payload as Basic60ErrorEnvelope).error;
    throw new Basic60ApiError(messages.unavailable, response.status, error?.code);
  }
  if (!isBasic60Envelope<T>(payload)) {
    throw new Basic60ApiError(messages.rejected, 502, "BASIC60_RELEASE_REJECTED");
  }
  return payload;
}

export type Basic60CountryListParams = {
  q?: string;
  region?: string;
  coverage_level?: "Basic";
  as_of?: string;
  cursor?: string;
  limit?: number;
};

export function listBasic60Countries(
  params: Basic60CountryListParams,
  locale: Basic60Locale,
): Promise<Basic60Envelope<Basic60CountrySummary[]>> {
  const target = new URL("/api/v1/countries", "http://basic60.internal");
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") target.searchParams.set(key, String(value));
  }
  target.searchParams.set("locale", locale);
  return request(`${target.pathname}${target.search}`, locale);
}

export function getBasic60Country(
  code: string,
  locale: Basic60Locale,
): Promise<Basic60Envelope<Basic60CountryDetail>> {
  const normalizedCode = code.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalizedCode)) {
    throw new Basic60ApiError(
      locale === "en" ? "The country code is invalid." : "国家代码无效。",
      400,
      "BASIC60_INVALID_COUNTRY_CODE",
    );
  }
  const query = new URLSearchParams({
    expand: "identity,macro,energy",
    locale,
  });
  return request(`/api/v1/countries/${normalizedCode}?${query}`, locale);
}

export function compareBasic60Countries(
  comparison: Basic60ComparisonRequest,
  locale: Basic60Locale,
): Promise<Basic60Envelope<Basic60Comparison>> {
  const query = new URLSearchParams({ locale });
  return request(`/api/v1/country-comparisons?${query}`, locale, {
    method: "POST",
    body: comparison,
  });
}
