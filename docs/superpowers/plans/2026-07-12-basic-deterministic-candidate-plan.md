# Basic Deterministic Candidate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validate complete audit/v2 material, assemble a Basic market draft deterministically, generate the four candidate artifacts through a model-free staged API, and provide a constrained CLI that writes only ready artifacts to isolated staging.

**Architecture:** A pure assembler is extracted from the legacy llama bridge and shared without changing v1 behavior. Dedicated v2 preflight/parser/validator/artifact modules keep v1 and v2 exact schemas separate. `runBasicDeterministicCandidate()` accepts one injected runner port, snapshots its result once, performs trust/completeness checks, assembles and validates the audit bundle, and returns a fully staged non-throwing result. A thin CLI is the only composition layer allowed to read files/use global fetch/write staging.

**Tech Stack:** TypeScript strict mode, existing catalog/capture/materialization modules, Node.js fs/path/util APIs, Vitest, pnpm workspace. No new dependencies.

## Global Constraints

- Read `AGENTS.md`, the approved source-boundary design, and all four completed predecessor docs before editing.
- Work only on `feat/DATA-BASIC-DETERMINISTIC-1` from latest pushed `main` after Editorial is merged.
- Use TDD; confirm RED before implementation for each slice.
- Preserve exact v1 audit/raw-capture/dry-run/llama bridge exports, inputs, stage names, fixtures, failure codes, and runtime behavior.
- The new candidate normal input contains no scenario, bridge, model, Prompt, Hermes, search, completion, or generative port.
- Core candidate code must not read env/files, call global fetch/socket/child process, or write raw cache/staging/canonical/database/manifest/KnowledgeChunk/AI index.
- The CLI may compose reviewed collection modules and global fetch, but may write only four ready artifacts to `data/staging/<countryDirectory>/<runId>/`; never canonical or `collection-manifest.json`.
- No automatic approval/publication, no Prisma, no schema-model changes, no dependency additions, and no Web changes.
- Every thrown/rejected/malformed dependency result becomes a stable blocked result. Errors never expose URL/query/raw text/token/cookie/external messages.
- All output is exact, recursively frozen, deterministically ordered, and generated from one catalog version/digest.

---

## File Structure

### Create

- `packages/db/src/collection/basic-market-overview-draft-assembler.ts`
- `packages/db/src/collection/basic-collection-v2-parser.ts`
- `packages/db/src/collection/basic-v2-fact-ownership.ts`
- `packages/db/src/collection/basic-collection-v2-validator.ts`
- `packages/db/src/collection/basic-audit-v2-assembler.ts`
- `packages/db/src/collection/basic-audit-v2-artifacts.ts`
- `packages/db/src/collection/basic-deterministic-source-preflight.ts`
- `packages/db/src/collection/basic-deterministic-candidate-contracts.ts`
- `packages/db/src/collection/basic-deterministic-candidate-result.ts`
- `packages/db/src/collection/basic-deterministic-candidate.ts`
- `packages/db/src/collection/basic-collection-versioned-loader.ts`
- `packages/db/src/cli/basic-candidate-config.ts`
- `packages/db/src/cli/basic-candidate-composition.ts`
- `packages/db/src/cli/basic-candidate-artifact-writer.ts`
- `packages/db/src/cli/candidate-basic-country.ts`
- `packages/db/fixtures/basic-collection-v2/id-ready.json`
- focused tests for every module above, including `basic-deterministic-candidate-integration.test.ts`.
- `packages/db/src/basic-candidate-composition-integration.test.ts` - synthetic full-path temp-repository test.
- `docs/basic-deterministic-candidate.md`

### Modify

