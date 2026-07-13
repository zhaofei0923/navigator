import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { isProxy } from "node:util/types";

import { expectUtcRfc3339Timestamp, SAFE_RUN_ID } from "../seed/basic-country-validation-utils.js";
import type {
  BasicCollectionJsonValue,
  BasicSourceRecord,
} from "./basic-collection-contracts.js";
import {
  BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION,
  classifyBasicV2FieldPath,
  type BasicDocumentCaptureV2,
  type BasicPreliminarySourceRunV2,
  type BasicSourcedObservationV2,
  type BasicStructuredEditorialEvidenceObservation,
} from "./basic-collection-v2-contracts.js";
import {
  deepFreezeBasicOfflineValue,
  isRecord,
  snapshotBasicOfflineValue,
} from "./basic-offline-value.js";
import { captureBasicRawSourceV2 } from "./basic-raw-capture-v2.js";
import type {
  BasicDeterministicAdapterOutput,
  BasicDeterministicObservation,
  BasicDeterministicSourceAdapter,
} from "./basic-source-adapter-contracts.js";
import { resolveBasicSourceAdapter } from "./basic-source-adapter-registry.js";
import {
  BASIC_MANUAL_DOCUMENT_ADAPTER_ID,
  BASIC_MANUAL_DOCUMENT_ADAPTER_VERSION,
  type BasicSourceCatalogSource,
} from "./basic-source-catalog.js";
import {
  isBasicSourceExecutionPlanEntryTrusted,
  snapshotBasicSourceExecutionPlanEntryProvenance,
  type BasicSourceExecutionPlan,
  type BasicSourceExecutionPlanEntry,
  type BasicSourceExecutionPlanEntryProvenance,
} from "./basic-source-request-materializer.js";
import {
  parseBasicRawCaptureManifestV2,
  snapshotBasicSourceRequestV2,
} from "./basic-source-metadata-v2.js";
import type {
  BasicRawCaptureInputV2,
  BasicRawCaptureManifestV2,
  BasicRawCaptureResultV2,
  BasicSourceRequestV2,
  BasicSourceTransportV2,
} from "./basic-source-v2-contracts.js";
import { materializeBasicSourceFactsV2 } from "./basic-v2-fact-materializer.js";

export interface BasicSourcePlanRunnerInputV2 {
  readonly repoRoot: string;
  readonly countryCode: string;
  readonly runId: string;
  readonly plan: BasicSourceExecutionPlan;
  readonly transport: BasicSourceTransportV2;
}

type BoundEntry = Readonly<{
  entry: BasicSourceExecutionPlanEntry;
  entryProvenance: BasicSourceExecutionPlanEntryProvenance;
  request: BasicSourceRequestV2;
  adapter: BasicDeterministicSourceAdapter | null;
}>;

export type BasicDocumentCaptureProvenanceV2 = Readonly<{
  entryProvenance: BasicSourceExecutionPlanEntryProvenance;
  runId: string;
  countryCode: string;
  catalogVersion: string;
  catalogSha256: string;
  sourceId: string;
  adapterId: string;
  adapterVersion: string;
  catalogSource: BasicSourceCatalogSource;
  request: BasicSourceRequestV2;
  manifest: BasicRawCaptureManifestV2;
}>;

const ERROR_MESSAGE = "basic source plan run is invalid";
const INPUT_KEYS = ["repoRoot", "countryCode", "runId", "plan", "transport"] as const;
const PLAN_KEYS = ["catalogVersion", "catalogSha256", "countryCode", "sources"] as const;
const OUTPUT_KEYS = ["publishedAt", "promptInjectionRisk", "accessNotes", "observations"] as const;
const OBSERVATION_KEYS = [
  "fieldPath",
  "locator",
  "rawValue",
  "normalizedValue",
  "unit",
  "year",
  "uncertainty",
] as const;
const ISO2 = /^[A-Z]{2}$/;
const SAFE_VERSION = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_ACTIVE_SOURCES = 64;
const MAX_OBSERVATIONS = 256;
const MAX_STRING_BYTES = 65_536;
const MAX_TRANSPORT_PROTOTYPE_DEPTH = 16;
const RUNNER_ENTRY_PROVENANCE = new WeakMap<
  object,
  BasicSourceExecutionPlanEntryProvenance
>();
const DOCUMENT_CAPTURE_PROVENANCE = new WeakMap<
  object,
  BasicDocumentCaptureProvenanceV2
>();

export function snapshotBasicDocumentCaptureProvenanceV2(
  value: unknown,
): BasicDocumentCaptureProvenanceV2 | null {
  if (typeof value !== "object" || value === null) return null;
  return DOCUMENT_CAPTURE_PROVENANCE.get(value) ?? null;
}

