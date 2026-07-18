import { describe, expect, expectTypeOf, test } from "vitest";

import {
  MAX_COUNTRIES_PAGE_SIZE,
  parseApiCountryQuery,
  parseCountryCodeParam,
  parseModuleKeyParam,
  resolveCountryLocale,
  type ParseCountryQueryInput,
} from "./country-query.js";

describe("country query parser", () => {
  test("applies documented defaults", () => {
    const result = parseApiCountryQuery({
      searchParams: new URLSearchParams(),
    });

    expect(result).toEqual({
      errors: {},
      filters: {
        coverageLevel: undefined,
        industryTags: [],
        locale: "zh-CN",
        page: 1,
        pageSize: 20,
        region: undefined,
        techTags: [],
      },
      textMode: "localized",
    });
  });

  test("uses query locale before Accept-Language and defaults to Chinese", () => {
    expect(
      resolveCountryLocale({
        acceptLanguage: "zh-CN,zh;q=0.9",
        searchParams: new URLSearchParams("locale=en"),
      }),
    ).toBe("en");
    expect(
      resolveCountryLocale({
        acceptLanguage: "fr;q=0.9,en-US;q=0.8",
        searchParams: new URLSearchParams(),
      }),
    ).toBe("en");
    expect(
      resolveCountryLocale({
        acceptLanguage: "fr-FR,fr;q=0.9",
        searchParams: new URLSearchParams(),
      }),
    ).toBe("zh-CN");
  });

  test("does not let a legacy injected locale override Accept-Language", () => {
    const legacyInjectedInput = {
      acceptLanguage: "en-US,en;q=0.9",
      locale: "zh-CN" as const,
      searchParams: new URLSearchParams(),
    };

    const result = parseApiCountryQuery(legacyInjectedInput);

    expect(result.filters.locale).toBe("en");
    expect(resolveCountryLocale(legacyInjectedInput)).toBe("en");

    type HasInjectedLocale = "locale" extends keyof ParseCountryQueryInput
      ? true
      : false;
    expectTypeOf<HasInjectedLocale>().toEqualTypeOf<false>();
  });

  test("parses filters, all-match tag lists, pagination, and raw mode", () => {
    const result = parseApiCountryQuery({
      searchParams: new URLSearchParams({
        coverageLevel: "STANDARD",
        industryTags: "solar, wind",
        locale: "en",
        page: "3",
        pageSize: "999",
        region: "middle-east",
        techTags: "pv-module,inverter",
        textMode: "raw",
      }),
    });

    expect(result).toEqual({
      errors: {},
      filters: {
        coverageLevel: "STANDARD",
        industryTags: ["solar", "wind"],
        locale: "en",
        page: 3,
        pageSize: MAX_COUNTRIES_PAGE_SIZE,
        region: "middle-east",
        techTags: ["pv-module", "inverter"],
      },
      textMode: "raw",
    });
  });

  test.each([
    ["coverageLevel", "DEEP"],
    ["locale", "fr"],
    ["region", "antarctica"],
    ["industryTags", "solar,bad-tag"],
    ["techTags", "pv-module,bad-tech"],
    ["textMode", "compact"],
    ["page", "0"],
    ["page", "1.5"],
    ["pageSize", "abc"],
  ])("reports the existing validation detail for invalid %s", (key, value) => {
    const result = parseApiCountryQuery({
      searchParams: new URLSearchParams({ [key]: value }),
    });

    expect(result.errors).toEqual({ [key]: value });
  });

  test("normalizes country codes without changing invalid-code NOT_FOUND semantics", () => {
    expect(parseCountryCodeParam("  id ")).toBe("ID");
    expect(parseCountryCodeParam("")).toBe("");
    expect(parseCountryCodeParam("x")).toBe("X");
    expect(parseCountryCodeParam("unknown")).toBe("UNKNOWN");
  });

  test("accepts only one of the ten fixed module keys", () => {
    expect(parseModuleKeyParam("market-overview")).toBe("market-overview");
    expect(parseModuleKeyParam("ai-advisor")).toBe("ai-advisor");
    expect(parseModuleKeyParam("bad-module")).toBeNull();
  });
});
