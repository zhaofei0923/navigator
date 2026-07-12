import { isProxy } from "node:util/types";

import type {
  BasicCollectionJsonValue,
  BasicInjectionRisk,
  BasicSourceCheck,
  BasicSourceRecord,
} from "./basic-collection-contracts.js";
import {
  BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION,
  BASIC_V2_REQUIRED_EDITORIAL_PATHS,
  classifyBasicV2FieldPath,
  type BasicExtractedFactV2,
  type BasicExtractedFactsV2,
  type BasicPreliminarySourceRunV2,
  type BasicRawCaptureReceiptV2,
  type BasicReviewedMaterializationV2,
  type BasicSourceRegisterV2,
  type BasicStructuredEditorialEvidenceObservation,
} from "./basic-collection-v2-contracts.js";
import {
  snapshotBasicBoundedJsonValue,
  type BasicBoundedArrayLimit,
} from "./basic-bounded-json.js";
import {
  snapshotBasicDocumentMaterializationProvenanceV2,
  type BasicDocumentMaterializationResult,
} from "./basic-document-observation-materializer.js";
import { materializeBasicDerivedFacts } from "./basic-derived-fact-materializer.js";
import {
  materializeBasicEditorialFacts,
} from "./basic-editorial-materializer.js";
import { parseBasicCountryEditorialInput } from "./basic-editorial-input-parser.js";
import {
  deepFreezeBasicOfflineValue,
  deeplyEqualBasicOfflineValue,
} from "./basic-offline-value.js";
import {
  snapshotBasicDocumentCaptureProvenanceV2,
} from "./basic-source-plan-runner-v2.js";
import type { BasicStructuredSourceReview } from "./basic-source-review-contracts.js";
import { parseBasicStructuredSourceReview } from "./basic-source-review-parser.js";
import {
  materializeBasicEditorialObservationsV2,
  materializeBasicSourceFactsV2,
} from "./basic-v2-fact-materializer.js";

const ERROR = "basic reviewed materialization is invalid";
const INPUT_KEYS = [
  "preliminary",
  "structuredReview",
  "documentResult",
  "editorial",
] as const;
const PRELIMINARY_KEYS = [
  "sourceRegister",
  "extractedFacts",
  "structuredEditorialEvidence",
  "documentCaptures",
  "receipts",
] as const;
const SOURCE_KEYS = [
  "sourceId", "sourceName", "sourceUrl", "retrievedAt", "publishedAt",
  "contentSha256", "evidenceLocators", "sourceFamily", "accessStatus",
  "accessNotes", "credibility", "discoveryOnly", "promptInjectionRisk",
] as const;
const FACT_KEYS = [
  "factId", "fieldPath", "status", "evidence", "extractionMethod", "uncertainty",
] as const;
const EVIDENCE_KEYS = [
  "sourceId", "locator", "rawValue", "normalizedValue", "unit", "year",
] as const;
const STRUCTURED_EVIDENCE_KEYS = ["sourceId", "fieldPath", "locator", "rawValue"] as const;
const RECEIPT_KEYS = ["sourceId", "contentSha256", "byteLength", "reused"] as const;
const CAPTURE_BINDING_KEYS = [
  "sourceId", "requestUrl", "finalUrl", "retrievedAt", "contentSha256",
] as const;
const MAX_SOURCES = 64;
const MAX_FACTS = 256;
const MAX_EVIDENCE = 2_048;
const MAX_JSON_ARRAY = 256;
const MAX_JSON_STRING_BYTES = 65_536;
const INDICATOR_COMPONENT_PATH =
  /^marketOverview\.keyIndicators\[(?:0|[1-9]\d*)\]\.(label|value|unit|year)$/;

type Input = Readonly<{
  preliminary: BasicPreliminarySourceRunV2;
  structuredReview: BasicStructuredSourceReview | null;
  documentResult: BasicDocumentMaterializationResult | null;
  editorial: Parameters<typeof materializeBasicEditorialFacts>[0]["editorial"];
}>;

