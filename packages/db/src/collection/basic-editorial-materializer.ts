import { isProxy } from "node:util/types";

import { CREDIBILITIES } from "@navigator/shared-types/schema";
import { expectUtcRfc3339Timestamp } from "../seed/basic-country-validation-utils.js";

import type {
  BasicCollectionJsonValue,
  BasicInjectionRisk,
  BasicSourceCheck,
  BasicSourceRecord,
} from "./basic-collection-contracts.js";
import {
  snapshotBasicBoundedJsonValue,
  type BasicBoundedArrayLimit,
} from "./basic-bounded-json.js";
import {
  BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION,
  classifyBasicV2FieldPath,
  type BasicExtractedFactV2,
  type BasicExtractedFactsV2,
  type BasicSourceRegisterV2,
  type BasicSourcedObservationV2,
  type BasicStructuredEditorialEvidenceObservation,
} from "./basic-collection-v2-contracts.js";
import {
  snapshotBasicDocumentMaterializationProvenanceV2,
  type BasicDocumentMaterializationResult,
} from "./basic-document-observation-materializer.js";
import type { BasicCountryEditorialInput } from "./basic-editorial-input-contracts.js";
import { parseBasicCountryEditorialInput } from "./basic-editorial-input-parser.js";
import { deepFreezeBasicOfflineValue } from "./basic-offline-value.js";
import {
  materializeBasicEditorialObservationsV2,
  materializeBasicSourceFactsV2,
} from "./basic-v2-fact-materializer.js";

export interface BasicEditorialMaterializationResult {
  readonly facts: readonly BasicExtractedFactV2[];
  readonly consumedEvidence: readonly {
    sourceId: string;
    fieldPath: string;
    locator: string;
  }[];
}

interface MaterializationInput {
  readonly editorial: BasicCountryEditorialInput;
  readonly reviewedSources: BasicSourceRegisterV2;
  readonly preliminaryFacts: BasicExtractedFactsV2;
  readonly structuredEditorialEvidence:
    readonly BasicStructuredEditorialEvidenceObservation[];
  readonly documentResult: BasicDocumentMaterializationResult | null;
  readonly sourceChecks: readonly BasicSourceCheck[];
  readonly injectionRisks: readonly BasicInjectionRisk[];
}

interface ValidatedDocumentResult {
  readonly manualSourceIds: readonly string[];
  readonly facts: readonly BasicExtractedFactV2[];
  readonly editorialEvidence: readonly BasicStructuredEditorialEvidenceObservation[];
}

const ERROR = "basic editorial materialization is invalid";
const INPUT_KEYS = [
  "editorial",
  "reviewedSources",
  "preliminaryFacts",
  "structuredEditorialEvidence",
  "documentResult",
  "sourceChecks",
  "injectionRisks",
] as const;
const REGISTER_KEYS = [
  "schemaVersion", "runId", "countryCode", "catalogVersion", "catalogSha256", "sources",
] as const;
const FACTS_KEYS = ["schemaVersion", "runId", "countryCode", "facts"] as const;
const SOURCE_KEYS = [
  "sourceId", "sourceName", "sourceUrl", "retrievedAt", "publishedAt",
  "contentSha256", "evidenceLocators", "sourceFamily", "accessStatus",
  "accessNotes", "credibility", "discoveryOnly", "promptInjectionRisk",
] as const;
const FACT_KEYS = [
  "factId", "fieldPath", "status", "evidence", "extractionMethod", "uncertainty",
] as const;
const FACT_EVIDENCE_KEYS = [
  "sourceId", "locator", "rawValue", "normalizedValue", "unit", "year",
] as const;
const STRUCTURED_EVIDENCE_KEYS = ["sourceId", "fieldPath", "locator", "rawValue"] as const;
const CHECK_KEYS = ["sourceId", "status", "notes"] as const;
const RISK_KEYS = ["sourceId", "locator", "severity", "details"] as const;
const MAX_SOURCES = 64;
const MAX_FACTS = 512;
const MAX_EVIDENCE = 2_048;
const MAX_STRING_BYTES = 65_536;
const MAX_SOURCE_NAME_BYTES = 512;
const MAX_EVIDENCE_LOCATOR_BYTES = 512;
const SAFE_SOURCE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SOURCE_FAMILIES = [
  "international-organization", "official-statistics", "government",
  "energy-authority", "regulator", "grid-operator", "industry-association",
  "verified-research",
] as const;
const ACCESS_STATUSES = ["open", "restricted", "unknown"] as const;
const PROMPT_INJECTION_RISKS = ["none", "suspected", "confirmed"] as const;

