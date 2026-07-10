# P1-6C Hermes Discovery and llama.cpp Draft Bridge Design

## 1. Scope

P1-6C adds a country-neutral, fail-closed bridge between the existing P1-6B source runtime and the P1-6A audit contract. It has three public operations:

1. `runBasicHermesDiscovery()` validates transient SearXNG candidates returned by an injected Hermes port.
2. `promoteBasicHermesJsonEvidence()` proves that Hermes observations came from P1-6B-captured JSON and merges them with deterministic evidence.
3. `bridgeBasicMarketOverviewDraft()` sends an already grounded expected draft through an injected llama.cpp transport and accepts only a schema-valid, exactly grounded result.

The normative behavior is defined in `docs/basic-country-hermes-llama-bridge.md`. This design does not add dependencies, Prisma fields, canonical files, staging writers, review reports, knowledge chunks, AI retrieval, permissions, billing, or country-specific behavior.

## 2. Architectural Decisions

### 2.1 Hermes is an injected port

The repository does not call `hermes chat`, depend on Hermes Python internals, or implement ACP. The installed Hermes version and command surface are external runtime details. A `BasicHermesDiscoveryPort` receives a frozen structured request and an `AbortSignal`, and returns `unknown` for strict reconstruction.

This direction lets Hermes own SearXNG/browser orchestration while the repository owns trust classification. It also prevents prompts or queries from leaking through process arguments and keeps tests independent of local services.

### 2.2 P1-6C is JSON-only

P1-6B accepts HTTPS JSON/`+json`; P1-6C reuses that exact provenance boundary. HTML/PDF candidates remain transient and cannot be promoted. There is no second capture implementation.

### 2.3 Search candidates never become audit sources

Discovery candidates are not `BasicSourceRecord` values. They retain title/snippet only in the transient discovery result. Promotion creates a distinct source record from reviewed policy plus captured original bytes, and fixes `discoveryOnly = false`.

### 2.4 Deterministic facts win ownership

P1-6A permits only one fact per field path and one extraction method per fact. Hermes may fill paths missing from the P1-6B base result. Any deterministic/Hermes path overlap fails; the bridge does not merge methods or choose a winner.

Hermes/Hermes overlap is materialized as one `candidate`, `conflict`, or `untrusted` fact according to source identity, tuples, and trust metadata.

### 2.5 The model is not a source

The bridge derives an expected draft entirely from candidate normalized values before calling llama.cpp. The model sees no raw values, search snippets, raw bytes, tools, system message, repository path, or secret. Its output must exactly equal the expected draft after strict reconstruction.

This preserves the P1-6A rule that candidate normalized values equal draft values. The model provides the schema-constrained runtime bridge without gaining authority to invent, translate, select, publish, or enable AI use.

### 2.6 No writes

All P1-6C APIs return in-memory reconstructed values. P1-6B remains the only raw writer. P1-6D will assemble offline audit bundles.

## 3. Public Types

Types live in `packages/db/src/collection/basic-hermes-llama-contracts.ts` and are exported selectively from the package barrel.

```ts
export const BASIC_HERMES_DISCOVERY_SCHEMA_VERSION =
  "basic-hermes-discovery/v1" as const;
export const BASIC_HERMES_DISCOVERY_TIMEOUT_MS = 300_000;
export const BASIC_HERMES_DISCOVERY_MAX_QUERIES = 20;
export const BASIC_HERMES_DISCOVERY_MAX_RESULTS = 50;
export const BASIC_LLAMA_DRAFT_TIMEOUT_MS = 120_000;
export const BASIC_LLAMA_DRAFT_MAX_REQUEST_BYTES = 1_048_576;
export const BASIC_LLAMA_DRAFT_MAX_RESPONSE_BYTES = 262_144;
export const BASIC_LLAMA_DRAFT_PROTOCOL_VERSION =
  "basic-country-draft/v1" as const;
export const BASIC_LLAMA_DRAFT_OPERATION =
  "return-exact-draft" as const;

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
```

Promotion input uses exact plain records:

```ts
export interface BasicHermesSourcePolicy {
  sourceId: string;
  sourceName: string;
  sourceUrl: string;
  sourceFamily: BasicSourceFamily;
  credibility: Credibility;
  accessStatus: BasicSourceAccessStatus;
  accessNotes: string | null;
  publishedAt: string | null;
  promptInjectionRisk: BasicPromptInjectionRisk;
  approvedOrigins: readonly string[];
  allowedQueryParameters: readonly string[];
}

export interface BasicHermesOpenedJsonSource {
  discoveryId: string;
  policy: BasicHermesSourcePolicy;
  capture: BasicRawCaptureResult;
  observations: readonly BasicHermesObservation[];
}

export interface BasicHermesEvidencePromotionInput {
  base: BasicSourceAdapterRunResult;
  discovery: BasicHermesDiscoveryBatch;
  openedSources: readonly BasicHermesOpenedJsonSource[];
}
```