export function materializeBasicReviewedRunV2(
  value: Input,
): BasicReviewedMaterializationV2 {
  try {
    const input = exactProperties(value, INPUT_KEYS);
    const preliminary = snapshotPreliminary(input.get("preliminary"));
    const editorial = parseBasicCountryEditorialInput(input.get("editorial"));
    requireIdentity(preliminary, editorial);

    const deterministicIds = preliminary.sourceRegister.sources
      .map(({ sourceId }) => sourceId);
    const structuredReview = snapshotStructuredReview(
      input.get("structuredReview"),
      preliminary,
      deterministicIds,
    );
    const documentResult = bindDocumentResult(
      input.get("documentResult"),
      preliminary,
    );
    const manualSources = documentResult?.sources ?? [];
    requireDisjoint(deterministicIds, manualSources.map(({ sourceId }) => sourceId));

    const sourceChecks = aggregateChecks(structuredReview, documentResult);
    const injectionRisks = aggregateRisks(structuredReview, documentResult);
    const reviewedSources = buildReviewedRegister(
      preliminary,
      manualSources,
      documentResult,
      editorial,
    );
    const receipts = snapshotAndBindReceipts(
      preliminary.receipts,
      reviewedSources,
      preliminary,
    );

    const editorialResult = materializeBasicEditorialFacts({
      editorial,
      reviewedSources,
      preliminaryFacts: preliminary.extractedFacts,
      structuredEditorialEvidence: preliminary.structuredEditorialEvidence,
      documentResult,
      sourceChecks,
      injectionRisks,
    });
    const mergedFacts = mergeFacts(
      preliminary.extractedFacts.facts,
      documentResult?.facts ?? [],
      editorialResult.facts,
    );
    requireEditorialCompleteness(mergedFacts);
    const derived = materializeBasicDerivedFacts({
      countryCode: reviewedSources.countryCode,
      primarySourceId: editorial.primarySourceId,
      sourceRegister: reviewedSources,
      candidateFacts: mergedFacts,
    });
    const facts = [...mergedFacts, ...derived.facts]
      .sort((left, right) => compareText(left.fieldPath, right.fieldPath));
    requireUnique(facts.map(({ fieldPath }) => fieldPath));

    return deepFreezeBasicOfflineValue({
      materialization: {
        sourceRegister: derived.sourceRegister,
        extractedFacts: {
          schemaVersion: BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION,
          runId: derived.sourceRegister.runId,
          countryCode: derived.sourceRegister.countryCode,
          facts,
        },
        receipts,
      },
      sourceChecks,
      injectionRisks,
    });
  } catch {
    throw new Error(ERROR);
  }
}

function requireEditorialCompleteness(
  facts: readonly BasicExtractedFactV2[],
): void {
  const paths = new Set(facts.map(({ fieldPath }) => fieldPath));
  for (const fieldPath of BASIC_V2_REQUIRED_EDITORIAL_PATHS) {
    if (!paths.has(fieldPath)) invalid();
  }

  const indicatorPrefixes = new Set<string>();
  for (const fieldPath of paths) {
    if (INDICATOR_COMPONENT_PATH.test(fieldPath)) {
      indicatorPrefixes.add(fieldPath.slice(0, fieldPath.lastIndexOf(".")));
    }
  }
  for (const prefix of indicatorPrefixes) {
    if (!paths.has(`${prefix}.label`)) invalid();
  }
}

function snapshotPreliminary(value: unknown): BasicPreliminarySourceRunV2 {
  const input = exactProperties(value, PRELIMINARY_KEYS);
  const sourceRegister = snapshotRegister(input.get("sourceRegister"));
  const extractedFacts = snapshotFacts(input.get("extractedFacts"));
  if (
    sourceRegister.runId !== extractedFacts.runId ||
    sourceRegister.countryCode !== extractedFacts.countryCode
  ) invalid();
  const structuredEditorialEvidence = snapshotStructuredEvidence(
    input.get("structuredEditorialEvidence"),
  );
  const documentCaptures = denseReferences(input.get("documentCaptures"), MAX_SOURCES);
  const receipts = snapshotReceipts(input.get("receipts"));
  const sourceIds = new Set(sourceRegister.sources.map(({ sourceId }) => sourceId));
  const referenced = new Set<string>();
  for (const fact of extractedFacts.facts) {
    if (
      fact.extractionMethod !== "deterministic" ||
      !["source-backed", "hybrid-name"].includes(
        classifyBasicV2FieldPath(fact.fieldPath) ?? "",
      )
    ) invalid();
    requireValidFact(fact);
    for (const evidence of fact.evidence) referenced.add(evidence.sourceId);
  }
  for (const evidence of structuredEditorialEvidence) {
    if (classifyBasicV2FieldPath(evidence.fieldPath) !== "editorial") invalid();
    referenced.add(evidence.sourceId);
  }
  if (
    referenced.size !== sourceIds.size ||
    [...referenced].some((sourceId) => !sourceIds.has(sourceId))
  ) invalid();
  return deepFreezeBasicOfflineValue({
    sourceRegister,
    extractedFacts,
    structuredEditorialEvidence,
    documentCaptures,
    receipts,
  });
}

