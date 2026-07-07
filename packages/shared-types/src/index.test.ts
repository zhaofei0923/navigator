import { describe, expect, test } from "vitest";

import { pickLocale, type LocalizedText } from "./index.js";

describe("@navigator/shared-types", () => {
  test("returns zh text for zh-CN without fallback", () => {
    const text: LocalizedText = { zh: "中文内容", en: "English content" };

    expect(pickLocale(text, "zh-CN")).toEqual({
      value: "中文内容",
      fallback: false,
    });
  });

  test("returns en text for en without fallback", () => {
    const text: LocalizedText = { zh: "中文内容", en: "English content" };

    expect(pickLocale(text, "en")).toEqual({
      value: "English content",
      fallback: false,
    });
  });

  test("falls back to en when zh is missing", () => {
    const text = { en: "English content" } as unknown as LocalizedText;

    expect(pickLocale(text, "zh-CN")).toEqual({
      value: "English content",
      fallback: true,
    });
  });

  test("falls back to zh when en is missing", () => {
    const text = { zh: "中文内容" } as unknown as LocalizedText;

    expect(pickLocale(text, "en")).toEqual({
      value: "中文内容",
      fallback: true,
    });
  });

  test("falls back when the primary text is blank", () => {
    const text: LocalizedText = { zh: "   ", en: "English content" };

    expect(pickLocale(text, "zh-CN")).toEqual({
      value: "English content",
      fallback: true,
    });
  });

  test("returns an empty fallback when all text is missing", () => {
    const text = {} as unknown as LocalizedText;

    expect(pickLocale(text, "zh-CN")).toEqual({
      value: "",
      fallback: true,
    });
  });

  test("returns an empty fallback for null or undefined text", () => {
    expect(pickLocale(null, "zh-CN")).toEqual({ value: "", fallback: true });
    expect(pickLocale(undefined, "en")).toEqual({
      value: "",
      fallback: true,
    });
  });
});
