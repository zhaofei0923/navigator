import { describe, expect, test } from "vitest";

import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE_NAME,
  getLocalizedPathname,
  isLocale,
  locales,
} from "./routing.js";

describe("web locale routing", () => {
  test("supports only the documented locales with zh-CN as default", () => {
    expect(locales).toEqual(["zh-CN", "en"]);
    expect(DEFAULT_LOCALE).toBe("zh-CN");
    expect(isLocale("zh-CN")).toBe(true);
    expect(isLocale("en")).toBe(true);
    expect(isLocale("id")).toBe(false);
  });

  test("exposes the persistent locale cookie name", () => {
    expect(LOCALE_COOKIE_NAME).toBe("NEXT_LOCALE");
  });

  test("language switching keeps the current path, query, and hash", () => {
    expect(getLocalizedPathname("/zh-CN/countries/ID", "en")).toBe(
      "/en/countries/ID",
    );
    expect(getLocalizedPathname("/en/reports?type=market#latest", "zh-CN")).toBe(
      "/zh-CN/reports?type=market#latest",
    );
    expect(getLocalizedPathname("/reports", "en")).toBe("/en/reports");
    expect(getLocalizedPathname("/", "zh-CN")).toBe("/zh-CN");
  });
});
