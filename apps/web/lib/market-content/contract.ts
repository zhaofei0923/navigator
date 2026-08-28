import type { Basic60Locale } from "@/lib/basic60/types";
import type { MarketOverviewEnvelope } from "@/lib/market-content/types";

type UnknownRecord = Record<string, unknown>;
const WHITESPACE = /[\p{White_Space}\u001C-\u001F]/gu;
const record = (value: unknown): value is UnknownRecord => typeof value === "object" && value !== null && !Array.isArray(value);
const keys = (value: UnknownRecord, fields: readonly string[]) => Object.keys(value).length === fields.length && fields.every((field) => Object.hasOwn(value, field));
const text = (value: unknown, limit = 100_000): value is string =>
  typeof value === "string" && value.replace(WHITESPACE, "").length > 0 && Array.from(value).length <= limit;

function date(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validMeta(value: unknown, code: string, locale: Basic60Locale): boolean {
  if (!record(value) || !keys(value, ["country_code", "content_version", "as_of", "locale"]) ||
    !/^[A-Z]{3}$/.test(code) || code === "CHN" || value.country_code !== code ||
    (locale !== "zh-CN" && locale !== "en") || value.locale !== locale ||
    !text(value.content_version, 80) || !date(value.as_of)) return false;
  const version = value.content_version.match(/^OVERVIEW-([A-Z]{3})-(\d{4})(\d{2})(\d{2})-R[1-9]\d*$/);
  if (!version || version[1] !== code) return false;
  const versionDate = `${version[2]}-${version[3]}-${version[4]}`;
  return date(versionDate) && value.as_of <= versionDate;
}

export function isMarketOverviewEnvelope(value: unknown, code: string, locale: Basic60Locale): value is MarketOverviewEnvelope {
  if (!record(value) || !keys(value, ["meta", "data"]) || !validMeta(value.meta, code, locale) ||
    !record(value.data) || !keys(value.data, ["title", "paragraphs", "disclaimer"]) ||
    !text(value.data.title) || !text(value.data.disclaimer) ||
    !Array.isArray(value.data.paragraphs) || value.data.paragraphs.length < 6 || value.data.paragraphs.length > 8 ||
    !value.data.paragraphs.every((paragraph) => text(paragraph))) return false;
  // Match the published contract's Unicode code-point count, not UTF-16 length.
  // Python whitespace includes U+001C–U+001F, but not the BOM.
  const count = Array.from(value.data.paragraphs.join("").replace(WHITESPACE, "")).length;
  return locale !== "zh-CN" || (count >= 1_500 && count <= 2_000);
}
