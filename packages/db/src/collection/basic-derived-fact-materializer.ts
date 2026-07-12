import { createHash } from "node:crypto";

import { CREDIBILITIES } from "@navigator/shared-types/schema";
import { expectUtcRfc3339Timestamp } from "../seed/basic-country-validation-utils.js";

import type {
  BasicCollectionJsonValue,
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
  type BasicFactEvidenceV2,
  type BasicSourceRegisterV2,
} from "./basic-collection-v2-contracts.js";
import {
  deepFreezeBasicOfflineValue,
} from "./basic-offline-value.js";

const ERROR = "basic derived fact materialization is invalid";
const INPUT_KEYS = [
  "countryCode", "primarySourceId", "sourceRegister", "candidateFacts",
] as const;
const REGISTER_KEYS = [
  "schemaVersion", "runId", "countryCode", "catalogVersion", "catalogSha256", "sources",
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
const CREDIBILITY_RANK = new Map(CREDIBILITIES.map((value, index) => [value, index]));
const SOURCE_FAMILIES = [
  "international-organization", "official-statistics", "government", "energy-authority",
  "regulator", "grid-operator", "industry-association", "verified-research",
] as const;
const ACCESS_STATUSES = ["open", "restricted", "unknown"] as const;
const PROMPT_RISKS = ["none", "suspected", "confirmed"] as const;
const FACT_STATUSES = ["candidate", "conflict"] as const;
const EXTRACTION_METHODS = ["deterministic", "manual"] as const;
const SHA256 = /^[0-9a-f]{64}$/;
const FALLBACK_UNCERTAINTY = "publishedAt unavailable; derived from retrievedAt";
const MAX_SOURCES = 64;
const MAX_FACTS = 256;
const MAX_EVIDENCE = 2_048;

type Input = Readonly<{
  countryCode: string;
  primarySourceId: string;
  sourceRegister: BasicSourceRegisterV2;
  candidateFacts: readonly BasicExtractedFactV2[];
}>;

export function materializeBasicDerivedFacts(input: Input): Readonly<{
  sourceRegister: BasicSourceRegisterV2;
  facts: readonly BasicExtractedFactV2[];
}> {
  try {
    const snapshot = jsonRecord(input, INPUT_KEYS, (path) =>
      path.length === 2 && path[0] === "sourceRegister" && path[1] === "sources"
        ? MAX_SOURCES
        : undefined);
    const countryCode = iso2(snapshot.countryCode);
    const primarySourceId = text(snapshot.primarySourceId);
    const sourceRegister = snapshotRegister(snapshot.sourceRegister);
    const candidateFacts = jsonArray(snapshot.candidateFacts, MAX_FACTS).map(snapshotFact);
    if (sourceRegister.countryCode !== countryCode) invalid();

    const sourceById = new Map(sourceRegister.sources.map((source) => [source.sourceId, source]));
    const activeIds = new Set<string>();
    const paths = new Set<string>();
    for (const fact of candidateFacts) {
      if (
        paths.has(fact.fieldPath) ||
        classifyBasicV2FieldPath(fact.fieldPath) === "derived"
      ) invalid();
      paths.add(fact.fieldPath);
      if (fact.evidence.length === 0) invalid();
      for (const evidence of fact.evidence) {
        const source = sourceById.get(evidence.sourceId);
        if (source === undefined || !source.evidenceLocators.includes(evidence.locator)) invalid();
        if (fact.status === "candidate") activeIds.add(evidence.sourceId);
      }
    }
    if (activeIds.size === 0 || !activeIds.has(primarySourceId)) invalid();

    const activeSources = [...activeIds].sort(compareText).map((sourceId) => {
      const source = sourceById.get(sourceId);
      if (
        source === undefined || source.discoveryOnly || source.accessStatus !== "open" ||
        source.promptInjectionRisk !== "none"
      ) invalid();
      return source;
    });
    const primarySource = sourceById.get(primarySourceId);
    if (primarySource === undefined) invalid();
    const countryCodeFacts = candidateFacts.filter(({ fieldPath }) => fieldPath === "country.code");
    if (countryCodeFacts.length !== 1) invalid();
    const countryCodeFact = countryCodeFacts[0]!;
    if (
      countryCodeFact.status !== "candidate" ||
      countryCodeFact.evidence.some(({ rawValue, normalizedValue }) =>
      rawValue !== countryCode || normalizedValue !== countryCode,
      )
    ) invalid();

    const collectedAt = maximumTimestamp(activeSources.map(({ retrievedAt }) => retrievedAt));
    const published = activeSources.filter(
      (source): source is BasicSourceRecord & { publishedAt: string } => source.publishedAt !== null,
    );
    const fallback = published.length === 0;
    const updatedAt = fallback
      ? collectedAt
      : maximumTimestamp(published.map(({ publishedAt }) => publishedAt));
    const credibility = activeSources.reduce((lowest, source) =>
      credibilityRank(source.credibility) > credibilityRank(lowest)
        ? source.credibility
        : lowest,
    activeSources[0]!.credibility);

    const facts = [
      fact("country.flagEmoji", countryCodeFact.evidence.map((evidence) => ({
        ...evidence,
        normalizedValue: flagEmoji(countryCode),
      })), null),
      fact("country.updatedAt", timestampEvidence(
        fallback ? activeSources : published,
        fallback ? "retrievedAt" : "publishedAt",
        updatedAt,
      ), fallback ? FALLBACK_UNCERTAINTY : null),
      fact("marketOverview.collectedAt", timestampEvidence(
        activeSources, "retrievedAt", collectedAt,
      ), null),
      fact("marketOverview.countryCode", countryCodeFact.evidence.map((evidence) => ({
        ...evidence,
        normalizedValue: countryCode,
      })), null),
      fact("marketOverview.credibility", activeSources.map((source) => evidence(
        source.sourceId, "metadata:/credibility", source.credibility, credibility,
      )), null),
      fact("marketOverview.source", [evidence(
        primarySource.sourceId,
        "metadata:/sourceName",
        primarySource.sourceName,
        primarySource.sourceName,
      )], null),
      fact("marketOverview.sourceUrl", [evidence(
        primarySource.sourceId,
        "metadata:/sourceUrl",
        primarySource.sourceUrl,
        primarySource.sourceUrl,
      )], null),
      fact("marketOverview.updatedAt", timestampEvidence(
        fallback ? activeSources : published,
        fallback ? "retrievedAt" : "publishedAt",
        updatedAt,
      ), fallback ? FALLBACK_UNCERTAINTY : null),
    ].sort((left, right) => compareText(left.fieldPath, right.fieldPath));

    const locators = new Map(sourceRegister.sources.map((source) => [
      source.sourceId, new Set(source.evidenceLocators),
    ]));
    for (const derivedFact of facts) {
      for (const item of derivedFact.evidence) {
        const owned = locators.get(item.sourceId);
        if (owned === undefined) invalid();
        owned.add(item.locator);
      }
    }
    const sources = sourceRegister.sources.map((source) => ({
      ...source,
      evidenceLocators: [...(locators.get(source.sourceId) ?? [])].sort(compareText),
    }));

    return deepFreezeBasicOfflineValue({
      sourceRegister: { ...sourceRegister, sources },
      facts,
    });
  } catch {
    throw new Error(ERROR);
  }
}

function snapshotRegister(value: BasicCollectionJsonValue): BasicSourceRegisterV2 {
  const record = exactRecord(value, REGISTER_KEYS);
  if (
    record.schemaVersion !== BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION ||
    !nonblank(record.runId) || !nonblank(record.catalogVersion) ||
    !nonblank(record.catalogSha256)
  ) invalid();
  const countryCode = iso2(record.countryCode);
  const sources = jsonArray(record.sources, MAX_SOURCES).map(snapshotSource)
    .sort((left, right) => compareText(left.sourceId, right.sourceId));
  requireUnique(sources.map(({ sourceId }) => sourceId));
  return deepFreezeBasicOfflineValue({
    schemaVersion: BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION,
    runId: record.runId,
    countryCode,
    catalogVersion: record.catalogVersion,
    catalogSha256: record.catalogSha256,
    sources,
  });
}

function snapshotSource(value: BasicCollectionJsonValue): BasicSourceRecord {
  const record = exactRecord(value, SOURCE_KEYS);
  if (
    !nonblank(record.sourceId) || !nonblank(record.sourceName) ||
    !validUrl(record.sourceUrl) || !timestamp(record.retrievedAt) ||
    !(record.publishedAt === null || timestamp(record.publishedAt)) ||
    typeof record.contentSha256 !== "string" || !SHA256.test(record.contentSha256) ||
    !includes(SOURCE_FAMILIES, record.sourceFamily) ||
    !includes(ACCESS_STATUSES, record.accessStatus) ||
    !(record.accessNotes === null || nonblank(record.accessNotes)) ||
    !CREDIBILITIES.includes(record.credibility as never) ||
    typeof record.discoveryOnly !== "boolean" ||
    !includes(PROMPT_RISKS, record.promptInjectionRisk)
  ) invalid();
  const evidenceLocators = jsonArray(record.evidenceLocators, MAX_EVIDENCE).map(text);
  requireUnique(evidenceLocators);
  return {
    sourceId: record.sourceId,
    sourceName: record.sourceName,
    sourceUrl: record.sourceUrl,
    retrievedAt: record.retrievedAt,
    publishedAt: record.publishedAt,
    contentSha256: record.contentSha256,
    evidenceLocators: [...evidenceLocators].sort(compareText),
    sourceFamily: record.sourceFamily as BasicSourceRecord["sourceFamily"],
    accessStatus: record.accessStatus as BasicSourceRecord["accessStatus"],
    accessNotes: record.accessNotes,
    credibility: record.credibility as BasicSourceRecord["credibility"],
    discoveryOnly: record.discoveryOnly,
    promptInjectionRisk: record.promptInjectionRisk as BasicSourceRecord["promptInjectionRisk"],
  };
}

function snapshotFact(value: BasicCollectionJsonValue): BasicExtractedFactV2 {
  const record = exactRecord(value, FACT_KEYS);
  if (
    !nonblank(record.factId) || !nonblank(record.fieldPath) || !nonblank(record.status) ||
    !includes(FACT_STATUSES, record.status) ||
    !includes(EXTRACTION_METHODS, record.extractionMethod) ||
    !(record.uncertainty === null || nonblank(record.uncertainty)) ||
    classifyBasicV2FieldPath(record.fieldPath) === null ||
    record.factId !== factId(record.fieldPath)
  ) invalid();
  const evidenceItems = jsonArray(record.evidence, MAX_EVIDENCE).map((value) => {
    const item = exactRecord(value, EVIDENCE_KEYS);
    if (
      !nonblank(item.sourceId) || !nonblank(item.locator) ||
      !(item.unit === null || nonblank(item.unit)) ||
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
  }).sort(compareEvidence);
  return {
    factId: record.factId,
    fieldPath: record.fieldPath,
    status: record.status as BasicExtractedFactV2["status"],
    evidence: evidenceItems,
    extractionMethod: record.extractionMethod as BasicExtractedFactV2["extractionMethod"],
    uncertainty: record.uncertainty,
  };
}

function fact(
  fieldPath: string,
  evidenceItems: readonly BasicFactEvidenceV2[],
  uncertainty: string | null,
): BasicExtractedFactV2 {
  return {
    factId: factId(fieldPath),
    fieldPath,
    status: "candidate",
    evidence: [...evidenceItems].sort(compareEvidence),
    extractionMethod: "deterministic",
    uncertainty,
  };
}

function timestampEvidence(
  sources: readonly BasicSourceRecord[],
  key: "retrievedAt" | "publishedAt",
  normalizedValue: string,
): readonly BasicFactEvidenceV2[] {
  const locator = key === "retrievedAt" ? "capture:/retrievedAt" : "metadata:/publishedAt";
  return sources.map((source) => {
    const rawValue = source[key];
    if (rawValue === null) invalid();
    return evidence(source.sourceId, locator, rawValue, normalizedValue);
  });
}

function evidence(
  sourceId: string,
  locator: string,
  rawValue: string,
  normalizedValue: string,
): BasicFactEvidenceV2 {
  return { sourceId, locator, rawValue, normalizedValue, unit: null, year: null };
}

function maximumTimestamp(values: readonly string[]): string {
  if (values.length === 0) invalid();
  let maximum = Number.NEGATIVE_INFINITY;
  let result = "";
  for (const value of values) {
    if (!timestamp(value)) invalid();
    const milliseconds = Date.parse(value);
    if (!Number.isFinite(milliseconds)) invalid();
    if (milliseconds > maximum) {
      maximum = milliseconds;
      result = value;
    } else if (milliseconds === maximum && value !== result) {
      invalid();
    }
  }
  return result;
}

function flagEmoji(countryCode: string): string {
  return [...countryCode].map((character) =>
    String.fromCodePoint(127397 + character.charCodeAt(0)),
  ).join("");
}

function credibilityRank(value: BasicSourceRecord["credibility"]): number {
  const rank = CREDIBILITY_RANK.get(value);
  if (rank === undefined) invalid();
  return rank;
}

function factId(fieldPath: string): string {
  return `fact-${createHash("sha256").update(fieldPath, "utf8").digest("hex").slice(0, 16)}`;
}

function jsonRecord<const Keys extends readonly string[]>(
  value: unknown,
  keys: Keys,
  arrayLimit?: BasicBoundedArrayLimit,
): Record<Keys[number], BasicCollectionJsonValue> {
  const snapshot = snapshotBasicBoundedJsonValue(value, arrayLimit);
  if (!snapshot.valid) invalid();
  return exactRecord(snapshot.data, keys);
}

function exactRecord<const Keys extends readonly string[]>(
  value: BasicCollectionJsonValue,
  keys: Keys,
): Record<Keys[number], BasicCollectionJsonValue> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid();
  const ownKeys = Object.keys(value);
  if (ownKeys.length !== keys.length || ownKeys.some((key) => !keys.includes(key))) invalid();
  return value as Record<Keys[number], BasicCollectionJsonValue>;
}

function jsonArray(
  value: BasicCollectionJsonValue,
  maximum: number,
): readonly BasicCollectionJsonValue[] {
  if (!Array.isArray(value) || value.length > maximum) invalid();
  return value;
}

function iso2(value: BasicCollectionJsonValue): string {
  if (typeof value !== "string" || !/^[A-Z]{2}$/.test(value)) invalid();
  return value;
}

function text(value: BasicCollectionJsonValue): string {
  if (!nonblank(value)) invalid();
  return value;
}

function nonblank(value: BasicCollectionJsonValue): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function timestamp(value: BasicCollectionJsonValue): value is string {
  const errors: string[] = [];
  expectUtcRfc3339Timestamp(value, "timestamp", errors);
  return errors.length === 0;
}

function validUrl(value: BasicCollectionJsonValue): value is string {
  if (typeof value !== "string" || value.trim() !== value) return false;
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function includes<const Values extends readonly string[]>(
  values: Values,
  value: BasicCollectionJsonValue,
): value is Values[number] {
  return typeof value === "string" && values.includes(value as Values[number]);
}

function requireUnique(values: readonly string[]): void {
  if (new Set(values).size !== values.length) invalid();
}

function compareEvidence(left: BasicFactEvidenceV2, right: BasicFactEvidenceV2): number {
  return compareText(
    `${left.sourceId}\0${left.locator}\0${JSON.stringify(left.rawValue)}`,
    `${right.sourceId}\0${right.locator}\0${JSON.stringify(right.rawValue)}`,
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function invalid(): never {
  throw new Error(ERROR);
}
