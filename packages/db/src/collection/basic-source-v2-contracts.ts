export const BASIC_RAW_CAPTURE_V2_SCHEMA_VERSION =
  "basic-country-raw-capture/v2" as const;
export const BASIC_RAW_CAPTURE_MAX_BYTES_V2 = 10 * 1024 * 1024;
export const BASIC_SOURCE_MAX_REDIRECTS_V2 = 3;

export type BasicSourceAcceptV2 =
  | "application/json"
  | "text/csv"
  | "text/html"
  | "application/pdf";

export interface BasicSourceRequestV2 {
  readonly method: "GET";
  readonly url: string;
  readonly accept: BasicSourceAcceptV2;
  readonly allowedOrigins: readonly string[];
  readonly allowedQueryParameters: readonly string[];
}

export interface BasicSourceTransportResponseV2 {
  readonly status: number;
  readonly finalUrl: string;
  readonly contentType: string;
  readonly retrievedAt: string;
  readonly redirectChain: readonly string[];
  readonly body: AsyncIterable<Uint8Array>;
}

export interface BasicSourceTransportV2 {
  execute(
    request: BasicSourceRequestV2,
  ): Promise<BasicSourceTransportResponseV2>;
}

export interface BasicRawCaptureInputV2 {
  readonly repoRoot: string;
  readonly countryCode: string;
  readonly runId: string;
  readonly catalogVersion: string;
  readonly catalogSha256: string;
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly sourceId: string;
  readonly request: BasicSourceRequestV2;
}

export interface BasicRawCaptureReceiptV2 {
  readonly sourceId: string;
  readonly contentSha256: string;
  readonly byteLength: number;
  readonly reused: boolean;
}

export interface BasicRawCaptureResultV2 extends BasicRawCaptureReceiptV2 {
  readonly body: Uint8Array;
  readonly finalUrl: string;
  readonly redirectChain: readonly string[];
  readonly contentType: string;
  readonly retrievedAt: string;
}

export interface BasicRawCaptureManifestV2 {
  readonly schemaVersion: typeof BASIC_RAW_CAPTURE_V2_SCHEMA_VERSION;
  readonly countryCode: string;
  readonly runId: string;
  readonly catalogVersion: string;
  readonly catalogSha256: string;
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly sourceId: string;
  readonly request: {
    readonly method: "GET";
    readonly url: string;
    readonly accept: BasicSourceAcceptV2;
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