export function materializeBasicEditorialFacts(
  value: MaterializationInput,
): BasicEditorialMaterializationResult {
  try {
    const input = exactProperties(value, INPUT_KEYS);
    const editorial = parseBasicCountryEditorialInput(input.get("editorial"));
    const reviewedSources = snapshotRegister(input.get("reviewedSources"));
    const preliminaryFacts = snapshotFacts(input.get("preliminaryFacts"));
    requireDeterministicPreliminaryFacts(preliminaryFacts);
    requireIdentity(editorial, reviewedSources, preliminaryFacts);

    const sourceById = new Map(reviewedSources.sources.map((source) => [source.sourceId, source]));
    const sourceChecks = snapshotChecks(input.get("sourceChecks"), sourceById);
    const checkById = new Map(sourceChecks.map((check) => [check.sourceId, check]));
    const injectionRisks = snapshotRisks(input.get("injectionRisks"), sourceById);
    const riskySourceIds = new Set(injectionRisks.map(({ sourceId }) => sourceId));
    const structuredEvidence = snapshotStructuredEvidence(
      input.get("structuredEditorialEvidence"),
    );
    const documentResult = input.get("documentResult") === null
      ? null
      : validateDocumentResult(
        input.get("documentResult"),
        editorial,
        sourceById,
        sourceChecks,
        injectionRisks,
      );
    requireExactReviewedSourceUnion(
      reviewedSources,
      preliminaryFacts,
      structuredEvidence,
      documentResult?.manualSourceIds ?? [],
    );

    const evidenceByKey = new Map<string, BasicStructuredEditorialEvidenceObservation>();
    for (const observation of [
      ...structuredEvidence,
      ...(documentResult?.editorialEvidence ?? []),
    ]) {
      const key = evidenceKey(observation);
      if (evidenceByKey.has(key)) invalid();
      evidenceByKey.set(key, observation);
    }

    const ordinary: BasicSourcedObservationV2[] = [];
    const nameFacts: BasicExtractedFactV2[] = [];
    const consumedKeys = new Set<string>();
    for (const item of editorial.items) {
      if (item.fieldPath === "country.name") {
        nameFacts.push(materializeName(item, preliminaryFacts, sourceById, checkById,
          riskySourceIds));
        continue;
      }
      for (const evidence of item.evidence) {
        const key = evidenceKey({ ...evidence, fieldPath: item.fieldPath });
        if (!evidenceByKey.has(key) || consumedKeys.has(key)) invalid();
        requireConsumable(evidence.sourceId, sourceById, checkById, riskySourceIds);
        consumedKeys.add(key);
        ordinary.push({
          sourceId: evidence.sourceId,
          fieldPath: item.fieldPath,
          locator: evidence.locator,
          rawValue: evidence.rawValue,
          normalizedValue: item.normalizedValue,
          unit: null,
          year: null,
          uncertainty: item.uncertainty,
        });
      }
    }
    if (consumedKeys.size !== evidenceByKey.size) invalid();

    const facts = [
      ...materializeBasicEditorialObservationsV2(ordinary),
      ...nameFacts,
    ].sort((left, right) => compareText(left.fieldPath, right.fieldPath));
    if (facts.length !== editorial.items.length) invalid();
    const activeSourceIds = new Set<string>();
    for (const fact of [
      ...preliminaryFacts.facts,
      ...(documentResult?.facts ?? []),
      ...facts,
    ]) {
      if (fact.status !== "candidate") continue;
      for (const evidence of fact.evidence) activeSourceIds.add(evidence.sourceId);
    }
    if (!activeSourceIds.has(editorial.primarySourceId)) invalid();
    requireConsumable(editorial.primarySourceId, sourceById, checkById, riskySourceIds);
    const consumedEvidence = facts.flatMap((fact) => fact.evidence.map((evidence) => ({
      sourceId: evidence.sourceId,
      fieldPath: fact.fieldPath,
      locator: evidence.locator,
    }))).sort(compareConsumedEvidence);
    return deepFreezeBasicOfflineValue({ facts, consumedEvidence });
  } catch {
    throw new Error(ERROR);
  }
}

