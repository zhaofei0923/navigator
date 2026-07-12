# Basic Source Formats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an isolated raw-capture/v2 path for reviewed JSON, CSV, HTML, and PDF sources, plus a strict CSV parser and locator API, while preserving every v1 request, transport, capture, cache, and export behavior.

**Architecture:** New v2 contracts snapshot a catalog-bound GET request and carry `catalogVersion/catalogSha256` through transport, cache identity, and manifest. A v2 transport reuses the existing security semantics but applies an exact Accept/MIME matrix. A separate immutable `raw-v2` namespace prevents v1/v2 cache reuse. CSV parsing is a pure, bounded adapter utility built on a pinned parser; source-specific row selection and normalization remain future adapter responsibilities.

**Tech Stack:** TypeScript strict mode, Node.js Web Streams/URL/crypto/fs APIs, `csv-parse@7.0.1`, Vitest, pnpm workspace.

## Global Constraints

- Read `AGENTS.md`, the approved source-boundary design, and the completed catalog task before editing.
- Work only on `feat/DATA-BASIC-FORMATS-1` created from the latest pushed `main` after `DATA-BASIC-CATALOG-1` is merged.
- Use TDD for every behavior and record RED before production code.
- Introducing exact dependency `csv-parse@7.0.1` is the only approved dependency change in this task.
- Do not modify or widen v1 `BasicSourceRequest`, `BasicSourceTransport`, `captureBasicRawSource()`, `basic-country-raw-capture/v1`, v1 cache paths, v1 package exports, or v1 tests except to add explicit non-regression assertions.
- Do not modify adapters, source facts, audit envelopes, editorial input, draft assembly, Prisma, canonical data, AI, permissions, billing, or Web code.
- Do not make real network requests. Tests inject a fake fetch or transport.
- Keep all v2 APIs package-private in this task; do not modify `packages/db/src/index.ts`.
- Every parser reconstructs exact plain objects from `unknown`, rejects extra/accessor/symbol/proxy/cyclic/sparse input, applies depth/string/array limits, and recursively freezes results.
- Stable errors must not echo URLs, query values, response bodies, CSV cells, headers, tokens, cookies, or external errors.

---

## File Structure

### Create

- `packages/db/src/collection/basic-source-v2-contracts.ts` - v2 Accept/request/transport/capture types and constants.
- `packages/db/src/collection/basic-source-metadata-v2.ts` - exact snapshots and raw-capture/v2 manifest parser.
- `packages/db/src/collection/basic-source-transport-v2.ts` - four-MIME fetch transport and response policy.
- `packages/db/src/collection/basic-raw-capture-v2.ts` - catalog-bound immutable v2 cache and capture.
- `packages/db/src/collection/basic-csv-parser.ts` - strict CSV table and locator utilities.
- `packages/db/src/basic-source-transport-v2.test.ts`
- `packages/db/src/basic-raw-capture-v2.test.ts`
- `packages/db/src/basic-csv-parser.test.ts`
- `docs/basic-source-formats.md`

### Modify

- `packages/db/package.json` and `pnpm-lock.yaml` - exact `csv-parse@7.0.1` dependency only.
- `packages/db/src/basic-source-transport.test.ts` - explicit v1 non-JSON rejection regression.
- `packages/db/src/basic-raw-capture.test.ts` - explicit v1/v2 namespace non-reuse regression.
- `docs/basic-source-catalog.md`, `docs/basic-country-collection.md`, and `docs/roadmap.md`.

### Must Remain Unchanged

- `packages/db/src/collection/basic-source-adapter-contracts.ts`
- `packages/db/src/collection/basic-source-metadata.ts`
- `packages/db/src/collection/basic-source-transport.ts`
- `packages/db/src/collection/basic-raw-capture.ts`
- `packages/db/src/collection/basic-source-adapter-runner.ts`
- `packages/db/src/index.ts`
- `packages/db/prisma/schema.prisma`
- `data/**`

---

### Task 1: v2 Contracts, Snapshots, and Manifest Identity

**Files:**
- Create: `packages/db/src/collection/basic-source-v2-contracts.ts`
- Create: `packages/db/src/collection/basic-source-metadata-v2.ts`
- Create: `packages/db/src/basic-source-transport-v2.test.ts`
- Create: `packages/db/src/basic-raw-capture-v2.test.ts`

