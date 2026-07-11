import { isAbsolute } from "node:path";

import { CREDIBILITIES, INDUSTRY_TAGS, TECH_TAGS } from "@navigator/shared-types/schema";

import { SAFE_COUNTRY_DIRECTORY, SAFE_RUN_ID } from "../seed/basic-country-validation-utils.js";
import {
  BASIC_COLLECTION_REQUIRED_STATIC_FACT_PATHS,
  type BasicCollectionJsonValue,
  type BasicInjectionRisk,
  type BasicSourceCheck,
} from "./basic-collection-contracts.js";
import type {
  BasicHermesDiscoveryRequest,
  BasicHermesSourcePolicy,
  BasicLlamaCppFetch,
} from "./basic-hermes-llama-contracts.js";
import { canonicalBasicHermesDiscoveryUrl } from "./basic-hermes-discovery.js";
import { snapshotBasicOfflineValue } from "./basic-offline-value.js";
import type { BasicSourceFetch } from "./basic-source-transport.js";

export const BASIC_COUNTRY_CANDIDATE_SCHEMA_VERSION = "basic-country-candidate/v1" as const;
export const BASIC_COUNTRY_CANDIDATE_ARTIFACTS = Object.freeze([
  "source-register.json",
  "extracted-facts.json",
  "market-overview.draft.json",
  "review-report.json",
] as const);

const CONFIG_KEYS = ["schemaVersion", "countryCode", "countryDirectory", "runId", "discoveryRequest", "openedSources", "sourceChecks", "injectionRisks", "llama"] as const;
const INPUT_KEYS = ["config", "discoveryResponse"] as const;
const DISCOVERY_KEYS = ["countryCode", "runId", "queries", "maxResults"] as const;
const OPENED_KEYS = ["discoveryId", "policy", "observations"] as const;
const POLICY_KEYS = ["sourceId", "sourceName", "sourceUrl", "sourceFamily", "credibility", "accessStatus", "accessNotes", "publishedAt", "promptInjectionRisk", "approvedOrigins", "allowedQueryParameters"] as const;
const OBSERVATION_KEYS = ["fieldPath", "locator", "normalizedValue", "unit", "year", "uncertainty"] as const;
const CHECK_KEYS = ["sourceId", "status", "notes"] as const;
const RISK_KEYS = ["sourceId", "locator", "severity", "details"] as const;
const LLAMA_KEYS = ["baseUrl", "model"] as const;
const SOURCE_FAMILIES = ["international-organization", "official-statistics", "government", "energy-authority", "regulator", "grid-operator", "industry-association", "verified-research"] as const;
const PROTECTED_PATHS = new Set(["country.code", "country.name", "marketOverview.population", "marketOverview.gdp", "marketOverview.gdpGrowth"]);
const STATIC_PATHS = new Set<string>(BASIC_COLLECTION_REQUIRED_STATIC_FACT_PATHS);
const INDICATOR_PATH = /^marketOverview\.keyIndicators\[(?:0|[1-9]\d*)\]\.(?:label|value|unit|year)$/;
const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_QUERY = /^[A-Za-z][A-Za-z0-9_-]*$/;

export interface OpenedJsonSourcePlan {
  discoveryId: string;
  policy: BasicHermesSourcePolicy;
  observations: Array<{
    fieldPath: string;
    locator: `json:${string}`;
    normalizedValue: BasicCollectionJsonValue;
    unit: string | null;
    year: number | null;
    uncertainty: string | null;
  }>;
}

export interface BasicCountryCandidateConfig {
  schemaVersion: typeof BASIC_COUNTRY_CANDIDATE_SCHEMA_VERSION;
  countryCode: string;
  countryDirectory: string;
  runId: string;
  discoveryRequest: BasicHermesDiscoveryRequest;
  openedSources: OpenedJsonSourcePlan[];
  sourceChecks: BasicSourceCheck[];
  injectionRisks: BasicInjectionRisk[];
  llama: { baseUrl: string; model: string };
}