function snapshotStructuredReview(
  value: unknown,
  preliminary: BasicPreliminarySourceRunV2,
  deterministicSourceIds: readonly string[],
): BasicStructuredSourceReview | null {
  if (deterministicSourceIds.length === 0) {
    if (value !== null) invalid();
    return null;
  }
  if (value === null) invalid();
  return parseBasicStructuredSourceReview(value, {
    runId: preliminary.sourceRegister.runId,
    countryCode: preliminary.sourceRegister.countryCode,
    catalogVersion: preliminary.sourceRegister.catalogVersion,
    catalogSha256: preliminary.sourceRegister.catalogSha256,
    deterministicSourceIds,
    manualSourceIds: [],
  });
}

function bindDocumentResult(
  value: unknown,
  preliminary: BasicPreliminarySourceRunV2,
): BasicDocumentMaterializationResult | null {
  const captures = preliminary.documentCaptures;
  if (captures.length === 0) {
    if (value !== null) invalid();
    return null;
  }
  if (value === null) invalid();
  const provenance = snapshotBasicDocumentMaterializationProvenanceV2(value);
  if (provenance === null || !sameIdentity(provenance, preliminary.sourceRegister)) invalid();
  const captureById = new Map<string, BasicPreliminarySourceRunV2["documentCaptures"][number]>();
  const captureIds: string[] = [];
  for (const capture of captures) {
    const captured = snapshotBasicDocumentCaptureProvenanceV2(capture);
    if (
      captured === null || !sameIdentity(captured, preliminary.sourceRegister) ||
      captured.catalogSource !== capture.catalogSource ||
      captured.manifest !== capture.manifest ||
      captured.sourceId !== capture.catalogSource.sourceId
    ) invalid();
    captureIds.push(captured.sourceId);
    captureById.set(captured.sourceId, capture);
  }
  const manualIds = uniqueSortedIds(captureIds);
  const provenanceIds = uniqueSortedIds(snapshotTextArray(
    provenance.manualSourceIds,
    MAX_SOURCES,
  ));
  const provenanceBindings = snapshotCaptureBindings(provenance.captureBindings);
  const bindingIds = uniqueSortedIds(provenanceBindings.map(({ sourceId }) => sourceId));
  const result = value as BasicDocumentMaterializationResult;
  const resultIds = uniqueSortedIds(snapshotResultSourceIds(result.sources));
  if (
    !sameStrings(manualIds, provenanceIds) ||
    !sameStrings(manualIds, bindingIds) ||
    !sameStrings(manualIds, resultIds)
  ) invalid();
  const bindingById = new Map(
    provenanceBindings.map((binding) => [binding.sourceId, binding]),
  );
  for (const sourceId of manualIds) {
    const capture = captureById.get(sourceId);
    const binding = bindingById.get(sourceId);
    if (capture === undefined || binding === undefined) invalid();
    const manifest = capture.manifest;
    if (
      binding.requestUrl !== manifest.request.url ||
      binding.finalUrl !== manifest.response.finalUrl ||
      binding.retrievedAt !== manifest.response.retrievedAt ||
      binding.contentSha256 !== manifest.response.contentSha256
    ) invalid();
  }
  for (const source of result.sources) {
    const capture = captureById.get(source.sourceId);
    if (capture === undefined) invalid();
    const { catalogSource, manifest } = capture;
    if (
      source.sourceName !== catalogSource.sourceName ||
      source.sourceFamily !== catalogSource.sourceFamily ||
      source.credibility !== catalogSource.credibility ||
      source.accessStatus !== "open" || catalogSource.accessMode !== "open" ||
      source.sourceUrl !== manifest.request.url ||
      source.retrievedAt !== manifest.response.retrievedAt ||
      source.contentSha256 !== manifest.response.contentSha256
    ) invalid();
  }
  for (const fact of result.facts) {
    if (fact.extractionMethod !== "manual") invalid();
    const owner = classifyBasicV2FieldPath(fact.fieldPath);
    if (owner !== "source-backed" && owner !== "hybrid-name") invalid();
    requireValidFact(fact);
  }
  requireDocumentOwnership(result, new Set(manualIds));
  return result;
}