export async function runBasicSourceExecutionPlanV2(
  value: BasicSourcePlanRunnerInputV2,
): Promise<BasicPreliminarySourceRunV2> {
  try {
    const input = snapshotRunnerInput(value);
    const boundEntries = bindEntries(input.plan, input.countryCode);
    return await executeEntries(input, boundEntries);
  } catch {
    throw new Error(ERROR_MESSAGE);
  }
}

function snapshotRunnerInput(value: unknown): BasicSourcePlanRunnerInputV2 {
  const properties = exactDataProperties(value, INPUT_KEYS);
  if (properties === null) invalid();
  const repoRoot = properties.get("repoRoot");
  const countryCode = properties.get("countryCode");
  const runId = properties.get("runId");
  if (
    typeof repoRoot !== "string" ||
    !isAbsolute(repoRoot) ||
    repoRoot.includes("\0") ||
    typeof countryCode !== "string" ||
    !ISO2.test(countryCode) ||
    typeof runId !== "string" ||
    !SAFE_RUN_ID.test(runId)
  ) invalid();
  const plan = snapshotPlan(properties.get("plan"), countryCode);
  const transport = snapshotTransport(properties.get("transport"));
  if (transport === null) invalid();
  return Object.freeze({ repoRoot, countryCode, runId, plan, transport });
}

function snapshotPlan(value: unknown, countryCode: string): BasicSourceExecutionPlan {
  const plan = exactDataProperties(value, PLAN_KEYS);
  if (plan === null) invalid();
  const catalogVersion = plan.get("catalogVersion");
  const catalogSha256 = plan.get("catalogSha256");
  const plannedCountryCode = plan.get("countryCode");
  if (
    typeof catalogVersion !== "string" ||
    !SAFE_VERSION.test(catalogVersion) ||
    typeof catalogSha256 !== "string" ||
    !SHA256.test(catalogSha256) ||
    plannedCountryCode !== countryCode
  ) invalid();
  const entries = trustedPlanEntries(plan.get("sources"), {
    catalogVersion,
    catalogSha256,
    countryCode,
  });
  const sourceIds = new Set<string>();
  const rebuiltEntries = entries.map((entry) => {
    if (sourceIds.has(entry.source.sourceId)) invalid();
    sourceIds.add(entry.source.sourceId);
    const rebuilt = Object.freeze({
      source: entry.source,
      request: snapshotBasicSourceRequestV2(entry.request),
    });
    const provenance = snapshotBasicSourceExecutionPlanEntryProvenance(entry);
    if (provenance === null) invalid();
    RUNNER_ENTRY_PROVENANCE.set(rebuilt, provenance);
    return rebuilt;
  }).sort((left, right) => compareText(
    left.source.sourceId,
    right.source.sourceId,
  ));
  return Object.freeze({
    catalogVersion,
    catalogSha256,
    countryCode,
    sources: Object.freeze(rebuiltEntries),
  });
}

function trustedPlanEntries(
  value: unknown,
  identity: BasicSourceExecutionPlanEntryProvenance,
): readonly BasicSourceExecutionPlanEntry[] {
  if (
    typeof value !== "object" ||
    value === null ||
    isProxy(value) ||
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype
  ) invalid();
  const length = Object.getOwnPropertyDescriptor(value, "length");
  if (
    length === undefined ||
    !Object.hasOwn(length, "value") ||
    typeof length.value !== "number" ||
    !Number.isSafeInteger(length.value) ||
    length.value === 0 ||
    length.value > MAX_ACTIVE_SOURCES ||
    Reflect.ownKeys(value).length !== length.value + 1
  ) invalid();
  const entries: BasicSourceExecutionPlanEntry[] = [];
  let sharedProvenance: BasicSourceExecutionPlanEntryProvenance | null = null;
  for (let index = 0; index < length.value; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, "value") ||
      !isBasicSourceExecutionPlanEntryTrusted(descriptor.value)
    ) invalid();
    const provenance = snapshotBasicSourceExecutionPlanEntryProvenance(
      descriptor.value,
    );
    if (
      provenance === null ||
      provenance.catalogVersion !== identity.catalogVersion ||
      provenance.catalogSha256 !== identity.catalogSha256 ||
      provenance.countryCode !== identity.countryCode ||
      (sharedProvenance !== null && provenance !== sharedProvenance)
    ) invalid();
    sharedProvenance = provenance;
    entries.push(descriptor.value);
  }
  return entries;
}

