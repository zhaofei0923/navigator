# P1-6C Hermes Discovery and llama.cpp Draft Bridge Implementation Plan

> **For agentic workers:** implement one task at a time with TDD, independent review after every task, and no scope expansion. Use the normative document and design spec as the acceptance source.

**Goal:** Connect transient Hermes/SearXNG discovery to verified P1-6B JSON evidence and bridge fully grounded P1-6A facts through a loopback llama.cpp schema response without granting either external runtime publication, provenance, canonical, or AI authority.

**Architecture:** `@navigator/db` owns exact JSON boundaries, evidence proof, grounding, and sanitized errors. Hermes and llama.cpp are injected ports. Only the llama.cpp HTTP transport has a production network adapter, restricted to loopback. All outputs are in-memory and P1-6D remains responsible for audit-bundle assembly.

**Tech Stack:** TypeScript strict mode, Node.js Web APIs and crypto, existing P1-6A/B contracts, Vitest, pnpm workspace. No new dependency.

## Global Constraints

- Read `AGENTS.md`, `docs/basic-country-hermes-llama-bridge.md`, the design spec, and P1-6A/B docs before every task.
- Do not modify Prisma, migrations, `docs/data-schema.md`, permissions, billing, AI advisor retrieval, system prompts, canonical country data, or package dependencies.
- Do not add a staging writer, review report generator, manifest writer, knowledge chunk, or import operation.
- P1-6C v1 promotes only P1-6B-compatible HTTPS JSON/`+json` original sources.
- SearXNG candidates remain transient and never appear in source register, facts, model input, errors, or public receipts.
- No production/test code invokes Hermes CLI, ACP, SearXNG, child processes, sockets, or real network services.
- The llama HTTP transport uses an injected fetch; tests set global fetch to a throwing sentinel.
- Every external object is `unknown` until exact-key descriptor-safe reconstruction. Never spread unknown objects.
- Every public error is sanitized and has no cause/provider message.
- Keep each production TypeScript file at or below 300 lines.
- Every task must leave the worktree clean and commit a Conventional Commit.

## Task 1: Freeze P1-6C documentation

**Files:**

- Add: `docs/basic-country-hermes-llama-bridge.md`
- Add: `docs/superpowers/specs/2026-07-10-basic-hermes-llama-bridge-design.md`
- Add: `docs/superpowers/plans/2026-07-10-basic-hermes-llama-bridge-plan.md`
- Modify: `docs/basic-country-collection.md`
- Modify: `docs/roadmap.md`

**Acceptance:**

- The normative document fixes JSON-only evidence, injected Hermes, transient discovery, P1-6B capture proof, no path overlap, llama loopback/schema/grounding, no writes, errors, limits, and P1-6D boundary.
- It explicitly states no system message and no environment-variable addition.
- Roadmap and collection docs link to it without changing the total P1-6 scope.
- An independent specification reviewer approves the design before production code starts.

**Verification:**

```bash
rg -n "basic-hermes-discovery/v1|discoveryOnly|JSON|P1-6B|llama.cpp|127.0.0.1|draft|aiUsable|P1-6D" \
  docs/basic-country-hermes-llama-bridge.md \
  docs/basic-country-collection.md docs/roadmap.md
git diff --check
```

Commit: `docs: define P1-6C discovery and draft bridge`

## Task 2: Add sanitized bridge contracts and Hermes discovery runtime

**Files:**

- Add: `packages/db/src/collection/basic-hermes-llama-contracts.ts`
- Add: `packages/db/src/collection/basic-collection-bridge-error.ts`
- Add: `packages/db/src/collection/basic-hermes-discovery.ts`
- Add: `packages/db/src/basic-hermes-discovery.test.ts`

**Interfaces:**

- Produces the constants, candidate/batch/request/port types, result/failure/error types in the design.
- `runBasicHermesDiscovery(value, port)` returns `BasicBridgeResult<BasicHermesDiscoveryBatch>`.
- The port method is captured descriptor-safely and called with `Reflect.apply`; traversal has cycle/depth bounds.

