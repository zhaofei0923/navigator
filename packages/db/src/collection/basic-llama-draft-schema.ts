import { isProxy } from "node:util/types";

import {
  CREDIBILITIES,
  INDUSTRY_TAGS,
  TECH_TAGS,
} from "@navigator/shared-types/schema";

import {
  SAFE_RUN_ID, expectUtcRfc3339Timestamp, isEnumValue, isHttpUrl,
} from "../seed/basic-country-validation-utils.js";
import {
  BASIC_COLLECTION_AUDIT_SCHEMA_VERSION,
  BASIC_COLLECTION_REQUIRED_STATIC_FACT_PATHS,
  type BasicCollectionJsonValue, type BasicFactStatus,
} from "./basic-collection-contracts.js";

const JSON_INVALID = Symbol("json-invalid");
const MAX_JSON_DEPTH = 64;
const REGISTER_KEYS = ["schemaVersion", "runId", "countryCode", "sources"] as const;
const SOURCE_KEYS = ["sourceId", "sourceName", "sourceUrl", "retrievedAt", "publishedAt", "contentSha256", "evidenceLocators", "sourceFamily", "accessStatus", "accessNotes", "credibility", "discoveryOnly", "promptInjectionRisk"] as const;
const FACTS_KEYS = ["schemaVersion", "runId", "countryCode", "facts"] as const;
const FACT_KEYS = ["factId", "fieldPath", "status", "evidence", "extractionMethod", "uncertainty"] as const;
const EVIDENCE_KEYS = ["sourceId", "locator", "rawValue", "normalizedValue", "unit", "year"] as const;
const SOURCE_FAMILIES = ["international-organization", "official-statistics", "government", "energy-authority", "regulator", "grid-operator", "industry-association", "verified-research"] as const;
const ACCESS_STATUSES = ["open", "restricted", "unknown"] as const;
const PROMPT_RISKS = ["none", "suspected", "confirmed"] as const;
const FACT_STATUSES = ["candidate", "missing", "conflict", "untrusted"] as const;
const EXTRACTION_METHODS = ["deterministic", "hermes", "manual"] as const;
const STATIC_PATHS = new Set<string>(BASIC_COLLECTION_REQUIRED_STATIC_FACT_PATHS);
const INDICATOR_PATH = /^marketOverview\.keyIndicators\[(0|[1-9]\d*)\]\.(label|value|unit|year)$/;

type JsonRecord = Record<string, BasicCollectionJsonValue>;
export interface BasicLlamaSourceSnapshot {
  sourceId: string;
  locators: string[];
  safe: boolean;
}
export interface BasicLlamaEvidenceSnapshot {
  sourceId: string;
  locator: string;
  normalizedValue: BasicCollectionJsonValue;
}
export interface BasicLlamaFactSnapshot {
  factId: string;
  fieldPath: string;
  status: BasicFactStatus;
  evidence: BasicLlamaEvidenceSnapshot[];
}
export interface BasicLlamaRegisterSnapshot {
  runId: string;
  countryCode: string;
  sources: BasicLlamaSourceSnapshot[];
}
export interface BasicLlamaFactsSnapshot {
  runId: string;
  countryCode: string;
  facts: BasicLlamaFactSnapshot[];
}

export function parseBasicLlamaRegisterSnapshot(
  value: BasicCollectionJsonValue,
): BasicLlamaRegisterSnapshot | null {
  const record = exactRecord(value, REGISTER_KEYS);
  if (record === null || valueAt(record, "schemaVersion") !== BASIC_COLLECTION_AUDIT_SCHEMA_VERSION) return null;
  const runId = valueAt(record, "runId");
  const countryCode = valueAt(record, "countryCode");
  const sourceValues = jsonArray(valueAt(record, "sources"));
  if (!isSafeRunId(runId) || !isCountryCode(countryCode) || sourceValues === null) return null;
  const sources: BasicLlamaSourceSnapshot[] = [];
  for (const item of sourceValues) {
    const source = parseSource(item);
    if (source === null) return null;
    sources.push(source);
  }
  return uniqueBy(sources, ({ sourceId }) => sourceId) ? { runId, countryCode, sources } : null;
}

