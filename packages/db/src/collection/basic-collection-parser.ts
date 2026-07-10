import {
  CREDIBILITIES,
  INDUSTRY_TAGS,
  TECH_TAGS,
} from "@navigator/shared-types/schema";

import {
  KEY_INDICATOR_KEYS,
  LOCALIZED_TEXT_KEYS,
  SAFE_COUNTRY_DIRECTORY,
  SAFE_RUN_ID,
  expectUtcRfc3339Timestamp,
  hasExactOwnKeys,
  isEnumValue,
  isHttpUrl,
  isPlainRecord,
} from "../seed/basic-country-validation-utils.js";
import {
  BASIC_COLLECTION_AUDIT_SCHEMA_VERSION,
  BASIC_COLLECTION_REQUIRED_STATIC_FACT_PATHS,
  type BasicCollectionAuditBundle,
  type BasicCollectionAuditSummary,
  type BasicCollectionJsonValue,
  type BasicCollectionReviewReport,
  type BasicDraftKeyIndicator,
  type BasicExtractedFact,
  type BasicExtractedFacts,
  type BasicFactEvidence,
  type BasicMarketOverviewDraft,
  type BasicSourceRecord,
  type BasicSourceRegister,
} from "./basic-collection-contracts.js";

type JsonRecord = Record<string, unknown>;

export interface BasicCollectionAuditParseResult {
  data: BasicCollectionAuditBundle | null;
  errors: string[];
  summary: BasicCollectionAuditSummary;
}

const BUNDLE_KEYS = ["countryDirectory", "runId", "sourceRegister", "extractedFacts", "marketOverviewDraft", "reviewReport"] as const;
const SOURCE_REGISTER_KEYS = ["schemaVersion", "runId", "countryCode", "sources"] as const;
const SOURCE_KEYS = ["sourceId", "sourceName", "sourceUrl", "retrievedAt", "publishedAt", "contentSha256", "evidenceLocators", "sourceFamily", "accessStatus", "accessNotes", "credibility", "discoveryOnly", "promptInjectionRisk"] as const;
const FACTS_KEYS = ["schemaVersion", "runId", "countryCode", "facts"] as const;
const FACT_KEYS = ["factId", "fieldPath", "status", "evidence", "extractionMethod", "uncertainty"] as const;
const EVIDENCE_KEYS = ["sourceId", "locator", "rawValue", "normalizedValue", "unit", "year"] as const;
const DRAFT_KEYS = ["overview", "population", "gdp", "gdpGrowth", "energyDemand", "renewableTarget", "keyIndicators", "source", "sourceUrl", "collectedAt", "updatedAt", "credibility", "reviewStatus", "aiUsable", "countryCode", "industryTags", "techTags"] as const;
const REPORT_KEYS = ["schemaVersion", "runId", "countryCode", "status", "missingFields", "conflicts", "sourceChecks", "injectionRisks", "publicationRecommendation", "humanDecision"] as const;
const CONFLICT_KEYS = ["fieldPath", "factIds", "resolution", "notes"] as const;
const SOURCE_CHECK_KEYS = ["sourceId", "status", "notes"] as const;
const INJECTION_RISK_KEYS = ["sourceId", "locator", "severity", "details"] as const;
const HUMAN_DECISION_KEYS = ["decision", "reviewerId", "decidedAt", "notes"] as const;
const SOURCE_FAMILIES = ["international-organization", "official-statistics", "government", "energy-authority", "regulator", "grid-operator", "industry-association", "verified-research"] as const;
const FIELD_PATHS = new Set<string>(BASIC_COLLECTION_REQUIRED_STATIC_FACT_PATHS);
const INDICATOR_PATH = /^marketOverview\.keyIndicators\[(?:0|[1-9]\d*)\]\.(?:label|value|unit|year)$/;

