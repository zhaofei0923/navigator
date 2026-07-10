# P1-6B Deterministic Source Adapters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture approved structured HTTPS sources reproducibly, preserve exact raw bytes and provenance, and materialize deterministic P1-6A source/fact artifacts without allowing raw data into canonical flows.

**Architecture:** Source-specific adapters produce typed observations from captured bytes. A shared transport and immutable content-addressed cache enforce URL, redirect, size, hash, and path policy; a runner converts observations into the existing P1-6A source register and extracted-facts shapes while retaining conflicts.

**Tech Stack:** TypeScript strict mode, Node.js `fetch`, `crypto`, and filesystem APIs, Vitest, pnpm workspace, existing `@navigator/shared-types` and P1-6A contracts. No new dependencies.

## Global Constraints

- Do not modify `docs/data-schema.md`, Prisma schema, migrations, canonical country data, AI retrieval boundaries, permissions, billing, or membership behavior.
- Do not invoke Hermes, SearXNG, browser automation, llama.cpp, or any real network source in tests.
- Do not introduce any third-party dependency, CSV parser, selector DSL, network SDK, or schema library.
- Production collection accepts HTTPS GET only, no URL credentials, only adapter-allowlisted unique query names on requests and redirects, an exact origin allowlist, at most three redirects, JSON media types, and at most 10 MiB after transfer decoding.
- Raw bytes remain under `.cache/basic-country/<ISO2>/<runId>/raw/`, are content-addressed and immutable, and never enter staging JSON, canonical imports, C-end responses, coverage counts, or AI retrieval.
- `sourceUrl` preserves the original request URL. Redirect and final-URL metadata is local-only in `capture.json`.
- Every fact path is P1-6A allowlisted; every raw/normalized value is reconstructed finite JSON; every evidence locator belongs to its registered source.
- Equal tuples from one or more `sourceId` values produce one `candidate` fact with all evidence.
- Differing tuples from at least two distinct `sourceId` values produce one `conflict` fact with all evidence.
- Differing tuples within one `sourceId` are malformed adapter output and fail closed; the runner neither selects a value nor fabricates another source.
- Every `conflict` fact therefore contains evidence from at least two distinct `sourceId` values.
- Observation-free adapter output is rejected. The runner fixes `accessStatus = "open"`, `discoveryOnly = false`, and `extractionMethod = "deterministic"`.
- World Bank adapters are country-neutral and emit only source-supported fields. Missing translations and null indicators are not invented.
- Every behavior change follows RED -> GREEN -> REFACTOR, each task is committed independently, and all production TypeScript files remain at or below 300 lines.

---

### Task 1: Document the P1-6B runtime and provenance boundary

**Files:**
- Create: `docs/basic-country-source-adapters.md`
- Modify: `docs/basic-country-collection.md`
- Modify: `docs/basic-country-audit-contract.md`
- Modify: `docs/roadmap.md`

**Interfaces:**
- Consumes: `docs/superpowers/specs/2026-07-10-basic-source-adapters-design.md` and the frozen P1-6A contract.
- Produces: exact raw-cache, URL, hash, adapter, locator, and World Bank behavior used by Tasks 2-4.

- [ ] **Step 1: Write the normative source-adapter document**

Document these exact constants and paths:

```text
rawCaptureSchemaVersion = basic-country-raw-capture/v1
maxRawCaptureBytes = 10485760
maxRedirects = 3
.cache/basic-country/<ISO2>/<runId>/raw/<sourceId>/<sha256>.bin
.cache/basic-country/<ISO2>/<runId>/raw/<sourceId>/capture.json
```

State that the hash covers transport-delivered bytes after transfer decoding and before parsing, and that a valid existing capture is verified and reused without a network call.

- [ ] **Step 2: Clarify evidence membership and uniqueness**

Add to `docs/basic-country-audit-contract.md`:

```text
Each extracted-facts fieldPath occurs at most once.
Each evidence locator must exactly match one locator in the referenced
source record's evidenceLocators array.
```

- [ ] **Step 3: Link the implementation boundary**

Link P1-6B in `docs/roadmap.md` and `docs/basic-country-collection.md` to the new document. Keep P1-6C responsible for Hermes and llama.cpp and P1-6D responsible for full pipeline boundary verification.

- [ ] **Step 4: Verify and commit**

Run:

```bash
rg -n "basic-country-raw-capture/v1|10485760|three redirects|evidenceLocators|World Bank|P1-6C|P1-6D" docs/basic-country-source-adapters.md docs/basic-country-collection.md docs/basic-country-audit-contract.md docs/roadmap.md
```

