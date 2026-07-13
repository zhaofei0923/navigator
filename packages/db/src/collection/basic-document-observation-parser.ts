import { isProxy } from "node:util/types";

import {
  expectUtcRfc3339Timestamp,
  SAFE_RUN_ID,
} from "../seed/basic-country-validation-utils.js";
import type { BasicCollectionJsonValue } from "./basic-collection-contracts.js";
import { classifyBasicV2FieldPath } from "./basic-collection-v2-contracts.js";
import {
  BASIC_DOCUMENT_OBSERVATION_PLAN_SCHEMA_VERSION,
  type BasicDocumentObservation,
  type BasicDocumentObservationCapture,
  type BasicDocumentObservationPlan,
} from "./basic-document-observation-contracts.js";
import { BASIC_RAW_CAPTURE_MAX_BYTES_V2 } from "./basic-source-v2-contracts.js";

export type {
  BasicDocumentObservation,
  BasicDocumentObservationCapture,
  BasicDocumentObservationPlan,
} from "./basic-document-observation-contracts.js";
export {
  BASIC_DOCUMENT_OBSERVATION_PLAN_SCHEMA_VERSION,
} from "./basic-document-observation-contracts.js";

const ERROR = "document observation plan is invalid";
const MAX_ARRAY_ITEMS = 256;
const MAX_DEPTH = 64;
const MAX_STRING_BYTES = 65_536;
const MAX_URL_BYTES = 8_192;
const INVALID = Symbol("invalid document observation snapshot");
const ISO2 = /^[A-Z]{2}$/;
const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_VERSION = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const QUOTED_STRING = /^"(?:[\t !#-\[\]-~]|\\[\t !-~])*"$/;
const PDF_LOCATOR = /^pdf:page=([1-9]\d*)#([\s\S]*)$/;
const RESERVED_LOCATOR = /^(?:https?:\/\/|url(?:[:=\/])|search(?:[:=\/])|metadata(?:[:=\/])|capture(?:[:=\/]))/i;
const CONTROL_CHARACTER = /[\u0000-\u001F\u007F]/;
const PLAN_KEYS = [
  "schemaVersion",
  "runId",
  "countryCode",
  "catalogVersion",
  "catalogSha256",
  "sourceId",
  "capture",
  "observations",
] as const;
const CAPTURE_KEYS = [
  "adapterId",
  "adapterVersion",
  "requestUrl",
  "retrievedAt",
  "contentType",
  "byteLength",
  "contentSha256",
] as const;
const SOURCE_FACT_KEYS = [
  "usage",
  "fieldPath",
  "locator",
  "rawValue",
  "normalizedValue",
  "unit",
  "year",
  "uncertainty",
] as const;
const EDITORIAL_EVIDENCE_KEYS = [
  "usage",
  "fieldPath",
  "locator",
  "rawValue",
] as const;

type ExactRecord<Keys extends readonly string[]> = Record<Keys[number], BasicCollectionJsonValue>;
type DocumentFormat = "html" | "pdf";

export function parseBasicDocumentObservationPlan(
  value: unknown,
): BasicDocumentObservationPlan {
  try {
    const snapshot = snapshotValue(value);
    if (snapshot === INVALID) invalid();
    const record = exactRecord(snapshot, PLAN_KEYS);
    if (record.schemaVersion !== BASIC_DOCUMENT_OBSERVATION_PLAN_SCHEMA_VERSION) {
      invalid();
    }
    const capture = parseCapture(record.capture);
    const observations = parseObservations(record.observations, capture.contentType);
    return deepFreeze({
      schemaVersion: BASIC_DOCUMENT_OBSERVATION_PLAN_SCHEMA_VERSION,
      runId: runId(record.runId),
      countryCode: countryCode(record.countryCode),
      catalogVersion: version(record.catalogVersion),
      catalogSha256: digest(record.catalogSha256),
      sourceId: safeId(record.sourceId),
      capture,
      observations,
    });
  } catch {
    throw new Error(ERROR);
  }
}

function parseCapture(value: BasicCollectionJsonValue): BasicDocumentObservationCapture {
  const record = exactRecord(value, CAPTURE_KEYS);
  const contentType = nonBlankText(record.contentType);
  const byteLength = record.byteLength;
  if (
    typeof byteLength !== "number" ||
    !Number.isSafeInteger(byteLength) ||
    byteLength < 0 ||
    byteLength > BASIC_RAW_CAPTURE_MAX_BYTES_V2
  ) invalid();
  return {
    adapterId: safeId(record.adapterId),
    adapterVersion: version(record.adapterVersion),
    requestUrl: requestUrl(record.requestUrl),
    retrievedAt: timestamp(record.retrievedAt),
    contentType,
    byteLength,
    contentSha256: digest(record.contentSha256),
  };
}

function parseObservations(
  value: BasicCollectionJsonValue,
  contentType: string,
): readonly BasicDocumentObservation[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ARRAY_ITEMS) {
    invalid();
  }
  const format = documentFormat(contentType);
  const observations = value.map((entry) => parseObservation(entry, format));
  requireSortedUnique(observations);
  return observations;
}

function parseObservation(
  value: BasicCollectionJsonValue,
  format: DocumentFormat,
): BasicDocumentObservation {
  const usage = readUsage(value);
  if (usage === "source-fact") {
    const record = exactRecord(value, SOURCE_FACT_KEYS);
    const fieldPath = sourceBackedPath(record.fieldPath);
    return {
      usage,
      fieldPath,
      locator: locator(record.locator, format),
      rawValue: record.rawValue,
      normalizedValue: record.normalizedValue,
      unit: nullableNonBlankText(record.unit),
      year: nullableFiniteNumber(record.year),
      uncertainty: nullableNonBlankText(record.uncertainty),
    };
  }
  const record = exactRecord(value, EDITORIAL_EVIDENCE_KEYS);
  return {
    usage,
    fieldPath: editorialPath(record.fieldPath),
    locator: locator(record.locator, format),
    rawValue: record.rawValue,
  };
}

