import { isProxy } from "node:util/types";

import {
  INDUSTRY_TAGS,
  REGIONS,
  TECH_TAGS,
} from "@navigator/shared-types/schema";

import { SAFE_RUN_ID } from "../seed/basic-country-validation-utils.js";
import type { BasicCollectionJsonValue } from "./basic-collection-contracts.js";
import { classifyBasicV2FieldPath } from "./basic-collection-v2-contracts.js";
import {
  BASIC_COUNTRY_EDITORIAL_INPUT_SCHEMA_VERSION,
  type BasicCountryEditorialInput,
  type BasicEditorialEvidenceInput,
  type BasicEditorialItemInput,
} from "./basic-editorial-input-contracts.js";
import { deepFreezeBasicOfflineValue } from "./basic-offline-value.js";

export type {
  BasicCountryEditorialInput,
  BasicEditorialEvidenceInput,
  BasicEditorialItemInput,
} from "./basic-editorial-input-contracts.js";
export {
  BASIC_COUNTRY_EDITORIAL_INPUT_SCHEMA_VERSION,
} from "./basic-editorial-input-contracts.js";

const ERROR = "basic editorial input is invalid";
const MAX_ITEMS = 256;
const MAX_EVIDENCE = 32;
const MAX_ARRAY_ITEMS = 256;
const MAX_DEPTH = 64;
const MAX_STRING_BYTES = 65_536;
const INVALID = Symbol("invalid editorial input snapshot");
const ISO2 = /^[A-Z]{2}$/;
const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_VERSION = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const CONTROL_CHARACTER = /[\u0000-\u001F\u007F]/;
const INPUT_KEYS = [
  "schemaVersion",
  "runId",
  "countryCode",
  "catalogVersion",
  "catalogSha256",
  "primarySourceId",
  "items",
] as const;
const ITEM_KEYS = [
  "fieldPath",
  "normalizedValue",
  "evidence",
  "uncertainty",
] as const;
const EVIDENCE_KEYS = ["sourceId", "locator", "rawValue", "unit", "year"] as const;
const LOCALIZED_TEXT_KEYS = ["zh", "en"] as const;

type ExactRecord<Keys extends readonly string[]> =
  Record<Keys[number], BasicCollectionJsonValue>;

export function parseBasicCountryEditorialInput(
  value: unknown,
): BasicCountryEditorialInput {
  try {
    const snapshot = snapshotValue(value);
    if (snapshot === INVALID) invalid();
    const record = exactRecord(snapshot, INPUT_KEYS);
    if (record.schemaVersion !== BASIC_COUNTRY_EDITORIAL_INPUT_SCHEMA_VERSION) {
      invalid();
    }
    const items = array(record.items, MAX_ITEMS, true).map(parseItem);
    requireSortedUnique(items, ({ fieldPath }) => fieldPath);
    return deepFreezeBasicOfflineValue({
      schemaVersion: BASIC_COUNTRY_EDITORIAL_INPUT_SCHEMA_VERSION,
      runId: runId(record.runId),
      countryCode: countryCode(record.countryCode),
      catalogVersion: version(record.catalogVersion),
      catalogSha256: digest(record.catalogSha256),
      primarySourceId: safeId(record.primarySourceId),
      items,
    });
  } catch {
    throw new Error(ERROR);
  }
}

function parseItem(value: BasicCollectionJsonValue): BasicEditorialItemInput {
  const record = exactRecord(value, ITEM_KEYS);
  const fieldPath = text(record.fieldPath);
  const owner = classifyBasicV2FieldPath(fieldPath);
  if (owner !== "editorial" && owner !== "hybrid-name") invalid();
  if (owner === "hybrid-name" && fieldPath !== "country.name") invalid();
  const evidenceValues = array(record.evidence, MAX_EVIDENCE, false).map(
    parseEvidence,
  );
  requireSortedEvidence(evidenceValues);
  return {
    fieldPath,
    normalizedValue: normalizedValue(fieldPath, owner, record.normalizedValue),
    evidence: evidenceValues,
    uncertainty: nullableNonBlankText(record.uncertainty),
  };
}

function parseEvidence(
  value: BasicCollectionJsonValue,
): BasicEditorialEvidenceInput {
  const record = exactRecord(value, EVIDENCE_KEYS);
  if (record.unit !== null || record.year !== null) invalid();
  return {
    sourceId: safeId(record.sourceId),
    locator: locator(record.locator),
    rawValue: record.rawValue,
    unit: null,
    year: null,
  };
}

function normalizedValue(
  fieldPath: string,
  owner: "editorial" | "hybrid-name",
  value: BasicCollectionJsonValue,
): BasicCollectionJsonValue {
  if (owner === "hybrid-name") return localizedText(value);
  if (fieldPath === "country.region") return enumValue(value, REGIONS);
  if (fieldPath === "marketOverview.industryTags") {
    return enumArray(value, INDUSTRY_TAGS);
  }
  if (fieldPath === "marketOverview.techTags") {
    return enumArray(value, TECH_TAGS);
  }
  return localizedText(value);
}

function localizedText(
  value: BasicCollectionJsonValue,
): { readonly zh: string; readonly en: string } {
  const record = exactRecord(value, LOCALIZED_TEXT_KEYS);
  return {
    zh: nonBlankText(record.zh),
    en: nonBlankText(record.en),
  };
}

function enumArray<const Values extends readonly string[]>(
  value: BasicCollectionJsonValue,
  values: Values,
): Values[number][] {
  const result = array(value, MAX_ARRAY_ITEMS, true).map((entry) =>
    enumValue(entry, values));
  requireSortedUnique(result, identity);
  return result;
}

function snapshotValue(value: unknown): BasicCollectionJsonValue | typeof INVALID {
  return snapshotAt(value, 0, new Set<object>());
}