function parseSource(value: BasicCollectionJsonValue): BasicLlamaSourceSnapshot | null {
  const source = exactRecord(value, SOURCE_KEYS);
  if (source === null) return null;
  const sourceId = valueAt(source, "sourceId");
  const locators = nonBlankStrings(valueAt(source, "evidenceLocators"));
  const family = valueAt(source, "sourceFamily");
  const access = valueAt(source, "accessStatus");
  const credibility = valueAt(source, "credibility");
  const discoveryOnly = valueAt(source, "discoveryOnly");
  const promptRisk = valueAt(source, "promptInjectionRisk");
  if (!isNonBlank(sourceId) || !isNonBlank(valueAt(source, "sourceName")) || locators === null) return null;
  if (!isHttpUrl(valueAt(source, "sourceUrl")) || !isTimestamp(valueAt(source, "retrievedAt"))) return null;
  if (!isNullableTimestamp(valueAt(source, "publishedAt")) || !isSha256(valueAt(source, "contentSha256"))) return null;
  if (!isEnumValue(family, SOURCE_FAMILIES) || !isEnumValue(access, ACCESS_STATUSES)) return null;
  if (!isNullableText(valueAt(source, "accessNotes")) || !isEnumValue(credibility, CREDIBILITIES)) return null;
  if (typeof discoveryOnly !== "boolean" || !isEnumValue(promptRisk, PROMPT_RISKS)) return null;
  const safe = access === "open" && credibility !== "UNVERIFIED" && !discoveryOnly && promptRisk === "none";
  return { sourceId, locators, safe };
}

export function parseBasicLlamaFactsSnapshot(
  value: BasicCollectionJsonValue,
): BasicLlamaFactsSnapshot | null {
  const record = exactRecord(value, FACTS_KEYS);
  if (record === null || valueAt(record, "schemaVersion") !== BASIC_COLLECTION_AUDIT_SCHEMA_VERSION) return null;
  const runId = valueAt(record, "runId");
  const countryCode = valueAt(record, "countryCode");
  const factValues = jsonArray(valueAt(record, "facts"));
  if (!isSafeRunId(runId) || !isCountryCode(countryCode) || factValues === null) return null;
  const facts: BasicLlamaFactSnapshot[] = [];
  for (const item of factValues) {
    const fact = parseFact(item);
    if (fact === null) return null;
    facts.push(fact);
  }
  return uniqueBy(facts, ({ factId }) => factId) ? { runId, countryCode, facts } : null;
}

function parseFact(value: BasicCollectionJsonValue): BasicLlamaFactSnapshot | null {
  const fact = exactRecord(value, FACT_KEYS);
  if (fact === null) return null;
  const factId = valueAt(fact, "factId");
  const fieldPath = valueAt(fact, "fieldPath");
  const status = valueAt(fact, "status");
  const method = valueAt(fact, "extractionMethod");
  const evidenceValues = jsonArray(valueAt(fact, "evidence"));
  if (!isNonBlank(factId) || !isAllowedPath(fieldPath) || !isEnumValue(status, FACT_STATUSES)) return null;
  if (!isEnumValue(method, EXTRACTION_METHODS) || !isNullableText(valueAt(fact, "uncertainty")) || evidenceValues === null) return null;
  const evidence: BasicLlamaEvidenceSnapshot[] = [];
  for (const item of evidenceValues) {
    const parsed = parseEvidence(item);
    if (parsed === null) return null;
    evidence.push(parsed);
  }
  return validEvidenceCardinality(status, evidence) ? { factId, fieldPath, status, evidence } : null;
}

function parseEvidence(value: BasicCollectionJsonValue): BasicLlamaEvidenceSnapshot | null {
  const evidence = exactRecord(value, EVIDENCE_KEYS);
  if (evidence === null) return null;
  const sourceId = valueAt(evidence, "sourceId");
  const locator = valueAt(evidence, "locator");
  const year = valueAt(evidence, "year");
  if (!isNonBlank(sourceId) || !isNonBlank(locator) || !isNullableText(valueAt(evidence, "unit"))) return null;
  if (!(year === null || typeof year === "number" && Number.isFinite(year))) return null;
  return { sourceId, locator, normalizedValue: valueAt(evidence, "normalizedValue") };
}