function bindEntries(
  plan: BasicSourceExecutionPlan,
  countryCode: string,
): readonly BoundEntry[] {
  return Object.freeze(plan.sources.map((entry) => {
    const { source } = entry;
    const entryProvenance = RUNNER_ENTRY_PROVENANCE.get(entry);
    if (entryProvenance === undefined) invalid();
    const request = snapshotBasicSourceRequestV2(entry.request);
    if (source.adapterKind === "deterministic") {
      if (source.format !== "json" && source.format !== "csv") invalid();
      return Object.freeze({
        entry,
        entryProvenance,
        request,
        adapter: resolveBasicSourceAdapter(entry, countryCode),
      });
    }
    if (
      source.adapterKind !== "manual-document" ||
      (source.format !== "html" && source.format !== "pdf") ||
      source.adapterId !== BASIC_MANUAL_DOCUMENT_ADAPTER_ID ||
      source.adapterVersion !== BASIC_MANUAL_DOCUMENT_ADAPTER_VERSION
    ) invalid();
    return Object.freeze({ entry, entryProvenance, request, adapter: null });
  }));
}

async function executeEntries(
  input: BasicSourcePlanRunnerInputV2,
  entries: readonly BoundEntry[],
): Promise<BasicPreliminarySourceRunV2> {
  const sources: BasicSourceRecord[] = [];
  const factObservations: BasicSourcedObservationV2[] = [];
  const structuredEditorialEvidence: BasicStructuredEditorialEvidenceObservation[] = [];
  const documentCaptures: BasicDocumentCaptureV2[] = [];
  const receipts: BasicPreliminarySourceRunV2["receipts"][number][] = [];

  for (const bound of entries) {
    const captureInput = createCaptureInput(input, bound);
    const capture = await captureBasicRawSourceV2(captureInput, input.transport);
    receipts.push(receiptFrom(capture));
    if (bound.adapter === null) {
      const manifest = await readVerifiedManifest(captureInput, capture);
      const documentCapture = deepFreezeBasicOfflineValue({
        catalogSource: bound.entry.source,
        manifest,
      });
      DOCUMENT_CAPTURE_PROVENANCE.set(documentCapture, Object.freeze({
        entryProvenance: bound.entryProvenance,
        runId: input.runId,
        countryCode: input.countryCode,
        catalogVersion: input.plan.catalogVersion,
        catalogSha256: input.plan.catalogSha256,
        sourceId: bound.entry.source.sourceId,
        adapterId: bound.entry.source.adapterId,
        adapterVersion: bound.entry.source.adapterVersion,
        catalogSource: bound.entry.source,
        request: bound.request,
        manifest,
      }));
      documentCaptures.push(documentCapture);
      continue;
    }

    const output = extractAdapterOutput(bound.adapter, {
      countryCode: input.countryCode,
      requestUrl: bound.request.url,
      finalUrl: capture.finalUrl,
      contentType: capture.contentType,
      retrievedAt: capture.retrievedAt,
      body: new Uint8Array(capture.body),
    });
    const locators: string[] = [];
    for (const observation of output.observations) {
      if (!bound.entry.source.fieldPaths.includes(observation.fieldPath)) invalid();
      const owner = classifyBasicV2FieldPath(observation.fieldPath);
      if (owner === "derived" || owner === null) invalid();
      locators.push(observation.locator);
      if (owner === "editorial") {
        structuredEditorialEvidence.push({
          sourceId: bound.entry.source.sourceId,
          fieldPath: observation.fieldPath,
          locator: observation.locator,
          rawValue: observation.rawValue,
        });
      } else {
        factObservations.push({
          ...observation,
          sourceId: bound.entry.source.sourceId,
        });
      }
    }
    sources.push(sourceRecord(
      bound.entry.source,
      bound.request,
      capture,
      output,
      locators,
    ));
  }

  structuredEditorialEvidence.sort(compareEditorialEvidence);
  return deepFreezeBasicOfflineValue({
    sourceRegister: {
      schemaVersion: BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION,
      runId: input.runId,
      countryCode: input.countryCode,
      catalogVersion: input.plan.catalogVersion,
      catalogSha256: input.plan.catalogSha256,
      sources,
    },
    extractedFacts: {
      schemaVersion: BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION,
      runId: input.runId,
      countryCode: input.countryCode,
      facts: materializeBasicSourceFactsV2(factObservations, "deterministic"),
    },
    structuredEditorialEvidence,
    documentCaptures,
    receipts,
  });
}