**TDD RED:**

Write tests first for:

1. stable reconstruction and ordering of an unsorted valid batch;
2. request exact keys, query/result limits, identity mismatch, duplicate ID/URL;
3. missing/extra/inherited/symbol/accessor fields and sparse/custom arrays;
4. malformed provider/discoveryOnly/timestamp/URL and literal unsafe IPs;
5. mutation of input/port/response across await boundaries;
6. self-cyclic/alternating/deep port prototypes and hostile `.bind`;
7. timeout abort, late resolution, sync throw, rejection and secret redaction;
8. result contains no fact, source, model, review, canonical, AI, repo or path fields.

Run the focused test and record failures before production edits.

**GREEN:**

- Snapshot all caller values before await.
- Use a single-settle timeout helper and clear timers.
- Reconstruct and deep-freeze candidates; never log/store them.
- Map failures to deterministic codes.

**Verification:**

```bash
pnpm --filter @navigator/db exec vitest run src/basic-hermes-discovery.test.ts
pnpm --filter @navigator/db typecheck
git diff --check
```

Commit: `feat: add guarded Hermes discovery bridge`

## Task 3: Prove and promote Hermes JSON evidence

**Files:**

- Add: `packages/db/src/collection/basic-hermes-json-evidence.ts`
- Add: `packages/db/src/collection/basic-hermes-evidence-materializer.ts`
- Add: `packages/db/src/basic-hermes-json-evidence.test.ts`
- Modify: `packages/db/src/collection/basic-hermes-llama-contracts.ts`

**Interfaces:**

- `promoteBasicHermesJsonEvidence(value)` returns `BasicBridgeResult<BasicSourceAdapterRunResult>`.
- Consumes a P1-6B base result, validated discovery batch, and opened source inputs.
- Outputs merged source register/facts/path-free receipts only.

**TDD RED:**

Cover:

1. valid JSON pointer proof and stable source/fact/receipt output;
2. snippet sentinel appears only in discovery input and nowhere in promotion output;
3. source policy is independent of candidate title/provider metadata;
4. candidate/policy URL mismatch, unapproved origin, credentials, unsafe origin, final URL mismatch and query mismatch;
5. unknown and duplicate query parameter names in candidate, policy and final URLs; final URL must equal reviewed source URL so redirects are not promoted;
6. body-copy/hash/MIME/identity/timestamp/size mismatch;
7. exact policy/capture/observation mapping into every required `BasicSourceRecord` field and rejection of missing fields;
8. invalid JSON, nonfinite values, pointer escaping, missing pointer, inherited/prototype pointer, array-index edge cases;
9. rawValue mismatch, unknown path, malformed normalized value, unit/year/uncertainty and empty observations;
10. source ID collision and deterministic/Hermes field path collision;
11. same-source multiple tuples fail closed;
12. equal multi-source tuples become candidate, differing tuples become conflict;
13. equal tuple with restricted/unknown/UNVERIFIED/injection source becomes untrusted; differing tuple preserves conflict;
14. fact IDs exactly reuse `fact-${sha256(fieldPath).slice(0, 16)}` and remain unique after merge;
15. no raw body, candidate metadata, cache path, policy allowlist, staging/canonical/AI fields in result;
16. caller mutation after entry cannot affect output.

**GREEN:**

- Recompute SHA-256 over a copied body.
- Parse finite JSON with cycle/depth protection.
- Resolve only `json:` RFC6901 pointers through own data properties.
- Reconstruct all metadata and observations.
- Materialize Hermes facts and merge only uncovered base paths.
- Deep-freeze output.

**Verification:**

```bash
pnpm --filter @navigator/db exec vitest run \
  src/basic-hermes-json-evidence.test.ts \
  src/basic-source-adapter-runner.test.ts \
  src/basic-raw-capture.test.ts
pnpm --filter @navigator/db typecheck
git diff --check
```

