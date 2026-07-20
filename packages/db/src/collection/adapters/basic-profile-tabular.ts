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
const WIND_RESOURCE_CLASSES = new Set([
  "poor", "fair", "good", "very-good", "excellent",
]);
const NUMERIC_FIELD_UNITS = Object.freeze({
  "electricityMarket.totalGeneration": "TWh",
  "electricityMarket.electricityConsumption": "TWh",
  "electricityMarket.renewableGenerationShare": "%",
  "renewableCapacity.totalRenewableCapacity": "GW",
  "renewableCapacity.solarCapacity": "GW",
  "renewableCapacity.windCapacity": "GW",
  "renewableCapacity.hydroCapacity": "GW",
  "solarResource.ghi": "kWh/m2/day",
  "solarResource.pvout": "kWh/kWp/day",
} as const);
const REVIEWED_TEXT_FIELDS = new Set([
  "electricityMarket.electricityMix",
  "solarResource.solarPotentialSummary",
]);

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
        validateReviewedGlobalField(category, key, unavailable, value, rawUnit, year);
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

function validateReviewedGlobalField(
  category: string,
  key: string,
  unavailable: boolean,
  value: number | string | null,
  rawUnit: string,
  year: number | null,
): void {
  const fieldPath = `${category}.${key}`;
  const numericUnit = NUMERIC_FIELD_UNITS[
    fieldPath as keyof typeof NUMERIC_FIELD_UNITS
  ];
  const windField = category === "windResource" &&
    (key === "onshoreWindClass" || key === "offshoreWindClass");
  const reviewedTextField = REVIEWED_TEXT_FIELDS.has(fieldPath);
  if (numericUnit === undefined && !windField && !reviewedTextField) invalid();
  if (unavailable) return;
  // This tabular contract has one scalar value column. Human-readable text must
  // stay unavailable until a future format can bind both languages atomically.
  if (reviewedTextField) invalid();
  if (year === null || year < 1900) invalid();
  if (numericUnit !== undefined) {
    if (typeof value !== "number" || !Number.isFinite(value) || rawUnit !== numericUnit) invalid();
    return;
  }
  if (
    typeof value !== "string" || !WIND_RESOURCE_CLASSES.has(value) || rawUnit !== ""
  ) invalid();
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
