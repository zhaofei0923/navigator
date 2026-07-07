import type { Locale } from "./schema.js";

export interface LocalizedText {
  zh: string;
  en: string;
}

export function pickLocale(
  text: LocalizedText | undefined | null,
  locale: Locale,
): { value: string; fallback: boolean } {
  const primary = text?.[locale === "zh-CN" ? "zh" : "en"];
  if (primary !== undefined && primary.trim() !== "") {
    return { value: primary, fallback: false };
  }

  const other = text?.[locale === "zh-CN" ? "en" : "zh"];
  if (other !== undefined && other.trim() !== "") {
    return { value: other, fallback: true };
  }

  return { value: "", fallback: true };
}
