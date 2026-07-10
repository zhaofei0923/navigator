import {
  expectUtcRfc3339Timestamp,
  SAFE_RUN_ID,
} from "../seed/basic-country-validation-utils.js";
import {
  BASIC_HERMES_DISCOVERY_MAX_QUERIES,
  BASIC_HERMES_DISCOVERY_MAX_RESULTS,
  BASIC_HERMES_DISCOVERY_SCHEMA_VERSION,
  BASIC_HERMES_DISCOVERY_TIMEOUT_MS,
  type BasicBridgeErrorCode,
  type BasicBridgeFailure,
  type BasicBridgeResult,
  type BasicHermesDiscoveryBatch,
  type BasicHermesDiscoveryCandidate,
  type BasicHermesDiscoveryPort,
  type BasicHermesDiscoveryRequest,
} from "./basic-hermes-llama-contracts.js";

const REQUEST_KEYS = ["countryCode", "runId", "queries", "maxResults"] as const;
const BATCH_KEYS = ["schemaVersion", "runId", "countryCode", "candidates"] as const;
const CANDIDATE_KEYS = ["discoveryId", "provider", "query", "title", "snippet", "url", "discoveredAt", "discoveryOnly"] as const;
const MAX_PORT_PROTOTYPE_DEPTH = 16;
const MAX_DISCOVERY_ID_LENGTH = 128;
const SAFE_DISCOVERY_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

type DiscoveryMethod = BasicHermesDiscoveryPort["discover"];
type CapturedPort = (request: BasicHermesDiscoveryRequest, signal: AbortSignal) => Promise<unknown>;

export async function runBasicHermesDiscovery(
  value: unknown,
  port: unknown,
): Promise<BasicBridgeResult<BasicHermesDiscoveryBatch>> {
  const request = snapshotRequest(value);
  const discover = snapshotPort(port);
  if (request === null || discover === null) return failed("INPUT_INVALID", "input");
  return await settleDiscovery(request, discover);
}

function settleDiscovery(
  request: BasicHermesDiscoveryRequest,
  discover: CapturedPort,
): Promise<BasicBridgeResult<BasicHermesDiscoveryBatch>> {
  return new Promise((resolve) => {
    const controller = new AbortController();
    let settled = false;
    const settle = (result: BasicBridgeResult<BasicHermesDiscoveryBatch>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      try { controller.abort(); } catch { /* Abort must not replace the timeout result. */ }
      settle(failed("HERMES_TIMEOUT", "hermes"));
    }, BASIC_HERMES_DISCOVERY_TIMEOUT_MS);

    try {
      Promise.resolve(discover(request, controller.signal)).then(
        (response) => {
          if (settled) return;
          try { settle(parseBatch(response, request)); }
          catch { settle(failed("HERMES_RESPONSE_INVALID", "hermes")); }
        },
        () => settle(failed("HERMES_UNAVAILABLE", "hermes")),
      );
    } catch {
      settle(failed("HERMES_UNAVAILABLE", "hermes"));
    }
  });
}

function snapshotRequest(value: unknown): BasicHermesDiscoveryRequest | null {
  const properties = exactProperties(value, REQUEST_KEYS);
  const countryCode = properties?.get("countryCode");
  const runId = properties?.get("runId");
  const queries = denseValues(properties?.get("queries"));
  const maxResults = properties?.get("maxResults");
  if (
    typeof countryCode !== "string" || !/^[A-Z]{2}$/.test(countryCode) ||
    typeof runId !== "string" || !SAFE_RUN_ID.test(runId) ||
    queries === null || queries.length < 1 || queries.length > BASIC_HERMES_DISCOVERY_MAX_QUERIES ||
    typeof maxResults !== "number" || !Number.isSafeInteger(maxResults) ||
    maxResults < 1 || maxResults > BASIC_HERMES_DISCOVERY_MAX_RESULTS
  ) return null;
  const snapshot: string[] = [];
  for (const query of queries) {
    if (typeof query !== "string" || query.length > 256 || query.trim() === "") return null;
    if (query !== query.trim()) return null;
    snapshot.push(query);
  }
  return Object.freeze({ countryCode, runId, queries: Object.freeze(snapshot), maxResults });
}