Commit: `feat: promote captured Hermes JSON evidence`

## Task 4: Extract a standalone market-overview draft parser

**Files:**

- Add: `packages/db/src/collection/basic-market-overview-draft-parser.ts`
- Add: `packages/db/src/basic-market-overview-draft-parser.test.ts`
- Modify: `packages/db/src/collection/basic-collection-parser.ts`
- Modify: existing P1-6A parser/classifier tests only as needed for stable shared behavior

**TDD RED:**

- Add focused tests for exact draft shape, one-side bilingual fallback, both blank, locks, URLs/timestamps/enums/tags, finite values, indicator shape, accessors/symbols/custom arrays, cycles and caller mutation.
- Add a regression proving the full bundle parser keeps its existing error paths and accepts/rejects all four fixtures unchanged.

**GREEN:**

- Extract the draft parser without changing the public package barrel.
- The full bundle parser delegates to it and prefixes errors exactly as before.
- Return a reconstructed fresh value only on zero errors.

**Verification:**

```bash
pnpm --filter @navigator/db exec vitest run \
  src/basic-market-overview-draft-parser.test.ts \
  src/basic-collection-parser.test.ts \
  src/basic-collection-static-fixtures.test.ts
pnpm --filter @navigator/db typecheck
git diff --check
```

Commit: `refactor: share Basic draft parser`

## Task 5: Add loopback llama.cpp transport

**Files:**

- Add: `packages/db/src/collection/basic-llama-cpp-transport.ts`
- Add: `packages/db/src/basic-llama-cpp-transport.test.ts`
- Modify: `packages/db/src/collection/basic-hermes-llama-contracts.ts`

**Interface:**

- `createBasicLlamaCppDraftTransport(options)` returns `BasicDraftModelPort`.
- The transport adds model alias and owns HTTP timeout/limits; it returns reconstructed provider response as `unknown` to the bridge.

**TDD RED:**

Cover:

1. exact request URL/method/headers/body/redirect/signal;
2. loopback IPv4/IPv6 acceptance; localhost, public/private host, HTTPS, credentials, query/fragment/path variants reject;
3. model alias validation and no file path;
4. request byte limit before fetch;
5. timeout abort, sync/rejection, status, redirect, MIME, null body, stream failure and response byte overflow;
6. hostile response getters/headers/body and error redaction;
7. caller mutation cannot change endpoint/model/fetch/timeout after creation;
8. no Authorization/cookie/proxy/tools/system values.

**GREEN:**

- Snapshot options and fetch function safely.
- Use an internal streaming response collector with hard cap.
- Parse JSON to `unknown`, never spread provider objects.
- Map only timeout/unavailable as retryable.

**Verification:**

```bash
pnpm --filter @navigator/db exec vitest run src/basic-llama-cpp-transport.test.ts
pnpm --filter @navigator/db typecheck
git diff --check
```

Commit: `feat: add loopback llama.cpp draft transport`

## Task 6: Bridge grounded facts to schema-constrained draft

**Files:**

- Add: `packages/db/src/collection/basic-llama-draft-schema.ts`
- Add: `packages/db/src/collection/basic-llama-draft-bridge.ts`
- Add: `packages/db/src/basic-llama-draft-bridge.test.ts`
- Modify: `packages/db/src/collection/basic-hermes-llama-contracts.ts`

**Interface:**

- `bridgeBasicMarketOverviewDraft(value)` returns `Promise<BasicBridgeResult<BasicMarketOverviewDraft>>`.

**TDD RED:**

Cover:

1. valid complete grounded facts produce exact draft;
2. request contains one user JSON protocol message, no system/tools/raw/snippet/path/secret;
3. exact request snapshot uses immutable exported protocol/operation constants; any drift fails the test;
4. recursive JSON schema requires all keys and fixes `draft/false`;
5. missing required static path, indicator gap/incomplete group, duplicate path, invalid source reference, locator mismatch;
6. missing/conflict/untrusted fact or unsafe source blocks before model call;
7. multiple candidate evidence normalized values mismatch blocks;
8. Hermes snippet/raw sentinel never enters model request;
9. model throw/rejection and malformed OpenAI envelope;
10. empty/multiple choices, non-stop finish, non-string/empty content, non-JSON content;
11. lock field changes/extra policy fields, schema errors, both languages blank;
12. structurally valid but changed value returns ungrounded;
13. one-side language fallback is retained;
14. output is fresh/frozen and mutation-safe;
15. no files or canonical/import/AI APIs are touched.

**GREEN:**

- Deterministically assemble expected draft from facts.
- Parse expected draft before model call.
- Build fixed versioned request/schema.
- Reconstruct provider envelope/content and parse draft.
- Deep-compare model output to expected draft.

**Verification:**

```bash
pnpm --filter @navigator/db exec vitest run \
  src/basic-llama-draft-bridge.test.ts \
  src/basic-market-overview-draft-parser.test.ts \
  src/basic-collection-classifier.test.ts
pnpm --filter @navigator/db typecheck
git diff --check
```

Commit: `feat: bridge grounded facts to Basic draft`

## Task 7: Public exports, isolation and full regression

**Files:**

- Modify: `packages/db/src/index.ts`
- Modify: `packages/db/src/index.test.ts`
- Modify: `packages/db/src/basic-country-import.test.ts`
- Add: `packages/db/src/basic-hermes-llama-isolation.test.ts`
- Modify docs only if implementation discovered a real contract mismatch

**Acceptance:**

- Export only public runners/factory, result/port/input/output types, and documented limits/error codes.
- Keep JSON schema, parsers, materializers, pointer helpers, prompt/protocol builder and provider parser private.
- Assert internal helper names cannot be imported from `@navigator/db`.
- Assert serialized success/failure values contain none of raw body, snippet sentinel, repo/cache/staging/canonical/manifest/knowledge/AI fields.
- Assert import plans remain unchanged and cannot consume P1-6C artifacts.
- Assert global fetch, child process and filesystem write sentinels have zero calls.
- Re-run all P1-6A/B fixture classifications and source adapter tests.

**Verification:**

```bash
pnpm --filter @navigator/db test
pnpm --filter @navigator/db typecheck
pnpm lint
pnpm typecheck
pnpm test
pnpm exec turbo run lint typecheck test --force --output-logs=errors-only
git diff --check
find packages/db/src/collection -type f -name '*.ts' ! -name '*.test.ts' -print0 \
  | xargs -0 wc -l | sort -nr
git status --short --branch
```

No Playwright E2E is required because this task has no Web behavior.

Commit: `test: enforce P1-6C bridge isolation`

## Task 8: Independent whole-branch review and delivery

1. Generate a complete base-to-head review package.
2. Independent reviewer reads AGENTS, normative docs, design, plan and full diff.
3. Fix every Critical/Important finding and re-review until approved; address practical Minor findings.
4. Main agent reruns root gates and forced no-cache gates on the feature branch.
5. Pull latest `main`, merge with `--no-ff`, rerun `pnpm lint`, `pnpm typecheck`, `pnpm test`, then push `origin main`.
6. Verify local and remote main SHA match.
7. Retain the feature branch/worktree unless deletion is explicitly authorized.

## Optional Local Smoke Test

After all offline tests pass, the main agent may run a non-repository-data smoke test against explicitly supplied `http://127.0.0.1:8080/v1` and model alias `qwen35b`. The smoke test:

- is not part of `pnpm test` or CI;
- sends only a synthetic minimal draft;
- uses the production transport and schema;
- writes no file;
- reports failure without blocking offline correctness if the local service has changed or stopped.

Any real Hermes discovery or country data run remains a later `DATA-BASIC-<ISO2>` activity requiring human country approval.
