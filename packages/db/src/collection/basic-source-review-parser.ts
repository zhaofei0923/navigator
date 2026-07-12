import {
  expectUtcRfc3339Timestamp,
  SAFE_RUN_ID,
} from "../seed/basic-country-validation-utils.js";
import { isProxy } from "node:util/types";
import {
  BASIC_MANUAL_SOURCE_REVIEW_SCHEMA_VERSION,
  BASIC_STRUCTURED_SOURCE_REVIEW_SCHEMA_VERSION,
  type BasicManualInjectionRisk,
  type BasicManualSourceReview,
  type BasicManualSourceReviewSource,
  type BasicReviewedSourceCheck,
  type BasicReviewIdentityExpectation,
  type BasicStructuredInjectionRisk,
  type BasicStructuredSourceReview,
  type BasicStructuredSourceReviewSource,
} from "./basic-source-review-contracts.js";

export type {
  BasicManualInjectionRisk,
  BasicManualSourceReview,
  BasicManualSourceReviewSource,
  BasicReviewedSourceCheck,
  BasicReviewIdentityExpectation,
  BasicStructuredInjectionRisk,
  BasicStructuredSourceReview,
  BasicStructuredSourceReviewSource,
} from "./basic-source-review-contracts.js";
export {
  BASIC_MANUAL_SOURCE_REVIEW_SCHEMA_VERSION,
  BASIC_STRUCTURED_SOURCE_REVIEW_SCHEMA_VERSION,
} from "./basic-source-review-contracts.js";

const STRUCTURED_ERROR = "structured source review is invalid";
const MANUAL_ERROR = "manual source review is invalid";
const MAX_SOURCE_REVIEWS = 64;
const MAX_ARRAY_ITEMS = 256;
const MAX_STRING_BYTES = 65_536;
const MAX_SNAPSHOT_DEPTH = 64;
const INVALID_SNAPSHOT = Symbol("invalid source review snapshot");
const ISO2 = /^[A-Z]{2}$/;
const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_VERSION = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const JSON_POINTER = /^json:(?:\/(?:[^~/]|~[01])*)*$/;
const CSV_LOCATOR = /^csv:\/rows\/(?:0|[1-9]\d*)\/columns\/(?:[^~/]|~[01])+$/;
const PDF_LOCATOR = /^pdf:page=(?:[1-9]\d*)#.+$/;
const STRUCTURED_KEYS = [
  "schemaVersion",
  "runId",
  "countryCode",
  "catalogVersion",
  "catalogSha256",
  "sources",
  "injectionRisks",
] as const;
const MANUAL_KEYS = [
  "schemaVersion",
  "runId",
  "countryCode",
  "catalogVersion",
  "catalogSha256",
  "sources",
] as const;
const EXPECTATION_KEYS = [
  "runId",
  "countryCode",
  "catalogVersion",
  "catalogSha256",
  "deterministicSourceIds",
  "manualSourceIds",
] as const;
const STRUCTURED_SOURCE_KEYS = ["sourceId", "sourceCheck"] as const;
const MANUAL_SOURCE_KEYS = [
  "sourceId",
  "publishedAt",
  "accessNotes",
  "promptInjectionRisk",
  "sourceCheck",
  "injectionRisks",
] as const;
const SOURCE_CHECK_KEYS = ["status", "notes"] as const;
const STRUCTURED_RISK_KEYS = [
  "sourceId",
  "locator",
  "severity",
  "details",
] as const;
const MANUAL_RISK_KEYS = ["locator", "severity", "details"] as const;

type ExactRecord<Keys extends readonly string[]> = Record<Keys[number], unknown>;
type ParsedExpectation = {
  readonly runId: string;
  readonly countryCode: string;
  readonly catalogVersion: string;
  readonly catalogSha256: string;
  readonly deterministicSourceIds: readonly string[];
  readonly manualSourceIds: readonly string[];
};

export function parseBasicStructuredSourceReview(
  value: unknown,
  expected: BasicReviewIdentityExpectation,
): BasicStructuredSourceReview {
  try {
    const identity = parseExpectation(expected);
    if (identity.deterministicSourceIds.length === 0) invalid();
    const record = snapshotExactRecord(value, STRUCTURED_KEYS);
    matchStructuredIdentity(record, identity);
    const sources = parseStructuredSources(record.sources, identity);
    const injectionRisks = parseStructuredRisks(
      record.injectionRisks,
      identity.deterministicSourceIds,
    );
    return freezeStructuredReview({
      schemaVersion: BASIC_STRUCTURED_SOURCE_REVIEW_SCHEMA_VERSION,
      runId: identity.runId,
      countryCode: identity.countryCode,
      catalogVersion: identity.catalogVersion,
      catalogSha256: identity.catalogSha256,
      sources,
      injectionRisks,
    });
  } catch {
    throw new Error(STRUCTURED_ERROR);
  }
}