function snapshotPort(value: unknown): CapturedPort | null {
  try {
    if ((typeof value !== "object" && typeof value !== "function") || value === null) return null;
    const target = value;
    const method = readDataMethod(target);
    if (method === null) return null;
    const captured: CapturedPort = (
      request: BasicHermesDiscoveryRequest,
      signal: AbortSignal,
    ) => Reflect.apply(method, target, [request, signal]) as Promise<unknown>;
    return Object.freeze(captured);
  } catch {
    return null;
  }
}

function readDataMethod(value: object | Function): DiscoveryMethod | null {
  let owner: object | null = value;
  const visited = new Set<object>();
  for (let depth = 0; owner !== null && depth < MAX_PORT_PROTOTYPE_DEPTH; depth += 1) {
    if (owner === Object.prototype || owner === Function.prototype || visited.has(owner)) return null;
    visited.add(owner);
    const descriptor = Object.getOwnPropertyDescriptor(owner, "discover");
    if (descriptor !== undefined) {
      return Object.hasOwn(descriptor, "value") && typeof descriptor.value === "function"
        ? descriptor.value as DiscoveryMethod : null;
    }
    owner = Object.getPrototypeOf(owner) as object | null;
  }
  return null;
}

function parseBatch(value: unknown, request: BasicHermesDiscoveryRequest): BasicBridgeResult<BasicHermesDiscoveryBatch> {
  const properties = exactProperties(value, BATCH_KEYS);
  if (properties === null) return failed("HERMES_RESPONSE_INVALID", "hermes");
  const candidates = denseValues(properties.get("candidates"));
  if (
    properties.get("schemaVersion") !== BASIC_HERMES_DISCOVERY_SCHEMA_VERSION ||
    properties.get("runId") !== request.runId || properties.get("countryCode") !== request.countryCode ||
    candidates === null || candidates.length > request.maxResults
  ) return failed("HERMES_RESPONSE_INVALID", "hermes");
  const ids = new Set<string>();
  const urls = new Set<string>();
  const snapshot: BasicHermesDiscoveryCandidate[] = [];
  for (const value of candidates) {
    const candidate = snapshotBasicHermesDiscoveryCandidate(value, request.queries);
    if ("code" in candidate) return { ok: false, error: candidate };
    if (ids.has(candidate.discoveryId) || urls.has(candidate.url)) {
      return failed("HERMES_RESPONSE_INVALID", "hermes");
    }
    ids.add(candidate.discoveryId);
    urls.add(candidate.url);
    snapshot.push(candidate);
  }
  snapshot.sort((left, right) => compareCodeUnits(left.url, right.url) ||
    compareCodeUnits(left.discoveryId, right.discoveryId));
  return { ok: true, data: Object.freeze({
    schemaVersion: BASIC_HERMES_DISCOVERY_SCHEMA_VERSION,
    runId: request.runId,
    countryCode: request.countryCode,
    candidates: Object.freeze(snapshot),
  }) };
}

export function snapshotBasicHermesDiscoveryCandidate(
  value: unknown,
  allowedQueries?: readonly string[],
): BasicHermesDiscoveryCandidate | BasicBridgeFailure {
  const properties = exactProperties(value, CANDIDATE_KEYS);
  if (properties === null) return bridgeFailure("SEARXNG_RECORD_INVALID", "hermes");
  const discoveryId = properties.get("discoveryId");
  const provider = properties.get("provider");
  const query = properties.get("query");
  const title = properties.get("title");
  const snippet = properties.get("snippet");
  const url = canonicalBasicHermesDiscoveryUrl(properties.get("url"));
  const discoveredAt = properties.get("discoveredAt");
  if (url === "forbidden") return bridgeFailure("DISCOVERY_URL_FORBIDDEN", "hermes");
  if (
    typeof discoveryId !== "string" || discoveryId.length > MAX_DISCOVERY_ID_LENGTH ||
    !SAFE_DISCOVERY_ID.test(discoveryId) || provider !== "searxng" ||
    typeof query !== "string" || (allowedQueries === undefined
      ? query.length > 256 || query.trim() === "" || query !== query.trim()
      : !allowedQueries.includes(query)) ||
    typeof title !== "string" || typeof snippet !== "string" ||
    typeof discoveredAt !== "string" || !isUtcTimestamp(discoveredAt) ||
    properties.get("discoveryOnly") !== true || url === null
  ) return bridgeFailure("SEARXNG_RECORD_INVALID", "hermes");
  return Object.freeze({ discoveryId, provider, query, title, snippet, url, discoveredAt, discoveryOnly: true });
}