export function parseBasicCollectionAuditBundle(value: unknown): BasicCollectionAuditParseResult {
  const errors: string[] = [];
  const summary = buildSummary(value);
  const bundle = exactRecord(value, BUNDLE_KEYS, "bundle", errors);
  if (bundle === null) return { data: null, errors, summary };
  const countryDirectory = slug(bundle.countryDirectory, "countryDirectory", errors);
  const runId = run(bundle.runId, "runId", errors);
  const sourceRegister = parseSourceRegister(bundle.sourceRegister, errors);
  const extractedFacts = parseExtractedFacts(bundle.extractedFacts, errors);
  const marketOverviewDraft = parseDraft(bundle.marketOverviewDraft, errors);
  const reviewReport = parseReport(bundle.reviewReport, errors);
  if (sourceRegister === null || extractedFacts === null || marketOverviewDraft === null || reviewReport === null) return { data: null, errors, summary };
  matchIdentities(runId, sourceRegister, extractedFacts, marketOverviewDraft, reviewReport, errors);
  const data = { countryDirectory, runId, sourceRegister, extractedFacts, marketOverviewDraft, reviewReport };
  return { data: errors.length === 0 ? data : null, errors, summary: summaryFor(data) };
}

function parseSourceRegister(value: unknown, errors: string[]): BasicSourceRegister | null {
  const record = exactRecord(value, SOURCE_REGISTER_KEYS, "sourceRegister", errors);
  if (record === null) return null;
  const sources = values(record.sources, "sourceRegister.sources", errors, (item, label) => parseSource(item, label, errors));
  unique(sources, (source) => source.sourceId, "sourceRegister.sources", errors);
  return { schemaVersion: schema(record.schemaVersion, "sourceRegister.schemaVersion", errors), runId: run(record.runId, "sourceRegister.runId", errors), countryCode: country(record.countryCode, "sourceRegister.countryCode", errors), sources };
}

function parseSource(value: unknown, label: string, errors: string[]): BasicSourceRecord | null {
  const record = exactRecord(value, SOURCE_KEYS, label, errors);
  if (record === null) return null;
  const sourceUrl = url(record.sourceUrl, `${label}.sourceUrl`, errors);
  return { sourceId: text(record.sourceId, `${label}.sourceId`, errors), sourceName: text(record.sourceName, `${label}.sourceName`, errors), sourceUrl, retrievedAt: timestamp(record.retrievedAt, `${label}.retrievedAt`, errors), publishedAt: nullableTimestamp(record.publishedAt, `${label}.publishedAt`, errors), contentSha256: sha256(record.contentSha256, `${label}.contentSha256`, errors), evidenceLocators: strings(record.evidenceLocators, `${label}.evidenceLocators`, errors, true), sourceFamily: enumValue(record.sourceFamily, SOURCE_FAMILIES, `${label}.sourceFamily`, errors), accessStatus: enumValue(record.accessStatus, ["open", "restricted", "unknown"], `${label}.accessStatus`, errors), accessNotes: nullableText(record.accessNotes, `${label}.accessNotes`, errors), credibility: enumValue(record.credibility, CREDIBILITIES, `${label}.credibility`, errors), discoveryOnly: booleanValue(record.discoveryOnly, `${label}.discoveryOnly`, errors), promptInjectionRisk: enumValue(record.promptInjectionRisk, ["none", "suspected", "confirmed"], `${label}.promptInjectionRisk`, errors) };
}

function parseExtractedFacts(value: unknown, errors: string[]): BasicExtractedFacts | null {
  const record = exactRecord(value, FACTS_KEYS, "extractedFacts", errors);
  if (record === null) return null;
  const facts = values(record.facts, "extractedFacts.facts", errors, (item, label) => parseFact(item, label, errors));
  unique(facts, (fact) => fact.factId, "extractedFacts.facts", errors);
  return { schemaVersion: schema(record.schemaVersion, "extractedFacts.schemaVersion", errors), runId: run(record.runId, "extractedFacts.runId", errors), countryCode: country(record.countryCode, "extractedFacts.countryCode", errors), facts };
}