function snapshotAt(
  value: unknown,
  depth: number,
  ancestors: Set<object>,
): BasicCollectionJsonValue | typeof INVALID {
  try {
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "string") return boundedText(value) ? value : INVALID;
    if (typeof value === "number") return Number.isFinite(value) ? value : INVALID;
    if (
      typeof value !== "object" ||
      depth >= MAX_DEPTH ||
      isProxy(value) ||
      ancestors.has(value)
    ) return INVALID;
    ancestors.add(value);
    const result = Array.isArray(value)
      ? snapshotArray(value, depth, ancestors)
      : snapshotRecord(value, depth, ancestors);
    ancestors.delete(value);
    return result;
  } catch {
    return INVALID;
  }
}

function snapshotArray(
  value: unknown[],
  depth: number,
  ancestors: Set<object>,
): BasicCollectionJsonValue[] | typeof INVALID {
  if (Object.getPrototypeOf(value) !== Array.prototype) return INVALID;
  const length = Object.getOwnPropertyDescriptor(value, "length");
  if (
    length === undefined ||
    !Object.hasOwn(length, "value") ||
    typeof length.value !== "number" ||
    !Number.isSafeInteger(length.value) ||
    length.value < 0 ||
    length.value > MAX_ARRAY_ITEMS ||
    Reflect.ownKeys(value).length !== length.value + 1
  ) return INVALID;
  const result: BasicCollectionJsonValue[] = [];
  for (let index = 0; index < length.value; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, "value")
    ) return INVALID;
    const child = snapshotAt(descriptor.value, depth + 1, ancestors);
    if (child === INVALID) return INVALID;
    result.push(child);
  }
  return result;
}

function snapshotRecord(
  value: object,
  depth: number,
  ancestors: Set<object>,
): { [key: string]: BasicCollectionJsonValue } | typeof INVALID {
  if (Object.getPrototypeOf(value) !== Object.prototype) return INVALID;
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) return INVALID;
  const result: { [key: string]: BasicCollectionJsonValue } = {};
  for (const key of (keys as string[]).sort(compareText)) {
    if (!boundedText(key)) return INVALID;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, "value")
    ) return INVALID;
    const child = snapshotAt(descriptor.value, depth + 1, ancestors);
    if (child === INVALID) return INVALID;
    Object.defineProperty(result, key, {
      value: child,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return result;
}

function exactRecord<const Keys extends readonly string[]>(
  value: BasicCollectionJsonValue,
  keys: Keys,
): ExactRecord<Keys> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid();
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))
  ) invalid();
  return value as ExactRecord<Keys>;
}

function array(
  value: BasicCollectionJsonValue,
  maximum: number,
  allowEmpty: boolean,
): readonly BasicCollectionJsonValue[] {
  if (
    !Array.isArray(value) ||
    value.length > maximum ||
    (!allowEmpty && value.length === 0)
  ) invalid();
  return value;
}

function requireSortedUnique<T>(
  values: readonly T[],
  key: (value: T) => string,
): void {
  let previous: string | null = null;
  for (const value of values) {
    const current = key(value);
    if (previous !== null && previous >= current) invalid();
    previous = current;
  }
}

function requireSortedEvidence(
  values: readonly BasicEditorialEvidenceInput[],
): void {
  let previous: BasicEditorialEvidenceInput | null = null;
  for (const value of values) {
    if (
      previous !== null &&
      (previous.sourceId > value.sourceId ||
        (previous.sourceId === value.sourceId && previous.locator >= value.locator))
    ) invalid();
    previous = value;
  }
}

function enumValue<const Values extends readonly string[]>(
  value: BasicCollectionJsonValue,
  values: Values,
): Values[number] {
  if (typeof value !== "string" || !values.includes(value)) invalid();
  return value as Values[number];
}

function runId(value: BasicCollectionJsonValue): string {
  const result = text(value);
  if (!SAFE_RUN_ID.test(result)) invalid();
  return result;
}

function countryCode(value: BasicCollectionJsonValue): string {
  const result = text(value);
  if (!ISO2.test(result)) invalid();
  return result;
}

function version(value: BasicCollectionJsonValue): string {
  const result = text(value);
  if (!SAFE_VERSION.test(result)) invalid();
  return result;
}

function safeId(value: BasicCollectionJsonValue): string {
  const result = text(value);
  if (!SAFE_ID.test(result)) invalid();
  return result;
}

function digest(value: BasicCollectionJsonValue): string {
  const result = text(value);
  if (!SHA256.test(result)) invalid();
  return result;
}

function locator(value: BasicCollectionJsonValue): string {
  const result = nonBlankText(value);
  if (result.trim() !== result || CONTROL_CHARACTER.test(result)) invalid();
  return result;
}

function nullableNonBlankText(value: BasicCollectionJsonValue): string | null {
  return value === null ? null : nonBlankText(value);
}

function nonBlankText(value: BasicCollectionJsonValue): string {
  const result = text(value);
  if (result.trim() === "") invalid();
  return result;
}

function text(value: BasicCollectionJsonValue): string {
  if (typeof value !== "string" || !boundedText(value)) invalid();
  return value;
}

function boundedText(value: string): boolean {
  return isWellFormedUnicode(value) &&
    Buffer.byteLength(value, "utf8") <= MAX_STRING_BYTES;
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xD800 && codeUnit <= 0xDBFF) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isInteger(next) || next < 0xDC00 || next > 0xDFFF) return false;
      index += 1;
    } else if (codeUnit >= 0xDC00 && codeUnit <= 0xDFFF) {
      return false;
    }
  }
  return true;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function identity(value: string): string {
  return value;
}

function invalid(): never {
  throw new Error(ERROR);
}