function requireDocumentOwnership(
  result: BasicDocumentMaterializationResult,
  manualIds: ReadonlySet<string>,
): void {
  for (const fact of result.facts) {
    for (const evidence of fact.evidence) if (!manualIds.has(evidence.sourceId)) invalid();
  }
  for (const evidence of result.editorialEvidence) {
    if (!manualIds.has(evidence.sourceId)) invalid();
  }
  if (
    result.sourceChecks.length !== manualIds.size ||
    result.sourceChecks.some(({ sourceId }) => !manualIds.has(sourceId)) ||
    result.injectionRisks.some(({ sourceId }) => !manualIds.has(sourceId))
  ) invalid();
}

function buildReviewedRegister(
  preliminary: BasicPreliminarySourceRunV2,
  manualSources: readonly BasicSourceRecord[],
  documentResult: BasicDocumentMaterializationResult | null,
  editorial: Input["editorial"],
): BasicSourceRegisterV2 {
  const sources = [...preliminary.sourceRegister.sources, ...manualSources]
    .map((source) => ({ ...source, evidenceLocators: [...source.evidenceLocators] }))
    .sort((left, right) => compareText(left.sourceId, right.sourceId));
  requireUnique(sources.map(({ sourceId }) => sourceId));
  const locators = new Map(sources.map(({ sourceId, evidenceLocators }) => [
    sourceId,
    new Set(evidenceLocators),
  ]));
  const add = (sourceId: string, locator: string): void => {
    const values = locators.get(sourceId);
    if (values === undefined) invalid();
    values.add(locator);
  };
  for (const fact of [
    ...preliminary.extractedFacts.facts,
    ...(documentResult?.facts ?? []),
  ]) for (const evidence of fact.evidence) add(evidence.sourceId, evidence.locator);
  for (const evidence of preliminary.structuredEditorialEvidence) {
    add(evidence.sourceId, evidence.locator);
  }
  for (const evidence of documentResult?.editorialEvidence ?? []) {
    add(evidence.sourceId, evidence.locator);
  }
  for (const item of editorial.items) {
    for (const evidence of item.evidence) add(evidence.sourceId, evidence.locator);
  }
  const enriched = sources.map((source) => ({
    ...source,
    evidenceLocators: [...(locators.get(source.sourceId) ?? [])].sort(compareText),
  }));
  return deepFreezeBasicOfflineValue({
    schemaVersion: BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION,
    runId: preliminary.sourceRegister.runId,
    countryCode: preliminary.sourceRegister.countryCode,
    catalogVersion: preliminary.sourceRegister.catalogVersion,
    catalogSha256: preliminary.sourceRegister.catalogSha256,
    sources: enriched,
  });
}

function aggregateChecks(
  structuredReview: BasicStructuredSourceReview | null,
  documentResult: BasicDocumentMaterializationResult | null,
): readonly BasicSourceCheck[] {
  const checks = [
    ...(structuredReview?.sources.map(({ sourceId, sourceCheck }) => ({
      sourceId,
      status: sourceCheck.status,
      notes: sourceCheck.notes,
    })) ?? []),
    ...(documentResult?.sourceChecks ?? []),
  ].sort((left, right) => compareText(left.sourceId, right.sourceId));
  requireUnique(checks.map(({ sourceId }) => sourceId));
  return deepFreezeBasicOfflineValue(checks);
}

function aggregateRisks(
  structuredReview: BasicStructuredSourceReview | null,
  documentResult: BasicDocumentMaterializationResult | null,
): readonly BasicInjectionRisk[] {
  const risks = [
    ...(structuredReview?.injectionRisks ?? []),
    ...(documentResult?.injectionRisks ?? []),
  ].map((risk) => ({ ...risk })).sort(compareRisk);
  requireUnique(risks.map(riskKey));
  return deepFreezeBasicOfflineValue(risks);
}