export function parseBasicLlamaIndicatorPath(
  path: string,
): { index: number; key: string } | null {
  const match = INDICATOR_PATH.exec(path);
  return match === null ? null : { index: Number(match[1]), key: match[2]! };
}

function validEvidenceCardinality(status: BasicFactStatus, evidence: BasicLlamaEvidenceSnapshot[]): boolean {
  if (status === "candidate" || status === "untrusted") return evidence.length > 0;
  if (status === "missing") return evidence.length === 0;
  return new Set(evidence.map(({ sourceId }) => sourceId)).size >= 2;
}
function isAllowedPath(value: BasicCollectionJsonValue): value is string {
  return isNonBlank(value) && (STATIC_PATHS.has(value) || INDICATOR_PATH.test(value));
}
function isSafeRunId(value: BasicCollectionJsonValue): value is string { return isNonBlank(value) && SAFE_RUN_ID.test(value); }
function isCountryCode(value: BasicCollectionJsonValue): value is string { return typeof value === "string" && /^[A-Z]{2}$/.test(value); }
function isNonBlank(value: BasicCollectionJsonValue): value is string { return typeof value === "string" && value.trim() !== ""; }
function isNullableText(value: BasicCollectionJsonValue): boolean { return value === null || isNonBlank(value); }
function isTimestamp(value: BasicCollectionJsonValue): value is string { const errors: string[] = []; expectUtcRfc3339Timestamp(value, "timestamp", errors); return errors.length === 0; }
function isNullableTimestamp(value: BasicCollectionJsonValue): boolean { return value === null || isTimestamp(value); }
function isSha256(value: BasicCollectionJsonValue): boolean { return typeof value === "string" && /^[0-9a-f]{64}$/.test(value); }
function nonBlankStrings(value: BasicCollectionJsonValue): string[] | null { return Array.isArray(value) && value.length > 0 && value.every(isNonBlank) ? value : null; }
function uniqueBy<T>(values: readonly T[], key: (value: T) => string): boolean { const keys = values.map(key); return new Set(keys).size === keys.length; }
function jsonArray(value: BasicCollectionJsonValue): BasicCollectionJsonValue[] | null { return Array.isArray(value) ? value : null; }
function valueAt(record: JsonRecord, key: string): BasicCollectionJsonValue { return record[key]!; }
function exactRecord(value: BasicCollectionJsonValue, keys: readonly string[]): JsonRecord | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key)) ? value : null;
}