function materializeName(
  item: BasicCountryEditorialInput["items"][number],
  preliminaryFacts: BasicExtractedFactsV2,
  sourceById: ReadonlyMap<string, BasicSourceRecord>,
  checkById: ReadonlyMap<string, BasicSourceCheck>,
  riskySourceIds: ReadonlySet<string>,
): BasicExtractedFactV2 {
  const candidates = preliminaryFacts.facts.filter(({ fieldPath }) => fieldPath === "country.name");
  if (
    candidates.length !== 1 ||
    candidates[0]!.status !== "candidate" ||
    candidates[0]!.extractionMethod !== "deterministic"
  ) invalid();
  const candidate = candidates[0]!;
  if (candidate.evidence.length !== item.evidence.length) invalid();
  const preliminaryByKey = new Map<string, BasicExtractedFactV2["evidence"][number]>();
  for (const evidence of candidate.evidence) {
    const key = nameEvidenceKey(evidence);
    if (preliminaryByKey.has(key)) invalid();
    preliminaryByKey.set(key, evidence);
  }
  const normalized = localizedText(item.normalizedValue);
  const observations: BasicSourcedObservationV2[] = [];
  for (const evidence of item.evidence) {
    const sourceEvidence = preliminaryByKey.get(nameEvidenceKey(evidence));
    if (sourceEvidence === undefined) invalid();
    const sourceName = localizedText(sourceEvidence.normalizedValue);
    if (normalized.en !== sourceName.en) invalid();
    requireConsumable(evidence.sourceId, sourceById, checkById, riskySourceIds);
    observations.push({
      sourceId: evidence.sourceId,
      fieldPath: "country.name",
      locator: evidence.locator,
      rawValue: evidence.rawValue,
      normalizedValue: { zh: normalized.zh, en: sourceName.en },
      unit: null,
      year: null,
      uncertainty: item.uncertainty,
    });
  }
  const facts = materializeBasicSourceFactsV2(observations, "manual");
  if (facts.length !== 1) invalid();
  return facts[0]!;
}

function validateDocumentResult(
  value: unknown,
  identity: Pick<BasicCountryEditorialInput, "runId" | "countryCode" | "catalogVersion" | "catalogSha256">,
  sourceById: ReadonlyMap<string, BasicSourceRecord>,
  sourceChecks: readonly BasicSourceCheck[],
  injectionRisks: readonly BasicInjectionRisk[],
): ValidatedDocumentResult {
  if (!isBrandedDocumentResult(value)) invalid();
  const provenance = snapshotBasicDocumentMaterializationProvenanceV2(value);
  if (
    provenance === null ||
    provenance.runId !== identity.runId ||
    provenance.countryCode !== identity.countryCode ||
    provenance.catalogVersion !== identity.catalogVersion ||
    provenance.catalogSha256 !== identity.catalogSha256
  ) invalid();
  requireSortedUnique(provenance.manualSourceIds, (sourceId) => sourceId);
  const result = value;
  const manualIds = result.sources.map(({ sourceId }) => sourceId);
  requireSortedUnique(manualIds, (sourceId) => sourceId);
  if (!sameStrings(manualIds, provenance.manualSourceIds)) invalid();
  for (const source of result.sources) {
    const reviewed = sourceById.get(source.sourceId);
    if (reviewed === undefined || !sameSourceRecord(reviewed, source)) invalid();
  }
  const manualIdSet = new Set(manualIds);
  const externalChecks = sourceChecks.filter(({ sourceId }) => manualIdSet.has(sourceId));
  const externalRisks = injectionRisks.filter(({ sourceId }) => manualIdSet.has(sourceId));
  if (
    !sameSourceChecks(externalChecks, result.sourceChecks) ||
    !sameInjectionRisks(externalRisks, result.injectionRisks)
  ) invalid();
  return {
    manualSourceIds: provenance.manualSourceIds,
    facts: result.facts,
    editorialEvidence: snapshotStructuredEvidence(result.editorialEvidence),
  };
}