**Interfaces:**

```ts
export const BASIC_RAW_CAPTURE_V2_SCHEMA_VERSION =
  "basic-country-raw-capture/v2" as const;

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
```

`BasicRawCaptureManifestV2` must have exact keys `schemaVersion`, `countryCode`, `runId`, `catalogVersion`, `catalogSha256`, `adapterId`, `adapterVersion`, `sourceId`, `request`, and `response`; request/response keys match v1 except request Accept is the exact v2 union. `catalogSha256` is lowercase 64-hex. Unlike the legacy manifest helper's historical array sorting, v2 preserves the reviewed execution-plan order of `allowedOrigins` and `allowedQueryParameters` and compares that order during cache reuse.

- [ ] **Step 1: Write failing exact-schema tests**

Test valid reconstruction/freezing plus extra/missing/accessor/symbol/proxy/cyclic/sparse values, invalid ISO2/run ID/version/digest/source identity, non-GET, invalid Accept, unsafe origins/query names, oversized URL/string/arrays, non-finite numbers, malformed response metadata, and all v1/v2 schema substitutions.

Add a compile/runtime regression proving v1 still rejects `text/csv`, `text/html`, and `application/pdf`.

- [ ] **Step 2: Confirm RED**

```bash
pnpm --filter @navigator/db exec vitest run src/basic-source-transport-v2.test.ts src/basic-raw-capture-v2.test.ts src/basic-source-transport.test.ts
```

Expected: new modules are missing; existing v1 tests remain green.

- [ ] **Step 3: Implement minimal exact snapshots**

Export package-private functions:

```ts
export function snapshotBasicSourceRequestV2(value: unknown): BasicSourceRequestV2;
export function snapshotBasicRawCaptureInputV2(value: unknown): BasicRawCaptureInputV2;
export function createBasicRawCaptureManifestV2(
  input: BasicRawCaptureInputV2,
  response: BasicSourceTransportResponseV2,
  contentSha256: string,
  byteLength: number,
): BasicRawCaptureManifestV2;
export function parseBasicRawCaptureManifestV2(
  value: unknown,
): BasicRawCaptureManifestV2 | null;
```

Reuse safe constants and pure finite-JSON helpers only; do not call v1 snapshots by casting. Reconstruct schema keys in declared order and recursively freeze snapshots.

- [ ] **Step 4: Confirm GREEN and commit**

```bash
pnpm --filter @navigator/db exec vitest run src/basic-source-transport-v2.test.ts src/basic-raw-capture-v2.test.ts src/basic-source-transport.test.ts
git add packages/db/src/collection/basic-source-v2-contracts.ts packages/db/src/collection/basic-source-metadata-v2.ts packages/db/src/basic-source-transport-v2.test.ts packages/db/src/basic-raw-capture-v2.test.ts packages/db/src/basic-source-transport.test.ts
git commit -m "feat: define Basic raw capture v2 contracts"
```

---

### Task 2: Exact Four-MIME Transport

**Files:**
- Create: `packages/db/src/collection/basic-source-transport-v2.ts`
- Modify: `packages/db/src/basic-source-transport-v2.test.ts`

**Interfaces:**

```ts
export interface BasicSourceTransportV2 {
  execute(request: BasicSourceRequestV2): Promise<BasicSourceTransportResponseV2>;
}

export function createBasicSourceTransportV2(
  fetchImpl: BasicSourceFetchV2,
  now?: () => Date,
): BasicSourceTransportV2;

export function isBasicSourceRequestAllowedV2(
  value: BasicSourceRequestV2,
): boolean;

export function isBasicSourceResponseAllowedV2(
  response: Pick<BasicSourceTransportResponseV2,
    "status" | "finalUrl" | "contentType" | "redirectChain">,
  request: BasicSourceRequestV2,
): boolean;
```

- [ ] **Step 1: Add failing policy tests**

Cover the complete matrix: JSON accepts `application/json` and valid `application/*+json`; CSV only `text/csv`; HTML only `text/html`; PDF only `application/pdf`. Parameters are case-insensitively normalized. Reject cross-type MIME, missing/conflicting type, `application/octet-stream`, `application/vnd.ms-excel`, malformed suffixes, and whitespace ambiguity.