`BasicHermesObservation` has the same seven fields as `BasicDeterministicObservation`. It is separate so the public API does not imply a deterministic extractor.

Model types:

```ts
export interface BasicLlamaCppDraftRequest {
  messages: readonly [{ role: "user"; content: string }];
  stream: false;
  temperature: 0;
  chat_template_kwargs: { enable_thinking: false };
  response_format: {
    type: "json_schema";
    schema: Readonly<Record<string, unknown>>;
  };
}

export interface BasicDraftModelPort {
  complete(request: BasicLlamaCppDraftRequest): Promise<unknown>;
}

export interface BasicLlamaCppTransportOptions {
  baseUrl: string;
  model: string;
  timeoutMs?: number;
  fetchImpl: BasicLlamaCppFetch;
}

export interface BasicDraftBridgeInput {
  sourceRegister: BasicSourceRegister;
  extractedFacts: BasicExtractedFacts;
  model: BasicDraftModelPort;
}
```

All operations use:

```ts
export type BasicBridgeResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: BasicBridgeFailure };

export interface BasicBridgeFailure {
  code: BasicBridgeErrorCode;
  phase: "input" | "hermes" | "source" | "evidence" | "llama" | "draft";
  retryable: boolean;
}
```

No error includes provider text, URL, payload, query, snippet, model content, stack cause, path, or secret.

## 4. Discovery Pipeline

`runBasicHermesDiscovery(value, port)` performs these synchronous checks before the first await:

1. exact-key descriptor-safe snapshot of top-level input;
2. scalar and dense-array validation;
3. stable bound/captured port method without reading `.bind`;
4. request freeze.

It then creates an `AbortController`, starts the port and timeout, and settles exactly once. Timeout aborts and returns `HERMES_TIMEOUT`. Port throw/rejection becomes `HERMES_UNAVAILABLE`. A late result is ignored.

The response parser reconstructs only the documented fields, rejects custom prototypes/accessors/symbols/sparse arrays/extra keys, caps results, canonicalizes URLs, blocks literal unsafe IP ranges, verifies identities, rejects duplicates, sorts deterministically, and deep-freezes the returned batch.

The bridge does not log or persist candidates.

## 5. JSON Evidence Promotion

Promotion is synchronous and atomic. It snapshots all caller-owned values before parsing capture bodies. Limits:

- at most 20 opened sources;
- at most 128 observations per source;
- existing P1-6B body limit remains authoritative.

For each opened source:

1. resolve `discoveryId`;
2. parse and compare policy URL to candidate URL;
3. validate reviewed origin/query allowlists independently from candidate data; allowlists are non-empty/unique where required, query names use the P1-6B safe grammar, every candidate/policy/final query name is allowed, and duplicate names are rejected;
4. reconstruct capture metadata and copy body;
5. recompute body hash and validate JSON MIME;
6. parse body JSON with finite-value/cycle/depth protection;
7. resolve each `json:` RFC6901 pointer without prototype traversal;
8. deep-compare pointed value to observation `rawValue`;
9. reconstruct normalized values and metadata;
10. create a source record and internal sourced observations.

The capture final canonical href must equal the reviewed policy source canonical href. P1-6C v1 therefore refuses redirected candidates even if the redirect stayed on an approved origin. This is stricter than P1-6B capture and avoids losing final-URL provenance when creating the P1-6A source record.

Source-record mapping is exact:

| `BasicSourceRecord` field | Source |
|---|---|
| `sourceId`, `sourceName`, `sourceUrl` | reviewed source policy |
| `retrievedAt`, `contentSha256` | reconstructed and independently verified `BasicRawCaptureResult` |
| `publishedAt`, `sourceFamily`, `accessStatus`, `accessNotes`, `credibility`, `promptInjectionRisk` | reviewed source policy |
| `evidenceLocators` | unique sorted validated observation locators |
| `discoveryOnly` | constant `false` |

Missing capture fields, empty observations, hash/body disagreement, or any unmapped field returns `SOURCE_CAPTURE_INVALID` or `EVIDENCE_INVALID`; no partially mapped source is returned.

No dynamic property path uses ordinary prototype lookup. JSON Pointer segments are decoded, and object access requires an own data property. Array indices use canonical non-negative decimal notation.

Hermes observations are grouped by field path and then source ID. A source must have exactly one tuple for a path. Cross-source tuples determine candidate/conflict. Equal tuples involving an untrusted source produce `untrusted`; differing tuples remain `conflict`, while the source metadata separately guarantees `UNTRUSTED_INPUT` later.

