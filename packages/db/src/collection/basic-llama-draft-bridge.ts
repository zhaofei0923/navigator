import { isDeepStrictEqual } from "node:util";
import { isProxy } from "node:util/types";

import { CREDIBILITIES } from "@navigator/shared-types/schema";

import { BasicCollectionBridgeError } from "./basic-collection-bridge-error.js";
import {
  BASIC_COLLECTION_AUDIT_SCHEMA_VERSION,
  BASIC_COLLECTION_REQUIRED_STATIC_FACT_PATHS,
  type BasicCollectionJsonValue,
  type BasicMarketOverviewDraft,
} from "./basic-collection-contracts.js";
import {
  BASIC_LLAMA_DRAFT_OPERATION,
  BASIC_LLAMA_DRAFT_PROTOCOL_VERSION,
  type BasicBridgeErrorCode,
  type BasicBridgeFailure,
  type BasicBridgeResult,
  type BasicDraftBridgeInput,
  type BasicLlamaCppDraftRequest,
} from "./basic-hermes-llama-contracts.js";
import {
  BASIC_LLAMA_DRAFT_JSON_SCHEMA,
  deepFreezeBasicLlamaValue,
  snapshotBasicLlamaJson,
} from "./basic-llama-draft-schema.js";
import { parseBasicMarketOverviewDraft } from "./basic-market-overview-draft-parser.js";

const INPUT_KEYS = ["sourceRegister", "extractedFacts", "model"] as const;
const REGISTER_KEYS = ["schemaVersion", "runId", "countryCode", "sources"] as const;
const SOURCE_KEYS = ["sourceId", "sourceName", "sourceUrl", "retrievedAt", "publishedAt", "contentSha256", "evidenceLocators", "sourceFamily", "accessStatus", "accessNotes", "credibility", "discoveryOnly", "promptInjectionRisk"] as const;
const FACTS_KEYS = ["schemaVersion", "runId", "countryCode", "facts"] as const;
const FACT_KEYS = ["factId", "fieldPath", "status", "evidence", "extractionMethod", "uncertainty"] as const;
const EVIDENCE_KEYS = ["sourceId", "locator", "rawValue", "normalizedValue", "unit", "year"] as const;
const INDICATOR_PATH = /^marketOverview\.keyIndicators\[(0|[1-9]\d*)\]\.(label|value|unit|year)$/;
const INDICATOR_KEYS = ["label", "value", "unit", "year"] as const;
const SOURCE_FAMILIES = ["international-organization", "official-statistics", "government", "energy-authority", "regulator", "grid-operator", "industry-association", "verified-research"] as const;
const EXTRACTION_METHODS = ["deterministic", "hermes", "manual"] as const;
const INVALID = Symbol("invalid");
const MAX_METHOD_DEPTH = 16;

type JsonRecord = Record<string, BasicCollectionJsonValue>;
interface SourceInfo { sourceId: string; locators: string[]; safe: boolean; }
interface EvidenceInfo { sourceId: string; locator: string; normalizedValue: BasicCollectionJsonValue; }
interface FactInfo { factId: string; fieldPath: string; status: string; evidence: EvidenceInfo[]; }
interface RegisterInfo { schemaVersion: string; runId: string; countryCode: string; sources: SourceInfo[]; }
interface FactsInfo { schemaVersion: string; runId: string; countryCode: string; facts: FactInfo[]; }
type DataMethod = (...args: unknown[]) => unknown;

export async function bridgeBasicMarketOverviewDraft(
  value: BasicDraftBridgeInput,
): Promise<BasicBridgeResult<BasicMarketOverviewDraft>> {
  const input = exactRuntimeRecord(value, INPUT_KEYS);
  if (input === null) return failed("INPUT_INVALID", "input", false);
  const model = input.get("model");
  const complete = dataMethod(model, "complete");
  if (complete === null || !isObjectLike(model)) return failed("INPUT_INVALID", "input", false);
  const sourceSnapshot = snapshotBasicLlamaJson(input.get("sourceRegister"));
  const factsSnapshot = snapshotBasicLlamaJson(input.get("extractedFacts"));
  if (!sourceSnapshot.valid || !factsSnapshot.valid) return blocked();
  const expected = assembleExpectedDraft(sourceSnapshot.data, factsSnapshot.data);
  if (expected === null) return blocked();
  const request = createRequest(expected);
  let response: unknown;
  try {
    const pending = Reflect.apply(complete, model, [request]);
    if (isObjectLike(pending) && isProxy(pending)) return failed("LLAMA_RESPONSE_INVALID", "llama", false);
    response = await pending;
  }
  catch (error) { return modelFailure(error); }
  return parseResponse(response, expected);
}

