# P1-6B Deterministic Source Adapters Design

**Status:** Approved after independent review with no Critical, Important, or Minor findings.

## Goal

Build a country-neutral, reproducible path from approved structured HTTPS sources to:

1. immutable local raw captures under `.cache/basic-country/<ISO2>/<runId>/raw/`;
2. exact P1-6A `BasicSourceRecord` entries; and
3. deterministic `BasicExtractedFact` evidence with raw value, normalized value, unit, year, and locator.

This slice does not create a bilingual market draft, publish canonical data, call Hermes or llama.cpp, or select a country for rollout.

## Chosen Approach

Use typed, source-specific adapters behind an injected transport and a shared capture runner.

Each adapter owns only source knowledge: request URL, accepted media type, source identity, and deterministic parsing. The runner owns cross-source invariants: HTTPS and origin policy, byte limits, SHA-256, cache immutability, path safety, source-register construction, fact grouping, and conflict preservation.

Two reusable World Bank adapters prove the boundary without adding real country data:

- country profile: ISO code and English country name;
- WDI core indicators: population, current-US-dollar GDP, and GDP growth.

The World Bank V2 API is unauthenticated, supports JSON, ISO country queries, most-recent non-empty values, and multiple indicator codes. The implementation follows the official documentation:

- https://datahelpdesk.worldbank.org/knowledgebase/articles/889392
- https://datahelpdesk.worldbank.org/knowledgebase/articles/898581-api-basic-call-structures
- https://datahelpdesk.worldbank.org/knowledgebase/articles/898590-country-api-queries

## Alternatives Considered

### Declarative selector DSL

A JSON-pointer mapping file would reduce adapter code, but it would create a new mini-language for selection, conversion, null handling, and conflict semantics. That language would need its own schema and security review. It is not justified for two initial source shapes.

### One generic collector

A single collector with source and country branches would be quick to start, but it would mix transport, provenance, and source parsing. It would also invite country-specific conditions, contrary to the shared-model rule.

### Direct Hermes collection

Hermes is intentionally deferred to P1-6C. Search and browser discovery cannot replace deterministic source evidence, and model output cannot be the source of truth.

## Public Interfaces

```ts
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

export async function runBasicDeterministicSourceAdapters(
  input: BasicSourceAdapterRunInput,
): Promise<BasicSourceAdapterRunResult>;
```

The runner sets every source record to `accessStatus = "open"` and `discoveryOnly = false`; P1-6B adapters cannot override those fields. The result contains `BasicSourceRegister`, `BasicExtractedFacts`, and cache receipts. A receipt contains only `sourceId`, `contentSha256`, `byteLength`, and `reused`; it never exposes a cache path to audit or canonical data.

## Raw Capture Contract

The local-only schema version is `basic-country-raw-capture/v1`. Each source is stored under:

```text
.cache/basic-country/<ISO2>/<runId>/raw/<sourceId>/
  <contentSha256>.bin
  capture.json
```

`capture.json` is an exact-key object with this shape:

```ts
interface BasicRawCaptureManifest {
  schemaVersion: "basic-country-raw-capture/v1";
  countryCode: string;
  runId: string;
  adapterId: string;
  adapterVersion: string;
  sourceId: string;
  request: {
    method: "GET";
    url: string;
    accept: string;
    allowedOrigins: string[];
    allowedQueryParameters: string[];
  };
  response: {
    status: number;
    finalUrl: string;
    redirectChain: string[];
    contentType: string;
    retrievedAt: string;
    byteLength: number;
    contentSha256: string;
  };
}
```

It contains no arbitrary request headers, credentials, cookies, authorization values, canonical values, review status, or AI flags. Every nested object is reconstructed from exact own keys, strict scalar values, and standard JSON arrays before cache reuse.

The SHA-256 covers the exact bytes delivered by the transport after HTTP transfer decoding and before parsing, text decoding, or JSON reserialization. The maximum captured body is 10 MiB. Cache files use local restrictive permissions.

The cache is immutable per `(countryCode, runId, sourceId)`. If a valid manifest exists, the runner re-reads and re-hashes the content-addressed payload and does not call the transport. Cache reuse requires exact equality of country/run/source IDs, adapter ID/version, GET URL, Accept value, sorted origin allowlist, sorted query-parameter allowlist, status, final URL, redirect chain, content type, payload filename, byte count, and hash. A malformed manifest, a final payload without a manifest, or any mismatch fails closed. Refreshing a source requires a new `runId`.