export type BasicLlamaJsonSnapshot = { valid: true; data: BasicCollectionJsonValue } | { valid: false };
export function readBasicLlamaExactRuntimeRecord(
  value: unknown,
  keys: readonly string[],
): ReadonlyMap<string, unknown> | null {
  try {
    if (typeof value !== "object" || value === null || isProxy(value) || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))) return null;
    const result = new Map<string, unknown>();
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) return null;
      result.set(key, descriptor.value);
    }
    return result;
  } catch { return null; }
}
export function readBasicLlamaStandardArray(value: unknown): unknown[] | null {
  try {
    if (typeof value !== "object" || value === null || isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
    const length = Object.getOwnPropertyDescriptor(value, "length");
    if (length === undefined || !Object.hasOwn(length, "value") || typeof length.value !== "number" || Reflect.ownKeys(value).length !== length.value + 1) return null;
    const result: unknown[] = [];
    for (let index = 0; index < length.value; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) return null;
      result.push(descriptor.value);
    }
    return result;
  } catch { return null; }
}
export function snapshotBasicLlamaJson(value: unknown): BasicLlamaJsonSnapshot {
  const data = snapshotJsonAt(value, 0, new Set<object>());
  return data === JSON_INVALID ? { valid: false } : { valid: true, data };
}
function snapshotJsonAt(value: unknown, depth: number, ancestors: Set<object>): BasicCollectionJsonValue | typeof JSON_INVALID {
  try {
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number") return Number.isFinite(value) ? value : JSON_INVALID;
    if (typeof value !== "object" || depth >= MAX_JSON_DEPTH || isProxy(value) || ancestors.has(value)) return JSON_INVALID;
    ancestors.add(value);
    const result = Array.isArray(value) ? snapshotArray(value, depth, ancestors) : snapshotRecord(value, depth, ancestors);
    ancestors.delete(value);
    return result;
  } catch { return JSON_INVALID; }
}
function snapshotArray(value: unknown[], depth: number, ancestors: Set<object>): BasicCollectionJsonValue[] | typeof JSON_INVALID {
  if (Object.getPrototypeOf(value) !== Array.prototype) return JSON_INVALID;
  const length = Object.getOwnPropertyDescriptor(value, "length");
  if (length === undefined || !Object.hasOwn(length, "value") || typeof length.value !== "number" ||
      !Number.isSafeInteger(length.value) || length.value < 0 || Reflect.ownKeys(value).length !== length.value + 1) return JSON_INVALID;
  const result: BasicCollectionJsonValue[] = [];
  for (let index = 0; index < length.value; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) return JSON_INVALID;
    const child = snapshotJsonAt(descriptor.value, depth + 1, ancestors);
    if (child === JSON_INVALID) return JSON_INVALID;
    result.push(child);
  }
  return result;
}
function snapshotRecord(value: object, depth: number, ancestors: Set<object>): JsonRecord | typeof JSON_INVALID {
  if (Object.getPrototypeOf(value) !== Object.prototype) return JSON_INVALID;
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) return JSON_INVALID;
  const result: JsonRecord = {};
  for (const key of keys) {
    if (typeof key !== "string") return JSON_INVALID;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) return JSON_INVALID;
    const child = snapshotJsonAt(descriptor.value, depth + 1, ancestors);
    if (child === JSON_INVALID) return JSON_INVALID;
    Object.defineProperty(result, key, { value: child, enumerable: true, writable: true, configurable: true });
  }
  return result;
}

export function deepFreezeBasicLlamaValue<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreezeBasicLlamaValue(child);
  Object.freeze(value);
  return value;
}
function localizedTextSchema(): Record<string, unknown> {
  return { type: "object", additionalProperties: false, required: ["zh", "en"], properties: { zh: { type: "string" }, en: { type: "string" } } };
}
const schema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["overview", "population", "gdp", "gdpGrowth", "energyDemand", "renewableTarget", "keyIndicators", "source", "sourceUrl", "collectedAt", "updatedAt", "credibility", "reviewStatus", "aiUsable", "countryCode", "industryTags", "techTags"],
  properties: {
    overview: localizedTextSchema(),
    population: { type: ["number", "null"] },
    gdp: { type: ["number", "null"] },
    gdpGrowth: { type: ["number", "null"] },
    energyDemand: localizedTextSchema(),
    renewableTarget: localizedTextSchema(),
    keyIndicators: { type: "array", items: { type: "object", additionalProperties: false, required: ["label", "value", "unit", "year"], properties: { label: localizedTextSchema(), value: { type: "string" }, unit: { type: "string" }, year: { type: "number" } } } },
    source: { type: "string" },
    sourceUrl: { type: ["string", "null"] },
    collectedAt: { type: "string" },
    updatedAt: { type: "string" },
    credibility: { type: "string", enum: [...CREDIBILITIES] },
    reviewStatus: { const: "draft" },
    aiUsable: { const: false },
    countryCode: { type: "string", pattern: "^[A-Z]{2}$" },
    industryTags: { type: "array", items: { type: "string", enum: [...INDUSTRY_TAGS] } },
    techTags: { type: "array", items: { type: "string", enum: [...TECH_TAGS] } },
  },
};
deepFreezeBasicLlamaValue(schema);
export const BASIC_LLAMA_DRAFT_JSON_SCHEMA: Readonly<Record<string, unknown>> = schema;
