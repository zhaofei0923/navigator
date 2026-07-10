import { createHash } from "node:crypto";

import { CREDIBILITIES } from "@navigator/shared-types/schema";
import { expectUtcRfc3339Timestamp } from "../seed/basic-country-validation-utils.js";
import {
  BASIC_COLLECTION_AUDIT_SCHEMA_VERSION,
  BASIC_COLLECTION_REQUIRED_STATIC_FACT_PATHS,
  type BasicCollectionJsonValue,
  type BasicExtractedFact,
  type BasicSourceRecord,
} from "./basic-collection-contracts.js";
import { materializeBasicHermesFacts, type BasicHermesSourcedObservation } from "./basic-hermes-evidence-materializer.js";
import {
  canonicalBasicHermesDiscoveryUrl,
  snapshotBasicHermesDiscoveryCandidate,
} from "./basic-hermes-discovery.js";
import {
  BASIC_HERMES_DISCOVERY_SCHEMA_VERSION,
  type BasicBridgeResult,
  type BasicHermesSourcePolicy,
} from "./basic-hermes-llama-contracts.js";
import { BASIC_RAW_CAPTURE_MAX_BYTES, type BasicRawCaptureReceipt, type BasicSourceAdapterRunResult } from "./basic-source-adapter-contracts.js";

const INPUT = ["base", "discovery", "openedSources"] as const;
const BASE = ["sourceRegister", "extractedFacts", "receipts"] as const;
const REGISTER = ["schemaVersion", "runId", "countryCode", "sources"] as const;
const FACTS = ["schemaVersion", "runId", "countryCode", "facts"] as const;
const SOURCE = ["sourceId", "sourceName", "sourceUrl", "retrievedAt", "publishedAt", "contentSha256", "evidenceLocators", "sourceFamily", "accessStatus", "accessNotes", "credibility", "discoveryOnly", "promptInjectionRisk"] as const;
const FACT = ["factId", "fieldPath", "status", "evidence", "extractionMethod", "uncertainty"] as const;
const EVIDENCE = ["sourceId", "locator", "rawValue", "normalizedValue", "unit", "year"] as const;
const RECEIPT = ["sourceId", "contentSha256", "byteLength", "reused"] as const;
const DISCOVERY = ["schemaVersion", "runId", "countryCode", "candidates"] as const;
const OPENED = ["discoveryId", "policy", "capture", "observations"] as const;
const POLICY = ["sourceId", "sourceName", "sourceUrl", "sourceFamily", "credibility", "accessStatus", "accessNotes", "publishedAt", "promptInjectionRisk", "approvedOrigins", "allowedQueryParameters"] as const;
const CAPTURE = ["sourceId", "contentSha256", "byteLength", "reused", "body", "finalUrl", "contentType", "retrievedAt"] as const;
const OBSERVATION = ["fieldPath", "locator", "rawValue", "normalizedValue", "unit", "year", "uncertainty"] as const;
const PATHS = new Set<string>(BASIC_COLLECTION_REQUIRED_STATIC_FACT_PATHS);
const INDICATOR = /^marketOverview\.keyIndicators\[(?:0|[1-9]\d*)\]\.(?:label|value|unit|year)$/;
const SOURCE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const FAMILIES = ["international-organization", "official-statistics", "government", "energy-authority", "regulator", "grid-operator", "industry-association", "verified-research"] as const;

class PromotionError extends Error { constructor(readonly code: "SOURCE_CAPTURE_INVALID" | "EVIDENCE_INVALID") { super(code); } }
type Candidate = { id: string; url: string };

export function promoteBasicHermesJsonEvidence(value: unknown): BasicBridgeResult<BasicSourceAdapterRunResult> {
  try {
    const input = snapshotInput(value);
    const result = promote(input);
    return { ok: true, data: deepFreeze(result) };
  } catch (error) {
    const code = error instanceof PromotionError ? error.code : "EVIDENCE_INVALID";
    return { ok: false, error: { code, phase: code === "SOURCE_CAPTURE_INVALID" ? "source" : "evidence", retryable: false } };
  }
}

function snapshotInput(value: unknown): { base: BasicSourceAdapterRunResult; candidates: Map<string, Candidate>; opened: readonly unknown[] } {
  const input = record(value, INPUT); if (input === null) invalid();
  const base = snapshotBase(input.get("base"));
  const candidates = snapshotDiscovery(input.get("discovery"), base);
  const opened = values(input.get("openedSources"), 20); if (opened === null) invalid();
  return { base, candidates, opened };
}