export interface BasicCountryCandidateRuntime {
  repositoryRoot: string;
  outputRoot: string;
  sourceFetch: BasicSourceFetch;
  llamaFetch: BasicLlamaCppFetch;
}

export type BasicCountryCandidateErrorCode = "INPUT_INVALID" | "DISCOVERY_REJECTED" | "SOURCE_CAPTURE_FAILED" | "EVIDENCE_REJECTED" | "PREFLIGHT_BLOCKED" | "DRAFT_FAILED" | "AUDIT_INVALID" | "OUTPUT_REJECTED";
export type BasicCountryCandidateResult =
  | { ok: true; code: "READY_FOR_HUMAN_REVIEW"; summary: CandidateSummary & { readyForHumanReview: true }; artifacts: typeof BASIC_COUNTRY_CANDIDATE_ARTIFACTS }
  | { ok: false; code: BasicCountryCandidateErrorCode; summary: { countryCode: string; runId: string; sourceCount: 0; factCount: 0; readyForHumanReview: false }; artifacts: null };
interface CandidateSummary { countryCode: string; runId: string; sourceCount: number; factCount: number }
export interface ParsedBasicCountryCandidateInput { config: BasicCountryCandidateConfig; discoveryResponse: BasicCollectionJsonValue }

export function parseBasicCountryCandidateInput(value: unknown): ParsedBasicCountryCandidateInput | null {
  const snapshot = snapshotBasicOfflineValue(value);
  if (!snapshot.valid) return null;
  const input = exact(snapshot.data, INPUT_KEYS);
  if (input === null) return null;
  const config = parseConfig(input.config);
  const discovery = snapshotBasicOfflineValue(input.discoveryResponse);
  return config === null || !discovery.valid ? null : { config, discoveryResponse: discovery.data };
}

export function isBasicCountryCandidateRuntime(value: unknown): value is BasicCountryCandidateRuntime {
  if (typeof value !== "object" || value === null) return false;
  try {
    const runtime = value as Partial<BasicCountryCandidateRuntime>;
    return typeof runtime.repositoryRoot === "string" && isAbsolute(runtime.repositoryRoot) && !runtime.repositoryRoot.includes("\0") &&
      typeof runtime.outputRoot === "string" && isAbsolute(runtime.outputRoot) && !runtime.outputRoot.includes("\0") &&
      typeof runtime.sourceFetch === "function" && typeof runtime.llamaFetch === "function";
  } catch { return false; }
}

function parseConfig(value: unknown): BasicCountryCandidateConfig | null {
  const item = exact(value, CONFIG_KEYS);
  if (item === null || item.schemaVersion !== BASIC_COUNTRY_CANDIDATE_SCHEMA_VERSION || !iso2(item.countryCode) ||
    !text(item.countryDirectory) || !SAFE_COUNTRY_DIRECTORY.test(item.countryDirectory) || !text(item.runId) || !SAFE_RUN_ID.test(item.runId)) return null;
  const discoveryRequest = parseDiscovery(item.discoveryRequest, item.countryCode, item.runId);
  const openedValues = array(item.openedSources, 20);
  const checkValues = array(item.sourceChecks, 100);
  const riskValues = array(item.injectionRisks, 100);
  const llama = parseLlama(item.llama);
  if (discoveryRequest === null || openedValues === null || checkValues === null || riskValues === null || llama === null) return null;
  const openedSources: OpenedJsonSourcePlan[] = [];
  const discoveryIds = new Set<string>();
  const sourceIds = new Set<string>();
  const paths = new Set<string>();
  for (const opened of openedValues) {
    const parsed = parseOpened(opened);
    if (parsed === null || discoveryIds.has(parsed.discoveryId) || sourceIds.has(parsed.policy.sourceId)) return null;
    for (const observation of parsed.observations) {
      if (PROTECTED_PATHS.has(observation.fieldPath) || paths.has(observation.fieldPath)) return null;
      paths.add(observation.fieldPath);
    }
    discoveryIds.add(parsed.discoveryId); sourceIds.add(parsed.policy.sourceId); openedSources.push(parsed);
  }
  const sourceChecks = checkValues.map(parseCheck);
  const injectionRisks = riskValues.map(parseRisk);
  if (sourceChecks.some(isNull) || injectionRisks.some(isNull)) return null;
  return { schemaVersion: BASIC_COUNTRY_CANDIDATE_SCHEMA_VERSION, countryCode: item.countryCode, countryDirectory: item.countryDirectory, runId: item.runId,
    discoveryRequest, openedSources, sourceChecks: sourceChecks as BasicSourceCheck[], injectionRisks: injectionRisks as BasicInjectionRisk[], llama };
}