- `packages/db/src/collection/basic-llama-draft-bridge.ts` - delegate its existing expected-draft reconstruction to the new pure assembler.
- `packages/db/src/collection/basic-collection-v2-contracts.ts` - final v2 bundle/report/validation types.
- `packages/db/src/collection/basic-collection-loader.ts` only if needed to share a path-safe read helper; its existing export/signature remains unchanged.
- `packages/db/src/index.ts`, `packages/db/src/index.test.ts`, `packages/db/package.json`, root `package.json`.
- v1 llama/dry-run/loader regression tests.
- `docs/basic-country-audit-contract.md`, `docs/basic-country-collection.md`, `docs/basic-country-hermes-llama-bridge.md`, `docs/testing.md`, and `docs/roadmap.md`.

### Must Remain Unchanged

- All v1 schema strings and public function signatures.
- Catalog/adapters/transport/capture/CSV/document/editorial behavior.
- Prisma, canonical `data/<country>`, collection manifests, AI, permissions, billing, and Web.

---

### Task 1: Extract the Pure Draft Assembler Without v1 Drift

**Files:**
- Create: `packages/db/src/collection/basic-market-overview-draft-assembler.ts`
- Create: `packages/db/src/basic-market-overview-draft-assembler.test.ts`
- Modify: `packages/db/src/collection/basic-llama-draft-bridge.ts`
- Modify: existing llama bridge tests.

**Interfaces:**

```ts
export function assembleBasicMarketOverviewDraft(input: {
  readonly sourceRegister: unknown;
  readonly extractedFacts: unknown;
}): BasicMarketOverviewDraft | null;
```

- [ ] **Step 1: Write assembler characterization tests**

Use existing v1 normal/missing/conflict/untrusted fixtures to lock expected results before moving code. Add v2-ready material and test: exact identities; all candidate facts; nonempty evidence; valid source/locator references; deep-equal normalized values; all 20 static paths; at least `keyIndicators[0]` followed by consecutive complete indicator groups; country code equality; stable key/indicator order; and fixed `reviewStatus: "draft"`, `aiUsable: false`.

Reject duplicate/missing/conflict/untrusted facts, unsafe sources, orphan evidence, inconsistent normalized values, incomplete/gapped indicators, malformed values, mixed identity, and prototype/accessor/proxy/cyclic input.

- [ ] **Step 2: Confirm RED**

```bash
pnpm --filter @navigator/db exec vitest run src/basic-market-overview-draft-assembler.test.ts src/basic-llama-draft-bridge.test.ts
```

- [ ] **Step 3: Extract only the pure reconstruction path**

Move `assembleExpectedDraft` and its pure helpers from the legacy bridge. The assembler accepts v1 or v2 register/facts snapshots via exact schema-specific parsing but produces the same existing `BasicMarketOverviewDraft`. Keep request/response/model/error logic in the bridge. Bridge delegates and maps `null` to its current failure result exactly.

- [ ] **Step 4: Prove byte/behavior equivalence and commit**

```bash
pnpm --filter @navigator/db exec vitest run src/basic-market-overview-draft-assembler.test.ts src/basic-llama-draft-bridge.test.ts src/basic-offline-dry-run.test.ts src/basic-offline-dry-run-exports.test.ts
git add packages/db/src/collection/basic-market-overview-draft-assembler.ts packages/db/src/basic-market-overview-draft-assembler.test.ts packages/db/src/collection/basic-llama-draft-bridge.ts packages/db/src/basic-llama-draft-bridge.test.ts
git commit -m "refactor: extract deterministic Basic draft assembler"
```

---

### Task 2: Exact v2 Bundle Parser, Validator, Artifacts, and Versioned Loader

**Files:**
- Create: `packages/db/src/collection/basic-collection-v2-parser.ts`
- Create: `packages/db/src/collection/basic-collection-v2-validator.ts`
- Create: `packages/db/src/collection/basic-audit-v2-assembler.ts`
- Create: `packages/db/src/collection/basic-audit-v2-artifacts.ts`
- Create: `packages/db/src/collection/basic-collection-versioned-loader.ts`
- Create corresponding focused tests.
- Modify: `packages/db/src/collection/basic-collection-v2-contracts.ts`
- Modify: loader regression tests.

**Interfaces:**

