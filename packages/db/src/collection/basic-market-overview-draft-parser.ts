import { isProxy } from "node:util/types";

import {
  CREDIBILITIES,
  INDUSTRY_TAGS,
  TECH_TAGS,
} from "@navigator/shared-types/schema";

import {
  expectUtcRfc3339Timestamp,
  isEnumValue,
  isHttpUrl,
  KEY_INDICATOR_KEYS,
  LOCALIZED_TEXT_KEYS,
} from "../seed/basic-country-validation-utils.js";
import type {
  BasicDraftKeyIndicator,
  BasicMarketOverviewDraft,
} from "./basic-collection-contracts.js";

const DRAFT_KEYS = [
  "overview", "population", "gdp", "gdpGrowth", "energyDemand", "renewableTarget",
  "keyIndicators", "source", "sourceUrl", "collectedAt", "updatedAt", "credibility",
  "reviewStatus", "aiUsable", "countryCode", "industryTags", "techTags",
] as const;

export interface BasicMarketOverviewDraftParseResult {
  data: BasicMarketOverviewDraft | null;
  errors: string[];
}

export function parseBasicMarketOverviewDraft(
  value: unknown,
): BasicMarketOverviewDraftParseResult {
  const parsed = reconstructBasicMarketOverviewDraft(value);
  return {
    data: parsed.errors.length === 0 ? parsed.data : null,
    errors: parsed.errors,
  };
}

export function parseBasicMarketOverviewDraftForAudit(value: unknown): {
  data: BasicMarketOverviewDraft | null;
  errors: string[];
} {
  return reconstructBasicMarketOverviewDraft(value);
}

function reconstructBasicMarketOverviewDraft(
  value: unknown,
): BasicMarketOverviewDraftParseResult {
  const errors: string[] = [];
  const draft = exactDataRecord(value, DRAFT_KEYS, "marketOverviewDraft", errors);
  if (draft === null) return { data: null, errors };
  const source = text(draft.get("source"), "marketOverviewDraft.source", errors);
  const sourceUrl = nullableUrl(draft.get("sourceUrl"), "marketOverviewDraft.sourceUrl", errors);
  if (sourceUrl === null && !source.includes("sourceUrl null")) {
    errors.push("marketOverviewDraft.source must explain why sourceUrl is null");
  }
  if (draft.get("reviewStatus") !== "draft") {
    errors.push("marketOverviewDraft.reviewStatus must be draft");
  }
  if (draft.get("aiUsable") !== false) {
    errors.push("marketOverviewDraft.aiUsable must be false");
  }
  const data: BasicMarketOverviewDraft = {
    overview: localized(draft.get("overview"), "marketOverviewDraft.overview", errors),
    population: nullableNumber(draft.get("population"), "marketOverviewDraft.population", errors),
    gdp: nullableNumber(draft.get("gdp"), "marketOverviewDraft.gdp", errors),
    gdpGrowth: nullableNumber(draft.get("gdpGrowth"), "marketOverviewDraft.gdpGrowth", errors),
    energyDemand: localized(draft.get("energyDemand"), "marketOverviewDraft.energyDemand", errors),
    renewableTarget: localized(draft.get("renewableTarget"), "marketOverviewDraft.renewableTarget", errors),
    keyIndicators: indicators(draft.get("keyIndicators"), errors),
    source,
    sourceUrl,
    collectedAt: timestamp(draft.get("collectedAt"), "marketOverviewDraft.collectedAt", errors),
    updatedAt: timestamp(draft.get("updatedAt"), "marketOverviewDraft.updatedAt", errors),
    credibility: enumValue(draft.get("credibility"), CREDIBILITIES, "marketOverviewDraft.credibility", errors),
    reviewStatus: "draft",
    aiUsable: false,
    countryCode: country(draft.get("countryCode"), "marketOverviewDraft.countryCode", errors),
    industryTags: enumValues(draft.get("industryTags"), INDUSTRY_TAGS, "marketOverviewDraft.industryTags", errors),
    techTags: enumValues(draft.get("techTags"), TECH_TAGS, "marketOverviewDraft.techTags", errors),
  };
  return { data, errors };
}

function indicators(value: unknown, errors: string[]): BasicDraftKeyIndicator[] {
  const array = standardArray(value, "marketOverviewDraft.keyIndicators", errors);
  if (array === null) return [];
  return array.map((item, index) => indicator(item, `marketOverviewDraft.keyIndicators[${index}]`, errors));
}