function parseDiscovery(value: unknown, countryCode: string, runId: string): BasicHermesDiscoveryRequest | null {
  const item = exact(value, DISCOVERY_KEYS); const queries = item === null ? null : array(item.queries, 20);
  if (item === null || item.countryCode !== countryCode || item.runId !== runId || queries === null || queries.length === 0 ||
    queries.some((query) => !text(query) || query.length > 256 || query !== query.trim()) || new Set(queries).size !== queries.length ||
    !integer(item.maxResults) || item.maxResults < 1 || item.maxResults > 50) return null;
  return { countryCode, runId, queries: queries as string[], maxResults: item.maxResults };
}

function parseOpened(value: unknown): OpenedJsonSourcePlan | null {
  const item = exact(value, OPENED_KEYS); if (item === null || !safeId(item.discoveryId)) return null;
  const policy = parsePolicy(item.policy); const values = array(item.observations, 200);
  if (policy === null || values === null || values.length === 0) return null;
  const observations = values.map(parseObservation);
  return observations.some(isNull) ? null : { discoveryId: item.discoveryId, policy, observations: observations as OpenedJsonSourcePlan["observations"] };
}

function parsePolicy(value: unknown): BasicHermesSourcePolicy | null {
  const p = exact(value, POLICY_KEYS); if (p === null || !safeId(p.sourceId) || !text(p.sourceName) || !httpsUrl(p.sourceUrl) ||
    !includes(SOURCE_FAMILIES, p.sourceFamily) || !includes(CREDIBILITIES, p.credibility) || p.credibility === "UNVERIFIED" || p.accessStatus !== "open" ||
    !nullableText(p.accessNotes) || !nullableTimestamp(p.publishedAt) || p.promptInjectionRisk !== "none") return null;
  const origins = array(p.approvedOrigins, 20); const query = array(p.allowedQueryParameters, 30);
  if (origins === null || origins.length === 0 || query === null || origins.some((v) => !origin(v)) || query.some((v) => !text(v) || !SAFE_QUERY.test(v)) ||
    new Set(origins).size !== origins.length || new Set(query).size !== query.length || !allowedPolicyUrl(p.sourceUrl, origins as string[], query as string[])) return null;
  return { sourceId: p.sourceId, sourceName: p.sourceName, sourceUrl: p.sourceUrl, sourceFamily: p.sourceFamily, credibility: p.credibility,
    accessStatus: "open", accessNotes: p.accessNotes, publishedAt: p.publishedAt, promptInjectionRisk: "none", approvedOrigins: origins as string[], allowedQueryParameters: query as string[] };
}

function parseObservation(value: unknown): OpenedJsonSourcePlan["observations"][number] | null {
  const o = exact(value, OBSERVATION_KEYS);
  if (o === null || !text(o.fieldPath) || !(STATIC_PATHS.has(o.fieldPath) || INDICATOR_PATH.test(o.fieldPath)) || !pointer(o.locator) ||
    !json(o.normalizedValue) || !nullableText(o.unit) || !(o.year === null || integer(o.year)) || !nullableText(o.uncertainty) || !validTags(o.fieldPath, o.normalizedValue)) return null;
  return { fieldPath: o.fieldPath, locator: o.locator as `json:${string}`, normalizedValue: o.normalizedValue as BasicCollectionJsonValue, unit: o.unit, year: o.year, uncertainty: o.uncertainty };
}