function parseFact(value: unknown, label: string, errors: string[]): BasicExtractedFact | null {
  const record = exactRecord(value, FACT_KEYS, label, errors);
  if (record === null) return null;
  const status = enumValue(record.status, ["candidate", "missing", "conflict", "untrusted"], `${label}.status`, errors);
  const evidence = values(record.evidence, `${label}.evidence`, errors, (item, itemLabel) => parseEvidence(item, itemLabel, errors));
  if ((status === "candidate" || status === "untrusted") && evidence.length === 0) errors.push(`${label}.evidence must contain at least one item for ${status}`);
  if (status === "missing" && evidence.length !== 0) errors.push(`${label}.evidence must be empty for missing`);
  if (status === "conflict" && new Set(evidence.map((item) => item.sourceId)).size < 2) errors.push(`${label}.evidence must contain at least two distinct sourceIds for conflict`);
  return { factId: text(record.factId, `${label}.factId`, errors), fieldPath: fieldPath(record.fieldPath, `${label}.fieldPath`, errors), status, evidence, extractionMethod: enumValue(record.extractionMethod, ["deterministic", "hermes", "manual"], `${label}.extractionMethod`, errors), uncertainty: nullableText(record.uncertainty, `${label}.uncertainty`, errors) };
}

function parseEvidence(value: unknown, label: string, errors: string[]): BasicFactEvidence | null {
  const record = exactRecord(value, EVIDENCE_KEYS, label, errors);
  if (record === null) return null;
  return { sourceId: text(record.sourceId, `${label}.sourceId`, errors), locator: text(record.locator, `${label}.locator`, errors), rawValue: json(record.rawValue, `${label}.rawValue`, errors), normalizedValue: json(record.normalizedValue, `${label}.normalizedValue`, errors), unit: nullableText(record.unit, `${label}.unit`, errors), year: nullableNumber(record.year, `${label}.year`, errors) };
}

function parseDraft(value: unknown, errors: string[]): BasicMarketOverviewDraft | null {
  const record = exactRecord(value, DRAFT_KEYS, "marketOverviewDraft", errors);
  if (record === null) return null;
  const source = text(record.source, "marketOverviewDraft.source", errors);
  const sourceUrl = nullableUrl(record.sourceUrl, "marketOverviewDraft.sourceUrl", errors);
  if (sourceUrl === null && !source.includes("sourceUrl null")) errors.push("marketOverviewDraft.source must explain why sourceUrl is null");
  if (record.reviewStatus !== "draft") errors.push("marketOverviewDraft.reviewStatus must be draft");
  if (record.aiUsable !== false) errors.push("marketOverviewDraft.aiUsable must be false");
  return { overview: localized(record.overview, "marketOverviewDraft.overview", errors), population: nullableNumber(record.population, "marketOverviewDraft.population", errors), gdp: nullableNumber(record.gdp, "marketOverviewDraft.gdp", errors), gdpGrowth: nullableNumber(record.gdpGrowth, "marketOverviewDraft.gdpGrowth", errors), energyDemand: localized(record.energyDemand, "marketOverviewDraft.energyDemand", errors), renewableTarget: localized(record.renewableTarget, "marketOverviewDraft.renewableTarget", errors), keyIndicators: values(record.keyIndicators, "marketOverviewDraft.keyIndicators", errors, (item, label) => parseIndicator(item, label, errors)), source, sourceUrl, collectedAt: timestamp(record.collectedAt, "marketOverviewDraft.collectedAt", errors), updatedAt: timestamp(record.updatedAt, "marketOverviewDraft.updatedAt", errors), credibility: enumValue(record.credibility, CREDIBILITIES, "marketOverviewDraft.credibility", errors), reviewStatus: "draft", aiUsable: false, countryCode: country(record.countryCode, "marketOverviewDraft.countryCode", errors), industryTags: enumValues(record.industryTags, INDUSTRY_TAGS, "marketOverviewDraft.industryTags", errors), techTags: enumValues(record.techTags, TECH_TAGS, "marketOverviewDraft.techTags", errors) };
}

function parseIndicator(value: unknown, label: string, errors: string[]): BasicDraftKeyIndicator | null {
  const record = exactRecord(value, KEY_INDICATOR_KEYS, label, errors);
  if (record === null) return null;
  return { label: localized(record.label, `${label}.label`, errors), value: text(record.value, `${label}.value`, errors), unit: text(record.unit, `${label}.unit`, errors), year: number(record.year, `${label}.year`, errors) };
}