function indicator(value: unknown, label: string, errors: string[]): BasicDraftKeyIndicator {
  const record = exactDataRecord(value, KEY_INDICATOR_KEYS, label, errors);
  if (record === null) return { label: { zh: "", en: "" }, value: "", unit: "", year: 0 };
  return {
    label: localized(record.get("label"), `${label}.label`, errors),
    value: text(record.get("value"), `${label}.value`, errors),
    unit: text(record.get("unit"), `${label}.unit`, errors),
    year: finiteNumber(record.get("year"), `${label}.year`, errors),
  };
}

function localized(value: unknown, label: string, errors: string[]) {
  const record = exactDataRecord(value, LOCALIZED_TEXT_KEYS, label, errors);
  if (record === null) return { zh: "", en: "" };
  const zh = string(record.get("zh"), `${label}.zh`, errors);
  const en = string(record.get("en"), `${label}.en`, errors);
  if (zh.trim() === "" && en.trim() === "") errors.push(`${label} must contain zh or en text`);
  return { zh, en };
}

function enumValues<T extends string>(value: unknown, allowed: readonly T[], label: string, errors: string[]): T[] {
  const array = standardArray(value, label, errors);
  return array === null ? [] : array.map((item, index) => enumValue(item, allowed, `${label}[${index}]`, errors));
}

function exactDataRecord(
  value: unknown,
  expectedKeys: readonly string[],
  label: string,
  errors: string[],
): ReadonlyMap<string, unknown> | null {
  try {
    if (
      typeof value !== "object" ||
      value === null ||
      isProxy(value) ||
      Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype
    ) {
      errors.push(`${label} must have exactly ${keyList(expectedKeys)} own keys`);
      return null;
    }
    const keys = Reflect.ownKeys(value);
    if (keys.length !== expectedKeys.length || keys.some((key) => typeof key !== "string" || !expectedKeys.includes(key))) {
      errors.push(`${label} must have exactly ${keyList(expectedKeys)} own keys`);
      return null;
    }
    const properties = new Map<string, unknown>();
    for (const key of expectedKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
        errors.push(`${label} must use enumerable data properties`);
        return null;
      }
      properties.set(key, descriptor.value);
    }
    return properties;
  } catch {
    errors.push(`${label} must have exactly ${keyList(expectedKeys)} own keys`);
    return null;
  }
}

function standardArray(value: unknown, label: string, errors: string[]): unknown[] | null {
  try {
    if (
      typeof value !== "object" ||
      value === null ||
      isProxy(value) ||
      !Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Array.prototype
    ) throw new Error();
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (lengthDescriptor === undefined || lengthDescriptor.enumerable || !Object.hasOwn(lengthDescriptor, "value") || typeof lengthDescriptor.value !== "number" || !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0 || Reflect.ownKeys(value).length !== lengthDescriptor.value + 1) throw new Error();
    const result: unknown[] = [];
    for (let index = 0; index < lengthDescriptor.value; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) throw new Error();
      result.push(descriptor.value);
    }
    return result;
  } catch {
    errors.push(`${label} must be a standard JSON array`);
    return null;
  }
}

function text(value: unknown, label: string, errors: string[]): string {
  const parsed = string(value, label, errors);
  if (parsed.trim() === "") errors.push(`${label} must be a non-empty string`);
  return parsed;
}
function string(value: unknown, label: string, errors: string[]): string { if (typeof value === "string") return value; errors.push(`${label} must be a string`); return ""; }
function finiteNumber(value: unknown, label: string, errors: string[]): number { if (typeof value === "number" && Number.isFinite(value)) return value; errors.push(`${label} must be a finite number`); return 0; }
function nullableNumber(value: unknown, label: string, errors: string[]): number | null { return value === null ? null : finiteNumber(value, label, errors); }
function enumValue<T extends string>(value: unknown, allowed: readonly T[], label: string, errors: string[]): T { if (isEnumValue(value, allowed)) return value; errors.push(`${label} must be one of ${allowed.join(", ")}`); return allowed[0]!; }
function timestamp(value: unknown, label: string, errors: string[]): string { const parsed = text(value, label, errors); expectUtcRfc3339Timestamp(parsed, label, errors); return parsed; }
function url(value: unknown, label: string, errors: string[]): string { const parsed = text(value, label, errors); if (!isHttpUrl(parsed)) errors.push(`${label} must be an HTTP(S) URL`); return parsed; }
function nullableUrl(value: unknown, label: string, errors: string[]): string | null { return value === null ? null : url(value, label, errors); }
function country(value: unknown, label: string, errors: string[]): string { const parsed = text(value, label, errors); if (!/^[A-Z]{2}$/.test(parsed)) errors.push(`${label} must be an uppercase two-letter country code`); return parsed; }
function keyList(keys: readonly string[]): string { return `${keys.slice(0, -1).join(", ")}, and ${keys.at(-1)}`; }