function snapshotAndBindReceipts(
  values: readonly BasicRawCaptureReceiptV2[],
  register: BasicSourceRegisterV2,
  preliminary: BasicPreliminarySourceRunV2,
): readonly BasicRawCaptureReceiptV2[] {
  const receipts = snapshotReceipts(values)
    .slice().sort((left, right) => compareText(left.sourceId, right.sourceId));
  requireUnique(receipts.map(({ sourceId }) => sourceId));
  if (receipts.length !== register.sources.length) invalid();
  const sourceById = new Map(register.sources.map((source) => [source.sourceId, source]));
  const captureById = new Map(preliminary.documentCaptures.map((capture) => [
    capture.manifest.sourceId,
    capture,
  ]));
  for (const receipt of receipts) {
    const source = sourceById.get(receipt.sourceId);
    if (source === undefined || source.contentSha256 !== receipt.contentSha256) invalid();
    const capture = captureById.get(receipt.sourceId);
    if (
      capture !== undefined &&
      (capture.manifest.response.byteLength !== receipt.byteLength ||
        capture.manifest.response.contentSha256 !== receipt.contentSha256)
    ) invalid();
  }
  return deepFreezeBasicOfflineValue(receipts);
}

function mergeFacts(
  preliminary: readonly BasicExtractedFactV2[],
  document: readonly BasicExtractedFactV2[],
  editorial: readonly BasicExtractedFactV2[],
): readonly BasicExtractedFactV2[] {
  const preliminaryName = preliminary.filter(({ fieldPath }) => fieldPath === "country.name");
  const editorialName = editorial.filter(({ fieldPath }) => fieldPath === "country.name");
  if (
    preliminaryName.length !== editorialName.length ||
    preliminaryName.length > 1 ||
    document.some(({ fieldPath }) => fieldPath === "country.name")
  ) invalid();
  const groups = new Map<string, BasicExtractedFactV2[]>();
  for (const fact of [
    ...preliminary.filter(({ fieldPath }) => fieldPath !== "country.name"),
    ...document,
    ...editorial,
  ]) {
    const group = groups.get(fact.fieldPath) ?? [];
    group.push(fact);
    groups.set(fact.fieldPath, group);
  }
  const result: BasicExtractedFactV2[] = [];
  for (const fieldPath of [...groups.keys()].sort(compareText)) {
    const facts = groups.get(fieldPath) ?? [];
    const methods = new Set(facts.map(({ extractionMethod }) => extractionMethod));
    if (methods.size !== 1) invalid();
    const method = facts[0]?.extractionMethod;
    if (method === undefined) invalid();
    const owner = classifyBasicV2FieldPath(fieldPath);
    if (owner === null || owner === "derived") invalid();
    const observations = facts.flatMap((fact) => fact.evidence.map((evidence) => ({
      sourceId: evidence.sourceId,
      fieldPath,
      locator: evidence.locator,
      rawValue: evidence.rawValue,
      normalizedValue: evidence.normalizedValue,
      unit: evidence.unit,
      year: evidence.year,
      uncertainty: fact.uncertainty,
    })));
    const merged = owner === "editorial"
      ? materializeBasicEditorialObservationsV2(observations)
      : materializeBasicSourceFactsV2(observations, method);
    if (merged.length !== 1) invalid();
    result.push(merged[0]!);
  }
  requireUnique(result.map(({ fieldPath }) => fieldPath));
  return deepFreezeBasicOfflineValue(result);
}

function requireValidFact(fact: BasicExtractedFactV2): void {
  const owner = classifyBasicV2FieldPath(fact.fieldPath);
  if (owner === null || owner === "derived") invalid();
  const observations = fact.evidence.map((evidence) => ({
    sourceId: evidence.sourceId,
    fieldPath: fact.fieldPath,
    locator: evidence.locator,
    rawValue: evidence.rawValue,
    normalizedValue: evidence.normalizedValue,
    unit: evidence.unit,
    year: evidence.year,
    uncertainty: fact.uncertainty,
  }));
  const rebuilt = owner === "editorial"
    ? materializeBasicEditorialObservationsV2(observations)
    : materializeBasicSourceFactsV2(observations, fact.extractionMethod);
  if (rebuilt.length !== 1 || !deeplyEqualBasicOfflineValue(rebuilt[0], fact)) invalid();
}