Commit:

```bash
git add docs/basic-country-source-adapters.md docs/basic-country-collection.md docs/basic-country-audit-contract.md docs/roadmap.md
git commit -m "docs: define deterministic source capture boundary"
```

---

### Task 2: Implement secure transport and immutable raw capture

**Files:**
- Create: `packages/db/src/collection/basic-source-adapter-contracts.ts`
- Create: `packages/db/src/collection/basic-source-transport.ts`
- Create: `packages/db/src/collection/basic-raw-capture.ts`
- Test: `packages/db/src/basic-source-transport.test.ts`
- Test: `packages/db/src/basic-raw-capture.test.ts`

**Interfaces:**
- Consumes: existing P1-6A source/fact types and safe run-ID rules.
- Produces:
  - `BASIC_RAW_CAPTURE_SCHEMA_VERSION = "basic-country-raw-capture/v1"`
  - `BASIC_RAW_CAPTURE_MAX_BYTES = 10 * 1024 * 1024`
  - `BASIC_SOURCE_MAX_REDIRECTS = 3`
  - `createBasicSourceTransport(fetchImpl, now)`
  - `captureBasicRawSource(input, transport)`
  - exact public interfaces from the approved design, including adapter input/output, run input/result, and path-free receipt.

- [ ] **Step 1: Write failing transport tests**

Cover the success shape and these rejections before implementation:

```ts
test.each([
  "http://api.worldbank.org/v2/country/VN",
  "file:///tmp/source.json",
  "https://user:secret@api.worldbank.org/v2/country/VN",
  "https://127.0.0.1/source",
  "https://api.worldbank.org/source?unreviewed_credential=DO_NOT_LEAK",
])("rejects unsafe URL %s", async (url) => {
  await expect(runTransport(url)).rejects.toThrow("source request URL is not allowed");
});
```

Assert the error text does not contain `DO_NOT_LEAK`, the URL, or a response sentinel. Also test disallowed redirect origin, fourth redirect, non-2xx, and non-JSON MIME. The transport does not consume the body stream.

- [ ] **Step 2: Implement the injected HTTPS transport**

Use manual redirects and return a transport response whose body is an `AsyncIterable<Uint8Array>`. Do not accept arbitrary headers; the request contains only GET URL and Accept. Validate the request and every redirect against exact, case-sensitive, duplicate-free `allowedQueryParameters`; reject any other query name without echoing URL data.

- [ ] **Step 3: Write failing raw-cache tests**

Test known bytes:

```ts
const body = new TextEncoder().encode('{"value":1234}');
expect(receipt.contentSha256).toBe(
  "07a9415d68c1cc231402a4b0c4a01aa291945f4a25dc1ffb228a697346c88d4b",
);
```

Then test a streamed body of `10485761` bytes, cache hit without transport, one-byte tamper, unsafe country/run/source IDs, symlinked ancestors, and no overwrite. Add exact tests for malformed manifest keys, adapter ID/version mismatch, request URL/Accept/origin mismatch, final URL/redirect/status/MIME mismatch, payload filename mismatch, byte-count mismatch, final payload without manifest, ignored orphan `.tmp-*`, concurrent identical publication, and concurrent differing payload rejection.

- [ ] **Step 4: Implement immutable content-addressed capture**

Validate `/^[A-Z]{2}$/` country codes, existing safe run IDs, and safe lowercase source IDs. `captureBasicRawSource()` alone consumes the stream, enforces `10485760` bytes, hashes the collected bytes, and writes the exact manifest shape from the design. Use exclusive temporary files and no-clobber atomic publication with mode `0o600`. Reconstruct and re-hash every cache hit.

- [ ] **Step 5: Run focused tests and commit**

```bash
pnpm --filter @navigator/db exec vitest run src/basic-source-transport.test.ts src/basic-raw-capture.test.ts
git add packages/db/src/collection/basic-source-adapter-contracts.ts packages/db/src/collection/basic-source-transport.ts packages/db/src/collection/basic-raw-capture.ts packages/db/src/basic-source-transport.test.ts packages/db/src/basic-raw-capture.test.ts
git commit -m "feat: capture deterministic source responses"
```

---

### Task 3: Implement country-neutral World Bank adapters

**Files:**
- Create: `packages/db/src/collection/adapters/world-bank-country.ts`
- Create: `packages/db/src/collection/adapters/world-bank-indicators.ts`
- Create: `packages/db/fixtures/source-adapters/world-bank-country-vn.json`
- Create: `packages/db/fixtures/source-adapters/world-bank-population-vn.json`
- Create: `packages/db/fixtures/source-adapters/world-bank-gdp-vn.json`
- Create: `packages/db/fixtures/source-adapters/world-bank-gdp-growth-vn.json`
- Test: `packages/db/src/world-bank-source-adapters.test.ts`

