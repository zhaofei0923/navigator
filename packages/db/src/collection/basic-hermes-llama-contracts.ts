export const BASIC_HERMES_DISCOVERY_SCHEMA_VERSION =
  "basic-hermes-discovery/v1" as const;
export const BASIC_HERMES_DISCOVERY_TIMEOUT_MS = 300_000;
export const BASIC_HERMES_DISCOVERY_MAX_QUERIES = 20;
export const BASIC_HERMES_DISCOVERY_MAX_RESULTS = 50;

export interface BasicHermesDiscoveryRequest {
  countryCode: string;
  runId: string;
  queries: readonly string[];
  maxResults: number;
}

export interface BasicHermesDiscoveryPort {
  discover(
    request: BasicHermesDiscoveryRequest,
    signal: AbortSignal,
  ): Promise<unknown>;
}

export interface BasicHermesDiscoveryCandidate {
  discoveryId: string;
  provider: "searxng";
  query: string;
  title: string;
  snippet: string;
  url: string;
  discoveredAt: string;
  discoveryOnly: true;
}

export interface BasicHermesDiscoveryBatch {
  schemaVersion: typeof BASIC_HERMES_DISCOVERY_SCHEMA_VERSION;
  runId: string;
  countryCode: string;
  candidates: readonly BasicHermesDiscoveryCandidate[];
}

export type BasicBridgeErrorCode =
  | "INPUT_INVALID"
  | "HERMES_TIMEOUT"
  | "HERMES_UNAVAILABLE"
  | "HERMES_RESPONSE_INVALID"
  | "SEARXNG_RECORD_INVALID"
  | "DISCOVERY_URL_FORBIDDEN"
  | "ORIGINAL_SOURCE_REQUIRED"
  | "SOURCE_CAPTURE_INVALID"
  | "EVIDENCE_INVALID"
  | "EVIDENCE_UNTRUSTED"
  | "DRAFT_INPUT_BLOCKED"
  | "LLAMA_TIMEOUT"
  | "LLAMA_UNAVAILABLE"
  | "LLAMA_RESPONSE_INVALID"
  | "LLAMA_OUTPUT_NOT_JSON"
  | "LLAMA_OUTPUT_INCOMPLETE"
  | "LLAMA_OUTPUT_SCHEMA_INVALID"
  | "LLAMA_OUTPUT_UNGROUNDED"
  | "DRAFT_LOCK_VIOLATION";

export type BasicBridgePhase =
  | "input"
  | "hermes"
  | "source"
  | "evidence"
  | "llama"
  | "draft";

export interface BasicBridgeFailure {
  code: BasicBridgeErrorCode;
  phase: BasicBridgePhase;
  retryable: boolean;
}

export type BasicBridgeResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: BasicBridgeFailure };