function isBrandedDocumentResult(value: unknown): value is BasicDocumentMaterializationResult {
  return snapshotBasicDocumentMaterializationProvenanceV2(value) !== null;
}

function requireExactReviewedSourceUnion(
  reviewedSources: BasicSourceRegisterV2,
  preliminaryFacts: BasicExtractedFactsV2,
  structuredEvidence: readonly BasicStructuredEditorialEvidenceObservation[],
  manualSourceIds: readonly string[],
): void {
  const deterministicSourceIds = new Set<string>();
  for (const fact of preliminaryFacts.facts) {
    for (const evidence of fact.evidence) deterministicSourceIds.add(evidence.sourceId);
  }
  for (const evidence of structuredEvidence) deterministicSourceIds.add(evidence.sourceId);

  const manualSourceIdSet = new Set(manualSourceIds);
  if (manualSourceIdSet.size !== manualSourceIds.length) invalid();
  for (const sourceId of deterministicSourceIds) {
    if (manualSourceIdSet.has(sourceId)) invalid();
  }

  const expectedSourceIds = [...deterministicSourceIds, ...manualSourceIdSet]
    .sort(compareText);
  const reviewedSourceIds = reviewedSources.sources.map(({ sourceId }) => sourceId);
  if (!sameStrings(reviewedSourceIds, expectedSourceIds)) invalid();
}

function requireDeterministicPreliminaryFacts(preliminaryFacts: BasicExtractedFactsV2): void {
  for (const fact of preliminaryFacts.facts) {
    const owner = classifyBasicV2FieldPath(fact.fieldPath);
    if (
      fact.extractionMethod !== "deterministic" ||
      owner !== "source-backed" && owner !== "hybrid-name"
    ) invalid();
  }
}

function requireIdentity(
  editorial: BasicCountryEditorialInput,
  sources: BasicSourceRegisterV2,
  facts: BasicExtractedFactsV2,
): void {
  if (
    sources.runId !== editorial.runId || facts.runId !== editorial.runId ||
    sources.countryCode !== editorial.countryCode || facts.countryCode !== editorial.countryCode ||
    sources.catalogVersion !== editorial.catalogVersion ||
    sources.catalogSha256 !== editorial.catalogSha256
  ) invalid();
}

function requireConsumable(
  sourceId: string,
  sourceById: ReadonlyMap<string, BasicSourceRecord>,
  checkById: ReadonlyMap<string, BasicSourceCheck>,
  riskySourceIds: ReadonlySet<string>,
): void {
  const source = sourceById.get(sourceId);
  const check = checkById.get(sourceId);
  if (
    source === undefined || source.discoveryOnly || source.accessStatus !== "open" ||
    source.credibility === "UNVERIFIED" || source.promptInjectionRisk !== "none" ||
    check?.status !== "passed" || riskySourceIds.has(sourceId)
  ) invalid();
}