function promote(input: { base: BasicSourceAdapterRunResult; candidates: Map<string, Candidate>; opened: readonly unknown[] }): BasicSourceAdapterRunResult {
  const sources = [...input.base.sourceRegister.sources];
  const facts = [...input.base.extractedFacts.facts];
  const receipts = [...input.base.receipts];
  const sourceIds = new Set(sources.map((source) => source.sourceId));
  const discoveryIds = new Set<string>();
  const paths = new Set(facts.map((fact) => fact.fieldPath));
  const observations: BasicHermesSourcedObservation[] = [];
  for (const value of input.opened) {
    const opened = record(value, OPENED); if (opened === null) invalid();
    const discoveryId = text(opened.get("discoveryId")); const candidate = input.candidates.get(discoveryId); if (candidate === undefined || discoveryIds.has(discoveryId)) invalid();
    const policy = snapshotPolicy(opened.get("policy"));
    if (sourceIds.has(policy.sourceId) || !allowedUrl(candidate.url, policy) || candidate.url !== policy.sourceUrl) invalid();
    const verified = snapshotCapture(opened.get("capture"), policy);
    const raw = parseCapturedJson(verified.body);
    const values = snapshotObservations(opened.get("observations"), raw, policy.sourceId, policy);
    for (const item of values) { if (paths.has(item.fieldPath)) invalid(); observations.push(item); }
    sources.push(source(policy, verified, values.map((item) => item.locator))); receipts.push(verified.receipt); sourceIds.add(policy.sourceId); discoveryIds.add(discoveryId);
  }
  let hermes: BasicExtractedFact[];
  try { hermes = materializeBasicHermesFacts(observations); } catch { invalid(); }
  for (const fact of hermes) paths.add(fact.fieldPath);
  const output = {
    sourceRegister: { ...input.base.sourceRegister, sources: sources.sort((left, right) => compare(left.sourceId, right.sourceId)) },
    extractedFacts: { ...input.base.extractedFacts, facts: [...facts, ...hermes].sort((left, right) => compare(left.fieldPath, right.fieldPath)) },
    receipts: receipts.sort((left, right) => compare(left.sourceId, right.sourceId)),
  };
  if (!unique(output.sourceRegister.sources.map((item) => item.sourceId)) || !unique(output.extractedFacts.facts.map((item) => item.factId)) || !unique(output.extractedFacts.facts.map((item) => item.fieldPath)) || !unique(output.receipts.map((item) => item.sourceId))) invalid();
  return output;
}

function snapshotBase(value: unknown): BasicSourceAdapterRunResult {
  const base = record(value, BASE); if (base === null) invalid();
  const register = record(base.get("sourceRegister"), REGISTER); const facts = record(base.get("extractedFacts"), FACTS);
  const receipts = values(base.get("receipts"), Number.MAX_SAFE_INTEGER); if (register === null || facts === null || receipts === null) invalid();
  const runId = run(register.get("runId")); const countryCode = country(register.get("countryCode"));
  if (register.get("schemaVersion") !== BASIC_COLLECTION_AUDIT_SCHEMA_VERSION || facts.get("schemaVersion") !== BASIC_COLLECTION_AUDIT_SCHEMA_VERSION || facts.get("runId") !== runId || facts.get("countryCode") !== countryCode) invalid();
  const sources = values(register.get("sources"), Number.MAX_SAFE_INTEGER)?.map(snapshotSource); const parsedFacts = values(facts.get("facts"), Number.MAX_SAFE_INTEGER)?.map(snapshotFact); const parsedReceipts = receipts.map(snapshotReceipt);
  if (sources === undefined || parsedFacts === undefined || !unique(sources.map((item) => item.sourceId)) || !unique(parsedFacts.map((item) => item.factId)) || !unique(parsedFacts.map((item) => item.fieldPath)) || !unique(parsedReceipts.map((item) => item.sourceId)) || sources.length !== parsedReceipts.length) invalid();
  const sourceMap = new Map(sources.map((item) => [item.sourceId, item]));
  if (parsedReceipts.some((item) => sourceMap.get(item.sourceId)?.contentSha256 !== item.contentSha256) || parsedFacts.some((fact) => fact.evidence.some((item) => { const source = sourceMap.get(item.sourceId); return source === undefined || !source.evidenceLocators.includes(item.locator); }))) invalid();
  return { sourceRegister: { schemaVersion: BASIC_COLLECTION_AUDIT_SCHEMA_VERSION, runId, countryCode, sources }, extractedFacts: { schemaVersion: BASIC_COLLECTION_AUDIT_SCHEMA_VERSION, runId, countryCode, facts: parsedFacts }, receipts: parsedReceipts };
}

