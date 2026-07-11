import { CREDIBILITIES } from "@navigator/shared-types/schema";

import {
  SAFE_RUN_ID,
  expectUtcRfc3339Timestamp,
  isHttpUrl,
} from "../seed/basic-country-validation-utils.js";
import {
  BASIC_COLLECTION_AUDIT_SCHEMA_VERSION,
  BASIC_COLLECTION_BLOCKER_CODES,
  BASIC_COLLECTION_REQUIRED_STATIC_FACT_PATHS,
  type BasicCollectionBlockerCode,
  type BasicExtractedFact,
  type BasicExtractedFacts,
  type BasicFactEvidence,
  type BasicInjectionRisk,
  type BasicSourceCheck,
  type BasicSourceRecord,
  type BasicSourceRegister,
} from "./basic-collection-contracts.js";
import type {
  BasicOfflinePreflightInput,
  BasicOfflinePreflightResult,
} from "./basic-offline-dry-run-contracts.js";
import {
  deepFreezeBasicOfflineValue,
  deeplyEqualBasicOfflineValue,
  isRecord,
  snapshotBasicOfflineValue,
} from "./basic-offline-value.js";

const INPUT_KEYS = ["sourceRegister", "extractedFacts", "sourceChecks", "injectionRisks"] as const;
const REGISTER_KEYS = ["schemaVersion", "runId", "countryCode", "sources"] as const;
const SOURCE_KEYS = ["sourceId", "sourceName", "sourceUrl", "retrievedAt", "publishedAt", "contentSha256", "evidenceLocators", "sourceFamily", "accessStatus", "accessNotes", "credibility", "discoveryOnly", "promptInjectionRisk"] as const;
const FACTS_KEYS = ["schemaVersion", "runId", "countryCode", "facts"] as const;
const FACT_KEYS = ["factId", "fieldPath", "status", "evidence", "extractionMethod", "uncertainty"] as const;
const EVIDENCE_KEYS = ["sourceId", "locator", "rawValue", "normalizedValue", "unit", "year"] as const;
const CHECK_KEYS = ["sourceId", "status", "notes"] as const;
const RISK_KEYS = ["sourceId", "locator", "severity", "details"] as const;
const SOURCE_FAMILIES = ["international-organization", "official-statistics", "government", "energy-authority", "regulator", "grid-operator", "industry-association", "verified-research"] as const;
const INDICATOR_PATH = /^marketOverview\.keyIndicators\[(0|[1-9]\d*)\]\.(label|value|unit|year)$/;
const ALLOWED_PATHS = new Set<string>(BASIC_COLLECTION_REQUIRED_STATIC_FACT_PATHS);

interface ParsedPreflight {
  sourceRegister: BasicSourceRegister;
  extractedFacts: BasicExtractedFacts;
  sourceChecks: BasicSourceCheck[];
  injectionRisks: BasicInjectionRisk[];
}

export function preflightBasicOfflineCollection(input: BasicOfflinePreflightInput): BasicOfflinePreflightResult {
  const snapshot = snapshotBasicOfflineValue(input);
  if (!snapshot.valid) return invalid("preflight input must be safely parseable");
  const errors: string[] = [];
  const parsed = parsePreflight(snapshot.data, errors);
  if (parsed === null || errors.length > 0) return freezeResult({ valid: false, blockers: [], errors });
  const relationErrors = validateRelations(parsed);
  if (relationErrors.length > 0) return freezeResult({ valid: false, blockers: [], errors: relationErrors });
  return freezeResult({ valid: true, blockers: deriveBlockers(parsed), errors: [] });
}

function parsePreflight(value: unknown, errors: string[]): ParsedPreflight | null {
  const input = exact(value, INPUT_KEYS, "input", errors);
  if (input === null) return null;
  const register = parseRegister(input.sourceRegister, errors);
  const facts = parseFacts(input.extractedFacts, errors);
  const checks = list(input.sourceChecks, "sourceChecks", errors, parseCheck);
  const risks = list(input.injectionRisks, "injectionRisks", errors, parseRisk);
  if (register === null || facts === null) return null;
  if (register.runId !== facts.runId) errors.push("extractedFacts.runId must match sourceRegister.runId");
  if (register.countryCode !== facts.countryCode) errors.push("extractedFacts.countryCode must match sourceRegister.countryCode");
  return { sourceRegister: register, extractedFacts: facts, sourceChecks: checks, injectionRisks: risks };
}