function snapshotRegister(value: unknown): BasicSourceRegisterV2 {
  const record = exactRecord(snapshotJson(value, (path) =>
    path.length === 1 && path[0] === "sources" ? MAX_SOURCES : undefined), REGISTER_KEYS);
  const sources = jsonArray(record.sources, MAX_SOURCES).map(snapshotSource);
  requireSortedUnique(sources, ({ sourceId }) => sourceId);
  if (
    record.schemaVersion !== BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION ||
    !isText(record.runId) || !isText(record.countryCode) ||
    !isText(record.catalogVersion) || !isText(record.catalogSha256)
  ) invalid();
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
  const source = exactRecord(value, SOURCE_KEYS);
  const sourceId = safeSourceId(source.sourceId);
  const sourceName = nonBlankText(source.sourceName, MAX_SOURCE_NAME_BYTES);
  const sourceUrl = httpsSourceUrl(source.sourceUrl);
  const retrievedAt = utcRfc3339Timestamp(source.retrievedAt);
  const publishedAt = source.publishedAt === null
    ? null
    : utcRfc3339Timestamp(source.publishedAt);
  const contentSha256 = sha256(source.contentSha256);
  const evidenceLocators = jsonArray(source.evidenceLocators, MAX_EVIDENCE)
    .map((locator) => nonBlankText(locator, MAX_EVIDENCE_LOCATOR_BYTES));
  if (evidenceLocators.length === 0) invalid();
  requireSortedUnique(evidenceLocators, (entry) => entry);
  return {
    sourceId,
    sourceName,
    sourceUrl,
    retrievedAt,
    publishedAt,
    contentSha256,
    evidenceLocators,
    sourceFamily: enumValue(SOURCE_FAMILIES, source.sourceFamily),
    accessStatus: enumValue(ACCESS_STATUSES, source.accessStatus),
    accessNotes: optionalNonBlankText(source.accessNotes),
    credibility: enumValue(CREDIBILITIES, source.credibility),
    discoveryOnly: booleanValue(source.discoveryOnly),
    promptInjectionRisk: enumValue(PROMPT_INJECTION_RISKS, source.promptInjectionRisk),
  };
}

function snapshotFacts(value: unknown): BasicExtractedFactsV2 {
  const record = exactRecord(snapshotJson(value), FACTS_KEYS);
  const facts = jsonArray(record.facts, MAX_FACTS).map(snapshotFact);
  requireSortedUnique(facts, ({ fieldPath }) => fieldPath);
  if (
    record.schemaVersion !== BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION ||
    !isText(record.runId) || !isText(record.countryCode)
  ) invalid();
  return deepFreezeBasicOfflineValue({
    schemaVersion: BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION,
    runId: record.runId,
    countryCode: record.countryCode,
    facts,
  });
}