function snapshotRegister(value: unknown): BasicSourceRegisterV2 {
  const record = jsonRecord(value, [
    "schemaVersion", "runId", "countryCode", "catalogVersion", "catalogSha256", "sources",
  ] as const, (path) => path.length === 1 && path[0] === "sources"
    ? MAX_SOURCES
    : undefined);
  if (
    record.schemaVersion !== BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION ||
    !isText(record.runId) || !isText(record.countryCode) ||
    !isText(record.catalogVersion) || !isText(record.catalogSha256)
  ) invalid();
  const sources = jsonArray(record.sources, MAX_SOURCES).map(snapshotSource);
  requireSortedUnique(sources.map(({ sourceId }) => sourceId));
  return deepFreezeBasicOfflineValue({
    schemaVersion: BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION,
    runId: record.runId,
    countryCode: record.countryCode,
    catalogVersion: record.catalogVersion,
    catalogSha256: record.catalogSha256,
    sources,
  });
}

function snapshotSource(value: BasicCollectionJsonValue): BasicSourceRecord {
  const record = exactJsonRecord(value, SOURCE_KEYS);
  if (
    !isText(record.sourceId) || !isText(record.sourceName) || !isText(record.sourceUrl) ||
    !isText(record.retrievedAt) || !(record.publishedAt === null || isText(record.publishedAt)) ||
    !isText(record.contentSha256) || !isText(record.sourceFamily) ||
    !isText(record.accessStatus) || !(record.accessNotes === null || isText(record.accessNotes)) ||
    !isText(record.credibility) || typeof record.discoveryOnly !== "boolean" ||
    !isText(record.promptInjectionRisk)
  ) invalid();
  const evidenceLocators = jsonArray(record.evidenceLocators, MAX_EVIDENCE).map(textValue);
  return {
    sourceId: record.sourceId,
    sourceName: record.sourceName,
    sourceUrl: record.sourceUrl,
    retrievedAt: record.retrievedAt,
    publishedAt: record.publishedAt,
    contentSha256: record.contentSha256,
    evidenceLocators,
    sourceFamily: record.sourceFamily as BasicSourceRecord["sourceFamily"],
    accessStatus: record.accessStatus as BasicSourceRecord["accessStatus"],
    accessNotes: record.accessNotes,
    credibility: record.credibility as BasicSourceRecord["credibility"],
    discoveryOnly: record.discoveryOnly,
    promptInjectionRisk: record.promptInjectionRisk as BasicSourceRecord["promptInjectionRisk"],
  };
}

function snapshotFacts(value: unknown): BasicExtractedFactsV2 {
  const record = jsonRecord(value, ["schemaVersion", "runId", "countryCode", "facts"] as const);
  if (
    record.schemaVersion !== BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION ||
    !isText(record.runId) || !isText(record.countryCode)
  ) invalid();
  const facts = jsonArray(record.facts, MAX_FACTS).map(snapshotFact);
  requireSortedUnique(facts.map(({ fieldPath }) => fieldPath));
  return deepFreezeBasicOfflineValue({
    schemaVersion: BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION,
    runId: record.runId,
    countryCode: record.countryCode,
    facts,
  });
}

function snapshotFact(value: BasicCollectionJsonValue): BasicExtractedFactV2 {
  const record = exactJsonRecord(value, FACT_KEYS);
  if (
    !isText(record.factId) || !isText(record.fieldPath) || !isText(record.status) ||
    !isText(record.extractionMethod) || !(record.uncertainty === null || isText(record.uncertainty))
  ) invalid();
  const evidence = jsonArray(record.evidence, MAX_EVIDENCE).map((entry) => {
    const item = exactJsonRecord(entry, EVIDENCE_KEYS);
    if (
      !isText(item.sourceId) || !isText(item.locator) ||
      !(item.unit === null || isText(item.unit)) ||
      !(item.year === null || typeof item.year === "number" && Number.isFinite(item.year))
    ) invalid();
    return {
      sourceId: item.sourceId,
      locator: item.locator,
      rawValue: item.rawValue,
      normalizedValue: item.normalizedValue,
      unit: item.unit,
      year: item.year,
    };
  });
  return {
    factId: record.factId,
    fieldPath: record.fieldPath,
    status: record.status as BasicExtractedFactV2["status"],
    evidence,
    extractionMethod: record.extractionMethod as BasicExtractedFactV2["extractionMethod"],
    uncertainty: record.uncertainty,
  };
}