function snapshotDiscovery(value: unknown, base: BasicSourceAdapterRunResult): Map<string, Candidate> {
  const discovery = record(value, DISCOVERY); if (discovery === null || discovery.get("schemaVersion") !== BASIC_HERMES_DISCOVERY_SCHEMA_VERSION || discovery.get("runId") !== base.sourceRegister.runId || discovery.get("countryCode") !== base.sourceRegister.countryCode) invalid();
  const candidates = values(discovery.get("candidates"), 50); if (candidates === null) invalid(); const output = new Map<string, Candidate>();
  for (const value of candidates) { const candidate = snapshotBasicHermesDiscoveryCandidate(value); if ("code" in candidate || output.has(candidate.discoveryId) || Array.from(output.values()).some((item) => item.url === candidate.url)) invalid(); output.set(candidate.discoveryId, { id: candidate.discoveryId, url: candidate.url }); }
  return output;
}

function snapshotPolicy(value: unknown): BasicHermesSourcePolicy {
  const policy = record(value, POLICY); if (policy === null) invalid();
  const approvedOrigins = originList(policy.get("approvedOrigins")); const allowedQueryParameters = queryList(policy.get("allowedQueryParameters"));
  const sourceId = text(policy.get("sourceId")); const sourceName = text(policy.get("sourceName")); const sourceUrl = safeUrl(policy.get("sourceUrl"));
  if (!SOURCE_ID.test(sourceId) || !includes(FAMILIES, policy.get("sourceFamily")) || !includes(CREDIBILITIES, policy.get("credibility")) || !includes(["open", "restricted", "unknown"] as const, policy.get("accessStatus")) || !(policy.get("accessNotes") === null || nonblank(policy.get("accessNotes"))) || !(policy.get("publishedAt") === null || timestamp(policy.get("publishedAt"))) || !includes(["none", "suspected", "confirmed"] as const, policy.get("promptInjectionRisk")) || !allowedUrl(sourceUrl, { approvedOrigins, allowedQueryParameters })) invalid();
  return { sourceId, sourceName, sourceUrl, sourceFamily: policy.get("sourceFamily") as BasicHermesSourcePolicy["sourceFamily"], credibility: policy.get("credibility") as BasicHermesSourcePolicy["credibility"], accessStatus: policy.get("accessStatus") as BasicHermesSourcePolicy["accessStatus"], accessNotes: policy.get("accessNotes") as string | null, publishedAt: policy.get("publishedAt") as string | null, promptInjectionRisk: policy.get("promptInjectionRisk") as BasicHermesSourcePolicy["promptInjectionRisk"], approvedOrigins, allowedQueryParameters };
}

function snapshotCapture(value: unknown, policy: BasicHermesSourcePolicy): { receipt: BasicRawCaptureReceipt; body: Uint8Array; retrievedAt: string; contentSha256: string } {
  const capture = record(value, CAPTURE); if (capture === null || capture.get("sourceId") !== policy.sourceId || typeof capture.get("reused") !== "boolean" || !timestamp(capture.get("retrievedAt")) || !jsonMime(capture.get("contentType"))) captureInvalid();
  const finalUrl = safeUrl(capture.get("finalUrl")); if (finalUrl !== policy.sourceUrl || !allowedUrl(finalUrl, policy)) captureInvalid();
  const original = capture.get("body"); if (!(original instanceof Uint8Array) || Object.getPrototypeOf(original) !== Uint8Array.prototype) captureInvalid(); const body = new Uint8Array(original);
  const byteLength = capture.get("byteLength"); const contentSha256 = capture.get("contentSha256"); if (typeof byteLength !== "number" || !Number.isSafeInteger(byteLength) || byteLength < 0 || byteLength > BASIC_RAW_CAPTURE_MAX_BYTES || byteLength !== body.byteLength || typeof contentSha256 !== "string" || !SHA256.test(contentSha256) || createHash("sha256").update(body).digest("hex") !== contentSha256) captureInvalid();
  return { receipt: { sourceId: policy.sourceId, contentSha256, byteLength, reused: capture.get("reused") as boolean }, body, retrievedAt: capture.get("retrievedAt") as string, contentSha256 };
}

