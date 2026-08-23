import { describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, isSupportedLocale, normalizeLocale } from "@/lib/i18n/config";
import { translate } from "@/lib/i18n/dictionary";

describe("locale configuration", () => {
  it("accepts only the supported locales and defaults to Chinese", () => {
    expect(isSupportedLocale("zh-CN")).toBe(true);
    expect(isSupportedLocale("en")).toBe(true);
    expect(isSupportedLocale("en-US")).toBe(false);
    expect(normalizeLocale("unexpected")).toBe(DEFAULT_LOCALE);
  });

  it("translates typed keys and interpolates values", () => {
    expect(translate("zh-CN", "nav.tools")).toBe("出海工具");
    expect(translate("en", "nav.tools")).toBe("Expansion Tools");
    expect(translate("en", "shell.baselineDate", { date: "2026-08-22" })).toBe(
      "Baseline date: 2026-08-22",
    );
  });
});