function snapshotFact(value: BasicCollectionJsonValue): BasicExtractedFactV2 {
  const fact = exactRecord(value, FACT_KEYS);
  const evidence = jsonArray(fact.evidence, MAX_EVIDENCE).map((entry) => {
    const item = exactRecord(entry, FACT_EVIDENCE_KEYS);
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
  if (
    !isText(fact.factId) || !isText(fact.fieldPath) ||
    !includes(["candidate", "missing", "conflict", "untrusted"] as const, fact.status) ||
    !includes(["deterministic", "manual"] as const, fact.extractionMethod) ||
    !(fact.uncertainty === null || isText(fact.uncertainty))
  ) invalid();
  return {
    factId: fact.factId,
    fieldPath: fact.fieldPath,
    status: fact.status,
    evidence,
    extractionMethod: fact.extractionMethod,
    uncertainty: fact.uncertainty,
  };
}

function snapshotStructuredEvidence(
  value: unknown,
): readonly BasicStructuredEditorialEvidenceObservation[] {
  const result = jsonArray(snapshotJson(value), MAX_EVIDENCE).map((entry) => {
    const observation = exactRecord(entry, STRUCTURED_EVIDENCE_KEYS);
    if (!isText(observation.sourceId) || !isText(observation.fieldPath) || !isText(observation.locator)) {
      invalid();
    }
    return {
      sourceId: observation.sourceId,
      fieldPath: observation.fieldPath,
      locator: observation.locator,
      rawValue: observation.rawValue,
    };
  });
  requireSortedUnique(result, evidenceKey);
  return deepFreezeBasicOfflineValue(result);
}

function snapshotChecks(
  value: unknown,
  sourceById: ReadonlyMap<string, BasicSourceRecord>,
): readonly BasicSourceCheck[] {
  const checks = jsonArray(snapshotJson(value, (path) =>
    path.length === 0 ? MAX_SOURCES : undefined), MAX_SOURCES).map((entry) => {
    const check = exactRecord(entry, CHECK_KEYS);
    if (
      !isText(check.sourceId) || !includes(["passed", "failed"] as const, check.status) ||
      !(check.notes === null || isText(check.notes))
    ) invalid();
    return { sourceId: check.sourceId, status: check.status, notes: check.notes };
  });
  requireSortedUnique(checks, ({ sourceId }) => sourceId);
  if (checks.length !== sourceById.size || checks.some(({ sourceId }) => !sourceById.has(sourceId))) {
    invalid();
  }
  return deepFreezeBasicOfflineValue(checks);
}

function snapshotRisks(
  value: unknown,
  sourceById: ReadonlyMap<string, BasicSourceRecord>,
): readonly BasicInjectionRisk[] {
  const risks = jsonArray(snapshotJson(value), MAX_EVIDENCE).map((entry) => {
    const risk = exactRecord(entry, RISK_KEYS);
    if (
      !isText(risk.sourceId) || !isText(risk.locator) || !isText(risk.details) ||
      !includes(["suspected", "confirmed"] as const, risk.severity) ||
      !sourceById.has(risk.sourceId)
    ) invalid();
    return {
      sourceId: risk.sourceId,
      locator: risk.locator,
      severity: risk.severity,
      details: risk.details,
    };
  });
  requireSortedUnique(risks, (risk) => [risk.sourceId, risk.locator, risk.severity, risk.details].join("\0"));
  return deepFreezeBasicOfflineValue(risks);
}

function snapshotJson(
  value: unknown,
  arrayLimit?: BasicBoundedArrayLimit,
): BasicCollectionJsonValue {
  const snapshot = snapshotBasicBoundedJsonValue(value, arrayLimit);
  if (!snapshot.valid) invalid();
  return snapshot.data;
}

function exactProperties(value: unknown, keys: readonly string[]): ReadonlyMap<string, unknown> {
  if (
    typeof value !== "object" || value === null || isProxy(value) || Array.isArray(value) ||
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

function exactRecord<const Keys extends readonly string[]>(
  value: BasicCollectionJsonValue,
  keys: Keys,
): Record<Keys[number], BasicCollectionJsonValue> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid();
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))) {
    invalid();
  }
  return value as Record<Keys[number], BasicCollectionJsonValue>;
}

function jsonArray(value: BasicCollectionJsonValue, maximum: number): readonly BasicCollectionJsonValue[] {
  if (!Array.isArray(value) || value.length > maximum) invalid();
  return value;
}

function localizedText(value: BasicCollectionJsonValue): Readonly<{ zh: string; en: string }> {
  const record = exactRecord(value, ["zh", "en"] as const);
  return { zh: nonBlankText(record.zh), en: nonBlankText(record.en) };
}

function evidenceKey(value: BasicStructuredEditorialEvidenceObservation): string {
  return [value.sourceId, value.fieldPath, value.locator, canonicalJson(value.rawValue)].join("\0");
}