function parseRegister(value: unknown, errors: string[]): BasicSourceRegister | null {
  const record = exact(value, REGISTER_KEYS, "sourceRegister", errors);
  if (record === null) return null;
  schema(record.schemaVersion, "sourceRegister.schemaVersion", errors);
  run(record.runId, "sourceRegister.runId", errors);
  country(record.countryCode, "sourceRegister.countryCode", errors);
  const sources = list(record.sources, "sourceRegister.sources", errors, parseSource);
  unique(sources.map(({ sourceId }) => sourceId), "sourceRegister.sources", errors);
  return record as unknown as BasicSourceRegister;
}

function parseSource(value: unknown, label: string, errors: string[]): BasicSourceRecord {
  const source = exact(value, SOURCE_KEYS, label, errors);
  if (source === null) return {} as BasicSourceRecord;
  text(source.sourceId, `${label}.sourceId`, errors); text(source.sourceName, `${label}.sourceName`, errors);
  url(source.sourceUrl, `${label}.sourceUrl`, errors); timestamp(source.retrievedAt, `${label}.retrievedAt`, errors);
  nullableTimestamp(source.publishedAt, `${label}.publishedAt`, errors); sha(source.contentSha256, `${label}.contentSha256`, errors);
  strings(source.evidenceLocators, `${label}.evidenceLocators`, errors, true);
  enumValue(source.sourceFamily, SOURCE_FAMILIES, `${label}.sourceFamily`, errors);
  enumValue(source.accessStatus, ["open", "restricted", "unknown"], `${label}.accessStatus`, errors);
  nullableText(source.accessNotes, `${label}.accessNotes`, errors); enumValue(source.credibility, CREDIBILITIES, `${label}.credibility`, errors);
  booleanValue(source.discoveryOnly, `${label}.discoveryOnly`, errors);
  enumValue(source.promptInjectionRisk, ["none", "suspected", "confirmed"], `${label}.promptInjectionRisk`, errors);
  return source as unknown as BasicSourceRecord;
}

function parseFacts(value: unknown, errors: string[]): BasicExtractedFacts | null {
  const record = exact(value, FACTS_KEYS, "extractedFacts", errors);
  if (record === null) return null;
  schema(record.schemaVersion, "extractedFacts.schemaVersion", errors); run(record.runId, "extractedFacts.runId", errors);
  country(record.countryCode, "extractedFacts.countryCode", errors);
  const facts = list(record.facts, "extractedFacts.facts", errors, parseFact);
  unique(facts.map(({ factId }) => factId), "extractedFacts.facts factId", errors);
  unique(facts.map(({ fieldPath }) => fieldPath), "extractedFacts.facts fieldPath", errors);
  return record as unknown as BasicExtractedFacts;
}

function parseFact(value: unknown, label: string, errors: string[]): BasicExtractedFact {
  const fact = exact(value, FACT_KEYS, label, errors);
  if (fact === null) return {} as BasicExtractedFact;
  text(fact.factId, `${label}.factId`, errors); fieldPath(fact.fieldPath, `${label}.fieldPath`, errors);
  const status = enumValue(fact.status, ["candidate", "missing", "conflict", "untrusted"], `${label}.status`, errors);
  const evidence = list(fact.evidence, `${label}.evidence`, errors, parseEvidence);
  enumValue(fact.extractionMethod, ["deterministic", "hermes", "manual"], `${label}.extractionMethod`, errors);
  nullableText(fact.uncertainty, `${label}.uncertainty`, errors);
  if ((status === "candidate" || status === "untrusted") && evidence.length === 0) errors.push(`${label}.evidence must not be empty`);
  if (status === "missing" && evidence.length !== 0) errors.push(`${label}.evidence must be empty`);
  if (status === "conflict" && new Set(evidence.map(({ sourceId }) => sourceId)).size < 2) errors.push(`${label}.evidence must use distinct sources`);
  if (status === "candidate" && !agrees(evidence)) errors.push(`${label}.evidence normalized tuples must agree`);
  if (status === "conflict" && agrees(evidence)) errors.push(`${label}.conflict evidence must disagree`);
  return fact as unknown as BasicExtractedFact;
}