function assembleExpectedDraft(sourceValue: BasicCollectionJsonValue, factsValue: BasicCollectionJsonValue): BasicMarketOverviewDraft | null {
  const register = parseRegister(sourceValue);
  const extracted = parseFacts(factsValue);
  if (register === null || extracted === null || register.schemaVersion !== BASIC_COLLECTION_AUDIT_SCHEMA_VERSION ||
      extracted.schemaVersion !== BASIC_COLLECTION_AUDIT_SCHEMA_VERSION || register.runId !== extracted.runId ||
      register.countryCode !== extracted.countryCode || !/^[A-Z]{2}$/.test(register.countryCode)) return null;
  const sources = new Map<string, SourceInfo>();
  for (const source of register.sources) {
    if (sources.has(source.sourceId) || !source.safe) return null;
    sources.set(source.sourceId, source);
  }
  const factIds = new Set<string>();
  const values = new Map<string, BasicCollectionJsonValue>();
  const indicators = new Map<number, Set<string>>();
  for (const fact of extracted.facts) {
    if (factIds.has(fact.factId) || values.has(fact.fieldPath) || fact.status !== "candidate" || fact.evidence.length === 0) return null;
    factIds.add(fact.factId);
    const indicator = INDICATOR_PATH.exec(fact.fieldPath);
    if (!BASIC_COLLECTION_REQUIRED_STATIC_FACT_PATHS.includes(fact.fieldPath as never) && indicator === null) return null;
    if (indicator !== null) {
      const index = Number(indicator[1]);
      const keys = indicators.get(index) ?? new Set<string>();
      keys.add(indicator[2]!);
      indicators.set(index, keys);
    }
    const normalized = fact.evidence[0]!.normalizedValue;
    for (const evidence of fact.evidence) {
      const source = sources.get(evidence.sourceId);
      if (source === undefined || !source.locators.includes(evidence.locator) || !isDeepStrictEqual(evidence.normalizedValue, normalized)) return null;
    }
    values.set(fact.fieldPath, normalized);
  }
  if (BASIC_COLLECTION_REQUIRED_STATIC_FACT_PATHS.some((path) => !values.has(path))) return null;
  const indices = [...indicators.keys()].sort((left, right) => left - right);
  if (indices.some((index, position) => index !== position || INDICATOR_KEYS.some((key) => !indicators.get(index)?.has(key)))) return null;
  if (values.get("country.code") !== register.countryCode || values.get("marketOverview.countryCode") !== register.countryCode) return null;
  const assembled = {
    overview: values.get("marketOverview.overview"), population: values.get("marketOverview.population"),
    gdp: values.get("marketOverview.gdp"), gdpGrowth: values.get("marketOverview.gdpGrowth"),
    energyDemand: values.get("marketOverview.energyDemand"), renewableTarget: values.get("marketOverview.renewableTarget"),
    keyIndicators: indices.map((index) => ({
      label: values.get(`marketOverview.keyIndicators[${index}].label`), value: values.get(`marketOverview.keyIndicators[${index}].value`),
      unit: values.get(`marketOverview.keyIndicators[${index}].unit`), year: values.get(`marketOverview.keyIndicators[${index}].year`),
    })),
    source: values.get("marketOverview.source"), sourceUrl: values.get("marketOverview.sourceUrl"),
    collectedAt: values.get("marketOverview.collectedAt"), updatedAt: values.get("marketOverview.updatedAt"),
    credibility: values.get("marketOverview.credibility"), reviewStatus: "draft", aiUsable: false,
    countryCode: values.get("marketOverview.countryCode"), industryTags: values.get("marketOverview.industryTags"),
    techTags: values.get("marketOverview.techTags"),
  };
  const parsed = parseBasicMarketOverviewDraft(assembled);
  return parsed.data === null ? null : deepFreezeBasicLlamaValue(parsed.data);
}