function createCaptureInput(
  input: BasicSourcePlanRunnerInputV2,
  bound: BoundEntry,
): BasicRawCaptureInputV2 {
  return Object.freeze({
    repoRoot: input.repoRoot,
    countryCode: input.countryCode,
    runId: input.runId,
    catalogVersion: input.plan.catalogVersion,
    catalogSha256: input.plan.catalogSha256,
    adapterId: bound.entry.source.adapterId,
    adapterVersion: bound.entry.source.adapterVersion,
    sourceId: bound.entry.source.sourceId,
    request: bound.request,
  });
}

function extractAdapterOutput(
  adapter: BasicDeterministicSourceAdapter,
  input: Parameters<BasicDeterministicSourceAdapter["extract"]>[0],
): BasicDeterministicAdapterOutput {
  let output: unknown;
  try {
    output = adapter.extract(Object.freeze(input));
  } catch {
    invalid();
  }
  const snapshot = snapshotBasicOfflineValue(output);
  if (!snapshot.valid) invalid();
  validateJsonBounds(snapshot.data);
  const record = exactRecord(snapshot.data, OUTPUT_KEYS);
  if (
    !(record.publishedAt === null || isTimestamp(record.publishedAt)) ||
    !includes(["none", "suspected", "confirmed"] as const, record.promptInjectionRisk) ||
    !(record.accessNotes === null || isNonBlankText(record.accessNotes)) ||
    !Array.isArray(record.observations) ||
    record.observations.length === 0 ||
    record.observations.length > MAX_OBSERVATIONS
  ) invalid();
  return {
    publishedAt: record.publishedAt,
    promptInjectionRisk: record.promptInjectionRisk,
    accessNotes: record.accessNotes,
    observations: record.observations.map(parseObservation),
  };
}

function parseObservation(value: unknown): BasicDeterministicObservation {
  const record = exactRecord(value, OBSERVATION_KEYS);
  if (
    !isNonBlankText(record.fieldPath) ||
    !isNonBlankText(record.locator) ||
    !(record.unit === null || isNonBlankText(record.unit)) ||
    !(record.year === null || typeof record.year === "number" && Number.isFinite(record.year)) ||
    !(record.uncertainty === null || isNonBlankText(record.uncertainty))
  ) invalid();
  return {
    fieldPath: record.fieldPath,
    locator: record.locator,
    rawValue: record.rawValue as BasicCollectionJsonValue,
    normalizedValue: record.normalizedValue as BasicCollectionJsonValue,
    unit: record.unit,
    year: record.year,
    uncertainty: record.uncertainty,
  };
}

function sourceRecord(
  source: BasicSourceCatalogSource,
  request: BasicSourceRequestV2,
  capture: BasicRawCaptureResultV2,
  output: BasicDeterministicAdapterOutput,
  locators: readonly string[],
): BasicSourceRecord {
  return {
    sourceId: source.sourceId,
    sourceName: source.sourceName,
    sourceUrl: request.url,
    retrievedAt: capture.retrievedAt,
    publishedAt: output.publishedAt,
    contentSha256: capture.contentSha256,
    evidenceLocators: Array.from(new Set(locators)).sort(compareText),
    sourceFamily: source.sourceFamily,
    accessStatus: "open",
    accessNotes: output.accessNotes,
    credibility: source.credibility,
    discoveryOnly: false,
    promptInjectionRisk: output.promptInjectionRisk,
  };
}

function receiptFrom(capture: BasicRawCaptureResultV2) {
  return {
    sourceId: capture.sourceId,
    contentSha256: capture.contentSha256,
    byteLength: capture.byteLength,
    reused: capture.reused,
  };
}

async function readVerifiedManifest(
  input: BasicRawCaptureInputV2,
  capture: BasicRawCaptureResultV2,
): Promise<BasicRawCaptureManifestV2> {
  const pathname = join(
    input.repoRoot,
    ".cache",
    "basic-country",
    input.countryCode,
    input.runId,
    "raw-v2",
    input.sourceId,
    "capture.json",
  );
  const value: unknown = JSON.parse(await readFile(pathname, "utf8")) as unknown;
  const manifest = parseBasicRawCaptureManifestV2(value);
  if (
    manifest === null ||
    manifest.countryCode !== input.countryCode ||
    manifest.runId !== input.runId ||
    manifest.catalogVersion !== input.catalogVersion ||
    manifest.catalogSha256 !== input.catalogSha256 ||
    manifest.adapterId !== input.adapterId ||
    manifest.adapterVersion !== input.adapterVersion ||
    manifest.sourceId !== input.sourceId ||
    !sameRequest(manifest.request, input.request) ||
    manifest.response.finalUrl !== capture.finalUrl ||
    !sameStrings(manifest.response.redirectChain, capture.redirectChain) ||
    manifest.response.contentType !== capture.contentType ||
    manifest.response.retrievedAt !== capture.retrievedAt ||
    manifest.response.byteLength !== capture.byteLength ||
    manifest.response.contentSha256 !== capture.contentSha256
  ) invalid();
  return manifest;
}