function parseEvidence(value: unknown, label: string, errors: string[]): BasicFactEvidence {
  const evidence = exact(value, EVIDENCE_KEYS, label, errors);
  if (evidence === null) return {} as BasicFactEvidence;
  text(evidence.sourceId, `${label}.sourceId`, errors); text(evidence.locator, `${label}.locator`, errors);
  nullableText(evidence.unit, `${label}.unit`, errors); nullableNumber(evidence.year, `${label}.year`, errors);
  return evidence as unknown as BasicFactEvidence;
}

function parseCheck(value: unknown, label: string, errors: string[]): BasicSourceCheck {
  const check = exact(value, CHECK_KEYS, label, errors); if (check === null) return {} as BasicSourceCheck;
  text(check.sourceId, `${label}.sourceId`, errors); enumValue(check.status, ["passed", "failed"], `${label}.status`, errors);
  nullableText(check.notes, `${label}.notes`, errors); return check as unknown as BasicSourceCheck;
}
function parseRisk(value: unknown, label: string, errors: string[]): BasicInjectionRisk {
  const risk = exact(value, RISK_KEYS, label, errors); if (risk === null) return {} as BasicInjectionRisk;
  text(risk.sourceId, `${label}.sourceId`, errors); text(risk.locator, `${label}.locator`, errors);
  enumValue(risk.severity, ["suspected", "confirmed"], `${label}.severity`, errors); text(risk.details, `${label}.details`, errors);
  return risk as unknown as BasicInjectionRisk;
}

function validateRelations(input: ParsedPreflight): string[] {
  const errors: string[] = [];
  const sources = new Map(input.sourceRegister.sources.map((source) => [source.sourceId, source]));
  for (const [factIndex, fact] of input.extractedFacts.facts.entries()) for (const [evidenceIndex, evidence] of fact.evidence.entries()) {
    const source = sources.get(evidence.sourceId);
    if (source === undefined) errors.push(`facts[${factIndex}].evidence[${evidenceIndex}] references unknown source`);
    else if (!source.evidenceLocators.includes(evidence.locator)) errors.push(`facts[${factIndex}].evidence[${evidenceIndex}] references unknown locator`);
  }
  for (const [label, references] of [["sourceChecks", input.sourceChecks], ["injectionRisks", input.injectionRisks]] as const) {
    references.forEach((item, index) => { if (!sources.has(item.sourceId)) errors.push(`${label}[${index}] references unknown source`); });
  }
  const indicator = new Map<number, Set<string>>();
  for (const fact of input.extractedFacts.facts) {
    const match = INDICATOR_PATH.exec(fact.fieldPath); if (match === null) continue;
    const index = Number(match[1]); const fields = indicator.get(index) ?? new Set<string>(); fields.add(match[2]!); indicator.set(index, fields);
  }
  const indexes = [...indicator.keys()].sort((a, b) => a - b);
  indexes.forEach((index, position) => { if (index !== position || indicator.get(index)?.size !== 4) errors.push("indicator paths must be contiguous and complete"); });
  return [...new Set(errors)];
}

function deriveBlockers(input: ParsedPreflight): BasicCollectionBlockerCode[] {
  const blockers = new Set<BasicCollectionBlockerCode>();
  const facts = input.extractedFacts.facts; const paths = new Set(facts.map(({ fieldPath }) => fieldPath));
  if (BASIC_COLLECTION_REQUIRED_STATIC_FACT_PATHS.some((path) => !paths.has(path)) || facts.some(({ status }) => status === "missing")) blockers.add("MISSING_REQUIRED_FACT");
  if (facts.some(({ status }) => status === "conflict")) blockers.add("UNRESOLVED_CONFLICT");
  const passed = new Set(input.sourceChecks.filter(({ status }) => status === "passed").map(({ sourceId }) => sourceId));
  const evidenceUnpassed = facts.some((fact) => fact.evidence.some(({ sourceId }) => !passed.has(sourceId)));
  const unsafeSource = input.sourceRegister.sources.some((source) => source.discoveryOnly || source.credibility === "UNVERIFIED" || source.accessStatus !== "open" || source.promptInjectionRisk !== "none");
  const unverifiedCredibility = facts.some((fact) => fact.fieldPath === "marketOverview.credibility" && fact.status === "candidate" && fact.evidence[0]?.normalizedValue === "UNVERIFIED");
  if (facts.some(({ status }) => status === "untrusted") || input.sourceChecks.some(({ status }) => status === "failed") || input.injectionRisks.length > 0 || evidenceUnpassed || unsafeSource || unverifiedCredibility) blockers.add("UNTRUSTED_INPUT");
  return BASIC_COLLECTION_BLOCKER_CODES.filter((code) => blockers.has(code));
}

