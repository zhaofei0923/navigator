import { describe, expect, test } from "vitest";

import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE_NAME,
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
});