```ts
export interface BasicCollectionReviewReportV2
  extends Omit<BasicCollectionReviewReport, "schemaVersion"> {
  readonly schemaVersion: typeof BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION;
}

export interface BasicCollectionAuditBundleV2 {
  readonly countryDirectory: string;
  readonly runId: string;
  readonly sourceRegister: BasicSourceRegisterV2;
  readonly extractedFacts: BasicExtractedFactsV2;
  readonly marketOverviewDraft: BasicMarketOverviewDraft;
  readonly reviewReport: BasicCollectionReviewReportV2;
}

export function assembleBasicCollectionAuditBundleV2(
  input: BasicCollectionAuditAssemblyInputV2,
): BasicCollectionAuditBundleV2;
export function validateBasicCollectionAuditBundleV2(
  value: unknown,
): BasicCollectionAuditValidationResultV2;
export function validateBasicV2FactOwnership(
  facts: readonly BasicExtractedFactV2[],
): readonly string[];
export function createBasicCollectionAuditArtifactsV2(
  value: unknown,
): BasicCollectionAuditArtifactsV2;
export function serializeBasicCollectionAuditArtifactsV2(
  artifacts: BasicCollectionAuditArtifactsV2,
): Readonly<Record<BasicCollectionAuditArtifactName, Uint8Array>>;
export function loadBasicCollectionAuditBundleVersioned(
  repoRoot: string,
  countryDirectory: string,
  runId: string,
): BasicCollectionAuditBundle | BasicCollectionAuditBundleV2;
```

Only `source-register.json` adds `catalogVersion/catalogSha256`; extracted-facts and review-report use their exact v2 schema with existing identity/content keys. The draft remains envelope-free. The v2 assembler verifies catalog identity supplied by candidate input against source register.

- [ ] **Step 1: Write failing exact-parser/validator tests**

Port all v1 structural, relation, required-path, indicator, blocker, source-check, injection-risk, review report, draft deep-equality, and country-directory tests to exact v2 schemas. Add catalog version/digest validation, no `hermes` extraction method, deterministic/manual collision checks, derived locator existence, and source-register/draft identity checks. Import the shared path classifier from `basic-collection-v2-contracts.ts`; enforce final method ownership centrally: hybrid name/editorial paths are manual, derived paths deterministic, and source-backed paths deterministic or reviewed-document manual. Table-test every static/indicator path with the wrong method.

Require at least one complete indicator group beginning at index 0. A v2 bundle with all 20 static paths but zero indicators is invalid and never ready; this rule is v2-specific and must not change legacy v1 parser behavior.

Reject v1 keys/schema in a v2 object, v2 keys/schema in v1, and mixed directories in every permutation. Existing `loadBasicCollectionAuditBundle()` must still load v1 and keep the same return type/errors. New versioned loader loads pure v1 or pure v2 and rejects mixed before validation with a stable error that does not include absolute paths or filesystem error text.

- [ ] **Step 2: Confirm RED**

Run the new v2 tests plus existing parser/validator/loader/artifact tests; v2 is missing and v1 remains green.

- [ ] **Step 3: Implement separate v2 modules**

Do not widen v1 key lists. Reuse low-level finite snapshot/deep equality helpers only. Assemble a review report with sorted missing/conflicts/checks/risks, `humanDecision: null`, and ready/blocked recommendation derived from material. Serializer emits UTF-8 `JSON.stringify(value) + "\n"` for names in fixed order: source register, extracted facts, draft, review report.

- [ ] **Step 4: Confirm GREEN and commit**