function snapshotStructuredEvidence(
  value: unknown,
): readonly BasicStructuredEditorialEvidenceObservation[] {
  const snapshot = jsonValue(value);
  const result = jsonArray(snapshot, MAX_EVIDENCE).map((entry) => {
    const record = exactJsonRecord(entry, STRUCTURED_EVIDENCE_KEYS);
    if (!isText(record.sourceId) || !isText(record.fieldPath) || !isText(record.locator)) invalid();
    return {
      sourceId: record.sourceId,
      fieldPath: record.fieldPath,
      locator: record.locator,
      rawValue: record.rawValue,
    };
  });
  requireSortedUnique(result.map((item) => [
    item.sourceId, item.fieldPath, item.locator, JSON.stringify(item.rawValue),
  ].join("\0")));
  return deepFreezeBasicOfflineValue(result);
}

function snapshotReceipts(value: unknown): readonly BasicRawCaptureReceiptV2[] {
  return jsonArray(jsonValue(value, (path) => path.length === 0
    ? MAX_SOURCES
    : undefined), MAX_SOURCES).map((entry) => {
    const record = exactJsonRecord(entry, RECEIPT_KEYS);
    if (
      !isText(record.sourceId) || !isText(record.contentSha256) ||
      typeof record.byteLength !== "number" || !Number.isSafeInteger(record.byteLength) ||
      record.byteLength < 0 || typeof record.reused !== "boolean"
    ) invalid();
    return {
      sourceId: record.sourceId,
      contentSha256: record.contentSha256,
      byteLength: record.byteLength,
      reused: record.reused,
    };
  });
}

function requireIdentity(
  preliminary: BasicPreliminarySourceRunV2,
  editorial: Input["editorial"],
): void {
  if (!sameIdentity(editorial, preliminary.sourceRegister)) invalid();
}

function sameIdentity(
  left: Readonly<{ runId: string; countryCode: string; catalogVersion: string; catalogSha256: string }>,
  right: Readonly<{ runId: string; countryCode: string; catalogVersion: string; catalogSha256: string }>,
): boolean {
  return left.runId === right.runId && left.countryCode === right.countryCode &&
    left.catalogVersion === right.catalogVersion && left.catalogSha256 === right.catalogSha256;
}

function exactProperties(value: unknown, keys: readonly string[]): ReadonlyMap<string, unknown> {
  if (
    typeof value !== "object" || value === null || Array.isArray(value) || isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) invalid();
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))) {
    invalid();
  }
  const result = new Map<string, unknown>();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) invalid();
    result.set(key, descriptor.value);
  }
  return result;
}

function denseReferences(value: unknown, maximum: number): readonly BasicPreliminarySourceRunV2["documentCaptures"][number][] {
  if (!Array.isArray(value) || isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) invalid();
  const length = Object.getOwnPropertyDescriptor(value, "length");
  if (
    length === undefined || !Object.hasOwn(length, "value") ||
    typeof length.value !== "number" || !Number.isSafeInteger(length.value) ||
    length.value < 0 || length.value > Math.min(maximum, MAX_JSON_ARRAY) ||
    Reflect.ownKeys(value).length !== length.value + 1
  ) invalid();
  const result: BasicPreliminarySourceRunV2["documentCaptures"][number][] = [];
  for (let index = 0; index < length.value; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) invalid();
    result.push(descriptor.value as BasicPreliminarySourceRunV2["documentCaptures"][number]);
  }
  return Object.freeze(result);
}

function snapshotTextArray(value: unknown, maximum: number): readonly string[] {
  return denseValues(value, maximum).map((item) => {
    if (
      typeof item !== "string" || item.length === 0 ||
      Buffer.byteLength(item, "utf8") > MAX_JSON_STRING_BYTES
    ) invalid();
    return item;
  });
}