function nameEvidenceKey(value: { sourceId: string; locator: string; rawValue: BasicCollectionJsonValue }): string {
  return [value.sourceId, value.locator, canonicalJson(value.rawValue)].join("\0");
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

function requireSortedUnique<T>(values: readonly T[], key: (value: T) => string): void {
  let previous: string | null = null;
  for (const value of values) {
    const current = key(value);
    if (previous !== null && previous >= current) invalid();
    previous = current;
  }
}

function compareConsumedEvidence(
  left: { sourceId: string; fieldPath: string; locator: string },
  right: { sourceId: string; fieldPath: string; locator: string },
): number {
  return compareText(left.sourceId, right.sourceId) ||
    compareText(left.fieldPath, right.fieldPath) || compareText(left.locator, right.locator);
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameSourceRecord(left: BasicSourceRecord, right: BasicSourceRecord): boolean {
  return left.sourceId === right.sourceId &&
    left.sourceName === right.sourceName &&
    left.sourceUrl === right.sourceUrl &&
    left.retrievedAt === right.retrievedAt &&
    left.publishedAt === right.publishedAt &&
    left.contentSha256 === right.contentSha256 &&
    sameStrings(left.evidenceLocators, right.evidenceLocators) &&
    left.sourceFamily === right.sourceFamily &&
    left.accessStatus === right.accessStatus &&
    left.accessNotes === right.accessNotes &&
    left.credibility === right.credibility &&
    left.discoveryOnly === right.discoveryOnly &&
    left.promptInjectionRisk === right.promptInjectionRisk;
}

function sameSourceChecks(
  left: readonly BasicSourceCheck[],
  right: readonly BasicSourceCheck[],
): boolean {
  return left.length === right.length && left.every((value, index) => {
    const other = right[index];
    return other !== undefined && value.sourceId === other.sourceId &&
      value.status === other.status && value.notes === other.notes;
  });
}

function sameInjectionRisks(
  left: readonly BasicInjectionRisk[],
  right: readonly BasicInjectionRisk[],
): boolean {
  return left.length === right.length && left.every((value, index) => {
    const other = right[index];
    return other !== undefined && value.sourceId === other.sourceId &&
      value.locator === other.locator && value.severity === other.severity &&
      value.details === other.details;
  });
}

function enumValue<const Values extends readonly string[]>(
  values: Values,
  value: BasicCollectionJsonValue,
): Values[number] {
  if (!includes(values, value)) invalid();
  return value;
}

function safeSourceId(value: BasicCollectionJsonValue): string {
  const sourceId = nonBlankText(value);
  if (!SAFE_SOURCE_ID.test(sourceId)) invalid();
  return sourceId;
}

function httpsSourceUrl(value: BasicCollectionJsonValue): string {
  const sourceUrl = nonBlankText(value);
  if (sourceUrl !== sourceUrl.trim()) invalid();
  try {
    const parsed = new URL(sourceUrl);
    if (
      parsed.protocol !== "https:" ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.hash !== ""
    ) invalid();
    return sourceUrl;
  } catch {
    invalid();
  }
}

function utcRfc3339Timestamp(value: BasicCollectionJsonValue): string {
  const timestamp = nonBlankText(value);
  const errors: string[] = [];
  expectUtcRfc3339Timestamp(timestamp, "timestamp", errors);
  if (errors.length !== 0) invalid();
  return timestamp;
}

function sha256(value: BasicCollectionJsonValue): string {
  const digest = nonBlankText(value);
  if (!SHA256.test(digest)) invalid();
  return digest;
}

function optionalNonBlankText(value: BasicCollectionJsonValue): string | null {
  return value === null ? null : nonBlankText(value);
}

function booleanValue(value: BasicCollectionJsonValue): boolean {
  if (typeof value !== "boolean") invalid();
  return value;
}

function includes<const Values extends readonly string[]>(values: Values, value: unknown): value is Values[number] {
  return typeof value === "string" && values.includes(value);
}

function nonBlankText(value: BasicCollectionJsonValue, maximum = MAX_STRING_BYTES): string {
  if (!isText(value) || value.trim() === "" || Buffer.byteLength(value, "utf8") > maximum) invalid();
  return value;
}

function isText(value: BasicCollectionJsonValue): value is string {
  return typeof value === "string";
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function invalid(): never {
  throw new Error(ERROR);
}
