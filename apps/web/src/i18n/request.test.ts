import { describe, expect, test } from "vitest";

import { resolveRequestLocale } from "./request-locale.js";

describe("web i18n request config", () => {
  test("prefers an explicit locale over the request locale", async () => {
    expect(resolveRequestLocale("en", "zh-CN")).toBe("en");
  });

  test("falls back to zh-CN for invalid request locales", async () => {
    expect(resolveRequestLocale(undefined, "fr")).toBe("zh-CN");
  });
});
