import { isProxy } from "node:util/types";

import { CREDIBILITIES } from "@navigator/shared-types/schema";

import type {
  BasicCollectionJsonValue,
  BasicInjectionRisk,
  BasicSourceCheck,
  BasicSourceRecord,
} from "./basic-collection-contracts.js";
import {
  BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION,
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
const MAX_JSON_DEPTH = 64;
const MAX_JSON_ARRAY = 2_048;
const MAX_STRING_BYTES = 65_536;
const SOURCE_FAMILIES = [
  "international-organization", "official-statistics", "government",
  "energy-authority", "regulator", "grid-operator", "industry-association",
  "verified-research",
] as const;

export function materializeBasicEditorialFacts(
  value: MaterializationInput,
): BasicEditorialMaterializationResult {
  try {
    const input = exactProperties(value, INPUT_KEYS);
    const editorial = parseBasicCountryEditorialInput(input.get("editorial"));
    const reviewedSources = snapshotRegister(input.get("reviewedSources"));
    const preliminaryFacts = snapshotFacts(input.get("preliminaryFacts"));
    requireIdentity(editorial, reviewedSources, preliminaryFacts);

    const sourceById = new Map(reviewedSources.sources.map((source) => [source.sourceId, source]));
    const sourceChecks = snapshotChecks(input.get("sourceChecks"), sourceById);
    const checkById = new Map(sourceChecks.map((check) => [check.sourceId, check]));
    const injectionRisks = snapshotRisks(input.get("injectionRisks"), sourceById);
    const riskySourceIds = new Set(injectionRisks.map(({ sourceId }) => sourceId));
    const structuredEvidence = snapshotStructuredEvidence(
      input.get("structuredEditorialEvidence"),
    );
    const documentResult = input.get("documentResult");
    const documentEvidence = documentResult === null
      ? []
      : validateDocumentResult(
        documentResult,
        editorial,
        sourceById,
        sourceChecks,
        injectionRisks,
      );

    const evidenceByKey = new Map<string, BasicStructuredEditorialEvidenceObservation>();
    for (const observation of [...structuredEvidence, ...documentEvidence]) {
      const key = evidenceKey(observation);
      if (evidenceByKey.has(key)) invalid();
      evidenceByKey.set(key, observation);
    }

    const ordinary: BasicSourcedObservationV2[] = [];
    const nameFacts: BasicExtractedFactV2[] = [];
    const consumedKeys = new Set<string>();
    const referencedSourceIds = new Set<string>();
    for (const item of editorial.items) {
      if (item.fieldPath === "country.name") {
        nameFacts.push(materializeName(item, preliminaryFacts, sourceById, checkById,
          riskySourceIds, referencedSourceIds));
        continue;
      }
      for (const evidence of item.evidence) {
        const key = evidenceKey({ ...evidence, fieldPath: item.fieldPath });
        if (!evidenceByKey.has(key) || consumedKeys.has(key)) invalid();
        requireConsumable(evidence.sourceId, sourceById, checkById, riskySourceIds);
        consumedKeys.add(key);
        referencedSourceIds.add(evidence.sourceId);
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
    if (!referencedSourceIds.has(editorial.primarySourceId)) invalid();
    requireConsumable(editorial.primarySourceId, sourceById, checkById, riskySourceIds);

    const facts = [
      ...materializeBasicEditorialObservationsV2(ordinary),
      ...nameFacts,
    ].sort((left, right) => compareText(left.fieldPath, right.fieldPath));
    if (facts.length !== editorial.items.length) invalid();
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
  referencedSourceIds: Set<string>,
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
    referencedSourceIds.add(evidence.sourceId);
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
): readonly BasicStructuredEditorialEvidenceObservation[] {
  const provenance = snapshotBasicDocumentMaterializationProvenanceV2(value);
  if (
    provenance === null ||
    provenance.runId !== identity.runId ||
    provenance.countryCode !== identity.countryCode ||
    provenance.catalogVersion !== identity.catalogVersion ||
    provenance.catalogSha256 !== identity.catalogSha256
  ) invalid();
  const result = value as BasicDocumentMaterializationResult;
  const manualIds = result.sources.map(({ sourceId }) => sourceId);
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
  return snapshotStructuredEvidence(result.editorialEvidence);
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
  const record = exactRecord(snapshotJson(value), REGISTER_KEYS);
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
  const evidenceLocators = jsonArray(source.evidenceLocators, MAX_EVIDENCE).map(nonBlankText);
  requireSortedUnique(evidenceLocators, (entry) => entry);
  if (
    !isText(source.sourceId) || !isText(source.sourceName) || !isText(source.sourceUrl) ||
    !isText(source.retrievedAt) || !(source.publishedAt === null || isText(source.publishedAt)) ||
    !isText(source.contentSha256) || !includes(SOURCE_FAMILIES, source.sourceFamily) ||
    !includes(["open", "restricted", "unknown"] as const, source.accessStatus) ||
    !(source.accessNotes === null || isText(source.accessNotes)) ||
    !includes(CREDIBILITIES, source.credibility) || typeof source.discoveryOnly !== "boolean" ||
    !includes(["none", "suspected", "confirmed"] as const, source.promptInjectionRisk)
  ) invalid();
  return {
    sourceId: source.sourceId,
    sourceName: source.sourceName,
    sourceUrl: source.sourceUrl,
    retrievedAt: source.retrievedAt,
    publishedAt: source.publishedAt,
    contentSha256: source.contentSha256,
    evidenceLocators,
    sourceFamily: source.sourceFamily,
    accessStatus: source.accessStatus,
    accessNotes: source.accessNotes,
    credibility: source.credibility,
    discoveryOnly: source.discoveryOnly,
    promptInjectionRisk: source.promptInjectionRisk,
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
  const checks = jsonArray(snapshotJson(value), MAX_SOURCES).map((entry) => {
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

function snapshotJson(value: unknown): BasicCollectionJsonValue {
  return snapshotJsonAt(value, 0, new Set<object>());
}

function snapshotJsonAt(value: unknown, depth: number, ancestors: Set<object>): BasicCollectionJsonValue {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalid();
    return value;
  }
  if (typeof value === "string") {
    if (Buffer.byteLength(value, "utf8") > MAX_STRING_BYTES) invalid();
    return value;
  }
  if (
    typeof value !== "object" || depth >= MAX_JSON_DEPTH || isProxy(value) ||
    ancestors.has(value)
  ) invalid();
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype || value.length > MAX_JSON_ARRAY ||
        Reflect.ownKeys(value).length !== value.length + 1) invalid();
      const result: BasicCollectionJsonValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) invalid();
        result.push(snapshotJsonAt(descriptor.value, depth + 1, ancestors));
      }
      return result;
    }
    if (Object.getPrototypeOf(value) !== Object.prototype) invalid();
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string")) invalid();
    const result: Record<string, BasicCollectionJsonValue> = {};
    for (const key of (keys as string[]).sort(compareText)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) invalid();
      result[key] = snapshotJsonAt(descriptor.value, depth + 1, ancestors);
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
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

function includes<const Values extends readonly string[]>(values: Values, value: unknown): value is Values[number] {
  return typeof value === "string" && values.includes(value);
}

function nonBlankText(value: BasicCollectionJsonValue): string {
  if (!isText(value) || value.trim() === "") invalid();
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