**Interfaces:**
- Consumes: `BasicDeterministicSourceAdapter` and transport-delivered bytes from Task 2.
- Produces:
  - `WORLD_BANK_ALLOWED_ORIGINS = Object.freeze(["https://api.worldbank.org"] as const)`
  - `worldBankCountryAdapter`
  - `WORLD_BANK_CORE_INDICATOR_ADAPTERS`, containing population, GDP, and GDP-growth adapters.

- [ ] **Step 1: Write failing country-profile adapter tests**

Commit the recorded fixture envelope from the design and decode its `bodyBase64`. Assert its SHA-256 is `7ddd064eb77613024ad050f7b885a61c239c01692ec59ef4b352ed100f2b7525`, then assert the exact URL `https://api.worldbank.org/v2/country/VN?format=json`, source identity, metadata `page=1/pages=1/per_page="50"/total=1`, `country.code`, and `{ zh: "", en: "Viet Nam" }` for `country.name`. Reject malformed envelopes, pagination, extra country records, and an ISO mismatch with synthetic mutations of the recorded body.

- [ ] **Step 2: Implement the country-profile adapter**

Only read exact own keys needed by the adapter. Do not derive internal region, summary, translation, or update timestamps from unrelated fields.

- [ ] **Step 3: Write failing WDI adapter tests**

Commit and hash-check the three recorded source-2 fixture envelopes from the design. They use these exact single-indicator URLs and mappings:

```text
SP.POP.TOTL?source=2&format=json&mrv=1&per_page=1 -> marketOverview.population / people
NY.GDP.MKTP.CD?source=2&format=json&mrv=1&per_page=1 -> marketOverview.gdp / current US$
NY.GDP.MKTP.KD.ZG?source=2&format=json&mrv=1&per_page=1 -> marketOverview.gdpGrowth / %
```

Assert each exact full URL, metadata `page=1/pages=1/per_page=1/total=1/sourceid="2"/lastupdated="2026-07-01"`, raw values `101598527`, `514697215165.065`, and `8.01882998978245`, normalized values, year `2025`, and locator `json:/1/0/value`. Reject pagination, missing or duplicate records, wrong country codes, invalid year strings, non-finite values, unexpected indicators, and malformed source-2 metadata. A synthetic null `value` must emit raw and normalized `null` without guessing.

- [ ] **Step 4: Implement the WDI adapter**

Build the three exact URLs above without URL/query reordering. Keep `publishedAt = null`; do not reinterpret `lastupdated` as a publication timestamp.

- [ ] **Step 5: Run focused tests and commit**

```bash
pnpm --filter @navigator/db exec vitest run src/world-bank-source-adapters.test.ts
git add packages/db/src/collection/adapters/world-bank-country.ts packages/db/src/collection/adapters/world-bank-indicators.ts packages/db/fixtures/source-adapters packages/db/src/world-bank-source-adapters.test.ts
git commit -m "feat: add World Bank Basic source adapters"
```

---

### Task 4: Materialize source register and deterministic facts

**Files:**
- Create: `packages/db/src/collection/basic-source-adapter-runner.ts`
- Modify: `packages/db/src/collection/basic-collection-classifier.ts`
- Test: `packages/db/src/basic-source-adapter-runner.test.ts`
- Test: `packages/db/src/basic-collection-classifier.test.ts`

**Interfaces:**
- Consumes: adapters, capture receipts, and existing P1-6A contracts.
- Produces: `runBasicDeterministicSourceAdapters(input): Promise<BasicSourceAdapterRunResult>`.

- [ ] **Step 1: Write failing materialization tests**

Assert stable source/fact ordering, strict JSON reconstruction, unit/year/locator preservation, hardcoded `accessStatus: "open"`, `discoveryOnly: false`, and `extractionMethod: "deterministic"`. Use two fake adapters with equal tuples and then tuples differing separately by normalized value, unit, and year. Also assert that differing tuples emitted by one source fail closed rather than producing a `conflict`:

```ts
expect(equal.facts[0]?.status).toBe("candidate");
expect(conflict.facts[0]?.status).toBe("conflict");
expect(conflict.facts[0]?.evidence).toHaveLength(2);
```

Assert duplicate source IDs and observation-free output fail before a result is returned. Adapter output cannot emit non-finite values, inherited values, unknown paths, blank locators, review status, AI flags, coverage fields, or raw-cache fields. Assert errors redact payload and URL sentinels.