function parseReport(value: unknown, errors: string[]): BasicCollectionReviewReport | null {
  const record = exactRecord(value, REPORT_KEYS, "reviewReport", errors);
  if (record === null) return null;
  return { schemaVersion: schema(record.schemaVersion, "reviewReport.schemaVersion", errors), runId: run(record.runId, "reviewReport.runId", errors), countryCode: country(record.countryCode, "reviewReport.countryCode", errors), status: enumValue(record.status, ["ready-for-human-review", "blocked"], "reviewReport.status", errors), missingFields: fieldPaths(record.missingFields, "reviewReport.missingFields", errors), conflicts: values(record.conflicts, "reviewReport.conflicts", errors, (item, label) => parseConflict(item, label, errors)), sourceChecks: values(record.sourceChecks, "reviewReport.sourceChecks", errors, (item, label) => parseSourceCheck(item, label, errors)), injectionRisks: values(record.injectionRisks, "reviewReport.injectionRisks", errors, (item, label) => parseInjectionRisk(item, label, errors)), publicationRecommendation: enumValue(record.publicationRecommendation, ["request-human-review", "do-not-publish"], "reviewReport.publicationRecommendation", errors), humanDecision: record.humanDecision === null ? null : parseHumanDecision(record.humanDecision, "reviewReport.humanDecision", errors) };
}

function parseConflict(value: unknown, label: string, errors: string[]) {
  const record = exactRecord(value, CONFLICT_KEYS, label, errors);
  if (record === null) return null;
  return { fieldPath: fieldPath(record.fieldPath, `${label}.fieldPath`, errors), factIds: strings(record.factIds, `${label}.factIds`, errors, true), resolution: enumValue(record.resolution, ["unresolved", "resolved"], `${label}.resolution`, errors), notes: text(record.notes, `${label}.notes`, errors) };
}

function parseSourceCheck(value: unknown, label: string, errors: string[]) {
  const record = exactRecord(value, SOURCE_CHECK_KEYS, label, errors);
  if (record === null) return null;
  return { sourceId: text(record.sourceId, `${label}.sourceId`, errors), status: enumValue(record.status, ["passed", "failed"], `${label}.status`, errors), notes: nullableText(record.notes, `${label}.notes`, errors) };
}

function parseInjectionRisk(value: unknown, label: string, errors: string[]) {
  const record = exactRecord(value, INJECTION_RISK_KEYS, label, errors);
  if (record === null) return null;
  return { sourceId: text(record.sourceId, `${label}.sourceId`, errors), locator: text(record.locator, `${label}.locator`, errors), severity: enumValue(record.severity, ["suspected", "confirmed"], `${label}.severity`, errors), details: text(record.details, `${label}.details`, errors) };
}

function parseHumanDecision(value: unknown, label: string, errors: string[]) {
  const record = exactRecord(value, HUMAN_DECISION_KEYS, label, errors);
  if (record === null) return null;
  return { decision: enumValue(record.decision, ["approved", "rejected"], `${label}.decision`, errors), reviewerId: text(record.reviewerId, `${label}.reviewerId`, errors), decidedAt: timestamp(record.decidedAt, `${label}.decidedAt`, errors), notes: text(record.notes, `${label}.notes`, errors) };
}

function exactRecord(value: unknown, keys: readonly string[], label: string, errors: string[]): JsonRecord | null {
  if (!hasExactOwnKeys(value, keys)) { errors.push(`${label} must have exactly ${keyList(keys)} own keys`); return null; }
  if (!keys.every((key) => isDataProperty(value, key))) { errors.push(`${label} must use enumerable data properties`); return null; }
  return value;
}

function values<T>(value: unknown, label: string, errors: string[], parse: (item: unknown, label: string) => T | null): T[] {
  const array = jsonArray(value, label, errors);
  if (array === null) return [];
  const result: T[] = [];
  for (const [index, item] of array.entries()) { const parsed = parse(item, `${label}[${index}]`); if (parsed !== null) result.push(parsed); }
  return result;
}

function jsonArray(value: unknown, label: string, errors: string[]): unknown[] | null {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || Reflect.ownKeys(value).length !== value.length + 1 || !Object.hasOwn(value, "length")) { errors.push(`${label} must be a standard JSON array`); return null; }
  for (let index = 0; index < value.length; index += 1) if (!Object.hasOwn(value, index) || !isDataProperty(value, String(index))) { errors.push(`${label} must be a standard JSON array`); return null; }
  return value;
}

