import { CREDIBILITIES } from "@navigator/shared-types/schema";
import {
  expectUtcRfc3339Timestamp,
  hasExactOwnKeys,
  isPlainRecord,
} from "../seed/basic-country-validation-utils.js";
import {
  BASIC_COLLECTION_AUDIT_SCHEMA_VERSION,
  BASIC_COLLECTION_REQUIRED_STATIC_FACT_PATHS,
  type BasicCollectionJsonValue,
  type BasicSourceRecord,
} from "./basic-collection-contracts.js";
import { captureBasicRawSource } from "./basic-raw-capture.js";
import type {
  BasicDeterministicAdapterOutput,
  BasicDeterministicObservation,
  BasicDeterministicSourceAdapter,
  BasicRawCaptureReceipt,
  BasicSourceAdapterRunInput,
  BasicSourceAdapterRunResult,
  BasicSourceRequest,
} from "./basic-source-adapter-contracts.js";
import {
  materializeBasicSourceFacts,
  type BasicSourcedObservation,
} from "./basic-source-fact-materializer.js";
import { snapshotBasicSourceRequest } from "./basic-source-metadata.js";
const OUTPUT_KEYS = ["publishedAt", "promptInjectionRisk", "accessNotes", "observations"] as const;
const OBSERVATION_KEYS = ["fieldPath", "locator", "rawValue", "normalizedValue", "unit", "year", "uncertainty"] as const;
const SOURCE_FAMILIES = ["international-organization", "official-statistics", "government", "energy-authority", "regulator", "grid-operator", "industry-association", "verified-research"] as const;
const PROMPT_INJECTION_RISKS = ["none", "suspected", "confirmed"] as const;
const FIELD_PATHS = new Set<string>(BASIC_COLLECTION_REQUIRED_STATIC_FACT_PATHS);
const INDICATOR_PATH = /^marketOverview\.keyIndicators\[(?:0|[1-9]\d*)\]\.(?:label|value|unit|year)$/;
const SAFE_SOURCE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export async function runBasicDeterministicSourceAdapters(
  input: BasicSourceAdapterRunInput,
): Promise<BasicSourceAdapterRunResult> {
  const adapters = prepareAdapters(input.adapters);
  if (adapters.length === 0) {
    throw new Error("source adapter run must contain observations");
  }
  const sources: BasicSourceRecord[] = [];
  const observations: BasicSourcedObservation[] = [];
  const receipts: BasicRawCaptureReceipt[] = [];
  for (const adapter of adapters) {
    const request = requestFrom(adapter, input.countryCode);
    const requestUrl = request.url;
    const capture = await captureBasicRawSource(
      {
        repoRoot: input.repoRoot,
        countryCode: input.countryCode,
        runId: input.runId,
        adapterId: adapter.adapterId,
        adapterVersion: adapter.adapterVersion,
        sourceId: adapter.sourceId,
        request,
      },
      input.transport,
    );
    if (!isTimestamp(capture.retrievedAt)) {
      throw new Error("source adapter materialization is invalid");
    }
    const output = extractFrom(adapter, {
      countryCode: input.countryCode,
      requestUrl,
      finalUrl: capture.finalUrl,
      contentType: capture.contentType,
      retrievedAt: capture.retrievedAt,
      body: new Uint8Array(capture.body),
    });
    const locators = [...new Set(output.observations.map(({ locator }) => locator))].sort(compareText);
    sources.push({
      sourceId: adapter.sourceId,
      sourceName: adapter.sourceName,
      sourceUrl: requestUrl,
      retrievedAt: capture.retrievedAt,
      publishedAt: output.publishedAt,
      contentSha256: capture.contentSha256,
      evidenceLocators: locators,
      sourceFamily: adapter.sourceFamily,
      accessStatus: "open",
      accessNotes: output.accessNotes,
      credibility: adapter.credibility,
      discoveryOnly: false,
      promptInjectionRisk: output.promptInjectionRisk,
    });
    observations.push(...output.observations.map((item) => ({ ...item, sourceId: adapter.sourceId })));
    receipts.push({
      sourceId: capture.sourceId,
      contentSha256: capture.contentSha256,
      byteLength: capture.byteLength,
      reused: capture.reused,
    });
  }
  return {
    sourceRegister: {
      schemaVersion: BASIC_COLLECTION_AUDIT_SCHEMA_VERSION,
      runId: input.runId,
      countryCode: input.countryCode,
      sources,
    },
    extractedFacts: {
      schemaVersion: BASIC_COLLECTION_AUDIT_SCHEMA_VERSION,
      runId: input.runId,
      countryCode: input.countryCode,
      facts: materializeBasicSourceFacts(observations),
    },
    receipts,
  };
}
function prepareAdapters(
  values: readonly BasicDeterministicSourceAdapter[],
): BasicDeterministicSourceAdapter[] {
  let adapters: BasicDeterministicSourceAdapter[];
  try {
    adapters = values.map((value) => {
      const { adapterId, adapterVersion, sourceId, sourceName, sourceFamily, credibility, request, extract } = value;
      if (!(isText(adapterId) && isText(adapterVersion) &&
        typeof sourceId === "string" && SAFE_SOURCE_ID.test(sourceId) &&
        isText(sourceName) && includes(SOURCE_FAMILIES, sourceFamily) &&
        includes(CREDIBILITIES, credibility) && typeof request === "function" &&
        typeof extract === "function")) throw new Error("invalid");
      return { adapterId, adapterVersion, sourceId, sourceName, sourceFamily, credibility, request: request.bind(value), extract: extract.bind(value) };
    });
  } catch {
    throw new Error("source adapter metadata is invalid");
  }
  const sourceIds = new Set<string>();
  for (const adapter of adapters) {
    if (sourceIds.has(adapter.sourceId)) {
      throw new Error("source adapter sourceId must be unique");
    }
    sourceIds.add(adapter.sourceId);
  }
  return adapters.sort((left, right) => compareText(left.sourceId, right.sourceId));
}
function requestFrom(adapter: BasicDeterministicSourceAdapter, countryCode: string): BasicSourceRequest {
  try {
    return snapshotBasicSourceRequest(adapter.request(countryCode));
  } catch {
    throw new Error("source adapter request failed");
  }
}
function extractFrom(
  adapter: BasicDeterministicSourceAdapter,
  input: Parameters<BasicDeterministicSourceAdapter["extract"]>[0],
): BasicDeterministicAdapterOutput {
  let value: unknown;
  try {
    value = adapter.extract(input);
  } catch {
    throw new Error("source adapter extract failed");
  }
  return parseOutput(value);
}
function parseOutput(value: unknown): BasicDeterministicAdapterOutput {
  if (!exactDataRecord(value, OUTPUT_KEYS) ||
    !(value.publishedAt === null || isTimestamp(value.publishedAt)) ||
    !includes(PROMPT_INJECTION_RISKS, value.promptInjectionRisk) ||
    !(value.accessNotes === null || isText(value.accessNotes)) ||
    !isStandardArray(value.observations)) {
    throw new Error("source adapter output is invalid");
  }
  const observations = value.observations.map(parseObservation);
  if (observations.length === 0) {
    throw new Error("source adapter output must contain observations");
  }
  return {
    publishedAt: value.publishedAt,
    promptInjectionRisk: value.promptInjectionRisk,
    accessNotes: value.accessNotes,
    observations,
  };
}
function parseObservation(value: unknown): BasicDeterministicObservation {
  if (!exactDataRecord(value, OBSERVATION_KEYS) ||
    typeof value.fieldPath !== "string" || !isFieldPath(value.fieldPath) ||
    !isText(value.locator) || !(value.unit === null || isText(value.unit)) ||
    !(value.year === null || isFiniteNumber(value.year)) ||
    !(value.uncertainty === null || isText(value.uncertainty))) {
    throw new Error("source adapter observation is invalid");
  }
  let rawValue: BasicCollectionJsonValue;
  let normalizedValue: BasicCollectionJsonValue;
  try {
    rawValue = reconstructJson(value.rawValue);
    normalizedValue = reconstructJson(value.normalizedValue);
  } catch {
    throw new Error("source adapter observation is invalid");
  }
  return {
    fieldPath: value.fieldPath,
    locator: value.locator,
    rawValue,
    normalizedValue,
    unit: value.unit,
    year: value.year,
    uncertainty: value.uncertainty === null ? null : value.uncertainty.trim(),
  };
}
function reconstructJson(
  value: unknown,
  ancestors = new WeakSet<object>(),
): BasicCollectionJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return value;
    throw new Error("invalid JSON");
  }
  if (typeof value !== "object" || ancestors.has(value)) throw new Error("invalid JSON");
  ancestors.add(value);
  if (Array.isArray(value)) {
    if (!isStandardArray(value)) throw new Error("invalid JSON");
    const result = value.map((item) => reconstructJson(item, ancestors));
    ancestors.delete(value);
    return result;
  }
  const keys = Reflect.ownKeys(value);
  if (!isPlainRecord(value) || keys.some((key) => typeof key !== "string") || !dataKeys(value, keys)) throw new Error("invalid JSON");
  const result: { [key: string]: BasicCollectionJsonValue } = {};
  for (const key of Object.keys(value)) {
    Object.defineProperty(result, key, {
      value: reconstructJson(value[key], ancestors),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  ancestors.delete(value);
  return result;
}
function exactDataRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> { return hasExactOwnKeys(value, keys) && dataKeys(value, keys); }
function dataKeys(value: object, keys: readonly PropertyKey[]): boolean {
  return keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && descriptor.enumerable && Object.hasOwn(descriptor, "value");
  });
}
function isStandardArray(value: unknown): value is unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (lengthDescriptor === undefined || lengthDescriptor.enumerable || !Object.hasOwn(lengthDescriptor, "value")) return false;
  const length: unknown = lengthDescriptor.value;
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 ||
    Reflect.ownKeys(value).length !== length + 1) return false;
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) return false;
  }
  return true;
}
function isFieldPath(value: string): boolean { return FIELD_PATHS.has(value) || INDICATOR_PATH.test(value); }
function isTimestamp(value: unknown): value is string { const errors: string[] = []; expectUtcRfc3339Timestamp(value, "timestamp", errors); return errors.length === 0; }
function isFiniteNumber(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function isText(value: unknown): value is string { return typeof value === "string" && value.trim() !== ""; }
function includes<T>(values: readonly T[], value: unknown): value is T { return values.includes(value as T); }
function compareText(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