function snapshotObservations(value: unknown, raw: BasicCollectionJsonValue, sourceId: string, policy: BasicHermesSourcePolicy): BasicHermesSourcedObservation[] {
  const observations = values(value, 128); if (observations === null || observations.length === 0) invalid();
  return observations.map((value) => { const observation = record(value, OBSERVATION); if (observation === null) invalid(); const fieldPath = text(observation.get("fieldPath")); const locator = text(observation.get("locator")); const rawValue = json(observation.get("rawValue")); const normalizedValue = json(observation.get("normalizedValue")); const unit = observation.get("unit"); const year = observation.get("year"); const uncertainty = observation.get("uncertainty"); if (!isPath(fieldPath) || !(unit === null || nonblank(unit)) || !(year === null || finite(year)) || !(uncertainty === null || nonblank(uncertainty)) || !sameJson(rawValue, pointer(raw, locator))) invalid(); return { sourceId, fieldPath, locator, rawValue, normalizedValue, unit: unit as string | null, year: year as number | null, uncertainty: uncertainty === null ? null : (uncertainty as string).trim(), untrusted: policy.accessStatus !== "open" || policy.credibility === "UNVERIFIED" || policy.promptInjectionRisk !== "none" }; });
}

function source(policy: BasicHermesSourcePolicy, capture: { retrievedAt: string; contentSha256: string }, locators: readonly string[]): BasicSourceRecord { return { sourceId: policy.sourceId, sourceName: policy.sourceName, sourceUrl: policy.sourceUrl, retrievedAt: capture.retrievedAt, publishedAt: policy.publishedAt, contentSha256: capture.contentSha256, evidenceLocators: Array.from(new Set(locators)).sort(compare), sourceFamily: policy.sourceFamily, accessStatus: policy.accessStatus, accessNotes: policy.accessNotes, credibility: policy.credibility, discoveryOnly: false, promptInjectionRisk: policy.promptInjectionRisk }; }

function snapshotSource(value: unknown): BasicSourceRecord {
  const source = record(value, SOURCE); if (source === null) invalid(); const sourceId = text(source.get("sourceId")); const sourceUrl = httpUrl(source.get("sourceUrl")); const locators = strings(source.get("evidenceLocators"), 1);
  if (!SOURCE_ID.test(sourceId) || !timestamp(source.get("retrievedAt")) || !(source.get("publishedAt") === null || timestamp(source.get("publishedAt"))) || typeof source.get("contentSha256") !== "string" || !SHA256.test(source.get("contentSha256") as string) || !includes(FAMILIES, source.get("sourceFamily")) || !includes(["open", "restricted", "unknown"] as const, source.get("accessStatus")) || !(source.get("accessNotes") === null || nonblank(source.get("accessNotes"))) || !includes(CREDIBILITIES, source.get("credibility")) || typeof source.get("discoveryOnly") !== "boolean" || !includes(["none", "suspected", "confirmed"] as const, source.get("promptInjectionRisk"))) invalid();
  return { sourceId, sourceName: text(source.get("sourceName")), sourceUrl, retrievedAt: source.get("retrievedAt") as string, publishedAt: source.get("publishedAt") as string | null, contentSha256: source.get("contentSha256") as string, evidenceLocators: locators, sourceFamily: source.get("sourceFamily") as BasicSourceRecord["sourceFamily"], accessStatus: source.get("accessStatus") as BasicSourceRecord["accessStatus"], accessNotes: source.get("accessNotes") as string | null, credibility: source.get("credibility") as BasicSourceRecord["credibility"], discoveryOnly: source.get("discoveryOnly") as boolean, promptInjectionRisk: source.get("promptInjectionRisk") as BasicSourceRecord["promptInjectionRisk"] };
}