export function parseBasicManualSourceReview(
  value: unknown,
  expected: BasicReviewIdentityExpectation,
): BasicManualSourceReview {
  try {
    const identity = parseExpectation(expected);
    if (identity.manualSourceIds.length === 0) invalid();
    const record = snapshotExactRecord(value, MANUAL_KEYS);
    matchManualIdentity(record, identity);
    const sources = parseManualSources(record.sources, identity);
    return freezeManualReview({
      schemaVersion: BASIC_MANUAL_SOURCE_REVIEW_SCHEMA_VERSION,
      runId: identity.runId,
      countryCode: identity.countryCode,
      catalogVersion: identity.catalogVersion,
      catalogSha256: identity.catalogSha256,
      sources,
    });
  } catch {
    throw new Error(MANUAL_ERROR);
  }
}

function parseExpectation(value: unknown): ParsedExpectation {
  const record = snapshotExactRecord(value, EXPECTATION_KEYS);
  const deterministicSourceIds = sourceIds(record.deterministicSourceIds, true);
  const manualSourceIds = sourceIds(record.manualSourceIds, true);
  if (intersects(deterministicSourceIds, manualSourceIds)) invalid();
  return Object.freeze({
    runId: runId(record.runId),
    countryCode: countryCode(record.countryCode),
    catalogVersion: version(record.catalogVersion),
    catalogSha256: digest(record.catalogSha256),
    deterministicSourceIds,
    manualSourceIds,
  });
}

function matchStructuredIdentity(
  record: ExactRecord<typeof STRUCTURED_KEYS>,
  expected: ParsedExpectation,
): void {
  if (
    record.schemaVersion !== BASIC_STRUCTURED_SOURCE_REVIEW_SCHEMA_VERSION ||
    record.runId !== expected.runId ||
    record.countryCode !== expected.countryCode ||
    record.catalogVersion !== expected.catalogVersion ||
    record.catalogSha256 !== expected.catalogSha256
  ) invalid();
}

function matchManualIdentity(
  record: ExactRecord<typeof MANUAL_KEYS>,
  expected: ParsedExpectation,
): void {
  if (
    record.schemaVersion !== BASIC_MANUAL_SOURCE_REVIEW_SCHEMA_VERSION ||
    record.runId !== expected.runId ||
    record.countryCode !== expected.countryCode ||
    record.catalogVersion !== expected.catalogVersion ||
    record.catalogSha256 !== expected.catalogSha256
  ) invalid();
}

function parseStructuredSources(
  value: unknown,
  expected: ParsedExpectation,
): readonly BasicStructuredSourceReviewSource[] {
  const sources = array(value, MAX_SOURCE_REVIEWS, false).map((entry) => {
    const record = exactRecord(entry, STRUCTURED_SOURCE_KEYS);
    return Object.freeze({
      sourceId: sourceId(record.sourceId),
      sourceCheck: parseSourceCheck(record.sourceCheck),
    });
  });
  requireExactSourceCoverage(
    sources.map(({ sourceId: id }) => id),
    expected.deterministicSourceIds,
  );
  return Object.freeze(sources);
}

function parseStructuredRisks(
  value: unknown,
  sourceIds: readonly string[],
): readonly BasicStructuredInjectionRisk[] {
  const risks = array(value, MAX_ARRAY_ITEMS, true).map((entry) => {
    const record = exactRecord(entry, STRUCTURED_RISK_KEYS);
    const source = sourceId(record.sourceId);
    if (!sourceIds.includes(source)) invalid();
    return Object.freeze({
      sourceId: source,
      locator: structuredLocator(record.locator),
      severity: severity(record.severity),
      details: nonBlankText(record.details),
    });
  });
  return Object.freeze(risks);
}

