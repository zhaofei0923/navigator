import { isDeepStrictEqual } from "node:util";
import { isNativeError, isPromise, isProxy } from "node:util/types";

import { BasicCollectionBridgeError } from "./basic-collection-bridge-error.js";
import {
  BASIC_COLLECTION_REQUIRED_STATIC_FACT_PATHS,
  type BasicCollectionJsonValue,
  type BasicMarketOverviewDraft,
} from "./basic-collection-contracts.js";
import {
  BASIC_LLAMA_DRAFT_OPERATION,
  BASIC_LLAMA_DRAFT_PROTOCOL_VERSION,
  type BasicBridgeErrorCode, type BasicBridgeFailure, type BasicBridgeResult,
  type BasicDraftBridgeInput, type BasicLlamaCppDraftRequest,
} from "./basic-hermes-llama-contracts.js";
import {
  BASIC_LLAMA_DRAFT_JSON_SCHEMA,
  deepFreezeBasicLlamaValue,
  parseBasicLlamaFactsSnapshot,
  parseBasicLlamaIndicatorPath,
  parseBasicLlamaRegisterSnapshot,
  readBasicLlamaExactRuntimeRecord,
  readBasicLlamaStandardArray,
  snapshotBasicLlamaJson,
  type BasicLlamaFactSnapshot, type BasicLlamaFactsSnapshot,
  type BasicLlamaRegisterSnapshot, type BasicLlamaSourceSnapshot,
} from "./basic-llama-draft-schema.js";
import { parseBasicMarketOverviewDraft } from "./basic-market-overview-draft-parser.js";

const INPUT_KEYS = ["sourceRegister", "extractedFacts", "model"] as const;
const INDICATOR_KEYS = ["label", "value", "unit", "year"] as const;
const INVALID = Symbol("invalid");
const MAX_METHOD_DEPTH = 16;
type DataMethod = (...args: unknown[]) => unknown;
interface GroundedFacts {
  values: Map<string, BasicCollectionJsonValue>;
  indicators: Map<number, Set<string>>;
}
type ContentResult =
  | { ok: true; content: string }
  | { ok: false; code: "LLAMA_RESPONSE_INVALID" | "LLAMA_OUTPUT_INCOMPLETE" };

export async function bridgeBasicMarketOverviewDraft(
  value: BasicDraftBridgeInput,
): Promise<BasicBridgeResult<BasicMarketOverviewDraft>> {
  const input = readBasicLlamaExactRuntimeRecord(value, INPUT_KEYS);
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
  let pending: unknown;
  try { pending = Reflect.apply(complete, model, [request]); }
  catch (error) { return modelFailure(error); }
  if (!isExactLocalPromise(pending)) return failed("LLAMA_RESPONSE_INVALID", "llama", false);

  let response: unknown;
  try { response = await pending; }
  catch (error) { return modelFailure(error); }
  return parseResponse(response, expected);
}

function assembleExpectedDraft(
  sourceValue: BasicCollectionJsonValue,
  factsValue: BasicCollectionJsonValue,
): BasicMarketOverviewDraft | null {
  const register = parseBasicLlamaRegisterSnapshot(sourceValue);
  const extracted = parseBasicLlamaFactsSnapshot(factsValue);
  if (register === null || extracted === null || !identitiesMatch(register, extracted)) return null;
  const sources = safeSources(register.sources);
  if (sources === null) return null;
  const grounded = collectGroundedFacts(extracted.facts, sources);
  if (grounded === null || !hasRequiredFacts(grounded.values)) return null;
  if (grounded.values.get("country.code") !== register.countryCode ||
      grounded.values.get("marketOverview.countryCode") !== register.countryCode) return null;
  const indices = completeIndicatorIndices(grounded.indicators);
  if (indices === null) return null;
  return parseAndCanonicalizeDraft(buildDraft(grounded.values, indices));
}

function identitiesMatch(register: BasicLlamaRegisterSnapshot, facts: BasicLlamaFactsSnapshot): boolean {
  return register.runId === facts.runId && register.countryCode === facts.countryCode;
}

function safeSources(sources: readonly BasicLlamaSourceSnapshot[]): Map<string, BasicLlamaSourceSnapshot> | null {
  if (sources.some(({ safe }) => !safe)) return null;
  return new Map(sources.map((source) => [source.sourceId, source]));
}

function collectGroundedFacts(
  facts: readonly BasicLlamaFactSnapshot[],
  sources: ReadonlyMap<string, BasicLlamaSourceSnapshot>,
): GroundedFacts | null {
  const values = new Map<string, BasicCollectionJsonValue>();
  const indicators = new Map<number, Set<string>>();
  for (const fact of facts) {
    if (fact.status !== "candidate" || values.has(fact.fieldPath)) return null;
    const normalized = fact.evidence[0]!.normalizedValue;
    if (!validEvidence(fact, normalized, sources)) return null;
    values.set(fact.fieldPath, normalized);
    const indicator = parseBasicLlamaIndicatorPath(fact.fieldPath);
    if (indicator !== null) {
      const keys = indicators.get(indicator.index) ?? new Set<string>();
      keys.add(indicator.key);
      indicators.set(indicator.index, keys);
    }
  }
  return { values, indicators };
}