function snapshotFact(value: unknown): BasicExtractedFact {
  const fact = record(value, FACT); if (fact === null) invalid(); const evidence = values(fact.get("evidence"), Number.MAX_SAFE_INTEGER); if (evidence === null) invalid(); const status = fact.get("status"); const fieldPath = text(fact.get("fieldPath"));
  if (!isPath(fieldPath) || !nonblank(fact.get("factId")) || !includes(["candidate", "missing", "conflict", "untrusted"] as const, status) || !includes(["deterministic", "hermes", "manual"] as const, fact.get("extractionMethod")) || !(fact.get("uncertainty") === null || nonblank(fact.get("uncertainty")))) invalid();
  const parsed = evidence.map((value) => { const item = record(value, EVIDENCE); if (item === null) invalid(); const unit = item.get("unit"); const year = item.get("year"); if (!SOURCE_ID.test(text(item.get("sourceId"))) || !nonblank(item.get("locator")) || !(unit === null || nonblank(unit)) || !(year === null || finite(year))) invalid(); return { sourceId: item.get("sourceId") as string, locator: item.get("locator") as string, rawValue: json(item.get("rawValue")), normalizedValue: json(item.get("normalizedValue")), unit: unit as string | null, year: year as number | null }; });
  if ((status === "candidate" || status === "untrusted") && parsed.length === 0 || status === "missing" && parsed.length !== 0 || status === "conflict" && new Set(parsed.map((item) => item.sourceId)).size < 2) invalid();
  return { factId: fact.get("factId") as string, fieldPath, status, evidence: parsed, extractionMethod: fact.get("extractionMethod") as BasicExtractedFact["extractionMethod"], uncertainty: fact.get("uncertainty") === null ? null : (fact.get("uncertainty") as string).trim() };
}

function snapshotReceipt(value: unknown): BasicRawCaptureReceipt { const receipt = record(value, RECEIPT); if (receipt === null || !SOURCE_ID.test(text(receipt.get("sourceId"))) || typeof receipt.get("contentSha256") !== "string" || !SHA256.test(receipt.get("contentSha256") as string) || !Number.isSafeInteger(receipt.get("byteLength")) || (receipt.get("byteLength") as number) < 0 || (receipt.get("byteLength") as number) > BASIC_RAW_CAPTURE_MAX_BYTES || typeof receipt.get("reused") !== "boolean") invalid(); return { sourceId: receipt.get("sourceId") as string, contentSha256: receipt.get("contentSha256") as string, byteLength: receipt.get("byteLength") as number, reused: receipt.get("reused") as boolean }; }