function parseRegister(value: BasicCollectionJsonValue): RegisterInfo | null {
  const record = exactJsonRecord(value, REGISTER_KEYS);
  if (record === null) return null;
  const sources = jsonArray(valueAt(record, "sources"));
  const schemaVersion = textAt(record, "schemaVersion");
  const runId = textAt(record, "runId");
  const countryCode = textAt(record, "countryCode");
  if (sources === null || schemaVersion === null || runId === null || countryCode === null) return null;
  const parsed: SourceInfo[] = [];
  for (const source of sources) { const item = parseSource(source); if (item === null) return null; parsed.push(item); }
  return { schemaVersion, runId, countryCode, sources: parsed };
}

function parseSource(value: BasicCollectionJsonValue): SourceInfo | null {
  const source = exactJsonRecord(value, SOURCE_KEYS);
  if (source === null) return null;
  const sourceId = textAt(source, "sourceId");
  const sourceFamily = textAt(source, "sourceFamily");
  const accessStatus = textAt(source, "accessStatus");
  const credibility = textAt(source, "credibility");
  const promptRisk = textAt(source, "promptInjectionRisk");
  const discoveryOnly = valueAt(source, "discoveryOnly");
  const locators = stringArray(valueAt(source, "evidenceLocators"));
  if (sourceId === null || sourceFamily === null || accessStatus === null || credibility === null || promptRisk === null || locators === null ||
      sourceId.trim() === "" || !hasStringFields(source, ["sourceName", "sourceUrl", "retrievedAt", "contentSha256"]) ||
      !nullableString(valueAt(source, "publishedAt")) || !nullableString(valueAt(source, "accessNotes")) ||
      !SOURCE_FAMILIES.includes(sourceFamily as never) || !CREDIBILITIES.includes(credibility as never) || typeof discoveryOnly !== "boolean") return null;
  const safe = accessStatus === "open" && credibility !== "UNVERIFIED" && discoveryOnly === false && promptRisk === "none";
  return { sourceId, locators, safe };
}

function parseFacts(value: BasicCollectionJsonValue): FactsInfo | null {
  const record = exactJsonRecord(value, FACTS_KEYS);
  if (record === null) return null;
  const facts = jsonArray(valueAt(record, "facts"));
  const schemaVersion = textAt(record, "schemaVersion");
  const runId = textAt(record, "runId");
  const countryCode = textAt(record, "countryCode");
  if (facts === null || schemaVersion === null || runId === null || countryCode === null) return null;
  const parsed: FactInfo[] = [];
  for (const fact of facts) { const item = parseFact(fact); if (item === null) return null; parsed.push(item); }
  return { schemaVersion, runId, countryCode, facts: parsed };
}

function parseFact(value: BasicCollectionJsonValue): FactInfo | null {
  const fact = exactJsonRecord(value, FACT_KEYS);
  if (fact === null) return null;
  const evidence = jsonArray(valueAt(fact, "evidence"));
  const factId = textAt(fact, "factId");
  const fieldPath = textAt(fact, "fieldPath");
  const status = textAt(fact, "status");
  const extractionMethod = textAt(fact, "extractionMethod");
  if (evidence === null || factId === null || fieldPath === null || status === null || extractionMethod === null ||
      factId.trim() === "" || fieldPath.trim() === "" || !nullableString(valueAt(fact, "uncertainty")) || !EXTRACTION_METHODS.includes(extractionMethod as never)) return null;
  const parsed: EvidenceInfo[] = [];
  for (const item of evidence) { const result = parseEvidence(item); if (result === null) return null; parsed.push(result); }
  return { factId, fieldPath, status, evidence: parsed };
}

function parseEvidence(value: BasicCollectionJsonValue): EvidenceInfo | null {
  const evidence = exactJsonRecord(value, EVIDENCE_KEYS);
  if (evidence === null) return null;
  const sourceId = textAt(evidence, "sourceId");
  const locator = textAt(evidence, "locator");
  const year = valueAt(evidence, "year");
  if (sourceId === null || locator === null || sourceId.trim() === "" || !nullableString(valueAt(evidence, "unit")) || !(year === null || typeof year === "number")) return null;
  return { sourceId, locator, normalizedValue: valueAt(evidence, "normalizedValue") };
}