function exact(value: unknown, keys: readonly string[], label: string, errors: string[]): Record<string, unknown> | null {
  if (!isRecord(value) || Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) { errors.push(`${label} must have exact keys`); return null; }
  return value;
}
function list<T>(value: unknown, label: string, errors: string[], parse: (item: unknown, label: string, errors: string[]) => T): T[] { if (!Array.isArray(value)) { errors.push(`${label} must be an array`); return []; } return value.map((item, index) => parse(item, `${label}[${index}]`, errors)); }
function unique(values: readonly string[], label: string, errors: string[]): void { const seen = new Set<string>(); for (const value of values) { if (seen.has(value)) errors.push(`${label} contains duplicate ${value}`); seen.add(value); } }
function agrees(evidence: readonly BasicFactEvidence[]): boolean { const first = evidence[0]; return first === undefined || evidence.every((item) => deeplyEqualBasicOfflineValue(item.normalizedValue, first.normalizedValue) && item.unit === first.unit && item.year === first.year); }
function text(value: unknown, label: string, errors: string[]): string { if (typeof value === "string" && value.trim() !== "") return value; errors.push(`${label} must be non-empty text`); return ""; }
function nullableText(value: unknown, label: string, errors: string[]): void { if (value !== null) text(value, label, errors); }
function nullableNumber(value: unknown, label: string, errors: string[]): void { if (value !== null && (typeof value !== "number" || !Number.isFinite(value))) errors.push(`${label} must be finite or null`); }
function booleanValue(value: unknown, label: string, errors: string[]): void { if (typeof value !== "boolean") errors.push(`${label} must be boolean`); }
function enumValue<T extends string>(value: unknown, allowed: readonly T[], label: string, errors: string[]): T { if (typeof value === "string" && allowed.includes(value as T)) return value as T; errors.push(`${label} has invalid value`); return allowed[0]!; }
function schema(value: unknown, label: string, errors: string[]): void { if (value !== BASIC_COLLECTION_AUDIT_SCHEMA_VERSION) errors.push(`${label} has invalid identity`); }
function run(value: unknown, label: string, errors: string[]): void { if (typeof value !== "string" || !SAFE_RUN_ID.test(value)) errors.push(`${label} must be a safe run id`); }
function country(value: unknown, label: string, errors: string[]): void { if (typeof value !== "string" || !/^[A-Z]{2}$/.test(value)) errors.push(`${label} must be a country code`); }
function timestamp(value: unknown, label: string, errors: string[]): void { const parsed = text(value, label, errors); expectUtcRfc3339Timestamp(parsed, label, errors); }
function nullableTimestamp(value: unknown, label: string, errors: string[]): void { if (value !== null) timestamp(value, label, errors); }
function url(value: unknown, label: string, errors: string[]): void { const parsed = text(value, label, errors); if (!isHttpUrl(parsed)) errors.push(`${label} must be HTTP(S)`); }
function sha(value: unknown, label: string, errors: string[]): void { if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) errors.push(`${label} must be SHA-256`); }
function strings(value: unknown, label: string, errors: string[], required: boolean): void { if (!Array.isArray(value) || (required && value.length === 0)) { errors.push(`${label} must be a non-empty string array`); return; } value.forEach((item, index) => text(item, `${label}[${index}]`, errors)); }
function fieldPath(value: unknown, label: string, errors: string[]): void { if (typeof value !== "string" || (!ALLOWED_PATHS.has(value) && !INDICATOR_PATH.test(value))) errors.push(`${label} is not allowed`); }
function invalid(error: string): BasicOfflinePreflightResult { return freezeResult({ valid: false, blockers: [], errors: [error] }); }
function freezeResult(result: BasicOfflinePreflightResult): BasicOfflinePreflightResult { return deepFreezeBasicOfflineValue(result); }