- [ ] **Step 2: Implement the runner**

Sort adapters by source ID before execution. Capture and extract each source, reconstruct observation JSON, derive sorted unique `evidenceLocators`, construct exact `BasicSourceRecord` values, then group observations by path. Compare `(normalizedValue, unit, year)` using canonical JSON with sorted object keys and ordered arrays. Equal tuples become a candidate; differing tuples become a conflict only when evidence references at least two distinct source IDs, while same-source differing tuples fail closed. Sort evidence by source ID, locator, canonical raw value, canonical normalized value, unit, and year. Aggregate unique non-null uncertainties in lexical order joined by `" | "`. Generate `fact-${sha256(fieldPath).slice(0, 16)}` and never choose among differing tuples or fabricate a source.

- [ ] **Step 3: Tighten P1-6A mapping validation**

Add tests and implementation so duplicate `fieldPath` values are structural errors and every evidence locator must occur in the referenced source record. Keep existing four fixture classifications unchanged.

- [ ] **Step 4: Run focused tests and commit**

```bash
pnpm --filter @navigator/db exec vitest run src/basic-source-adapter-runner.test.ts src/basic-collection-classifier.test.ts src/basic-collection-validator.test.ts src/basic-collection-static-fixtures.test.ts
git add packages/db/src/collection/basic-source-adapter-runner.ts packages/db/src/collection/basic-collection-classifier.ts packages/db/src/basic-source-adapter-runner.test.ts packages/db/src/basic-collection-classifier.test.ts
git commit -m "feat: materialize deterministic Basic evidence"
```

---

### Task 5: Export the API and prove raw-cache isolation

**Files:**
- Modify: `packages/db/src/index.ts`
- Modify: `packages/db/src/index.test.ts`
- Modify: `packages/db/src/basic-country-import.test.ts`
- Modify: `packages/db/src/basic-collection-loader.test.ts`

**Interfaces:**
- Consumes: public P1-6B APIs from Tasks 2-4.
- Produces: reviewed package exports and regression evidence that raw captures remain outside canonical flows.

- [ ] **Step 1: Write failing export tests**

Assert runtime exports for transport creation, capture, runner, adapters, and constants, plus type-only public contracts.

- [ ] **Step 2: Add raw-cache boundary tests**

Create one temporary repository fixture containing canonical Basic files, the four staging artifacts, and a generated raw capture containing `RAW_CAPTURE_SENTINEL_P1_6B`. Load the audit bundle and build the import plan from that same temporary repository before asserting:

```ts
expect(JSON.stringify(importPlan)).not.toContain("RAW_CAPTURE_SENTINEL_P1_6B");
expect(JSON.stringify(importPlan)).not.toContain("basic-country-raw-capture/v1");
expect(JSON.stringify(auditBundle)).not.toContain("RAW_CAPTURE_SENTINEL_P1_6B");
```

Also assert `git check-ignore .cache/basic-country/XZ/run-001/raw/source/capture.json` succeeds in a repository-level test or equivalent static `.gitignore` check.

- [ ] **Step 3: Export only the intended API**

Do not export internal filesystem path builders or mutation helpers. Public receipts must not contain a cache path.

- [ ] **Step 4: Run all gates and commit**

```bash
pnpm --filter @navigator/db test
pnpm lint
pnpm typecheck
pnpm test
git diff --check
git add packages/db/src/index.ts packages/db/src/index.test.ts packages/db/src/basic-country-import.test.ts packages/db/src/basic-collection-loader.test.ts
git commit -m "test: enforce Basic raw capture isolation"
```

Expected: all commands exit 0. Do not run Web E2E because this slice has no Web behavior.

---

## Final Review Checklist

- [ ] No dependency, lockfile, Prisma, canonical country, Web, AI, permission, or billing change.
- [ ] No real network call in tests and no Hermes or llama.cpp invocation.
- [ ] Raw payload hash is computed from exact transport bytes and verified on reuse.
- [ ] Cache paths and local capture metadata are absent from source register, facts, import plans, and package results.
- [ ] Unsafe paths, symlinks, URL credentials, unallowlisted or duplicate query names, disallowed origins, redirects, MIME types, status codes, and oversize responses fail closed without echoing URL or payload data.
- [ ] World Bank adapters remain country-neutral and do not invent translations or null values.
- [ ] Cross-source differing tuples remain a conflict and are not automatically selected; same-source differing tuples fail closed.
- [ ] P1-6A normal/missing/conflict/untrusted fixtures retain their classifications.
- [ ] Independent task reviews and a final whole-branch review have no Critical or Important findings.
