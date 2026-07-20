import type {
  BasicProfileCategoryKey,
  BasicProfileFieldStatus,
} from "@navigator/shared-types/basic-profile";

import { parseBasicCsv } from "../basic-csv-parser.js";

export interface BasicProfileTabularRow {
  readonly category: BasicProfileCategoryKey;
  readonly key: string;
  readonly status: BasicProfileFieldStatus;
  readonly value: number | string | null;
  readonly unit: string | null;
  readonly year: number | null;
  readonly locator: string;
  readonly reason: Readonly<{ zh: string; en: string }> | null;
}

const CATEGORIES = new Set<string>([
  "countryBasics", "electricityMarket", "energyAccess", "renewableCapacity",
  "solarResource", "windResource", "policyOverview", "marketSummary",
]);
const REQUIRED = ["countryCode", "category", "key", "value", "unit", "year", "locator"];

export function parseBasicProfileTabularSnapshot(
  body: Uint8Array,
  countryCode: string,
): readonly BasicProfileTabularRow[] {
  try {
    if (!/^[A-Z]{2}$/.test(countryCode)) invalid();
    const table = parseBasicCsv(body);
    const reasonHeaders = table.headers.includes("reasonZh") || table.headers.includes("reasonEn");
    const expected = reasonHeaders ? [...REQUIRED, "reasonZh", "reasonEn"] : REQUIRED;
    if (!sameStrings(table.headers, expected)) invalid();
    const column = new Map(table.headers.map((header, index) => [header, index]));
    const rows = table.rows.filter((row) => row[column.get("countryCode")!] === countryCode)
      .map((row): BasicProfileTabularRow => {
        const category = row[column.get("category")!];
        const key = row[column.get("key")!];
        const rawValue = row[column.get("value")!];
        const rawUnit = row[column.get("unit")!];
        const rawYear = row[column.get("year")!];
        const locator = row[column.get("locator")!];
        const reasonZh = reasonHeaders ? row[column.get("reasonZh")!] : "";
        const reasonEn = reasonHeaders ? row[column.get("reasonEn")!] : "";
        if (
          category === undefined || !CATEGORIES.has(category) || key === undefined ||
          !/^[a-z][A-Za-z0-9]*$/.test(key) || locator === undefined || locator.trim() === "" ||
          rawValue === undefined || rawUnit === undefined || rawYear === undefined ||
          reasonZh === undefined || reasonEn === undefined
        ) invalid();
        const unavailable = rawValue === "";
        if (unavailable && (rawUnit !== "" || rawYear !== "" || reasonZh.trim() === "" || reasonEn.trim() === "")) invalid();
        const numeric = rawValue === "" ? null : strictNumber(rawValue);
        const value = rawValue === "" ? null : numeric ?? rawValue;
        const year = rawYear === "" ? null : strictInteger(rawYear);
        return Object.freeze({
          category: category as BasicProfileCategoryKey,
          key,
          status: unavailable ? "NOT_AVAILABLE" : "AVAILABLE",
          value,
          unit: rawUnit === "" ? null : rawUnit,
          year,
          locator,
          reason: unavailable ? Object.freeze({ zh: reasonZh, en: reasonEn }) : null,
        });
      });
    return Object.freeze(rows);
  } catch {
    throw new Error("basic profile tabular snapshot is invalid");
  }
}

function strictNumber(value: string): number | null {
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function strictInteger(value: string): number {
  if (!/^[1-9]\d{3}$/.test(value)) invalid();
  return Number(value);
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function invalid(): never {
  throw new Error("invalid");
}
