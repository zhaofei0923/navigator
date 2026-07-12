import { isProxy } from "node:util/types";

import type {
  BasicInjectionRisk,
  BasicSourceCheck,
  BasicSourceRecord,
} from "./basic-collection-contracts.js";
import type {
  BasicDocumentCaptureV2,
  BasicEditorialEvidenceObservation,
  BasicExtractedFactV2,
  BasicSourcedObservationV2,
} from "./basic-collection-v2-contracts.js";
import type {
  BasicDocumentObservationPlan,
} from "./basic-document-observation-contracts.js";
import {
  parseBasicDocumentObservationPlan,
} from "./basic-document-observation-parser.js";
import {
  deepFreezeBasicOfflineValue,
} from "./basic-offline-value.js";
import type {
  BasicSourceCatalogSource,
} from "./basic-source-catalog.js";
import {
  isBasicSourceExecutionPlanEntryTrusted,
  snapshotBasicSourceExecutionPlanEntryProvenance,
  type BasicSourceExecutionPlan,
  type BasicSourceExecutionPlanEntry,
  type BasicSourceExecutionPlanEntryProvenance,
} from "./basic-source-request-materializer.js";
import type {
  BasicManualSourceReview,
  BasicManualSourceReviewSource,
} from "./basic-source-review-contracts.js";
import {
  parseBasicManualSourceReview,
} from "./basic-source-review-parser.js";
import {
  parseBasicRawCaptureManifestV2,
} from "./basic-source-metadata-v2.js";
import type {
  BasicRawCaptureManifestV2,
  BasicSourceRequestV2,
} from "./basic-source-v2-contracts.js";
import {
  isBasicSourceResponseAllowedV2,
} from "./basic-source-transport-v2.js";
import {
  snapshotBasicDocumentCaptureProvenanceV2,
} from "./basic-source-plan-runner-v2.js";
import {
  materializeBasicSourceFactsV2,
} from "./basic-v2-fact-materializer.js";

export interface BasicDocumentMaterializationResult {
  readonly sources: readonly BasicSourceRecord[];
  readonly facts: readonly BasicExtractedFactV2[];
  readonly editorialEvidence: readonly BasicEditorialEvidenceObservation[];
  readonly sourceChecks: readonly BasicSourceCheck[];
  readonly injectionRisks: readonly BasicInjectionRisk[];
}

export interface BasicDocumentMaterializationInput {
  readonly plan: BasicSourceExecutionPlan;
  readonly captures: readonly BasicDocumentCaptureV2[];
  readonly review: BasicManualSourceReview;
  readonly documentPlans: readonly BasicDocumentObservationPlan[];
}

type TrustedPlan = Readonly<{
  plan: BasicSourceExecutionPlan;
  entryProvenance: BasicSourceExecutionPlanEntryProvenance;
  manualEntries: readonly BasicSourceExecutionPlanEntry[];
  deterministicSourceIds: readonly string[];
}>;

type ParsedCapture = Readonly<{
  catalogSource: unknown;
  manifest: BasicRawCaptureManifestV2;
}>;

const ERROR_MESSAGE = "basic document evidence materialization is invalid";
const INPUT_KEYS = ["plan", "captures", "review", "documentPlans"] as const;
const PLAN_KEYS = ["catalogVersion", "catalogSha256", "countryCode", "sources"] as const;
const CAPTURE_KEYS = ["catalogSource", "manifest"] as const;
const MAX_ACTIVE_SOURCES = 64;

export function materializeBasicDocumentEvidence(
  value: BasicDocumentMaterializationInput,
): BasicDocumentMaterializationResult {
  try {
    const input = exactDataProperties(value, INPUT_KEYS);
    if (input === null) invalid();
    const trustedPlan = snapshotTrustedPlan(input.get("plan"));
    if (trustedPlan.manualEntries.length === 0) invalid();

    const captures = snapshotCaptures(input.get("captures"), trustedPlan);
    const captureBySource = exactCoverage(
      captures,
      ({ manifest }) => manifest.sourceId,
      trustedPlan.manualEntries,
    );
    const runId = captures[0]?.manifest.runId;
    if (runId === undefined) invalid();

    const review = parseBasicManualSourceReview(input.get("review"), {
      runId,
      countryCode: trustedPlan.plan.countryCode,
      catalogVersion: trustedPlan.plan.catalogVersion,
      catalogSha256: trustedPlan.plan.catalogSha256,
      deterministicSourceIds: trustedPlan.deterministicSourceIds,
      manualSourceIds: trustedPlan.manualEntries.map(({ source }) => source.sourceId),
    });
    const reviewBySource = new Map(
      review.sources.map((source) => [source.sourceId, source]),
    );

    const documentPlans = snapshotDocumentPlans(input.get("documentPlans"));
    const documentPlanBySource = exactCoverage(
      documentPlans,
      ({ sourceId }) => sourceId,
      trustedPlan.manualEntries,
    );

    return materializeReviewedSources(
      trustedPlan,
      runId,
      captureBySource,
      reviewBySource,
      documentPlanBySource,
    );
  } catch {
    throw new Error(ERROR_MESSAGE);
  }
}

