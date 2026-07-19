import { beforeEach, describe, expect, test, vi } from "vitest";

import type {
  LocalizedCountriesResponse,
  LocalizedCountryDetailResponse,
  LocalizedCountryModuleResponse,
} from "@navigator/shared-types/country-api";

import {
  CountryApiClientError,
  fetchCountries,
  fetchCountryDetail,
  fetchCountryModule,
} from "./country-api-client.js";

vi.mock("server-only", () => ({}));

const environment = {
  API_INTERNAL_BASE_URL: "http://127.0.0.1:3100/api/v1",
  NODE_ENV: "development",
} as const;

const listResponse: LocalizedCountriesResponse = {
  data: [],
  meta: {
    locale: "en",
    page: 1,
    pageSize: 20,
    textMode: "localized",
    total: 0,
  },
  success: true,
};

const detailResponse: LocalizedCountryDetailResponse = {
  data: {
    _i18nFallback: [],
    code: "ID",
    coverageLevel: "BASIC",
    flagEmoji: "ID",
    moduleCoverage: [],
    name: "Indonesia",
    region: "southeast-asia",
    signals: {
      opportunityLevel: "DATA_BUILDING",
      policyFriendliness: "DATA_BUILDING",
      recommendedEntryMode: null,
      recommendedPriority: "DATA_BUILDING",
      riskLevel: "DATA_BUILDING",
      sourceCount: 0,
      sources: [],
      updatedAt: "2026-07-19T00:00:00.000Z",
    },
    summary: "Summary",
    updatedAt: "2026-07-19T00:00:00.000Z",
  },
  meta: { locale: "en", textMode: "localized" },
  success: true,
};

const moduleResponse: LocalizedCountryModuleResponse = {
  data: {
    _i18nFallback: [],
    items: [],
    moduleKey: "policy",
    status: "BUILDING",
  },
  meta: {
    locale: "en",
    page: 1,
    pageSize: 20,
    textMode: "localized",
    total: 0,
  },
  success: true,
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("server-only country API client", () => {
  test("fetches the localized list with normalized filters and no-store", async () => {
    const fetcher = vi.fn(async () => jsonResponse(listResponse));

    await expect(fetchCountries(
      {
        coverageLevel: "BASIC",
        industryTags: ["solar", "wind"],
        locale: "en",
        page: 2,
        pageSize: 50,
        region: "southeast-asia",
        techTags: ["pv-module"],
      },
      { environment, fetcher },
    )).resolves.toEqual(listResponse);

    expect(fetcher).toHaveBeenCalledWith(
      "http://127.0.0.1:3100/api/v1/countries?locale=en&page=2&pageSize=50&textMode=localized&coverageLevel=BASIC&industryTags=solar%2Cwind&region=southeast-asia&techTags=pv-module",
      {
        cache: "no-store",
        headers: { accept: "application/json", "accept-language": "en" },
        method: "GET",
        redirect: "manual",
      },
    );
  });

  test("fetches detail and modules from encoded country paths with no-store", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(detailResponse))
      .mockResolvedValueOnce(jsonResponse(moduleResponse));

    await expect(fetchCountryDetail("ID", "en", {
      environment,
      fetcher,
    })).resolves.toEqual(detailResponse);
    await expect(fetchCountryModule("ID", "policy", "en", {
      environment,
      fetcher,
    })).resolves.toEqual(moduleResponse);

    expect(fetcher.mock.calls).toEqual([
      [
        "http://127.0.0.1:3100/api/v1/countries/ID?locale=en&textMode=localized",
        expect.objectContaining({ cache: "no-store", redirect: "manual" }),
      ],
      [
        "http://127.0.0.1:3100/api/v1/countries/ID/modules/policy?locale=en&page=1&pageSize=20&textMode=localized",
        expect.objectContaining({ cache: "no-store", redirect: "manual" }),
      ],
    ]);
  });

  test("maps only an exact upstream 404 to a missing country", async () => {
    const fetcher = vi.fn(async () => jsonResponse(
      {
        error: { code: "NOT_FOUND", details: null, message: "Country not found" },
        success: false,
      },
      404,
    ));

    await expect(fetchCountryDetail("XX", "en", {
      environment,
      fetcher,
    })).resolves.toBeNull();
  });

  test.each([
    ["redirect", new Response(null, { status: 302 })],
    ["server error", jsonResponse({ success: false }, 500)],
    ["non-JSON", new Response("not json", { status: 200 })],
    ["wrong envelope", jsonResponse({ data: [], success: false })],
  ])("throws a fixed error for a %s response", async (_name, response) => {
    await expect(fetchCountries(
      { locale: "en" },
      { environment, fetcher: vi.fn(async () => response) },
    )).rejects.toEqual(expect.objectContaining({
      name: "CountryApiClientError",
      message: "COUNTRY_API_REQUEST_FAILED",
    }));
  });

  test("does not include the internal URL or cause in its error", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("connect ECONNREFUSED http://secret.internal:3100");
    });

    const request = fetchCountries(
      { locale: "en" },
      { environment, fetcher },
    );

    await expect(request).rejects.toBeInstanceOf(CountryApiClientError);
    await expect(request).rejects.not.toThrow(/secret|ECONNREFUSED|3100/u);
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}