function parseCheck(value: unknown): BasicSourceCheck | null { const c = exact(value, CHECK_KEYS); return c !== null && safeId(c.sourceId) && (c.status === "passed" || c.status === "failed") && nullableText(c.notes) ? c as unknown as BasicSourceCheck : null; }
function parseRisk(value: unknown): BasicInjectionRisk | null { const r = exact(value, RISK_KEYS); return r !== null && safeId(r.sourceId) && text(r.locator) && (r.severity === "suspected" || r.severity === "confirmed") && text(r.details) ? r as unknown as BasicInjectionRisk : null; }
function parseLlama(value: unknown): { baseUrl: string; model: string } | null { const l = exact(value, LLAMA_KEYS); if (l === null || !text(l.baseUrl) || !text(l.model) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(l.model)) return null; const match = /^http:\/\/(?:127\.0\.0\.1|\[::1\]):([1-9][0-9]{0,4})\/v1$/.exec(l.baseUrl); return match !== null && Number(match[1]) <= 65_535 ? { baseUrl: l.baseUrl, model: l.model } : null; }
function exact(value: unknown, keys: readonly string[]): Record<string, BasicCollectionJsonValue> | null { if (typeof value !== "object" || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return null; const own = Reflect.ownKeys(value); return own.length === keys.length && own.every((key) => typeof key === "string" && keys.includes(key)) ? value as Record<string, BasicCollectionJsonValue> : null; }
function array(value: unknown, max: number): BasicCollectionJsonValue[] | null { return Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype && value.length <= max ? value : null; }
function pointer(value: unknown): boolean { return typeof value === "string" && /^json:(?:|\/(?:[^~\/]|~[01])*(?:\/(?:[^~\/]|~[01])*)*)$/.test(value); }
function httpsUrl(value: unknown): value is string { try { if (!text(value) || value !== value.trim()) return false; const canonical = canonicalBasicHermesDiscoveryUrl(value); const u = new URL(value); return canonical === value && u.hash === ""; } catch { return false; } }
function origin(value: unknown): value is string { try { if (!text(value) || value !== value.trim()) return false; const url = new URL(value); const canonical = canonicalBasicHermesDiscoveryUrl(value); return canonical !== null && canonical !== "forbidden" && url.origin === value && url.username === "" && url.password === ""; } catch { return false; } }
function allowedPolicyUrl(value: string, origins: readonly string[], allowed: readonly string[]): boolean { try { const url = new URL(value); if (!origins.includes(url.origin)) return false; const seen = new Set<string>(); for (const [name] of url.searchParams) { if (!allowed.includes(name) || seen.has(name)) return false; seen.add(name); } return true; } catch { return false; } }
function nullableTimestamp(value: unknown): value is string | null { return value === null || (typeof value === "string" && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value); }
function validTags(path: string, value: unknown): boolean { if (path === "marketOverview.industryTags") return Array.isArray(value) && value.every((v) => includes(INDUSTRY_TAGS, v)); if (path === "marketOverview.techTags") return Array.isArray(value) && value.every((v) => includes(TECH_TAGS, v)); return true; }
function json(value: unknown): boolean { return snapshotBasicOfflineValue(value).valid; }
function text(value: unknown): value is string { return typeof value === "string" && value.trim() !== ""; }
function nullableText(value: unknown): value is string | null { return value === null || text(value); }
function integer(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value); }
function iso2(value: unknown): value is string { return typeof value === "string" && /^[A-Z]{2}$/.test(value); }
function safeId(value: unknown): value is string { return typeof value === "string" && SAFE_ID.test(value); }
function includes<T>(values: readonly T[], value: unknown): value is T { return values.includes(value as T); }
function isNull<T>(value: T | null): value is null { return value === null; }