Writes use an exclusive temporary file followed by no-clobber atomic publication. Concurrent writers with identical bytes converge on one verified capture; a different payload for the same identity fails. Orphan `.tmp-*` files are ignored and never treated as captures, while a published payload without `capture.json` is an invalid partial capture. Existing symlinks anywhere below the raw-cache root are rejected. Absolute paths, traversal segments, unsafe IDs, and NUL or backslash separators are rejected before transport execution.

## Network Boundary

Production transport accepts HTTPS only, rejects URL credentials, and requires the requested and every redirect origin to appear in the adapter request's exact origin allowlist. Redirects are manual, same-policy, and limited to three. Only successful 2xx responses with an adapter-accepted JSON content type are capturable.

Every adapter declares an exact, case-sensitive `allowedQueryParameters` list. The requested URL and every redirect may contain only those names, each name at most once; all other names are rejected before transport continuation. The World Bank country adapter allows only `format`; each World Bank indicator adapter allows only `source`, `format`, `mrv`, and `per_page`. Adding a future query name requires a reviewed adapter code change, so unreviewed credential parameters cannot be persisted. Errors identify only the failed rule and do not echo a URL, query, response body, parameter value, or secret.

`captureBasicRawSource()` is the sole response-body consumer and enforces the 10 MiB limit while collecting the async stream and computing SHA-256, regardless of `Content-Length`. The transport validates URL, redirect, status, and MIME policy but does not consume or size the stream. Tests use an injected fetch implementation and never access the network.

## Materialization Rules

The source register preserves the original requested URL in `sourceUrl`; final URL and redirects remain in local `capture.json` because P1-6A has no committed final-URL field. `contentSha256` comes only from the verified raw payload.

Every observation must use a P1-6A allowlisted canonical field path and a non-empty locator. The runner reconstructs raw and normalized values as strict finite JSON values, rejects unknown paths and unsafe values, and requires every fact locator to be present in its source record's `evidenceLocators`.

An adapter output with zero observations is rejected and produces no source-register result. A null WDI record is omitted, but a source run in which every supported record is null fails as observation-free; the already captured raw bytes remain local for diagnosis.

Observations are grouped by field path in stable lexical order. Equality and conflict use the tuple `(normalizedValue, unit, year)`, where JSON objects compare by recursively sorted own keys, arrays preserve order, numbers use `Object.is`, and all other scalars compare by type and value:

- Equal tuples from one or more `sourceId` values produce one `candidate` fact with all evidence.
- Differing tuples from at least two distinct `sourceId` values produce one `conflict` fact with all evidence, even when only unit or year differs.
- Differing tuples within one `sourceId` are malformed adapter output and fail closed; the runner neither selects a value nor fabricates another source.
- Every `conflict` fact therefore contains evidence from at least two distinct `sourceId` values.
- every emitted fact uses `extractionMethod = "deterministic"`.

Evidence is sorted by `sourceId`, `locator`, canonical raw JSON, canonical normalized JSON, unit (`null` before text), then year (`null` before number). A fact's `uncertainty` is the lexically sorted set of distinct non-null, trimmed observation uncertainties joined with `" | "`, or `null` when the set is empty. The exact fact ID is `fact-` plus the first 16 lowercase hexadecimal characters of SHA-256 over the UTF-8 field path. Duplicate adapter source IDs are rejected before any cache or network work.

## World Bank Adapters

The country-profile adapter requests exactly `https://api.worldbank.org/v2/country/<ISO2>?format=json` with the uppercase ISO2 code and emits only evidence it can deterministically support: `country.code` and `country.name`. The English source name becomes `{ zh: "", en: value }`, preserving the existing localized fallback rule without inventing a translation. The response metadata must say page 1 of 1 and total 1, and the sole country record must contain the requested `iso2Code`.

The WDI implementation exports three source adapters, one per indicator. Their request URLs are exactly:

```text
https://api.worldbank.org/v2/country/<ISO2>/indicator/SP.POP.TOTL?source=2&format=json&mrv=1&per_page=1
https://api.worldbank.org/v2/country/<ISO2>/indicator/NY.GDP.MKTP.CD?source=2&format=json&mrv=1&per_page=1
https://api.worldbank.org/v2/country/<ISO2>/indicator/NY.GDP.MKTP.KD.ZG?source=2&format=json&mrv=1&per_page=1
```