function snapshotTrustedPlan(value: unknown): TrustedPlan {
  const properties = exactDataProperties(value, PLAN_KEYS);
  if (properties === null) invalid();
  const catalogVersion = properties.get("catalogVersion");
  const catalogSha256 = properties.get("catalogSha256");
  const countryCode = properties.get("countryCode");
  if (
    typeof catalogVersion !== "string" ||
    typeof catalogSha256 !== "string" ||
    typeof countryCode !== "string"
  ) invalid();

  const entries = denseDataArray(properties.get("sources"), MAX_ACTIVE_SOURCES);
  let sharedProvenance: BasicSourceExecutionPlanEntryProvenance | null = null;
  const trustedEntries: BasicSourceExecutionPlanEntry[] = [];
  for (const entry of entries) {
    if (!isBasicSourceExecutionPlanEntryTrusted(entry)) invalid();
    const provenance = snapshotBasicSourceExecutionPlanEntryProvenance(entry);
    if (
      provenance === null ||
      provenance.catalogVersion !== catalogVersion ||
      provenance.catalogSha256 !== catalogSha256 ||
      provenance.countryCode !== countryCode ||
      (sharedProvenance !== null && provenance !== sharedProvenance)
    ) invalid();
    sharedProvenance = provenance;
    trustedEntries.push(entry);
  }

  trustedEntries.sort((left, right) =>
    compareText(left.source.sourceId, right.source.sourceId));
  requireUniqueSourceIds(trustedEntries);
  const manualEntries: BasicSourceExecutionPlanEntry[] = [];
  const deterministicSourceIds: string[] = [];
  for (const entry of trustedEntries) {
    const { source } = entry;
    if (source.accessMode !== "open") invalid();
    if (source.adapterKind === "manual-document") {
      if (
        (source.format !== "html" && source.format !== "pdf") ||
        source.accept !== expectedAccept(source.format)
      ) invalid();
      manualEntries.push(entry);
    } else if (source.adapterKind === "deterministic") {
      deterministicSourceIds.push(source.sourceId);
    } else {
      invalid();
    }
  }

  return Object.freeze({
    plan: Object.freeze({
      catalogVersion,
      catalogSha256,
      countryCode,
      sources: Object.freeze(trustedEntries),
    }),
    entryProvenance: sharedProvenance ?? invalid(),
    manualEntries: Object.freeze(manualEntries),
    deterministicSourceIds: Object.freeze(deterministicSourceIds),
  });
}

function snapshotCaptures(
  value: unknown,
  trustedPlan: TrustedPlan,
): readonly ParsedCapture[] {
  return Object.freeze(denseDataArray(value, MAX_ACTIVE_SOURCES).map((item) => {
    const provenance = snapshotBasicDocumentCaptureProvenanceV2(item);
    const entry = provenance === null
      ? undefined
      : trustedPlan.manualEntries.find(
        ({ source }) => source.sourceId === provenance.sourceId,
      );
    if (
      provenance === null ||
      entry === undefined ||
      provenance.entryProvenance !== trustedPlan.entryProvenance ||
      provenance.runId !== provenance.manifest.runId ||
      provenance.countryCode !== trustedPlan.plan.countryCode ||
      provenance.countryCode !== provenance.manifest.countryCode ||
      provenance.catalogVersion !== trustedPlan.plan.catalogVersion ||
      provenance.catalogVersion !== provenance.manifest.catalogVersion ||
      provenance.catalogSha256 !== trustedPlan.plan.catalogSha256 ||
      provenance.catalogSha256 !== provenance.manifest.catalogSha256 ||
      provenance.sourceId !== entry.source.sourceId ||
      provenance.sourceId !== provenance.manifest.sourceId ||
      provenance.adapterId !== entry.source.adapterId ||
      provenance.adapterId !== provenance.manifest.adapterId ||
      provenance.adapterVersion !== entry.source.adapterVersion ||
      provenance.adapterVersion !== provenance.manifest.adapterVersion ||
      provenance.catalogSource !== entry.source ||
      !sameRequest(provenance.request, entry.request) ||
      !sameRequest(provenance.manifest.request, provenance.request)
    ) invalid();
    const properties = exactDataProperties(item, CAPTURE_KEYS);
    if (
      properties === null ||
      properties.get("catalogSource") !== provenance.catalogSource ||
      properties.get("manifest") !== provenance.manifest
    ) invalid();
    const manifest = parseBasicRawCaptureManifestV2(properties.get("manifest"));
    if (manifest === null || !sameManifest(manifest, provenance.manifest)) invalid();
    return Object.freeze({
      catalogSource: properties.get("catalogSource"),
      manifest,
    });
  }));
}