```bash
pnpm --filter @navigator/db exec vitest run src/basic-collection-v2-parser.test.ts src/basic-collection-v2-validator.test.ts src/basic-audit-v2-assembler.test.ts src/basic-audit-v2-artifacts.test.ts src/basic-collection-versioned-loader.test.ts src/basic-collection-loader.test.ts src/basic-collection-validator.test.ts src/basic-offline-audit-artifacts.test.ts
git add packages/db/src/collection/basic-collection-v2-contracts.ts packages/db/src/collection/basic-collection-v2-parser.ts packages/db/src/collection/basic-v2-fact-ownership.ts packages/db/src/collection/basic-collection-v2-validator.ts packages/db/src/collection/basic-audit-v2-assembler.ts packages/db/src/collection/basic-audit-v2-artifacts.ts packages/db/src/collection/basic-collection-versioned-loader.ts packages/db/src/basic-collection-v2-parser.test.ts packages/db/src/basic-collection-v2-validator.test.ts packages/db/src/basic-audit-v2-assembler.test.ts packages/db/src/basic-audit-v2-artifacts.test.ts packages/db/src/basic-collection-versioned-loader.test.ts packages/db/src/basic-collection-loader.test.ts
git commit -m "feat: validate Basic audit v2 bundles"
```

---

### Task 3: v2 Trust and Completeness Preflight

**Files:**
- Create: `packages/db/src/collection/basic-deterministic-source-preflight.ts`
- Create: `packages/db/src/basic-deterministic-source-preflight.test.ts`

**Interfaces:**

```ts
export interface BasicDeterministicPreflightResult {
  readonly valid: boolean;
  readonly blockers: readonly BasicCollectionBlockerCode[];
  readonly errors: readonly string[];
}

export function preflightBasicDeterministicCollection(input: {
  readonly sourceRegister: unknown;
  readonly extractedFacts: unknown;
  readonly sourceChecks: unknown;
  readonly injectionRisks: unknown;
  readonly catalogVersion: unknown;
  readonly catalogSha256: unknown;
}): BasicDeterministicPreflightResult;
```

- [ ] **Step 1: Add failing trust tests**

Require exact v2 identity/catalog match, unique sorted source/fact/check/risk collections, complete 20 static paths, at least one complete indicator group beginning at index 0 followed by contiguous complete groups, source/locator relations, passed check for every evidence source, open access, non-UNVERIFIED credibility, `discoveryOnly=false`, `promptInjectionRisk=none`, no risks, no failed check, and only deterministic/manual candidate facts. Call the same `validateBasicV2FactOwnership()` used by the v2 bundle validator, so an injected runner cannot bypass upstream ownership checks.

Map missing, including zero/incomplete indicators, to `MISSING_REQUIRED_FACT`; conflict to `UNRESOLVED_CONFLICT`; and trust violations to `UNTRUSTED_INPUT` in existing canonical blocker order. Wrong extractionMethod for a path is a structural ownership error and blocks before draft/artifacts. Structural mismatch yields errors and no invented facts.

- [ ] **Step 2: Confirm RED, implement, and confirm GREEN**

Return frozen data and stable field-level errors with no values.

```bash
pnpm --filter @navigator/db exec vitest run src/basic-deterministic-source-preflight.test.ts src/basic-offline-source-preflight.test.ts
git add packages/db/src/collection/basic-deterministic-source-preflight.ts packages/db/src/basic-deterministic-source-preflight.test.ts
git commit -m "feat: preflight deterministic Basic facts"
```

---

### Task 4: Model-Free Staged Candidate API

**Files:**
- Create: `packages/db/src/collection/basic-deterministic-candidate-contracts.ts`
- Create: `packages/db/src/collection/basic-deterministic-candidate-result.ts`
- Create: `packages/db/src/collection/basic-deterministic-candidate.ts`
- Create: `packages/db/src/basic-deterministic-candidate.test.ts`
- Create: `packages/db/src/basic-deterministic-candidate-boundaries.test.ts`

**Interfaces:**