function snapshotTransport(value: unknown): BasicSourceTransportV2 | null {
  try {
    if (
      (typeof value !== "object" && typeof value !== "function") ||
      value === null ||
      isProxy(value)
    ) return null;
    const original = value;
    const execute = readDataMethod(original, "execute");
    if (execute === null) return null;
    return Object.freeze({
      execute(request: BasicSourceRequestV2) {
        return Reflect.apply(execute, original, [request]) as ReturnType<
          BasicSourceTransportV2["execute"]
        >;
      },
    });
  } catch {
    return null;
  }
}

function validateJsonBounds(value: BasicCollectionJsonValue): void {
  if (typeof value === "string") {
    if (Buffer.byteLength(value, "utf8") > MAX_STRING_BYTES) invalid();
    return;
  }
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    if (value.length > MAX_OBSERVATIONS) invalid();
    for (const item of value) validateJsonBounds(item);
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (Buffer.byteLength(key, "utf8") > MAX_STRING_BYTES) invalid();
    validateJsonBounds(item);
  }
}

function readDataMethod(
  value: object | Function,
  key: string,
): BasicSourceTransportV2["execute"] | null {
  let owner: object | null = value;
  const visited = new Set<object>();
  for (let depth = 0; owner !== null && depth < MAX_TRANSPORT_PROTOTYPE_DEPTH; depth += 1) {
    if (
      isProxy(owner) ||
      owner === Object.prototype ||
      owner === Function.prototype ||
      visited.has(owner)
    ) {
      return null;
    }
    visited.add(owner);
    const descriptor = Object.getOwnPropertyDescriptor(owner, key);
    if (descriptor !== undefined) {
      return Object.hasOwn(descriptor, "value") && typeof descriptor.value === "function"
        ? descriptor.value as BasicSourceTransportV2["execute"]
        : null;
    }
    owner = Object.getPrototypeOf(owner) as object | null;
  }
  return null;
}

function exactDataProperties(
  value: unknown,
  keys: readonly string[],
): ReadonlyMap<string, unknown> | null {
  try {
    if (
      typeof value !== "object" ||
      value === null ||
      isProxy(value) ||
      Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype
    ) return null;
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.length !== keys.length ||
      ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))
    ) return null;
    const result = new Map<string, unknown>();
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !Object.hasOwn(descriptor, "value")
      ) return null;
      result.set(key, descriptor.value);
    }
    return result;
  } catch {
    return null;
  }
}

function exactRecord<const Keys extends readonly string[]>(
  value: unknown,
  keys: Keys,
): Record<Keys[number], unknown> {
  if (!isRecord(value)) invalid();
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length ||
    actual.some((key) => typeof key !== "string" || !keys.includes(key))
  ) invalid();
  return value as Record<Keys[number], unknown>;
}

function compareEditorialEvidence(
  left: BasicStructuredEditorialEvidenceObservation,
  right: BasicStructuredEditorialEvidenceObservation,
): number {
  return compareText(left.sourceId, right.sourceId) ||
    compareText(left.fieldPath, right.fieldPath) ||
    compareText(left.locator, right.locator) ||
    compareText(canonicalJson(left.rawValue), canonicalJson(right.rawValue));
}

function canonicalJson(value: BasicCollectionJsonValue): string {
  if (value === null || typeof value !== "object") {
    return Object.is(value, -0) ? "-0" : JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort(compareText).map(
    (key) => `${JSON.stringify(key)}:${canonicalJson(value[key]!)}`,
  ).join(",")}}`;
}

function sameRequest(left: BasicSourceRequestV2, right: BasicSourceRequestV2): boolean {
  return left.method === right.method &&
    left.url === right.url &&
    left.accept === right.accept &&
    sameStrings(left.allowedOrigins, right.allowedOrigins) &&
    sameStrings(left.allowedQueryParameters, right.allowedQueryParameters);
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

function isTimestamp(value: unknown): value is string {
  const errors: string[] = [];
  expectUtcRfc3339Timestamp(value, "timestamp", errors);
  return typeof value === "string" && errors.length === 0;
}

function isNonBlankText(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function includes<const Values extends readonly string[]>(
  values: Values,
  value: unknown,
): value is Values[number] {
  return typeof value === "string" && values.includes(value);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function invalid(): never {
  throw new Error(ERROR_MESSAGE);
}