function createRequest(expected: BasicMarketOverviewDraft): BasicLlamaCppDraftRequest {
  const request: BasicLlamaCppDraftRequest = {
    messages: [{ role: "user", content: JSON.stringify({ protocol: BASIC_LLAMA_DRAFT_PROTOCOL_VERSION, operation: BASIC_LLAMA_DRAFT_OPERATION, draft: expected }) }],
    stream: false, temperature: 0, chat_template_kwargs: { enable_thinking: false },
    response_format: { type: "json_schema", schema: BASIC_LLAMA_DRAFT_JSON_SCHEMA },
  };
  return deepFreezeBasicLlamaValue(request);
}

function parseResponse(value: unknown, expected: BasicMarketOverviewDraft): BasicBridgeResult<BasicMarketOverviewDraft> {
  const envelope = plainRuntimeObject(value);
  if (envelope === null) return failed("LLAMA_RESPONSE_INVALID", "llama", false);
  const choicesValue = ownData(envelope, "choices");
  if (choicesValue === INVALID) return failed("LLAMA_RESPONSE_INVALID", "llama", false);
  const choices = standardRuntimeArray(choicesValue);
  if (choices === null) return failed("LLAMA_RESPONSE_INVALID", "llama", false);
  if (choices.length !== 1) return failed("LLAMA_OUTPUT_INCOMPLETE", "llama", false);
  const choice = plainRuntimeObject(choices[0]);
  if (choice === null) return failed("LLAMA_RESPONSE_INVALID", "llama", false);
  const finishReason = ownData(choice, "finish_reason");
  const messageValue = ownData(choice, "message");
  if (finishReason === INVALID || messageValue === INVALID) return failed("LLAMA_RESPONSE_INVALID", "llama", false);
  if (typeof finishReason !== "string" || finishReason !== "stop" || messageValue === undefined) return failed("LLAMA_OUTPUT_INCOMPLETE", "llama", false);
  const message = plainRuntimeObject(messageValue);
  if (message === null) return failed("LLAMA_RESPONSE_INVALID", "llama", false);
  const content = ownData(message, "content");
  if (content === INVALID) return failed("LLAMA_RESPONSE_INVALID", "llama", false);
  if (typeof content !== "string" || content.trim() === "") return failed("LLAMA_OUTPUT_INCOMPLETE", "llama", false);
  let parsedValue: unknown;
  try { parsedValue = JSON.parse(content) as unknown; }
  catch { return failed("LLAMA_OUTPUT_NOT_JSON", "llama", false); }
  const draftRecord = plainRuntimeObject(parsedValue);
  if (draftRecord !== null && (ownData(draftRecord, "reviewStatus") !== "draft" || ownData(draftRecord, "aiUsable") !== false)) return failed("DRAFT_LOCK_VIOLATION", "draft", false);
  const parsed = parseBasicMarketOverviewDraft(parsedValue);
  if (parsed.data === null) return failed("LLAMA_OUTPUT_SCHEMA_INVALID", "draft", false);
  if (!isDeepStrictEqual(parsed.data, expected)) return failed("LLAMA_OUTPUT_UNGROUNDED", "draft", false);
  return { ok: true, data: deepFreezeBasicLlamaValue(parsed.data) };
}

function exactRuntimeRecord(value: unknown, keys: readonly string[]): ReadonlyMap<string, unknown> | null {
  try {
    if (!isPlainRuntimeObject(value)) return null;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))) return null;
    const result = new Map<string, unknown>();
    for (const key of keys) { const item = ownData(value, key); if (item === INVALID) return null; result.set(key, item); }
    return result;
  } catch { return null; }
}