Port v1 security regressions: HTTPS, credentials, exact origin/query cardinality, manual 301/302/303/307/308 redirects, relative redirect, maximum three redirects, disallowed redirect origin/query, non-2xx, unreadable headers/body/timestamp, rejected fetch, and redacted errors.

- [ ] **Step 2: Confirm RED**

Run `src/basic-source-transport-v2.test.ts`; expect missing implementation.

- [ ] **Step 3: Implement without importing v1 transport**

Use a frozen lookup:

```ts
const ALLOWED_CONTENT_TYPES: Readonly<Record<BasicSourceAcceptV2,
  (mediaType: string) => boolean>> = Object.freeze({
  "application/json": (value) =>
    value === "application/json" || /^application\/[a-z0-9!#$&^_.+-]+\+json$/.test(value),
  "text/csv": (value) => value === "text/csv",
  "text/html": (value) => value === "text/html",
  "application/pdf": (value) => value === "application/pdf",
});
```

Normalize only the media type before `;`; reject multiple comma-separated values. Send only `Accept`, use `redirect: "manual"`, and preserve the v1 redaction vocabulary.

- [ ] **Step 4: Confirm GREEN and commit**

```bash
pnpm --filter @navigator/db exec vitest run src/basic-source-transport-v2.test.ts src/basic-source-transport.test.ts
git add packages/db/src/collection/basic-source-transport-v2.ts packages/db/src/basic-source-transport-v2.test.ts
git commit -m "feat: add Basic multi-format transport"
```

---

### Task 3: Catalog-Bound Immutable v2 Capture

**Files:**
- Create: `packages/db/src/collection/basic-raw-capture-v2.ts`
- Modify: `packages/db/src/basic-raw-capture-v2.test.ts`
- Modify: `packages/db/src/basic-raw-capture.test.ts`

**Interfaces:**

```ts
export async function captureBasicRawSourceV2(
  input: BasicRawCaptureInputV2,
  transport: BasicSourceTransportV2,
): Promise<BasicRawCaptureResultV2>;
```

- [ ] **Step 1: Add failing capture/cache tests**

Test fresh capture, exact manifest bytes, transfer-decoded body SHA-256, 10 MiB boundary, empty body, each MIME, cache reuse without transport, tampered payload/hash/manifest, incomplete directories, symlink/traversal, concurrent same-content publication, concurrent different-content rejection, bad response, and stable redaction.

Assert the path is exactly:

```text
.cache/basic-country/<ISO2>/<runId>/raw-v2/<sourceId>/capture.json
.cache/basic-country/<ISO2>/<runId>/raw-v2/<sourceId>/<sha256>.bin
```

Changing any of catalog version/digest, adapter version, source ID, request URL/Accept/origins/query names or their order invalidates reuse. Copying a valid v1 `raw/<sourceId>` directory must not satisfy v2, and vice versa.

- [ ] **Step 2: Confirm RED**

Run v2 and v1 capture tests; expect v2 failures only.

- [ ] **Step 3: Implement isolated capture**

Mirror the verified v1 atomic publication algorithm with the `raw-v2` directory and v2 parser. Do not call `captureBasicRawSource()` and do not fall back to v1 cache. Cache comparison is exact for all identity/request fields including catalog identity.

- [ ] **Step 4: Confirm GREEN and commit**

```bash
pnpm --filter @navigator/db exec vitest run src/basic-raw-capture-v2.test.ts src/basic-raw-capture.test.ts
git add packages/db/src/collection/basic-raw-capture-v2.ts packages/db/src/basic-raw-capture-v2.test.ts packages/db/src/basic-raw-capture.test.ts
git commit -m "feat: capture catalog-bound Basic sources"
```

---

### Task 4: Strict CSV Parser and Locator