function validEvidence(
  fact: BasicLlamaFactSnapshot,
  normalized: BasicCollectionJsonValue,
  sources: ReadonlyMap<string, BasicLlamaSourceSnapshot>,
): boolean {
  return fact.evidence.every((evidence) => {
    const source = sources.get(evidence.sourceId);
    return source !== undefined && source.locators.includes(evidence.locator) &&
      isDeepStrictEqual(evidence.normalizedValue, normalized);
  });
}

function hasRequiredFacts(values: ReadonlyMap<string, BasicCollectionJsonValue>): boolean {
  return BASIC_COLLECTION_REQUIRED_STATIC_FACT_PATHS.every((path) => values.has(path));
}

function completeIndicatorIndices(indicators: ReadonlyMap<number, Set<string>>): number[] | null {
  const indices = [...indicators.keys()].sort((left, right) => left - right);
  const complete = indices.every((index, position) =>
    index === position && INDICATOR_KEYS.every((key) => indicators.get(index)?.has(key)),
  );
  return complete ? indices : null;
}

function buildDraft(values: ReadonlyMap<string, BasicCollectionJsonValue>, indices: readonly number[]): unknown {
  const read = (path: string) => values.get(path);
  return {
    overview: read("marketOverview.overview"),
    population: read("marketOverview.population"),
    gdp: read("marketOverview.gdp"),
    gdpGrowth: read("marketOverview.gdpGrowth"),
    energyDemand: read("marketOverview.energyDemand"),
    renewableTarget: read("marketOverview.renewableTarget"),
    keyIndicators: indices.map((index) => ({
      label: read(`marketOverview.keyIndicators[${index}].label`),
      value: read(`marketOverview.keyIndicators[${index}].value`),
      unit: read(`marketOverview.keyIndicators[${index}].unit`),
      year: read(`marketOverview.keyIndicators[${index}].year`),
    })),
    source: read("marketOverview.source"),
    sourceUrl: read("marketOverview.sourceUrl"),
    collectedAt: read("marketOverview.collectedAt"),
    updatedAt: read("marketOverview.updatedAt"),
    credibility: read("marketOverview.credibility"),
    reviewStatus: "draft",
    aiUsable: false,
    countryCode: read("marketOverview.countryCode"),
    industryTags: read("marketOverview.industryTags"),
    techTags: read("marketOverview.techTags"),
  };
}

function parseAndCanonicalizeDraft(value: unknown): BasicMarketOverviewDraft | null {
  const parsed = parseBasicMarketOverviewDraft(value);
  if (parsed.data === null) return null;
  try {
    const canonical: unknown = JSON.parse(JSON.stringify(parsed.data));
    const reparsed = parseBasicMarketOverviewDraft(canonical);
    return reparsed.data === null ? null : deepFreezeBasicLlamaValue(reparsed.data);
  } catch { return null; }
}

function createRequest(expected: BasicMarketOverviewDraft): BasicLlamaCppDraftRequest {
  const content = JSON.stringify({
    protocol: BASIC_LLAMA_DRAFT_PROTOCOL_VERSION,
    operation: BASIC_LLAMA_DRAFT_OPERATION,
    draft: expected,
  });
  return deepFreezeBasicLlamaValue({
    messages: [{ role: "user", content }],
    stream: false,
    temperature: 0,
    chat_template_kwargs: { enable_thinking: false },
    response_format: { type: "json_schema", schema: BASIC_LLAMA_DRAFT_JSON_SCHEMA },
  });
}

function parseResponse(value: unknown, expected: BasicMarketOverviewDraft): BasicBridgeResult<BasicMarketOverviewDraft> {
  const extracted = extractContent(value);
  if (!extracted.ok) return failed(extracted.code, "llama", false);
  let parsedValue: unknown;
  try { parsedValue = JSON.parse(extracted.content) as unknown; }
  catch { return failed("LLAMA_OUTPUT_NOT_JSON", "llama", false); }
  const record = plainRuntimeObject(parsedValue);
  if (record !== null && (changedLock(record, "reviewStatus", "draft") || changedLock(record, "aiUsable", false))) {
    return failed("DRAFT_LOCK_VIOLATION", "draft", false);
  }
  const parsed = parseBasicMarketOverviewDraft(parsedValue);
  if (parsed.data === null) return failed("LLAMA_OUTPUT_SCHEMA_INVALID", "draft", false);
  if (!isDeepStrictEqual(parsed.data, expected)) return failed("LLAMA_OUTPUT_UNGROUNDED", "draft", false);
  return { ok: true, data: deepFreezeBasicLlamaValue(parsed.data) };
}