function json(value: unknown, label: string, errors: string[], ancestors = new WeakSet<object>()): BasicCollectionJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") { if (Number.isFinite(value)) return value; errors.push(`${label} must be a JSON-compatible value`); return null; }
  if (typeof value !== "object") { errors.push(`${label} must be a JSON-compatible value`); return null; }
  if (ancestors.has(value)) { errors.push(`${label} must be a JSON value without cycles`); return null; }
  ancestors.add(value);
  if (Array.isArray(value)) { const array = jsonArray(value, label, errors); const parsed = array === null ? [] : array.map((item, index) => json(item, `${label}[${index}]`, errors, ancestors)); ancestors.delete(value); return parsed; }
  if (!isPlainRecord(value) || Reflect.ownKeys(value).some((key) => typeof key !== "string") || !Reflect.ownKeys(value).every((key) => typeof key === "string" && isDataProperty(value, key))) { ancestors.delete(value); errors.push(`${label} must be a JSON-compatible value`); return null; }
  const output: { [key: string]: BasicCollectionJsonValue } = {};
  for (const key of Object.keys(value)) Object.defineProperty(output, key, { value: json(value[key], `${label}.${key}`, errors, ancestors), enumerable: true, writable: true, configurable: true });
  ancestors.delete(value);
  return output;
}

function localized(value: unknown, label: string, errors: string[]) {
  const record = exactRecord(value, LOCALIZED_TEXT_KEYS, label, errors);
  if (record === null) return { zh: "", en: "" };
  const zh = string(record.zh, `${label}.zh`, errors); const en = string(record.en, `${label}.en`, errors);
  if (zh.trim() === "" && en.trim() === "") errors.push(`${label} must contain zh or en text`);
  return { zh, en };
}

