import { describe, expect, test } from "vitest";

import {
  parseApiCountryQuery,
  parseCountryCodeParam,
} from "@navigator/shared-types/country-runtime";

import {
  buildCountryDetailCacheKey,
  buildCountryListCacheKey,
  buildCountryModuleCacheKey,
  getCountryCacheKeyOwnership,
} from "./cache-key.js";

describe("country response cache keys", () => {
  test("canonicalizes list tag order and duplicates without losing response fields", () => {
    const first = buildCountryListCacheKey(
      {
        coverageLevel: "BASIC",
        industryTags: ["wind", "solar", "wind"],
        locale: "en",
        page: 2,
        pageSize: 25,
        region: "southeast-asia",
        techTags: ["inverter", "pv-module", "inverter"],
      },
      "localized",
    );
    const equivalent = buildCountryListCacheKey(
      {
        coverageLevel: "BASIC",
        industryTags: ["solar", "wind"],
        locale: "en",
        page: 2,
        pageSize: 25,
        region: "southeast-asia",
        techTags: ["pv-module", "inverter"],
      },
      "localized",
    );

    expect(first).toBe(equivalent);
    for (const changed of [
      buildCountryListCacheKey(
        { locale: "zh-CN", page: 2, pageSize: 25 },
        "localized",
      ),
      buildCountryListCacheKey(
        { locale: "en", page: 1, pageSize: 25 },
        "localized",
      ),
      buildCountryListCacheKey(
        { locale: "en", page: 2, pageSize: 20 },
        "localized",
      ),
      buildCountryListCacheKey(
        { locale: "en", page: 2, pageSize: 25 },
        "raw",
      ),
    ]) {
      expect(changed).not.toBe(first);
    }
  });

  test("uses parsed response semantics instead of raw query representation", () => {
    const parse = (query: string, acceptLanguage?: string) =>
      parseApiCountryQuery({
        acceptLanguage,
        searchParams: new URLSearchParams(query),
      });
    const variants = [
      parse("industryTags=wind%2C%2Csolar%2Cwind&page=01&pageSize=1000&ignored=x&locale=en"),
      parse("pageSize=100&industryTags=solar%2Cwind&page=1&locale=en"),
      parse("page=1&pageSize=100&industryTags=wind%2Csolar", "en-US,en;q=0.9"),
    ];

    expect(variants.every(({ errors }) => Object.keys(errors).length === 0)).toBe(
      true,
    );
    const keys = variants.map(({ filters, textMode }) =>
      buildCountryListCacheKey(filters, textMode),
    );
    expect(new Set(keys).size).toBe(1);
  });

  test("distinguishes every list response dimension and merges explicit defaults", () => {
    const base = {
      coverageLevel: "BASIC" as const,
      industryTags: ["solar" as const],
      locale: "en" as const,
      page: 1,
      pageSize: 20,
      region: "southeast-asia" as const,
      techTags: ["inverter" as const],
    };
    const baseKey = buildCountryListCacheKey(base, "localized");
    const changedKeys = [
      buildCountryListCacheKey({ ...base, coverageLevel: "STANDARD" }, "localized"),
      buildCountryListCacheKey({ ...base, industryTags: ["wind"] }, "localized"),
      buildCountryListCacheKey({ ...base, locale: "zh-CN" }, "localized"),
      buildCountryListCacheKey({ ...base, page: 2 }, "localized"),
      buildCountryListCacheKey({ ...base, pageSize: 21 }, "localized"),
      buildCountryListCacheKey({ ...base, region: "africa" }, "localized"),
      buildCountryListCacheKey({ ...base, techTags: ["pv-module"] }, "localized"),
      buildCountryListCacheKey(base, "raw"),
    ];

    expect(changedKeys.every((key) => key !== baseKey)).toBe(true);
    expect(new Set(changedKeys).size).toBe(changedKeys.length);
    expect(
      buildCountryListCacheKey(
        { industryTags: [], locale: "zh-CN", page: 1, pageSize: 20, techTags: [] },
        "localized",
      ),
    ).toBe(
      buildCountryListCacheKey(
        { locale: "zh-CN" },
        "localized",
      ),
    );
  });

  test("detail keys normalize country code and ignore fields without response meaning", () => {
    const extraFields = {
      locale: "en" as const,
      page: 999,
      region: "africa",
    };
    const first = buildCountryDetailCacheKey(
      parseCountryCodeParam(" id "),
      extraFields,
      "localized",
    );
    const equivalent = buildCountryDetailCacheKey(
      "ID",
      { locale: "en" },
      "localized",
    );

    expect(first).toBe(equivalent);
    expect(
      buildCountryDetailCacheKey("VN", { locale: "en" }, "localized"),
    ).not.toBe(first);
    expect(
      buildCountryDetailCacheKey("ID", { locale: "zh-CN" }, "localized"),
    ).not.toBe(first);
    expect(buildCountryDetailCacheKey("ID", { locale: "en" }, "raw")).not.toBe(
      first,
    );
  });

  test("module keys include only normalized module response dimensions", () => {
    const first = buildCountryModuleCacheKey(
      " id ",
      "projects",
      { locale: "en", page: 1, pageSize: 20 },
      "localized",
    );
    const equivalent = buildCountryModuleCacheKey(
      "ID",
      "projects",
      { locale: "en", page: 1, pageSize: 20 },
      "localized",
    );

    expect(first).toBe(equivalent);
    expect(
      buildCountryModuleCacheKey(
        "ID",
        "policy",
        { locale: "en", page: 1, pageSize: 20 },
        "localized",
      ),
    ).not.toBe(first);
    expect(
      buildCountryModuleCacheKey(
        "ID",
        "projects",
        { locale: "en", page: 2, pageSize: 20 },
        "localized",
      ),
    ).not.toBe(first);
    for (const changed of [
      buildCountryModuleCacheKey(
        "VN",
        "projects",
        { locale: "en", page: 1, pageSize: 20 },
        "localized",
      ),
      buildCountryModuleCacheKey(
        "ID",
        "projects",
        { locale: "zh-CN", page: 1, pageSize: 20 },
        "localized",
      ),
      buildCountryModuleCacheKey(
        "ID",
        "projects",
        { locale: "en", page: 1, pageSize: 21 },
        "localized",
      ),
      buildCountryModuleCacheKey(
        "ID",
        "projects",
        { locale: "en", page: 1, pageSize: 20 },
        "raw",
      ),
    ]) {
      expect(changed).not.toBe(first);
    }
  });

  test("uses collision-safe structured encoding and exposes exact ownership", () => {
    const listKey = buildCountryListCacheKey(
      { locale: "en", page: 1, pageSize: 20 },
      "localized",
    );
    const idDetail = buildCountryDetailCacheKey(
      "ID",
      { locale: "en" },
      "localized",
    );
    const idModule = buildCountryModuleCacheKey(
      "ID",
      "policy",
      { locale: "en", page: 1, pageSize: 20 },
      "localized",
    );
    const collisionAttempt = buildCountryDetailCacheKey(
      'ID\",\"module\",\"policy',
      { locale: "en" },
      "localized",
    );

    expect(new Set([listKey, idDetail, idModule, collisionAttempt]).size).toBe(4);
    expect(getCountryCacheKeyOwnership(listKey)).toEqual({ route: "list" });
    expect(getCountryCacheKeyOwnership(idDetail)).toEqual({
      countryCode: "ID",
      route: "detail",
    });
    expect(getCountryCacheKeyOwnership(idModule)).toEqual({
      countryCode: "ID",
      route: "module",
    });
    expect(getCountryCacheKeyOwnership("not-a-cache-key")).toBeNull();
    expect(
      getCountryCacheKeyOwnership(
        JSON.stringify(["navigator-country-cache-v1", "detail", "ID", "en"]),
      ),
    ).toBeNull();
  });
});