function parseManualSources(
  value: unknown,
  expected: ParsedExpectation,
): readonly BasicManualSourceReviewSource[] {
  const sources = array(value, MAX_SOURCE_REVIEWS, false).map((entry) => {
    const record = exactRecord(entry, MANUAL_SOURCE_KEYS);
    const sourceCheck = parseSourceCheck(record.sourceCheck);
    const publishedAt = nullableTimestamp(record.publishedAt);
    if (publishedAt === null && sourceCheck.notes === null) invalid();
    const promptInjectionRisk = injectionRisk(record.promptInjectionRisk);
    const injectionRisks = parseManualRisks(record.injectionRisks);
    if (promptInjectionRisk === "none" && injectionRisks.length !== 0) invalid();
    if (
      promptInjectionRisk !== "none" &&
      !injectionRisks.some(({ severity }) => severity === promptInjectionRisk)
    ) invalid();
    return Object.freeze({
      sourceId: sourceId(record.sourceId),
      publishedAt,
      accessNotes: nullableNonBlankText(record.accessNotes),
      promptInjectionRisk,
      sourceCheck,
      injectionRisks,
    });
  });
  requireExactSourceCoverage(
    sources.map(({ sourceId: id }) => id),
    expected.manualSourceIds,
  );
  return Object.freeze(sources);
}

function parseManualRisks(
  value: unknown,
): readonly BasicManualInjectionRisk[] {
  const risks = array(value, MAX_ARRAY_ITEMS, true).map((entry) => {
    const record = exactRecord(entry, MANUAL_RISK_KEYS);
    return Object.freeze({
      locator: manualLocator(record.locator),
      severity: severity(record.severity),
      details: nonBlankText(record.details),
    });
  });
  return Object.freeze(risks);
}

function parseSourceCheck(value: unknown): BasicReviewedSourceCheck {
  const record = exactRecord(value, SOURCE_CHECK_KEYS);
  if (record.status !== "passed" && record.status !== "failed") invalid();
  return Object.freeze({
    status: record.status,
    notes: nullableNonBlankText(record.notes),
  });
}

function snapshotExactRecord<const Keys extends readonly string[]>(
  value: unknown,
  keys: Keys,
): ExactRecord<Keys> {
  const snapshot = snapshotSourceReviewValue(value);
  if (snapshot === INVALID_SNAPSHOT) invalid();
  return exactRecord(snapshot, keys);
}

function snapshotSourceReviewValue(value: unknown): unknown | typeof INVALID_SNAPSHOT {
  return snapshotSourceReviewValueAt(value, 0, new Set<object>());
}

function snapshotSourceReviewValueAt(
  value: unknown,
  depth: number,
  ancestors: Set<object>,
): unknown | typeof INVALID_SNAPSHOT {
  try {
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "string") {
      return isBoundedSnapshotString(value) ? value : INVALID_SNAPSHOT;
    }
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : INVALID_SNAPSHOT;
    }
    if (
      typeof value !== "object" ||
      depth >= MAX_SNAPSHOT_DEPTH ||
      isProxy(value) ||
      ancestors.has(value)
    ) return INVALID_SNAPSHOT;

    ancestors.add(value);
    const snapshot = Array.isArray(value)
      ? snapshotSourceReviewArray(value, depth, ancestors)
      : snapshotSourceReviewRecord(value, depth, ancestors);
    ancestors.delete(value);
    return snapshot;
  } catch {
    return INVALID_SNAPSHOT;
  }
}

function snapshotSourceReviewArray(
  value: unknown[],
  depth: number,
  ancestors: Set<object>,
): unknown[] | typeof INVALID_SNAPSHOT {
  if (Object.getPrototypeOf(value) !== Array.prototype) return INVALID_SNAPSHOT;
  const length = Object.getOwnPropertyDescriptor(value, "length");
  if (
    length === undefined ||
    !Object.hasOwn(length, "value") ||
    typeof length.value !== "number" ||
    !Number.isSafeInteger(length.value) ||
    length.value < 0 ||
    length.value > MAX_ARRAY_ITEMS
  ) return INVALID_SNAPSHOT;

  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== length.value + 1) return INVALID_SNAPSHOT;
  const snapshot: unknown[] = [];
  for (let index = 0; index < length.value; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, "value")
    ) return INVALID_SNAPSHOT;
    const child = snapshotSourceReviewValueAt(descriptor.value, depth + 1, ancestors);
    if (child === INVALID_SNAPSHOT) return INVALID_SNAPSHOT;
    snapshot.push(child);
  }
  return snapshot;
}