function snapshotDocumentPlans(
  value: unknown,
): readonly BasicDocumentObservationPlan[] {
  return Object.freeze(denseDataArray(value, MAX_ACTIVE_SOURCES).map(
    (item) => parseBasicDocumentObservationPlan(item),
  ));
}

function exactCoverage<T>(
  values: readonly T[],
  sourceId: (value: T) => string,
  manualEntries: readonly BasicSourceExecutionPlanEntry[],
): ReadonlyMap<string, T> {
  const expected = manualEntries.map(({ source }) => source.sourceId);
  if (values.length !== expected.length) invalid();
  const result = new Map<string, T>();
  for (const value of values) {
    const id = sourceId(value);
    if (!expected.includes(id) || result.has(id)) invalid();
    result.set(id, value);
  }
  if (expected.some((id) => !result.has(id))) invalid();
  return result;
}

function materializeReviewedSources(
  trustedPlan: TrustedPlan,
  runId: string,
  captureBySource: ReadonlyMap<string, ParsedCapture>,
  reviewBySource: ReadonlyMap<string, BasicManualSourceReviewSource>,
  documentPlanBySource: ReadonlyMap<string, BasicDocumentObservationPlan>,
): BasicDocumentMaterializationResult {
  const sources: BasicSourceRecord[] = [];
  const factObservations: BasicSourcedObservationV2[] = [];
  const editorialEvidence: BasicEditorialEvidenceObservation[] = [];
  const sourceChecks: BasicSourceCheck[] = [];
  const injectionRisks: BasicInjectionRisk[] = [];

  for (const entry of trustedPlan.manualEntries) {
    const sourceId = entry.source.sourceId;
    const capture = captureBySource.get(sourceId);
    const sourceReview = reviewBySource.get(sourceId);
    const documentPlan = documentPlanBySource.get(sourceId);
    if (
      capture === undefined ||
      sourceReview === undefined ||
      documentPlan === undefined
    ) invalid();
    validateBinding(trustedPlan.plan, runId, entry, capture, documentPlan);

    const locators = new Set<string>();
    for (const observation of documentPlan.observations) {
      if (!entry.source.fieldPaths.includes(observation.fieldPath)) invalid();
      locators.add(observation.locator);
      if (observation.usage === "source-fact") {
        factObservations.push({
          sourceId,
          fieldPath: observation.fieldPath,
          locator: observation.locator,
          rawValue: observation.rawValue,
          normalizedValue: observation.normalizedValue,
          unit: observation.unit,
          year: observation.year,
          uncertainty: observation.uncertainty,
        });
      } else {
        editorialEvidence.push({
          sourceId,
          fieldPath: observation.fieldPath,
          locator: observation.locator,
          rawValue: observation.rawValue,
        });
      }
    }
    for (const risk of sourceReview.injectionRisks) {
      if (!locators.has(risk.locator)) invalid();
      injectionRisks.push({ sourceId, ...risk });
    }

    sources.push(sourceRecord(
      entry.source,
      entry.request,
      capture.manifest,
      sourceReview,
      locators,
    ));
    sourceChecks.push({ sourceId, ...sourceReview.sourceCheck });
  }

  editorialEvidence.sort(compareEditorialEvidence);
  return deepFreezeBasicOfflineValue({
    sources,
    facts: materializeBasicSourceFactsV2(factObservations, "manual"),
    editorialEvidence,
    sourceChecks,
    injectionRisks,
  });
}