function readUsage(value: BasicCollectionJsonValue): "source-fact" | "editorial-evidence" {
  const record = recordValue(value);
  const usage = record.usage;
  if (usage !== "source-fact" && usage !== "editorial-evidence") invalid();
  return usage;
}

function sourceBackedPath(value: BasicCollectionJsonValue): string {
  const path = nonBlankText(value);
  if (classifyBasicV2FieldPath(path) !== "source-backed") invalid();
  return path;
}

function editorialPath(value: BasicCollectionJsonValue): string {
  const path = nonBlankText(value);
  if (classifyBasicV2FieldPath(path) !== "editorial") invalid();
  return path;
}

function locator(value: BasicCollectionJsonValue, format: DocumentFormat): string {
  const result = nonBlankText(value);
  const location = format === "html"
    ? htmlLocation(result)
    : pdfAnchor(result);
  if (RESERVED_LOCATOR.test(location.trim())) invalid();
  return result;
}

function htmlLocation(value: string): string {
  if (!value.startsWith("html:")) invalid();
  const location = value.slice("html:".length);
  return reviewedLocatorPart(location);
}

function pdfAnchor(value: string): string {
  const match = PDF_LOCATOR.exec(value);
  if (match === null) invalid();
  const anchor = match[2];
  if (anchor === undefined) invalid();
  return reviewedLocatorPart(anchor);
}

function reviewedLocatorPart(value: string): string {
  if (
    value.trim() === "" ||
    value.trim() !== value ||
    CONTROL_CHARACTER.test(value)
  ) invalid();
  return value;
}

function documentFormat(value: string): DocumentFormat {
  if (value !== value.trim() || value.includes(",")) invalid();
  const parts = value.split(";");
  const mediaType = parts.shift()?.toLowerCase();
  if (
    mediaType === undefined ||
    !mediaTypePartsAreTokens(mediaType) ||
    !parts.every(isContentTypeParameter)
  ) invalid();
  if (mediaType === "text/html") return "html";
  if (mediaType === "application/pdf") return "pdf";
  invalid();
}

function mediaTypePartsAreTokens(value: string): boolean {
  const slash = value.indexOf("/");
  return slash > 0 && slash === value.lastIndexOf("/") &&
    TOKEN.test(value.slice(0, slash)) && TOKEN.test(value.slice(slash + 1));
}

function isContentTypeParameter(value: string): boolean {
  const parameter = value.trim();
  const equals = parameter.indexOf("=");
  if (equals <= 0) return false;
  const name = parameter.slice(0, equals);
  const parameterValue = parameter.slice(equals + 1);
  return TOKEN.test(name) &&
    (TOKEN.test(parameterValue) || QUOTED_STRING.test(parameterValue));
}

function requireSortedUnique(observations: readonly BasicDocumentObservation[]): void {
  let previous: string | null = null;
  for (const observation of observations) {
    const identity = `${observation.fieldPath}\0${observation.locator}`;
    if (previous !== null && previous >= identity) invalid();
    previous = identity;
  }
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
    if (typeof value === "string") return text(value);
    if (typeof value === "number") return Number.isFinite(value) ? value : INVALID;
    if (
      typeof value !== "object" ||
      depth >= MAX_DEPTH ||
      isProxy(value) ||
      ancestors.has(value)
    ) return INVALID;
    ancestors.add(value);
    const snapshot = Array.isArray(value)
      ? snapshotArray(value, depth, ancestors)
      : snapshotRecord(value, depth, ancestors);
    ancestors.delete(value);
    return snapshot;
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
  const stringKeys = keys as string[];
  const result: { [key: string]: BasicCollectionJsonValue } = {};
  for (const key of stringKeys.sort(compareText)) {
    if (
      !isWellFormedUnicode(key) ||
      Buffer.byteLength(key, "utf8") > MAX_STRING_BYTES
    ) return INVALID;
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
  const record = recordValue(value);
  const ownKeys = Reflect.ownKeys(record);
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))
  ) invalid();
  return record as ExactRecord<Keys>;
}

function recordValue(
  value: BasicCollectionJsonValue,
): { [key: string]: BasicCollectionJsonValue } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid();
  return value;
}

function nullableNonBlankText(value: BasicCollectionJsonValue): string | null {
  return value === null ? null : nonBlankText(value);
}

function nullableFiniteNumber(value: BasicCollectionJsonValue): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) invalid();
  return value;
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

function requestUrl(value: BasicCollectionJsonValue): string {
  const result = nonBlankText(value);
  if (Buffer.byteLength(result, "utf8") > MAX_URL_BYTES || result.trim() !== result) {
    invalid();
  }
  const parsed = new URL(result);
  if (parsed.toString() !== result) invalid();
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.hash !== ""
  ) invalid();
  return result;
}

function timestamp(value: BasicCollectionJsonValue): string {
  const result = text(value);
  const errors: string[] = [];
  expectUtcRfc3339Timestamp(result, "timestamp", errors);
  if (errors.length !== 0) invalid();
  return result;
}

function nonBlankText(value: BasicCollectionJsonValue): string {
  const result = text(value);
  if (result.trim() === "") invalid();
  return result;
}

function text(value: unknown): string {
  if (
    typeof value !== "string" ||
    !isWellFormedUnicode(value) ||
    Buffer.byteLength(value, "utf8") > MAX_STRING_BYTES
  ) invalid();
  return value;
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

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function invalid(): never {
  throw new Error("invalid document observation plan");
}