function snapshotSourceReviewRecord(
  value: object,
  depth: number,
  ancestors: Set<object>,
): Record<string, unknown> | typeof INVALID_SNAPSHOT {
  if (Object.getPrototypeOf(value) !== Object.prototype) return INVALID_SNAPSHOT;
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) return INVALID_SNAPSHOT;
  const snapshot: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, "value")
    ) return INVALID_SNAPSHOT;
    const child = snapshotSourceReviewValueAt(descriptor.value, depth + 1, ancestors);
    if (child === INVALID_SNAPSHOT) return INVALID_SNAPSHOT;
    Object.defineProperty(snapshot, key, {
      value: child,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return snapshot;
}

function isBoundedSnapshotString(value: string): boolean {
  return isWellFormedUnicode(value) && Buffer.byteLength(value, "utf8") <= MAX_STRING_BYTES;
}

function exactRecord<const Keys extends readonly string[]>(
  value: unknown,
  keys: Keys,
): ExactRecord<Keys> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) invalid();
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))
  ) invalid();
  return value as ExactRecord<Keys>;
}

function array(value: unknown, maximum: number, allowEmpty: boolean): unknown[] {
  if (!Array.isArray(value) || value.length > maximum || (!allowEmpty && value.length === 0)) {
    invalid();
  }
  return value;
}

function sourceIds(value: unknown, allowEmpty: boolean): readonly string[] {
  const values = array(value, MAX_SOURCE_REVIEWS, allowEmpty).map(sourceId);
  requireSortedUnique(values, (item) => item);
  return Object.freeze(values);
}

function requireExactSourceCoverage(
  actual: readonly string[],
  expected: readonly string[],
): void {
  requireSortedUnique(actual, (item) => item);
  if (actual.length !== expected.length) invalid();
  for (let index = 0; index < actual.length; index += 1) {
    if (actual[index] !== expected[index]) invalid();
  }
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

function intersects(left: readonly string[], right: readonly string[]): boolean {
  const rightSet = new Set(right);
  return left.some((item) => rightSet.has(item));
}

function sourceId(value: unknown): string {
  const result = text(value);
  if (!SAFE_ID.test(result)) invalid();
  return result;
}

function runId(value: unknown): string {
  const result = text(value);
  if (!SAFE_RUN_ID.test(result)) invalid();
  return result;
}

function countryCode(value: unknown): string {
  const result = text(value);
  if (!ISO2.test(result)) invalid();
  return result;
}

function version(value: unknown): string {
  const result = text(value);
  if (!SAFE_VERSION.test(result)) invalid();
  return result;
}

function digest(value: unknown): string {
  const result = text(value);
  if (!SHA256.test(result)) invalid();
  return result;
}

function nullableTimestamp(value: unknown): string | null {
  if (value === null) return null;
  const result = nonBlankText(value);
  const errors: string[] = [];
  expectUtcRfc3339Timestamp(result, "timestamp", errors);
  if (errors.length !== 0) invalid();
  return result;
}

function injectionRisk(value: unknown): "none" | "suspected" | "confirmed" {
  if (value === "none" || value === "suspected" || value === "confirmed") {
    return value;
  }
  invalid();
}

function severity(value: unknown): "suspected" | "confirmed" {
  if (value === "suspected" || value === "confirmed") return value;
  invalid();
}

function structuredLocator(value: unknown): string {
  const result = locatorText(value);
  if (!JSON_POINTER.test(result) && !CSV_LOCATOR.test(result)) invalid();
  return result;
}

function manualLocator(value: unknown): string {
  const result = locatorText(value);
  if (
    !(result.startsWith("html:") && result.slice("html:".length).trim() !== "") &&
    !(PDF_LOCATOR.test(result) && result.slice(result.indexOf("#") + 1).trim() !== "")
  ) invalid();
  return result;
}

function locatorText(value: unknown): string {
  const result = nonBlankText(value);
  if (result.trim() !== result || /[\u0000-\u001F\u007F]/.test(result)) invalid();
  return result;
}

function nullableNonBlankText(value: unknown): string | null {
  return value === null ? null : nonBlankText(value);
}

function nonBlankText(value: unknown): string {
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
      if (next < 0xDC00 || next > 0xDFFF) return false;
      index += 1;
    } else if (codeUnit >= 0xDC00 && codeUnit <= 0xDFFF) {
      return false;
    }
  }
  return true;
}

function freezeStructuredReview(
  review: BasicStructuredSourceReview,
): BasicStructuredSourceReview {
  return Object.freeze({
    ...review,
    sources: Object.freeze(review.sources),
    injectionRisks: Object.freeze(review.injectionRisks),
  });
}

function freezeManualReview(review: BasicManualSourceReview): BasicManualSourceReview {
  return Object.freeze({ ...review, sources: Object.freeze(review.sources) });
}

function invalid(): never {
  throw new Error("invalid source review");
}