function parseCapturedJson(body: Uint8Array): BasicCollectionJsonValue { try { return json(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) as unknown); } catch { invalid(); } }
function pointer(value: BasicCollectionJsonValue, locator: string): BasicCollectionJsonValue { if (!locator.startsWith("json:")) invalid(); const pointer = locator.slice(5); if (pointer !== "" && !pointer.startsWith("/")) invalid(); let current = value; for (const encoded of pointer === "" ? [] : pointer.slice(1).split("/")) { const segment = encoded.replace(/~1/g, "/").replace(/~0/g, "~"); if (/~(?:[^01]|$)/.test(encoded)) invalid(); if (Array.isArray(current)) { if (!/^(?:0|[1-9]\d*)$/.test(segment) || Number(segment) >= current.length) invalid(); current = current[Number(segment)]!; } else if (current !== null && typeof current === "object") { const descriptor = Object.getOwnPropertyDescriptor(current, segment); if (descriptor === undefined || !Object.hasOwn(descriptor, "value")) invalid(); current = descriptor.value as BasicCollectionJsonValue; } else invalid(); } return current; }
function json(value: unknown, ancestors = new WeakSet<object>(), depth = 0): BasicCollectionJsonValue { if (depth > 64) invalid(); if (value === null || typeof value === "string" || typeof value === "boolean") return value; if (finite(value)) return value; if (typeof value !== "object" || value === null || ancestors.has(value)) invalid(); ancestors.add(value); let result: BasicCollectionJsonValue; if (Array.isArray(value)) { const items = values(value, Number.MAX_SAFE_INTEGER); if (items === null) invalid(); result = items.map((item) => json(item, ancestors, depth + 1)); } else { const keys = Reflect.ownKeys(value); if (Object.getPrototypeOf(value) !== Object.prototype || keys.some((key) => typeof key !== "string")) invalid(); const output: { [key: string]: BasicCollectionJsonValue } = {}; for (const key of keys as string[]) { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) invalid(); Object.defineProperty(output, key, { value: json(descriptor.value, ancestors, depth + 1), enumerable: true }); } result = output; } ancestors.delete(value); return result; }
function sameJson(left: BasicCollectionJsonValue, right: BasicCollectionJsonValue): boolean { if (typeof left !== typeof right || left === null || right === null) return left === right; if (typeof left === "number") return Object.is(left, right); if (typeof left !== "object") return left === right; if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((item, index) => sameJson(item, right[index]!)); const leftRecord = left as { [key: string]: BasicCollectionJsonValue }; const rightRecord = right as { [key: string]: BasicCollectionJsonValue }; const keys = Object.keys(leftRecord); return keys.length === Object.keys(rightRecord).length && keys.every((key) => Object.hasOwn(rightRecord, key) && sameJson(leftRecord[key]!, rightRecord[key]!)); }
function record(value: unknown, keys: readonly string[]): ReadonlyMap<string, unknown> | null { try { if (typeof value !== "object" || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Reflect.ownKeys(value).length !== keys.length || Reflect.ownKeys(value).some((key) => typeof key !== "string" || !keys.includes(key))) return null; const output = new Map<string, unknown>(); for (const key of keys) { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) return null; output.set(key, descriptor.value); } return output; } catch { return null; } }
function values(value: unknown, max: number): unknown[] | null { try { if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > max || Reflect.ownKeys(value).length !== value.length + 1) return null; const output: unknown[] = []; for (let index = 0; index < value.length; index += 1) { const descriptor = Object.getOwnPropertyDescriptor(value, String(index)); if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) return null; output.push(descriptor.value); } return output; } catch { return null; } }
function strings(value: unknown, min: number): string[] { const result = values(value, Number.MAX_SAFE_INTEGER); if (result === null || result.length < min || result.some((item) => !nonblank(item)) || !unique(result as string[])) invalid(); return (result as string[]).map((item) => item.trim()); }
function originList(value: unknown): string[] { const origins = strings(value, 1); if (origins.some((origin) => { try { const url = new URL(origin); const canonical = canonicalBasicHermesDiscoveryUrl(origin); return url.protocol !== "https:" || url.origin !== origin || url.username !== "" || url.password !== "" || canonical === null || canonical === "forbidden"; } catch { return true; } })) invalid(); return origins; }
function queryList(value: unknown): string[] { const names = strings(value, 0); if (names.some((name) => !/^[A-Za-z][A-Za-z0-9_-]*$/.test(name))) invalid(); return names; }
function safeUrl(value: unknown): string { const url = canonicalBasicHermesDiscoveryUrl(value); if (url === null || url === "forbidden") invalid(); return url; }
function httpUrl(value: unknown): string { try { const url = new URL(text(value)); if (!/^https?:$/.test(url.protocol)) invalid(); return url.href; } catch { invalid(); } }
function allowedUrl(value: string, policy: Pick<BasicHermesSourcePolicy, "approvedOrigins" | "allowedQueryParameters">): boolean { try { const url = new URL(value); if (!policy.approvedOrigins.includes(url.origin)) return false; const names = new Set<string>(); for (const [name] of url.searchParams) { if (!policy.allowedQueryParameters.includes(name) || names.has(name)) return false; names.add(name); } return true; } catch { return false; } }
function jsonMime(value: unknown): boolean { return typeof value === "string" && (value.split(";", 1)[0]?.trim().toLowerCase() === "application/json" || value.split(";", 1)[0]?.trim().toLowerCase().endsWith("+json") === true); }
function isPath(value: string): boolean { return PATHS.has(value) || INDICATOR.test(value); }
function timestamp(value: unknown): value is string { const errors: string[] = []; expectUtcRfc3339Timestamp(value, "timestamp", errors); return errors.length === 0; }
function country(value: unknown): string { const result = text(value); if (!/^[A-Z]{2}$/.test(result)) invalid(); return result; }
function run(value: unknown): string { const result = text(value); if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(result)) invalid(); return result; }
function text(value: unknown): string { if (!nonblank(value)) invalid(); return value.trim(); }
function nonblank(value: unknown): value is string { return typeof value === "string" && value.trim() !== ""; }
function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function includes<T>(values: readonly T[], value: unknown): value is T { return values.includes(value as T); }
function unique(values: readonly string[]): boolean { return new Set(values).size === values.length; }
function compare(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function invalid(): never { throw new PromotionError("EVIDENCE_INVALID"); }
function captureInvalid(): never { throw new PromotionError("SOURCE_CAPTURE_INVALID"); }
function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T { if (typeof value === "object" && value !== null && !seen.has(value)) { seen.add(value); for (const item of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[item], seen); Object.freeze(value); } return value; }