Fact IDs use the existing P1-6B algorithm exactly: `fact-${sha256(fieldPath).slice(0, 16)}` with lowercase hex over UTF-8. Because field paths are unique and deterministic/Hermes overlap is rejected, this is unique within the bundle. The merged output rechecks both `factId` and `fieldPath` uniqueness.

Before merge, base identities, source IDs, facts, receipts, and field paths are reconstructed. Duplicate source IDs and deterministic/Hermes field path overlap return `EVIDENCE_INVALID`. The output is sorted and deep-frozen. Raw bodies and discovery text are dropped.

## 6. Draft Input Assembly

`bridgeBasicMarketOverviewDraft()` snapshots and validates source register and extracted facts. It does not accept a prebuilt draft from the caller.

The assembler requires the 20 static paths and groups indicator paths by index. Indices must be contiguous from zero; each group needs label/value/unit/year. Country paths are required for audit completeness but only `country.code` participates in draft identity. Market paths populate the exact `BasicMarketOverviewDraft` fields.

Each fact must be a candidate with at least one evidence item. Every evidence source must be registered, safe, and include the locator. All normalized values for one candidate must be deeply equal. The draft parser validates the assembled value before any model call.

Blocked input returns `DRAFT_INPUT_BLOCKED`; an attempted policy lock value in model output returns `DRAFT_LOCK_VIOLATION`.

## 7. llama.cpp HTTP Transport

The concrete transport validates options without reading environment variables. Allowed base URLs are exact loopback HTTP `/v1` roots. It builds `${baseUrl}/chat/completions` and adds `model` to the request body. The model alias uses a conservative identifier grammar and rejects filesystem separators.

Fetch init is fixed:

```ts
{
  method: "POST",
  headers: { "Content-Type": "application/json", Accept: "application/json" },
  body,
  redirect: "error",
  signal,
}
```

The transport owns timeout and response-size enforcement. It uses a streaming body reader where available, aborts on overflow, and never calls `response.text()` on an unbounded body. It accepts only integer 2xx status and JSON/`+json` MIME. Provider errors are mapped to sanitized codes.

The bridge parses the OpenAI-compatible response by reconstructing `choices[0].finish_reason` and `choices[0].message.content`. Provider extras are ignored, never spread or returned. It requires exactly one choice and `finish_reason = stop`.

The request has no system message. The user content is a deterministic JSON protocol object:

```json
{
  "protocol": "basic-country-draft/v1",
  "operation": "return-exact-draft",
  "draft": {}
}
```

The protocol and operation strings are exported read-only constants and the request-envelope test asserts their exact serialized value. Any later change to either constant, the message role/count, or the semantic instruction is a collection model prompt change requiring explicit human approval before merge.

The response schema is package-private, recursively sets `additionalProperties: false`, and fixes `reviewStatus` and `aiUsable` with `const`.

## 8. Standalone Draft Parser

P1-6C extracts the existing private draft parser into `basic-market-overview-draft-parser.ts`:

```ts
parseBasicMarketOverviewDraft(value: unknown): {
  data: BasicMarketOverviewDraft | null;
  errors: string[];
}
```

The P1-6A bundle parser calls the same helper with the existing `marketOverviewDraft` label. Existing error strings remain stable. The helper is package-private; only the bridge exposes success/failure.

## 9. Error Mapping

Input and parser failures are returned, not thrown. Constructor misuse may throw `BasicCollectionBridgeError`, but the message contains only the code and no cause.

Retryable:

- `HERMES_TIMEOUT`, `HERMES_UNAVAILABLE`
- `LLAMA_TIMEOUT`, `LLAMA_UNAVAILABLE`

All schema, policy, evidence, grounding, lock, URL, and content errors are non-retryable.

## 10. Verification

Unit tests are offline and deterministic. They cover:

- exact snapshots, mutation across awaits, hostile accessors/proxies, timeout and redaction;
- SearXNG discovery-only isolation and stable ordering;
- P1-6B receipt/hash/MIME/URL policy and JSON Pointer raw-value proof;
- prompt-injection and untrusted source blocking;
- tuple cardinality, conflict retention, base collision rejection;
- draft completeness, contiguous indicators, source references and fact grounding;
- exact llama request body, recursive schema, loopback-only transport, timeout/size/status/MIME/envelope failures;
- bilingual fallback, lock rejection, exact output equality;
- no global fetch, network, child process, filesystem write, canonical import, AI retrieval, or public internal helper leak.

Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, focused DB tests, and forced no-cache Turbo gates. P1-6C has no Web behavior, so Playwright E2E is not required.

An opt-in local smoke test may query the existing loopback llama.cpp instance with model alias `qwen35b`, but it is never part of the test suite and must not use repository/source data.