The uppercase ISO2 code, query parameter order, source 2, and `per_page=1` are fixed. Each response metadata object must contain `page = 1`, `pages = 1`, `per_page = 1`, `total = 1`, `sourceid = "2"`, and a `lastupdated` date. Pagination is not silently ignored. The sole data record must identify the adapter's requested indicator and ISO2 country.

| Indicator | Canonical path | Unit |
|---|---|---|
| `SP.POP.TOTL` | `marketOverview.population` | `people` |
| `NY.GDP.MKTP.CD` | `marketOverview.gdp` | `current US$` |
| `NY.GDP.MKTP.KD.ZG` | `marketOverview.gdpGrowth` | `%` |

Each record's exact `value`, including `null`, is the raw value. A finite number remains the normalized value and `null` remains `null`; the four-digit `date` supplies the year. A missing or second data record is rejected. The API `lastupdated` field is not treated as `publishedAt`; absent an explicit publication timestamp, `publishedAt` remains `null`.

## Recorded World Bank Fixtures

Task 3 commits four offline fixture envelopes under `packages/db/fixtures/source-adapters/`. Each envelope records `requestUrl`, `recordedAt = "2026-07-10T09:40:00Z"`, `contentSha256`, and `bodyBase64`. Decoding `bodyBase64` must reproduce the exact response bytes and hash observed from the official API; tests never refetch them.

| Fixture | Required response metadata | SHA-256 |
|---|---|---|
| `world-bank-country-vn.json` | `page=1`, `pages=1`, `per_page="50"`, `total=1` | `7ddd064eb77613024ad050f7b885a61c239c01692ec59ef4b352ed100f2b7525` |
| `world-bank-population-vn.json` | `page=1`, `pages=1`, `per_page=1`, `total=1`, `sourceid="2"`, `lastupdated="2026-07-01"` | `4f1ca6321f935f15850e5ada927c7d6f4a2a2d43b44a3c52b8d85cb899681cdd` |
| `world-bank-gdp-vn.json` | same source-2 metadata | `8fb1bd9738f682a7ac2e5cadf36afa6565687f30df51355b7cfb3afc4f182386` |
| `world-bank-gdp-growth-vn.json` | same source-2 metadata | `b8360f2686bf2de0706bd454be394736912f6f91fa199e257089a867e1dcb483` |

The exact `bodyBase64` values are:

```text
world-bank-country-vn.json:
W3sicGFnZSI6MSwicGFnZXMiOjEsInBlcl9wYWdlIjoiNTAiLCJ0b3RhbCI6MX0sW3siaWQiOiJWTk0iLCJpc28yQ29kZSI6IlZOIiwibmFtZSI6IlZpZXQgTmFtIiwicmVnaW9uIjp7ImlkIjoiRUFTIiwiaXNvMmNvZGUiOiJaNCIsInZhbHVlIjoiRWFzdCBBc2lhICYgUGFjaWZpYyJ9LCJhZG1pbnJlZ2lvbiI6eyJpZCI6IkVBUCIsImlzbzJjb2RlIjoiNEUiLCJ2YWx1ZSI6IkVhc3QgQXNpYSAmIFBhY2lmaWMgKGV4Y2x1ZGluZyBoaWdoIGluY29tZSkifSwiaW5jb21lTGV2ZWwiOnsiaWQiOiJVTUMiLCJpc28yY29kZSI6IlhUIiwidmFsdWUiOiJVcHBlciBtaWRkbGUgaW5jb21lIn0sImxlbmRpbmdUeXBlIjp7ImlkIjoiSUJEIiwiaXNvMmNvZGUiOiJYRiIsInZhbHVlIjoiSUJSRCJ9LCJjYXBpdGFsQ2l0eSI6Ikhhbm9pIiwibG9uZ2l0dWRlIjoiMTA1LjgyNSIsImxhdGl0dWRlIjoiMjEuMDA2OSJ9XV0=

world-bank-population-vn.json:
W3sicGFnZSI6MSwicGFnZXMiOjEsInBlcl9wYWdlIjoxLCJ0b3RhbCI6MSwic291cmNlaWQiOiIyIiwibGFzdHVwZGF0ZWQiOiIyMDI2LTA3LTAxIn0sW3siaW5kaWNhdG9yIjp7ImlkIjoiU1AuUE9QLlRPVEwiLCJ2YWx1ZSI6IlBvcHVsYXRpb24sIHRvdGFsIn0sImNvdW50cnkiOnsiaWQiOiJWTiIsInZhbHVlIjoiVmlldCBOYW0ifSwiY291bnRyeWlzbzNjb2RlIjoiVk5NIiwiZGF0ZSI6IjIwMjUiLCJ2YWx1ZSI6MTAxNTk4NTI3LCJ1bml0IjoiIiwib2JzX3N0YXR1cyI6IiIsImRlY2ltYWwiOjB9XV0=

world-bank-gdp-vn.json:
W3sicGFnZSI6MSwicGFnZXMiOjEsInBlcl9wYWdlIjoxLCJ0b3RhbCI6MSwic291cmNlaWQiOiIyIiwibGFzdHVwZGF0ZWQiOiIyMDI2LTA3LTAxIn0sW3siaW5kaWNhdG9yIjp7ImlkIjoiTlkuR0RQLk1LVFAuQ0QiLCJ2YWx1ZSI6IkdEUCAoY3VycmVudCBVUyQpIn0sImNvdW50cnkiOnsiaWQiOiJWTiIsInZhbHVlIjoiVmlldCBOYW0ifSwiY291bnRyeWlzbzNjb2RlIjoiVk5NIiwiZGF0ZSI6IjIwMjUiLCJ2YWx1ZSI6NTE0Njk3MjE1MTY1LjA2NSwidW5pdCI6IiIsIm9ic19zdGF0dXMiOiIiLCJkZWNpbWFsIjowfV1d

world-bank-gdp-growth-vn.json:
W3sicGFnZSI6MSwicGFnZXMiOjEsInBlcl9wYWdlIjoxLCJ0b3RhbCI6MSwic291cmNlaWQiOiIyIiwibGFzdHVwZGF0ZWQiOiIyMDI2LTA3LTAxIn0sW3siaW5kaWNhdG9yIjp7ImlkIjoiTlkuR0RQLk1LVFAuS0QuWkciLCJ2YWx1ZSI6IkdEUCBncm93dGggKGFubnVhbCAlKSJ9LCJjb3VudHJ5Ijp7ImlkIjoiVk4iLCJ2YWx1ZSI6IlZpZXQgTmFtIn0sImNvdW50cnlpc28zY29kZSI6IlZOTSIsImRhdGUiOiIyMDI1IiwidmFsdWUiOjguMDE4ODI5OTg5NzgyNDUsInVuaXQiOiIiLCJvYnNfc3RhdHVzIjoiIiwiZGVjaW1hbCI6MX1dXQ==
```

The recorded values are test evidence only, not canonical Vietnam data. The fixtures preserve `Viet Nam`, population `101598527`, GDP `514697215165.065`, GDP growth `8.01882998978245`, and year `2025` exactly as returned. Adapter tests decode the bodies, verify the hashes, and then parse those bytes.

## Error Handling

All validation is fail-closed and path-specific. A transport or adapter error returns no source register or facts for the run. Raw files may exist locally after a later adapter fails, but staging and canonical data are not written by this API.

Malformed JSON, unexpected response envelopes, mismatched country codes, duplicate indicators, non-finite values, invalid years, unknown field paths, unsupported MIME types, unsafe redirects, content overflow, and cache tampering all throw deterministic errors without including payload contents, URLs, query strings, or secrets.

## Test Strategy

- known-byte SHA-256 and one-byte tamper detection;
- path traversal, invalid identifiers, and symlink rejection before transport;
- immutable cache reuse and no transport call on a valid cache hit, including exact manifest invariants, malformed and partial captures, orphan temporary files, and concurrent no-clobber publication;
- HTTPS, credentials, secret query names, origin allowlist, redirect limit, status, MIME, byte-limit, and error-redaction tests;
- recorded, hash-verified World Bank country and WDI response fixtures plus synthetic malformed and null variants;
- exact raw versus normalized values, units, years, locators, and stable ordering;
- equal-evidence merge and conflict retention without automatic selection;
- locator-to-source-register membership and duplicate field-path validation;
- serialization checks proving `.cache`, raw payloads, capture manifests, and sentinels cannot enter import plans;
- root lint, typecheck, and unit tests. Web E2E is not required because P1-6B has no Web behavior.

## Out Of Scope

- CSV, ZIP, PDF, HTML, browser scraping, or a third-party parser;
- real-country canonical files or a pilot-country decision;
- Hermes, SearXNG, browser orchestration, or llama.cpp;
- bilingual drafting, review-report generation, publication, AI use, permissions, or billing;
- Prisma, migrations, `docs/data-schema.md`, or the P1-6A committed schema version.