function exactProperties(value: unknown, expectedKeys: readonly string[]): ReadonlyMap<string, unknown> | null {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== expectedKeys.length || ownKeys.some((key) => typeof key !== "string" || !expectedKeys.includes(key))) return null;
    const result = new Map<string, unknown>();
    for (const key of expectedKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) return null;
      result.set(key, descriptor.value);
    }
    return result;
  } catch { return null; }
}

function denseValues(value: unknown): readonly unknown[] | null {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
    const length = Object.getOwnPropertyDescriptor(value, "length");
    if (length === undefined || length.enumerable || !Object.hasOwn(length, "value") || !Number.isSafeInteger(length.value) || length.value < 0) return null;
    if (Reflect.ownKeys(value).length !== length.value + 1) return null;
    const snapshot: unknown[] = [];
    for (let index = 0; index < length.value; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) return null;
      snapshot.push(descriptor.value);
    }
    return Object.freeze(snapshot);
  } catch { return null; }
}

export function canonicalBasicHermesDiscoveryUrl(value: unknown): string | null | "forbidden" {
  if (typeof value !== "string" || value !== value.trim()) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || isForbiddenLiteralAddress(url.hostname)) return "forbidden";
    return url.href;
  } catch { return "forbidden"; }
}

function isForbiddenLiteralAddress(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "");
  const ipv4 = parseIpv4(host);
  if (ipv4 !== null) return isForbiddenIpv4(ipv4);
  const ipv6 = parseIpv6(host);
  if (ipv6 === null) return false;
  if (ipv6.every((part) => part === 0) || ipv6.slice(0, 7).every((part) => part === 0) && ipv6[7] === 1) return true;
  if ((ipv6[0]! & 0xff00) === 0xff00 || (ipv6[0]! & 0xffc0) === 0xfe80 || (ipv6[0]! & 0xfe00) === 0xfc00) return true;
  if (ipv6.slice(0, 5).every((part) => part === 0) && (ipv6[5] === 0 || ipv6[5] === 0xffff)) {
    return isForbiddenIpv4([ipv6[6]! >> 8, ipv6[6]! & 0xff, ipv6[7]! >> 8, ipv6[7]! & 0xff]);
  }
  return false;
}

function parseIpv4(value: string): readonly [number, number, number, number] | null {
  const parts = value.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) return null;
  const parsed = parts.map(Number);
  return parsed.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? [parsed[0]!, parsed[1]!, parsed[2]!, parsed[3]!]
    : null;
}

function parseIpv6(value: string): number[] | null {
  if (!value.includes(":")) return null;
  const sections = value.split("::");
  if (sections.length > 2) return null;
  const parseSide = (side: string): number[] | null => side === "" ? [] : side.split(":").map((part) => /^[0-9a-fA-F]{1,4}$/.test(part) ? Number.parseInt(part, 16) : Number.NaN);
  const left = parseSide(sections[0]!);
  const right = parseSide(sections[1] ?? "");
  if (left === null || right === null || left.some(Number.isNaN) || right.some(Number.isNaN)) return null;
  if (sections.length === 1) return left.length === 8 ? left : null;
  const missing = 8 - left.length - right.length;
  return missing >= 1 ? [...left, ...Array<number>(missing).fill(0), ...right] : null;
}

function isForbiddenIpv4([first, second]: readonly [number, number, number, number]): boolean {
  return first === 0 || first === 10 || first === 127 || first >= 224 ||
    first === 169 && second === 254 || first === 172 && second >= 16 && second <= 31 ||
    first === 192 && second === 168;
}

function isUtcTimestamp(value: string): boolean {
  const errors: string[] = [];
  expectUtcRfc3339Timestamp(value, "discoveredAt", errors);
  return errors.length === 0;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function bridgeFailure(code: BasicBridgeErrorCode, phase: "input" | "hermes"): BasicBridgeFailure {
  return { code, phase, retryable: code === "HERMES_TIMEOUT" || code === "HERMES_UNAVAILABLE" };
}

function failed<T>(code: BasicBridgeErrorCode, phase: "input" | "hermes"): BasicBridgeResult<T> {
  return { ok: false, error: bridgeFailure(code, phase) };
}
