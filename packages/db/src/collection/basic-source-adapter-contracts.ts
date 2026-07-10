import type { Credibility } from "@navigator/shared-types/schema";

import type {
  BasicCollectionJsonValue,
  BasicExtractedFacts,
  BasicPromptInjectionRisk,
  BasicSourceFamily,
  BasicSourceRegister,
} from "./basic-collection-contracts.js";

export const BASIC_RAW_CAPTURE_SCHEMA_VERSION =
  "basic-country-raw-capture/v1" as const;
export const BASIC_RAW_CAPTURE_MAX_BYTES = 10 * 1024 * 1024;
export const BASIC_SOURCE_MAX_REDIRECTS = 3;

export interface BasicSourceRequest {
  method: "GET";
  url: string;
  accept: string;
  allowedOrigins: readonly string[];
  allowedQueryParameters: readonly string[];
}

export interface BasicSourceTransportResponse {
  status: number;
  finalUrl: string;
  contentType: string;
  retrievedAt: string;
  redirectChain: readonly string[];
  body: AsyncIterable<Uint8Array>;
}

export interface BasicSourceTransport {
  execute(request: BasicSourceRequest): Promise<BasicSourceTransportResponse>;
}

export interface BasicDeterministicObservation {
  fieldPath: string;
  locator: string;
  rawValue: BasicCollectionJsonValue;
  normalizedValue: BasicCollectionJsonValue;
  unit: string | null;
  year: number | null;
  uncertainty: string | null;
}

export interface BasicDeterministicAdapterOutput {
  publishedAt: string | null;
  promptInjectionRisk: BasicPromptInjectionRisk;
  accessNotes: string | null;
  observations: readonly BasicDeterministicObservation[];
}

export interface BasicDeterministicAdapterInput {
  countryCode: string;
  requestUrl: string;
  finalUrl: string;
  contentType: string;
  retrievedAt: string;
  body: Uint8Array;
}

export interface BasicDeterministicSourceAdapter {
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly sourceId: string;
  readonly sourceName: string;
  readonly sourceFamily: BasicSourceFamily;
  readonly credibility: Credibility;
  request(countryCode: string): BasicSourceRequest;
  extract(input: BasicDeterministicAdapterInput): BasicDeterministicAdapterOutput;
}

export interface BasicRawCaptureReceipt {
  sourceId: string;
  contentSha256: string;
  byteLength: number;
  reused: boolean;
}

export interface BasicRawCaptureResult extends BasicRawCaptureReceipt {
  body: Uint8Array;
  finalUrl: string;
  readonly redirectChain: readonly string[];
  contentType: string;
  retrievedAt: string;
}

export interface BasicRawCaptureManifest {
  readonly schemaVersion: typeof BASIC_RAW_CAPTURE_SCHEMA_VERSION;
  readonly countryCode: string;
  readonly runId: string;
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly sourceId: string;
  readonly request: {
    readonly method: "GET";
    readonly url: string;
    readonly accept: string;
    readonly allowedOrigins: readonly string[];
    readonly allowedQueryParameters: readonly string[];
  };
  readonly response: {
    readonly status: number;
    readonly finalUrl: string;
    readonly redirectChain: readonly string[];
    readonly contentType: string;
    readonly retrievedAt: string;
    readonly byteLength: number;
    readonly contentSha256: string;
  };
}

export interface BasicRawCaptureInput {
  repoRoot: string;
  countryCode: string;
  runId: string;
  adapterId: string;
  adapterVersion: string;
  sourceId: string;
  request: BasicSourceRequest;
}

export interface BasicSourceAdapterRunInput {
  repoRoot: string;
  countryCode: string;
  runId: string;
  adapters: readonly BasicDeterministicSourceAdapter[];
  transport: BasicSourceTransport;
}

export interface BasicSourceAdapterRunResult {
  sourceRegister: BasicSourceRegister;
  extractedFacts: BasicExtractedFacts;
  receipts: BasicRawCaptureReceipt[];
}