function extractContent(value: unknown): ContentResult {
  const envelope = plainRuntimeObject(value);
  if (envelope === null) return { ok: false, code: "LLAMA_RESPONSE_INVALID" };
  const choicesValue = ownData(envelope, "choices");
  if (choicesValue === INVALID) return { ok: false, code: "LLAMA_RESPONSE_INVALID" };
  const choices = readBasicLlamaStandardArray(choicesValue);
  if (choices === null) return { ok: false, code: "LLAMA_RESPONSE_INVALID" };
  if (choices.length !== 1) return { ok: false, code: "LLAMA_OUTPUT_INCOMPLETE" };
  const choice = plainRuntimeObject(choices[0]);
  if (choice === null) return { ok: false, code: "LLAMA_RESPONSE_INVALID" };
  const finish = ownData(choice, "finish_reason");
  const messageValue = ownData(choice, "message");
  if (finish === INVALID || messageValue === INVALID) return { ok: false, code: "LLAMA_RESPONSE_INVALID" };
  if (finish !== "stop" || messageValue === undefined) return { ok: false, code: "LLAMA_OUTPUT_INCOMPLETE" };
  const message = plainRuntimeObject(messageValue);
  if (message === null) return { ok: false, code: "LLAMA_RESPONSE_INVALID" };
  const content = ownData(message, "content");
  if (content === INVALID) return { ok: false, code: "LLAMA_RESPONSE_INVALID" };
  return typeof content === "string" && content.trim() !== ""
    ? { ok: true, content }
    : { ok: false, code: "LLAMA_OUTPUT_INCOMPLETE" };
}

function changedLock(record: object, key: string, expected: unknown): boolean {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor !== undefined && (!Object.hasOwn(descriptor, "value") || descriptor.value !== expected);
}

function isExactLocalPromise(value: unknown): value is Promise<unknown> {
  try {
    return typeof value === "object" && value !== null && !isProxy(value) && isPromise(value) &&
      Object.getPrototypeOf(value) === Promise.prototype &&
      Object.getOwnPropertyDescriptor(value, "then") === undefined &&
      Object.getOwnPropertyDescriptor(value, "constructor") === undefined;
  } catch { return false; }
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
      if (descriptor !== undefined) {
        return Object.hasOwn(descriptor, "value") && typeof descriptor.value === "function" && !isProxy(descriptor.value)
          ? descriptor.value as DataMethod
          : null;
      }
      owner = Object.getPrototypeOf(owner) as object | null;
    }
    return null;
  } catch { return null; }
}

function modelFailure(error: unknown): { ok: false; error: BasicBridgeFailure } {
  try {
    if (typeof error !== "object" || error === null || isProxy(error) || !isNativeError(error)) return unavailable();
    const prototype = Object.getPrototypeOf(error) as object | null;
    if (prototype === null || isProxy(prototype) || prototype !== BasicCollectionBridgeError.prototype) return unavailable();
    const descriptor = Object.getOwnPropertyDescriptor(error, "message");
    if (descriptor === undefined || descriptor.enumerable || !Object.hasOwn(descriptor, "value")) return unavailable();
    if (descriptor.value === "P1-6C bridge failed: LLAMA_TIMEOUT") return failed("LLAMA_TIMEOUT", "llama", true);
    if (descriptor.value === "P1-6C bridge failed: LLAMA_UNAVAILABLE") return unavailable();
    if (descriptor.value === "P1-6C bridge failed: LLAMA_RESPONSE_INVALID") return failed("LLAMA_RESPONSE_INVALID", "llama", false);
    return unavailable();
  } catch { return unavailable(); }
}

function ownData(value: object, key: string): unknown | typeof INVALID {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined) return undefined;
    return descriptor.enumerable && Object.hasOwn(descriptor, "value") ? descriptor.value : INVALID;
  } catch { return INVALID; }
}
function plainRuntimeObject(value: unknown): object | null { return isPlainRuntimeObject(value) ? value : null; }
function isPlainRuntimeObject(value: unknown): value is object { try { return typeof value === "object" && value !== null && !isProxy(value) && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; } catch { return false; } }
function isObjectLike(value: unknown): value is object { return (typeof value === "object" && value !== null) || typeof value === "function"; }
function blocked(): BasicBridgeResult<never> { return failed("DRAFT_INPUT_BLOCKED", "draft", false); }
function unavailable(): { ok: false; error: BasicBridgeFailure } { return failed("LLAMA_UNAVAILABLE", "llama", true); }
function failed(code: BasicBridgeErrorCode, phase: BasicBridgeFailure["phase"], retryable: boolean): { ok: false; error: BasicBridgeFailure } {
  return { ok: false, error: { code, phase, retryable } };
}