function snapshotCaptureBindings(value: unknown): readonly Readonly<{
  sourceId: string;
  requestUrl: string;
  finalUrl: string;
  retrievedAt: string;
  contentSha256: string;
}>[] {
  return denseValues(value, MAX_SOURCES).map((item) => {
    const properties = exactProperties(item, CAPTURE_BINDING_KEYS);
    const sourceId = properties.get("sourceId");
    const requestUrl = properties.get("requestUrl");
    const finalUrl = properties.get("finalUrl");
    const retrievedAt = properties.get("retrievedAt");
    const contentSha256 = properties.get("contentSha256");
    if (
      !boundedText(sourceId) || !boundedText(requestUrl) || !boundedText(finalUrl) ||
      !boundedText(retrievedAt) || !boundedText(contentSha256)
    ) invalid();
    return Object.freeze({ sourceId, requestUrl, finalUrl, retrievedAt, contentSha256 });
  });
}

function snapshotResultSourceIds(value: unknown): readonly string[] {
  return denseValues(value, MAX_SOURCES).map((item) => {
    if (typeof item !== "object" || item === null || isProxy(item)) invalid();
    const descriptor = Object.getOwnPropertyDescriptor(item, "sourceId");
    if (
      descriptor === undefined || !descriptor.enumerable ||
      !Object.hasOwn(descriptor, "value") ||
      !boundedText(descriptor.value)
    ) invalid();
    return descriptor.value;
  });
}

function denseValues(value: unknown, maximum: number): readonly unknown[] {
  if (!Array.isArray(value) || isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    invalid();
  }
  const length = Object.getOwnPropertyDescriptor(value, "length");
  if (
    length === undefined || !Object.hasOwn(length, "value") ||
    typeof length.value !== "number" || !Number.isSafeInteger(length.value) ||
    length.value < 0 || length.value > Math.min(maximum, MAX_JSON_ARRAY) ||
    Reflect.ownKeys(value).length !== length.value + 1
  ) invalid();
  const result: unknown[] = [];
  for (let index = 0; index < length.value; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      descriptor === undefined || !descriptor.enumerable ||
      !Object.hasOwn(descriptor, "value")
    ) invalid();
    result.push(descriptor.value);
  }
  return Object.freeze(result);
}

function jsonValue(
  value: unknown,
  arrayLimit?: BasicBoundedArrayLimit,
): BasicCollectionJsonValue {
  const snapshot = snapshotBasicBoundedJsonValue(value, arrayLimit);
  if (!snapshot.valid) invalid();
  return snapshot.data;
}

function jsonRecord<const Keys extends readonly string[]>(
  value: unknown,
  keys: Keys,
  arrayLimit?: BasicBoundedArrayLimit,
): Record<Keys[number], BasicCollectionJsonValue> {
  return exactJsonRecord(jsonValue(value, arrayLimit), keys);
}

function exactJsonRecord<const Keys extends readonly string[]>(
  value: BasicCollectionJsonValue,
  keys: Keys,
): Record<Keys[number], BasicCollectionJsonValue> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid();
  const ownKeys = Object.keys(value);
  if (ownKeys.length !== keys.length || ownKeys.some((key) => !keys.includes(key))) invalid();
  return value as Record<Keys[number], BasicCollectionJsonValue>;
}

function jsonArray(value: BasicCollectionJsonValue, maximum: number): readonly BasicCollectionJsonValue[] {
  if (!Array.isArray(value) || value.length > maximum) invalid();
  return value;
}

function textValue(value: BasicCollectionJsonValue): string {
  if (!isText(value)) invalid();
  return value;
}

function isText(value: BasicCollectionJsonValue): value is string {
  return typeof value === "string" && value.length > 0;
}

function boundedText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 &&
    Buffer.byteLength(value, "utf8") <= MAX_JSON_STRING_BYTES;
}

function requireDisjoint(left: readonly string[], right: readonly string[]): void {
  const rightSet = new Set(right);
  if (left.some((value) => rightSet.has(value))) invalid();
}

function requireSortedUnique(values: readonly string[]): void {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index - 1]! >= values[index]!) invalid();
  }
}

function requireUnique(values: readonly string[]): void {
  if (new Set(values).size !== values.length) invalid();
}

function uniqueSortedIds(values: readonly string[]): readonly string[] {
  requireUnique(values);
  return Object.freeze([...values].sort(compareText));
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function riskKey(risk: BasicInjectionRisk): string {
  return [risk.sourceId, risk.locator, risk.severity, risk.details].join("\0");
}

function compareRisk(left: BasicInjectionRisk, right: BasicInjectionRisk): number {
  return compareText(riskKey(left), riskKey(right));
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function invalid(): never {
  throw new Error(ERROR);
}