function validateBinding(
  plan: BasicSourceExecutionPlan,
  runId: string,
  entry: BasicSourceExecutionPlanEntry,
  capture: ParsedCapture,
  documentPlan: BasicDocumentObservationPlan,
): void {
  const source = entry.source;
  const manifest = capture.manifest;
  if (
    capture.catalogSource !== source ||
    manifest.runId !== runId ||
    manifest.countryCode !== plan.countryCode ||
    manifest.catalogVersion !== plan.catalogVersion ||
    manifest.catalogSha256 !== plan.catalogSha256 ||
    manifest.sourceId !== source.sourceId ||
    manifest.adapterId !== source.adapterId ||
    manifest.adapterVersion !== source.adapterVersion ||
    !sameRequest(manifest.request, entry.request) ||
    !isBasicSourceResponseAllowedV2(manifest.response, manifest.request) ||
    mediaType(manifest.response.contentType) !== expectedAccept(source.format) ||
    documentPlan.runId !== runId ||
    documentPlan.countryCode !== plan.countryCode ||
    documentPlan.catalogVersion !== plan.catalogVersion ||
    documentPlan.catalogSha256 !== plan.catalogSha256 ||
    documentPlan.sourceId !== source.sourceId ||
    documentPlan.capture.adapterId !== source.adapterId ||
    documentPlan.capture.adapterVersion !== source.adapterVersion ||
    documentPlan.capture.requestUrl !== entry.request.url ||
    documentPlan.capture.requestUrl !== manifest.request.url ||
    documentPlan.capture.contentType !== manifest.response.contentType ||
    documentPlan.capture.retrievedAt !== manifest.response.retrievedAt ||
    documentPlan.capture.byteLength !== manifest.response.byteLength ||
    documentPlan.capture.contentSha256 !== manifest.response.contentSha256
  ) invalid();
}

function sourceRecord(
  source: BasicSourceCatalogSource,
  request: BasicSourceRequestV2,
  manifest: BasicRawCaptureManifestV2,
  review: BasicManualSourceReviewSource,
  locators: ReadonlySet<string>,
): BasicSourceRecord {
  return {
    sourceId: source.sourceId,
    sourceName: source.sourceName,
    sourceUrl: request.url,
    retrievedAt: manifest.response.retrievedAt,
    publishedAt: review.publishedAt,
    contentSha256: manifest.response.contentSha256,
    evidenceLocators: Array.from(locators).sort(compareText),
    sourceFamily: source.sourceFamily,
    accessStatus: "open",
    accessNotes: review.accessNotes,
    credibility: source.credibility,
    discoveryOnly: false,
    promptInjectionRisk: review.promptInjectionRisk,
  };
}

function denseDataArray(value: unknown, maximum: number): readonly unknown[] {
  try {
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
      length.value > maximum ||
      Reflect.ownKeys(value).length !== length.value + 1
    ) invalid();
    const result: unknown[] = [];
    for (let index = 0; index < length.value; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !Object.hasOwn(descriptor, "value")
      ) invalid();
      result.push(descriptor.value);
    }
    return result;
  } catch {
    invalid();
  }
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

function requireUniqueSourceIds(
  entries: readonly BasicSourceExecutionPlanEntry[],
): void {
  let previous: string | null = null;
  for (const { source } of entries) {
    if (previous !== null && previous === source.sourceId) invalid();
    previous = source.sourceId;
  }
}

function expectedAccept(format: BasicSourceCatalogSource["format"]): string {
  if (format === "html") return "text/html";
  if (format === "pdf") return "application/pdf";
  invalid();
}

function mediaType(contentType: string): string {
  const [type] = contentType.split(";", 1);
  if (type === undefined) invalid();
  return type.toLowerCase();
}

function sameRequest(
  left: BasicSourceRequestV2,
  right: BasicSourceRequestV2,
): boolean {
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

function sameManifest(
  left: BasicRawCaptureManifestV2,
  right: BasicRawCaptureManifestV2,
): boolean {
  return left.schemaVersion === right.schemaVersion &&
    left.countryCode === right.countryCode &&
    left.runId === right.runId &&
    left.catalogVersion === right.catalogVersion &&
    left.catalogSha256 === right.catalogSha256 &&
    left.adapterId === right.adapterId &&
    left.adapterVersion === right.adapterVersion &&
    left.sourceId === right.sourceId &&
    sameRequest(left.request, right.request) &&
    left.response.status === right.response.status &&
    left.response.finalUrl === right.response.finalUrl &&
    sameStrings(left.response.redirectChain, right.response.redirectChain) &&
    left.response.contentType === right.response.contentType &&
    left.response.retrievedAt === right.response.retrievedAt &&
    left.response.byteLength === right.response.byteLength &&
    left.response.contentSha256 === right.response.contentSha256;
}

function compareEditorialEvidence(
  left: BasicEditorialEvidenceObservation,
  right: BasicEditorialEvidenceObservation,
): number {
  return compareText(left.sourceId, right.sourceId) ||
    compareText(left.fieldPath, right.fieldPath) ||
    compareText(left.locator, right.locator) ||
    compareText(JSON.stringify(left.rawValue), JSON.stringify(right.rawValue));
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function invalid(): never {
  throw new Error(ERROR_MESSAGE);
}