function strings(value: unknown, label: string, errors: string[], required: boolean): string[] { const array = jsonArray(value, label, errors); if (array === null) return []; if (required && array.length === 0) errors.push(`${label} must be a non-empty array`); return array.map((item, index) => text(item, `${label}[${index}]`, errors)); }
function fieldPaths(value: unknown, label: string, errors: string[]): string[] { const array = jsonArray(value, label, errors); return array === null ? [] : array.map((item, index) => fieldPath(item, `${label}[${index}]`, errors)); }
function enumValues<T extends string>(value: unknown, allowed: readonly T[], label: string, errors: string[]): T[] { const array = jsonArray(value, label, errors); return array === null ? [] : array.map((item, index) => enumValue(item, allowed, `${label}[${index}]`, errors)); }
function text(value: unknown, label: string, errors: string[]): string { const parsed = string(value, label, errors); if (parsed.trim() === "") errors.push(`${label} must be a non-empty string`); return parsed; }
function string(value: unknown, label: string, errors: string[]): string { if (typeof value === "string") return value; errors.push(`${label} must be a string`); return ""; }
function nullableText(value: unknown, label: string, errors: string[]): string | null { return value === null ? null : text(value, label, errors); }
function number(value: unknown, label: string, errors: string[]): number { if (typeof value === "number" && Number.isFinite(value)) return value; errors.push(`${label} must be a finite number`); return 0; }
function nullableNumber(value: unknown, label: string, errors: string[]): number | null { return value === null ? null : number(value, label, errors); }
function booleanValue(value: unknown, label: string, errors: string[]): boolean { if (typeof value === "boolean") return value; errors.push(`${label} must be a boolean`); return false; }
function enumValue<T extends string>(value: unknown, allowed: readonly T[], label: string, errors: string[]): T { if (isEnumValue(value, allowed)) return value; errors.push(`${label} must be one of ${allowed.join(", ")}`); return allowed[0]!; }
function timestamp(value: unknown, label: string, errors: string[]): string { const parsed = text(value, label, errors); expectUtcRfc3339Timestamp(parsed, label, errors); return parsed; }
function nullableTimestamp(value: unknown, label: string, errors: string[]): string | null { return value === null ? null : timestamp(value, label, errors); }
function url(value: unknown, label: string, errors: string[]): string { const parsed = text(value, label, errors); if (!isHttpUrl(parsed)) errors.push(`${label} must be an HTTP(S) URL`); return parsed; }
function nullableUrl(value: unknown, label: string, errors: string[]): string | null { return value === null ? null : url(value, label, errors); }
function country(value: unknown, label: string, errors: string[]): string { const parsed = text(value, label, errors); if (!/^[A-Z]{2}$/.test(parsed)) errors.push(`${label} must be an uppercase two-letter country code`); return parsed; }
function run(value: unknown, label: string, errors: string[]): string { const parsed = text(value, label, errors); if (!SAFE_RUN_ID.test(parsed)) errors.push(`${label} must be a safe run id`); return parsed; }
function slug(value: unknown, label: string, errors: string[]): string { const parsed = text(value, label, errors); if (!SAFE_COUNTRY_DIRECTORY.test(parsed)) errors.push(`${label} must be a safe slug`); return parsed; }
function schema(value: unknown, label: string, errors: string[]): typeof BASIC_COLLECTION_AUDIT_SCHEMA_VERSION { if (value === BASIC_COLLECTION_AUDIT_SCHEMA_VERSION) return value; errors.push(`${label} must equal ${BASIC_COLLECTION_AUDIT_SCHEMA_VERSION}`); return BASIC_COLLECTION_AUDIT_SCHEMA_VERSION; }
function sha256(value: unknown, label: string, errors: string[]): string { const parsed = text(value, label, errors); if (!/^[0-9a-f]{64}$/.test(parsed)) errors.push(`${label} must be a lowercase SHA-256 hash`); return parsed; }
function fieldPath(value: unknown, label: string, errors: string[]): string { const parsed = text(value, label, errors); if (!FIELD_PATHS.has(parsed) && !INDICATOR_PATH.test(parsed)) errors.push(`${label} must be an allowed fieldPath`); return parsed; }
function unique<T>(values: readonly T[], key: (value: T) => string, label: string, errors: string[]): void { const seen = new Set<string>(); for (const value of values) { const valueKey = key(value); if (seen.has(valueKey)) errors.push(`${label} contains duplicate ${valueKey}`); seen.add(valueKey); } }
function isDataProperty(value: object, key: string): boolean { const descriptor = Object.getOwnPropertyDescriptor(value, key); return descriptor !== undefined && descriptor.enumerable === true && Object.hasOwn(descriptor, "value"); }
function keyList(keys: readonly string[]): string { return keys.length === 1 ? keys[0]! : `${keys.slice(0, -1).join(", ")}, and ${keys.at(-1)}`; }
function matchIdentities(runId: string, sourceRegister: BasicSourceRegister, extractedFacts: BasicExtractedFacts, draft: BasicMarketOverviewDraft, report: BasicCollectionReviewReport, errors: string[]): void { for (const [label, value] of [["sourceRegister.runId", sourceRegister.runId], ["extractedFacts.runId", extractedFacts.runId], ["reviewReport.runId", report.runId]] as const) if (value !== runId) errors.push(`${label} must match runId`); for (const [label, value] of [["extractedFacts.countryCode", extractedFacts.countryCode], ["marketOverviewDraft.countryCode", draft.countryCode], ["reviewReport.countryCode", report.countryCode]] as const) if (value !== sourceRegister.countryCode) errors.push(`${label} must match sourceRegister.countryCode`); }
function summaryFor(data: BasicCollectionAuditBundle): BasicCollectionAuditSummary { return { countryCode: data.sourceRegister.countryCode, runId: data.runId, sourceCount: data.sourceRegister.sources.length, factCount: data.extractedFacts.facts.length }; }
function buildSummary(value: unknown): BasicCollectionAuditSummary { if (!isPlainRecord(value)) return { countryCode: "", runId: "", sourceCount: 0, factCount: 0 }; const sourceRegister = isPlainRecord(value.sourceRegister) ? value.sourceRegister : null; const facts = isPlainRecord(value.extractedFacts) ? value.extractedFacts : null; return { countryCode: sourceRegister !== null && typeof sourceRegister.countryCode === "string" ? sourceRegister.countryCode : "", runId: typeof value.runId === "string" ? value.runId : "", sourceCount: sourceRegister !== null && Array.isArray(sourceRegister.sources) ? sourceRegister.sources.length : 0, factCount: facts !== null && Array.isArray(facts.facts) ? facts.facts.length : 0 }; }