**Files:**
- Modify: `packages/db/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `packages/db/src/collection/basic-csv-parser.ts`
- Create: `packages/db/src/basic-csv-parser.test.ts`

**Interfaces:**

```ts
export interface BasicCsvTable {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

export interface BasicCsvCell {
  readonly locator: string;
  readonly rawValue: string;
}

export function parseBasicCsv(body: Uint8Array): BasicCsvTable;
export function locateBasicCsvCell(
  table: BasicCsvTable,
  zeroBasedDataRow: number,
  header: string,
): BasicCsvCell;
export function escapeBasicCsvLocatorHeader(header: string): string;
```

- [ ] **Step 1: Install the exact approved dependency**

```bash
pnpm --filter @navigator/db add csv-parse@7.0.1
```

Inspect the lockfile and confirm no unrelated direct dependency changed.

- [ ] **Step 2: Write failing parser tests**

Cover UTF-8 fatal decoding, one optional BOM, ordinary cells, empty cells, CRLF/LF, quoted comma/newline, escaped quote, byte-preserving strings, and a header-only table with zero data rows. Reject second/interior BOM, blank/trim-changing/duplicate headers, empty file, inconsistent columns, empty physical lines, comments, malformed quotes, invalid UTF-8, absent row/header, non-integer/negative index, and mutated/non-frozen input.

Test every exact limit without allocating unbounded fixtures:

| Limit | Pass | Reject |
| --- | ---: | ---: |
| raw payload | 10 MiB | 10 MiB + 1 byte |
| data rows | 100,000 | 100,001 |
| columns | 256 | 257 |
| header UTF-8 bytes | 256 | 257 |
| cell UTF-8 bytes | 65,536 | 65,537 |
| parser record bytes | 1,048,576 | 1,048,577 |

Locator must be `csv:/rows/<row>/columns/<RFC6901-escaped-header>` with `~` -> `~0` and `/` -> `~1`.

- [ ] **Step 3: Confirm RED**

```bash
pnpm --filter @navigator/db exec vitest run src/basic-csv-parser.test.ts
```

- [ ] **Step 4: Implement strict parsing**

Import `parse` from `csv-parse/sync`. Decode with `new TextDecoder("utf-8", { fatal: true })`, strip exactly one leading BOM, and call the parser with comma delimiter, no comments, no relaxed quotes/column count, no skipped empty lines, no type casting, and `max_record_size: 1_048_576`. Revalidate every returned scalar as a string, apply byte/count limits, reconstruct and freeze the table. Catch library errors and throw only `basic CSV input is invalid`.

- [ ] **Step 5: Confirm GREEN and commit**

```bash
pnpm --filter @navigator/db exec vitest run src/basic-csv-parser.test.ts
git add packages/db/package.json pnpm-lock.yaml packages/db/src/collection/basic-csv-parser.ts packages/db/src/basic-csv-parser.test.ts
git commit -m "feat: parse bounded Basic CSV sources"
```

---

### Task 5: Documentation, Regression Gates, and Integration

**Files:**
- Create: `docs/basic-source-formats.md`
- Modify: `docs/basic-source-catalog.md`
- Modify: `docs/basic-country-collection.md`
- Modify: `docs/roadmap.md`

- [ ] **Step 1: Document exact v2 boundaries**

Document request/response contracts, MIME matrix, raw-capture/v2 schema, `raw-v2` path, catalog identity, cache rules, CSV grammar/limits/locator, dependency/version/license, redacted errors, and the v1 non-change statement. Mark HTML/PDF as capture-only until `DATA-BASIC-DOCUMENTS-1`.

- [ ] **Step 2: Run source and dependency scans**

```bash
rg -n "basic-country-raw-capture/v2|raw-v2|text/csv|application/pdf|100,000|1,048,576" docs packages/db/src/collection packages/db/src/*.test.ts
pnpm --filter @navigator/db list csv-parse --depth 0
git diff --check
```

Expected: exact dependency `7.0.1`; diff check exits 0.

- [ ] **Step 3: Run all branch gates**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm turbo run lint typecheck test --force
```

No E2E is required because no Web behavior changes.

- [ ] **Step 4: Commit docs and run independent review**

```bash
git add docs/basic-source-formats.md docs/basic-source-catalog.md docs/basic-country-collection.md docs/roadmap.md
git commit -m "docs: define Basic multi-format capture"
```

Dispatch an independent reviewer against `AGENTS.md`, the approved design, this plan, and base-to-HEAD diff. A fresh fix agent resolves every Critical/Important finding; rerun focused and full gates after fixes.

- [ ] **Step 5: Merge and push**

Merge `--no-ff` into the latest `main`, rerun all four gates on merged `main`, push `origin main`, and verify local/remote commit equality before starting `DATA-BASIC-DOCUMENTS-1`.