function dataMethod(value: unknown, key: string): DataMethod | null {
  try {
    if (!isObjectLike(value) || isProxy(value)) return null;
    let owner: object | null = value;
    const visited = new Set<object>();
    for (let depth = 0; owner !== null && depth < MAX_METHOD_DEPTH; depth += 1) {
      if (isProxy(owner) || visited.has(owner)) return null;
      visited.add(owner);
      const descriptor = Object.getOwnPropertyDescriptor(owner, key);
      if (descriptor !== undefined) return Object.hasOwn(descriptor, "value") && typeof descriptor.value === "function" && !isProxy(descriptor.value) ? descriptor.value as DataMethod : null;
      owner = Object.getPrototypeOf(owner) as object | null;
    }
    return null;
  } catch { return null; }
}

function standardRuntimeArray(value: unknown): unknown[] | null {
  try {
    if (typeof value !== "object" || value === null || isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
    const length = Object.getOwnPropertyDescriptor(value, "length");
    if (length === undefined || !Object.hasOwn(length, "value") || typeof length.value !== "number" || Reflect.ownKeys(value).length !== length.value + 1) return null;
    const result: unknown[] = [];
    for (let index = 0; index < length.value; index += 1) { const item = ownData(value, String(index)); if (item === INVALID) return null; result.push(item); }
    return result;
  } catch { return null; }
}

function ownData(value: object, key: string): unknown | typeof INVALID {
  try { const descriptor = Object.getOwnPropertyDescriptor(value, key); return descriptor !== undefined && descriptor.enumerable && Object.hasOwn(descriptor, "value") ? descriptor.value : descriptor === undefined ? undefined : INVALID; }
  catch { return INVALID; }
}
function plainRuntimeObject(value: unknown): object | null { return isPlainRuntimeObject(value) ? value : null; }
function isPlainRuntimeObject(value: unknown): value is object { try { return typeof value === "object" && value !== null && !isProxy(value) && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; } catch { return false; } }
function isObjectLike(value: unknown): value is object { return (typeof value === "object" && value !== null) || typeof value === "function"; }
function exactJsonRecord(value: BasicCollectionJsonValue, keys: readonly string[]): JsonRecord | null { if (!isJsonRecord(value)) return null; const actual = Object.keys(value); return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key)) ? value : null; }
function isJsonRecord(value: BasicCollectionJsonValue): value is JsonRecord { return typeof value === "object" && value !== null && !Array.isArray(value); }
function jsonArray(value: BasicCollectionJsonValue): BasicCollectionJsonValue[] | null { return Array.isArray(value) ? value : null; }
function stringArray(value: BasicCollectionJsonValue): string[] | null { return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : null; }
function valueAt(record: JsonRecord, key: string): BasicCollectionJsonValue { return record[key]!; }
function textAt(record: JsonRecord, key: string): string | null { const value = valueAt(record, key); return typeof value === "string" ? value : null; }
function hasStringFields(record: JsonRecord, keys: readonly string[]): boolean { return keys.every((key) => typeof valueAt(record, key) === "string"); }
function nullableString(value: BasicCollectionJsonValue): boolean { return value === null || typeof value === "string"; }
function blocked(): BasicBridgeResult<never> { return failed("DRAFT_INPUT_BLOCKED", "draft", false); }
function failed(code: BasicBridgeErrorCode, phase: BasicBridgeFailure["phase"], retryable: boolean): { ok: false; error: BasicBridgeFailure } { return { ok: false, error: { code, phase, retryable } }; }
function modelFailure(error: unknown): { ok: false; error: BasicBridgeFailure } {
  if (typeof error === "object" && error !== null && !isProxy(error) && error instanceof BasicCollectionBridgeError) {
    const descriptor = Object.getOwnPropertyDescriptor(error, "message");
    const message = descriptor !== undefined && Object.hasOwn(descriptor, "value") ? descriptor.value : INVALID;
    if (message === "P1-6C bridge failed: LLAMA_TIMEOUT") return failed("LLAMA_TIMEOUT", "llama", true);
    if (message === "P1-6C bridge failed: LLAMA_UNAVAILABLE") return failed("LLAMA_UNAVAILABLE", "llama", true);
    if (message === "P1-6C bridge failed: LLAMA_RESPONSE_INVALID") return failed("LLAMA_RESPONSE_INVALID", "llama", false);
  }
  return failed("LLAMA_UNAVAILABLE", "llama", true);
}