```ts
export const BASIC_DETERMINISTIC_STAGE_NAMES = Object.freeze([
  "input", "runner", "preflight", "draft-assemble",
  "audit-assemble", "validate", "artifacts", "boundary",
] as const);

export interface BasicDeterministicRunnerPort {
  run(): Promise<BasicDeterministicMaterializationResultV2>;
}

export interface BasicDeterministicCandidateInput {
  readonly countryDirectory: string;
  readonly countryCode: string;
  readonly runId: string;
  readonly catalogVersion: string;
  readonly catalogSha256: string;
  readonly runner: BasicDeterministicRunnerPort;
  readonly sourceChecks: readonly BasicSourceCheck[];
  readonly injectionRisks: readonly BasicInjectionRisk[];
}

export interface BasicDeterministicCandidateResult {
  readonly stages: readonly BasicDeterministicCandidateStage[];
  readonly failedStage: BasicDeterministicStageName | null;
  readonly validation: BasicCollectionAuditValidationResultV2 | null;
  readonly artifacts: BasicCollectionAuditArtifactsV2 | null;
  readonly boundaryVerdict: BasicDeterministicBoundaryVerdict;
}

export async function runBasicDeterministicCandidate(
  input: BasicDeterministicCandidateInput,
): Promise<BasicDeterministicCandidateResult>;
```

- [ ] **Step 1: Write failing stage/result tests**

Test exact input keys and one exact native `Promise` runner call. Reject missing/extra bridge/model/prompt/scenario keys, proxy/accessor ports, non-native thenables, multiple calls, malformed/extra runner-result/receipt keys, identity/catalog mismatch, and mutated post-call values.

For every stage, inject a failure and assert all eight stages are present: prior passed, first failure blocked, later skipped, exact `failedStage`. Before validate, `validation=null`; validate failure preserves exact validation; any failure gives `artifacts=null`. Only valid/ready/no-blocker path creates artifacts and passes boundary.

Boundary verdict preserves exact v1 safety semantics for the core: no staging/manifest/canonical/Prisma/coverage/publish/KnowledgeChunk/AI side effects. Install throwing sentinels for `process.env`, global fetch, fs, socket, child process, model, Hermes, and search where module isolation permits; assert candidate core never touches them.

- [ ] **Step 2: Confirm RED**

```bash
pnpm --filter @navigator/db exec vitest run src/basic-deterministic-candidate.test.ts src/basic-deterministic-candidate-boundaries.test.ts
```

- [ ] **Step 3: Implement staged orchestration**

Snapshot static input and exact port. Call runner exactly once, snapshot/deep-freeze its exact `{sourceRegister,extractedFacts,receipts}` result, preflight, assemble draft, assemble v2 audit, validate, create artifacts, then create the constant boundary verdict. Catch at each boundary; never leak dependency errors. Do not catch programming errors outside the stage wrapper into partial success.

- [ ] **Step 4: Confirm GREEN and commit**

```bash
pnpm --filter @navigator/db exec vitest run src/basic-deterministic-candidate.test.ts src/basic-deterministic-candidate-boundaries.test.ts src/basic-offline-dry-run.test.ts src/basic-offline-dry-run-boundaries.test.ts src/basic-offline-dry-run-exports.test.ts
git add packages/db/src/collection/basic-deterministic-candidate-contracts.ts packages/db/src/collection/basic-deterministic-candidate-result.ts packages/db/src/collection/basic-deterministic-candidate.ts packages/db/src/basic-deterministic-candidate.test.ts packages/db/src/basic-deterministic-candidate-boundaries.test.ts
git commit -m "feat: run model-free Basic candidates"
```

---

### Task 5: Constrained Production Composition and Atomic CLI Writer

**Files:**
- Create: `packages/db/src/cli/basic-candidate-config.ts`
- Create: `packages/db/src/cli/basic-candidate-composition.ts`
- Create: `packages/db/src/cli/basic-candidate-artifact-writer.ts`
- Create: `packages/db/src/cli/candidate-basic-country.ts`
- Create corresponding CLI tests.
- Modify: `packages/db/package.json`, root `package.json`.

**CLI Contract:**

```text
pnpm candidate:basic-country -- .cache/basic-country/<ISO2>/<runId>/candidate-config.json
```

The config exact schema is `basic-country-candidate-config/v1` with keys:

```text
schemaVersion, countryDirectory, countryCode, runId,
sourceIds[], structuredReviewPath, manualReviewPath,
documentPlanPaths[], editorialInputPath
```

Review paths may be `null` only when their corresponding selected source kind is empty. All non-null paths are relative, normalized children of the same run directory; no absolute path, `..`, NUL, symlink, special file, or outside read. `sourceIds` and document-plan paths are unique sorted. The catalog path is fixed at `packages/db/catalog/basic-source-catalog.json`; repo root is the verified current workspace root, never a config value.

- [ ] **Step 1: Write failing config/composition/writer tests**

Test exact config parsing and path confinement. Composition must parse catalog, create plan, run v2 capture/adapters, parse source reviews/document plans/editorial input, materialize reviewed facts, then inject a runner returning that final material into candidate core. Global fetch is wrapped only here. Test each dependency with fakes; no real network.

Writer accepts only successful ready artifacts. It writes four serialized files to a mode-0700 temporary sibling, fsyncs files/directory where supported, and atomically renames to `data/staging/<countryDirectory>/<runId>`. Reject existing target, symlinks, partial writes, invalid names, blocked result, and cross-device/non-atomic fallback. Never write `collection-manifest.json` or any canonical path.

CLI has exactly one positional argument, emits a concise success/blocked status without raw values, sets nonzero exit code on blocked/error, and does not write partial artifacts.

- [ ] **Step 2: Confirm RED, implement, and confirm GREEN**

Use Node 24 native TypeScript execution already used by repository seed scripts:

```json
// packages/db/package.json
"candidate:basic-country": "node src/cli/candidate-basic-country.ts"

// root package.json
"candidate:basic-country": "pnpm --filter @navigator/db candidate:basic-country"
```

```bash
pnpm --filter @navigator/db exec vitest run src/basic-candidate-config.test.ts src/basic-candidate-composition.test.ts src/basic-candidate-artifact-writer.test.ts src/candidate-basic-country.test.ts
git add packages/db/src/cli packages/db/src/basic-candidate-*.test.ts packages/db/src/candidate-basic-country.test.ts packages/db/package.json package.json
git commit -m "feat: add deterministic Basic candidate CLI"
```

---

### Task 6: ID-Shaped Offline Integration, Public Surface, and Documentation

**Files:**
- Create: `packages/db/fixtures/basic-collection-v2/id-ready.json`
- Create: `packages/db/src/basic-deterministic-candidate-integration.test.ts`
- Modify: `packages/db/src/index.ts`, `packages/db/src/index.test.ts`
- Create: `docs/basic-deterministic-candidate.md`
- Modify: related collection/audit/bridge/testing/roadmap docs.

- [ ] **Step 1: Add a synthetic ID-shaped integration fixture**

Use country identity `ID` and synthetic values/sources clearly marked as fixtures, not real Indonesia facts. The fixture exact top-level keys are `countryDirectory`, `countryCode`, `runId`, `catalogVersion`, `catalogSha256`, `materialization`, `sourceChecks`, and `injectionRisks`; `materialization` is the exact runner result and risks is empty. Cover all 20 static paths and at least `keyIndicators[0].label/value/unit/year`, multiple sources, manual and deterministic facts, primary source, derived locators, and passed checks. The complete pipeline produces ready artifacts without network/model/filesystem in the core test.

Permute object-key insertion order in a second in-memory fixture while retaining contract-required sorted arrays, and assert byte-identical serialized artifacts. Assert all three envelopes are v2, draft has no envelope, review is ready with `humanDecision=null`, and no forbidden side effect occurs.

- [ ] **Step 2: Add a full catalog-to-staging temp-repository integration**

Create `packages/db/src/basic-candidate-composition-integration.test.ts`. It must use production modules rather than replacing parsers/materializers with mocks:

1. Create a temporary repository layout with a synthetic catalog containing the four registered World Bank sources plus one open HTML `manual-document` source using `basic-manual-document-capture@1.0.0`.
2. Parse the catalog/create the ID execution plan and run the real v2 source-plan runner with a fake transport returning deterministic World Bank JSON and HTML bytes at a fixed timestamp. This first phase creates real `raw-v2` manifests/cache.
3. Build exact structured/manual reviews, one document plan bound to the returned HTML capture hash, and editorial input. The document plan supplies reviewed source facts for one indicator's value/unit/year and editorial evidence for its label and required bilingual narrative/taxonomy fields; World Bank supplies country code/name and macro facts.
4. Write the exact CLI config/input files under the temporary run directory, then invoke the real composition with a transport that throws if cache reuse unexpectedly performs network I/O.
5. Assert the same catalog version/digest in the plan, every raw manifest, both review inputs, document/editorial inputs, final source register, and candidate input. Assert all 20 static facts plus one complete indicator group reach ready artifacts.
6. Rewrite JSON object keys in a different insertion order while preserving required sorted arrays, rerun composition, and assert byte-identical serialized artifacts. Unsorted required arrays remain rejection tests, not normalized inputs.
7. Run the real atomic writer. A blocked variant writes no staging directory; success creates exactly four files, no `collection-manifest.json`, no canonical country directory, and no Prisma/KnowledgeChunk/AI side effect.

No URL, source content, or fixture value may represent a real Indonesia claim; `ID` is shape-only identity.

- [ ] **Step 3: Add only the approved public exports**

Export `runBasicDeterministicCandidate`, `loadBasicCollectionAuditBundleVersioned`, v2 schema/stage constants, and their consumer-facing result/bundle/artifact types. Keep catalog/parsers/materializers/assembler/preflight/CLI internals package-private. Extend `index.test.ts` to prove existing v1 exports still exist and no internal assembler or model-free bypass is accidentally exported.

- [ ] **Step 4: Complete docs and legacy labeling**

Document v2 four-file contract, stage semantics, artifact condition, CLI/config/path rules, human-review stop, side-effect boundary, v1/v2 loader behavior, and test commands. Mark llama bridge as legacy collection compatibility and explicitly state it is not used by the new CLI, AI advisor, or reports.

- [ ] **Step 5: Run final scans and all gates**

```bash
rg -n "runBasicDeterministicCandidate|basic-country-audit/v2|candidate:basic-country|legacy collection compatibility|DATA-BASIC-DETERMINISTIC-1" docs packages/db/src packages/db/package.json package.json
rg -n "bridge|model|prompt|Hermes|SearXNG" packages/db/src/collection/basic-deterministic-candidate*.ts packages/db/src/cli/basic-candidate-composition.ts
git diff --check
pnpm lint
pnpm typecheck
pnpm test
pnpm turbo run lint typecheck test --force
```

The second scan may find only explicit rejection assertions/comments in tests, never a normal-path port/import/call. No E2E is required.

- [ ] **Step 6: Commit, review, merge, and push**

```bash
git add packages/db/fixtures/basic-collection-v2/id-ready.json packages/db/src/basic-deterministic-candidate-integration.test.ts packages/db/src/basic-candidate-composition-integration.test.ts packages/db/src/index.ts packages/db/src/index.test.ts docs/basic-deterministic-candidate.md docs/basic-country-audit-contract.md docs/basic-country-collection.md docs/basic-country-hermes-llama-bridge.md docs/testing.md docs/roadmap.md
git commit -m "docs: complete deterministic Basic candidate path"
```

Dispatch independent review against all approved boundaries and base-to-HEAD diff. A fresh fix agent resolves every Critical/Important finding; rerun focused and all four branch gates. Merge `--no-ff` into latest `main`, rerun all four gates, push, and confirm local/remote equality.

After this merge only, merge latest `main` into `feat/DATA-BASIC-ID-indonesia-basic` and run the separately reviewed real `data-basic-id-20260711-r2` collection. Stop at the four-file candidate package for project-owner fact/translation approval; do not publish canonical data.
