# P1-6D Basic Offline Dry Run Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a pure-memory, injected P1-6A/B/C dry run that produces only a validated four-file Basic audit package and proves blocked paths stop before model invocation.

**Architecture:** Keep contracts, assembly, artifact creation and orchestration in separate `packages/db/src/collection/` modules. Normal input calls injected P1-6B/P1-6C-shaped ports; blocked inputs contain P1-6A-shaped material and cannot contain a model port. Cross-boundary tests use public existing functions rather than adding a Web/AI dependency to the orchestrator.

**Tech Stack:** TypeScript strict mode, Vitest, existing P1-6A/B/C contracts, existing `loadBasicCollectionAuditBundle()`, pnpm workspace. No new dependency.

## Global Constraints

- Follow [basic-country-offline-dry-run.md](../../basic-country-offline-dry-run.md), [basic-country-audit-contract.md](../../basic-country-audit-contract.md), [basic-country-source-adapters.md](../../basic-country-source-adapters.md), and [basic-country-hermes-llama-bridge.md](../../basic-country-hermes-llama-bridge.md).
- Do not modify `docs/data-schema.md`, Prisma schema/migrations, canonical country data, raw-cache implementation, coverage rules, AI prompt/retrieval, permissions, billing or memberships.
- Do not add a dependency or call real fetch, Hermes, llama transport, child process, raw cache, staging, manifest, canonical or Prisma API.
- Production modules accept no filesystem/transport/path/repo-root input and remain under 300 lines each.
- Validate, deep-clone and deep-freeze every external/dependency snapshot; errors are deterministic and redact raw/discovery/provider/path sentinels.
- Only normal may call runner then bridge; missing/conflict/untrusted must have exactly their named P1-6A blocker and four loader-compatible artifacts.

---

### Task 1: Freeze the P1-6D documentation contract

**Files:**
- Create: `docs/basic-country-offline-dry-run.md`
- Create: `docs/superpowers/specs/2026-07-11-basic-offline-dry-run-design.md`
- Modify: `docs/basic-country-collection.md`
- Modify: `docs/roadmap.md`
- Test: documentation consistency commands

**Produces:** normative API, scenario blockers, boundary matrix, and scope links.

- [ ] **Step 1: Add a documentation consistency check**

```bash
rg -n "P1-6D|assembleBasicCollectionAuditBundle|createBasicCollectionAuditArtifacts|runBasicOfflineDryRun|aiEligibleKnowledgeIds" \
  docs/basic-country-offline-dry-run.md docs/basic-country-collection.md docs/roadmap.md
```

Expected before the edit: no P1-6D contract/API matches.

- [ ] **Step 2: Write the normative contract and design**

Document the exact API and require `humanDecision: null`, explicit `sourceChecks`/`injectionRisks`, fixed four artifact names, and the following negative AI result:

```ts
{
  knowledgeChunkCount: 0,
  aiUsableTrueCount: 0,
  aiEligibleKnowledgeIds: [],
}
```

- [ ] **Step 3: Link collection and roadmap boundaries**

Add P1-6D as the offline orchestration boundary only; retain existing collection/publish scope and add the precise four-scenario/cross-boundary acceptance criterion.

- [ ] **Step 4: Re-run and review**

Run the Step 1 command and `git diff --check`. Review that no document promises RAG, staging writes or automatic resolution.

- [ ] **Step 5: Commit suggestion**

```bash
git add docs/basic-country-offline-dry-run.md docs/superpowers/specs/2026-07-11-basic-offline-dry-run-design.md docs/basic-country-collection.md docs/roadmap.md
git commit -m "docs: define P1-6D offline dry-run contract"
```

### Task 2: Add contracts and the audit assembler

**Files:**
- Create: `packages/db/src/collection/basic-offline-dry-run-contracts.ts`
- Create: `packages/db/src/collection/basic-offline-audit-assembler.ts`
- Test: `packages/db/src/basic-offline-audit-assembler.test.ts`

**Consumes:** existing `BasicSourceAdapterRunResult`, `BasicDraftModelPort`, `BasicBridgeResult`, and P1-6A types.

**Produces:** `assembleBasicCollectionAuditBundle(input)` and discriminated normal/blocked dry-run input types.

- [ ] **Step 1: Write failing assembler tests**

```ts
test("assembler preserves explicit source checks and forces humanDecision to null", () => {
  const bundle = assembleBasicCollectionAuditBundle(normalMaterial({ sourceChecks: [] }));
  expect(bundle.reviewReport.sourceChecks).toEqual([]);
  expect(bundle.reviewReport.humanDecision).toBeNull();
  expect(validateBasicCollectionAuditBundle(bundle).blockers).toEqual(["UNTRUSTED_INPUT"]);
});

test("assembler keeps a conflict unresolved without selecting a winner", () => {
  const bundle = assembleBasicCollectionAuditBundle(conflictMaterial());
  expect(bundle.reviewReport.conflicts[0]).toMatchObject({ resolution: "unresolved" });
  expect(validateBasicCollectionAuditBundle(bundle).blockers).toEqual(["UNRESOLVED_CONFLICT"]);
});
```

- [ ] **Step 2: Verify red**

Run: `pnpm --filter @navigator/db test -- basic-offline-audit-assembler.test.ts`

Expected: FAIL because the module/function does not exist.

- [ ] **Step 3: Implement the minimum assembler**

```ts
export function assembleBasicCollectionAuditBundle(
  input: BasicCollectionAuditAssemblyInput,
): BasicCollectionAuditBundle {
  const snapshot = snapshotAssemblyInput(input);
  const bundle = buildConservativeBundle(snapshot);
  const validation = validateBasicCollectionAuditBundle(bundle);
  if (!validation.valid) throw new Error("P1-6D audit assembly failed");
  return deepFreezeOfflineValue(validation.data);
}
```

Derive only missing fields/conflicts/report pairing; preserve explicit checks/risks, force `humanDecision` to `null`, and use no clock/randomness.

- [ ] **Step 4: Verify green and review**

Run the Step 2 command. Review invalid/proxy/cyclic values, mutation after return, missing facts and duplicate conflict ordering.

- [ ] **Step 5: Commit suggestion**

```bash
git add packages/db/src/collection/basic-offline-dry-run-contracts.ts packages/db/src/collection/basic-offline-audit-assembler.ts packages/db/src/basic-offline-audit-assembler.test.ts
git commit -m "feat: assemble Basic offline audit bundles"
```

### Task 3: Create the fixed in-memory artifacts

**Files:**
- Create: `packages/db/src/collection/basic-offline-audit-artifacts.ts`
- Test: `packages/db/src/basic-offline-audit-artifacts.test.ts`

**Consumes:** valid P1-6A `BasicCollectionAuditBundle`.

**Produces:** `createBasicCollectionAuditArtifacts(bundle)`.

- [ ] **Step 1: Write failing artifact tests**

```ts
test("creates exactly four immutable loader-compatible artifacts", () => {
  const artifacts = createBasicCollectionAuditArtifacts(validBlockedBundle());
  expect(Object.keys(artifacts)).toEqual([
    "source-register.json", "extracted-facts.json", "market-overview.draft.json", "review-report.json",
  ]);
  expect(() => { (artifacts as Record<string, unknown>).manifest = "sentinel"; }).toThrow();
});

test("rejects an invalid bundle without returning a partial map", () => {
  expect(() => createBasicCollectionAuditArtifacts({} as BasicCollectionAuditBundle)).toThrow("P1-6D artifact validation failed");
});
```

- [ ] **Step 2: Verify red**

Run: `pnpm --filter @navigator/db test -- basic-offline-audit-artifacts.test.ts`

Expected: FAIL because the artifact module does not exist.

- [ ] **Step 3: Implement strict validation and snapshots**

```ts
const result = validateBasicCollectionAuditBundle(bundle);
if (!result.valid) throw new Error("P1-6D artifact validation failed");
return deepFreezeOfflineValue({
  "source-register.json": result.data.sourceRegister,
  "extracted-facts.json": result.data.extractedFacts,
  "market-overview.draft.json": result.data.marketOverviewDraft,
  "review-report.json": result.data.reviewReport,
});
```

- [ ] **Step 4: Verify green and review**

Run the Step 2 command. Add a temporary-directory serialization round trip using `loadBasicCollectionAuditBundle()` and verify no production API writes paths.

- [ ] **Step 5: Commit suggestion**

```bash
git add packages/db/src/collection/basic-offline-audit-artifacts.ts packages/db/src/basic-offline-audit-artifacts.test.ts
git commit -m "feat: create Basic offline audit artifacts"
```

### Task 4: Orchestrate the normal path

**Files:**
- Create: `packages/db/src/collection/basic-offline-dry-run.ts`
- Test: `packages/db/src/basic-offline-dry-run.test.ts`

**Consumes:** injected runner/bridge/model ports and explicit checks/risks.

**Produces:** `runBasicOfflineDryRun({ scenario: "normal", ... })`.

- [ ] **Step 1: Write a failing normal-path test**

```ts
test("normal calls runner then bridge and returns a ready four-file result", async () => {
  const calls: string[] = [];
  const result = await runBasicOfflineDryRun(normalInput({
    runner: async () => { calls.push("runner"); return normalRunResult(); },
    bridge: async () => { calls.push("bridge"); return { ok: true, data: normalDraft() }; },
  }));
  expect(calls).toEqual(["runner", "bridge"]);
  expect(result.validation).toMatchObject({ valid: true, blockers: [], readyForHumanReview: true });
  expect(result.artifacts).not.toBeNull();
});
```

- [ ] **Step 2: Verify red**

Run: `pnpm --filter @navigator/db test -- basic-offline-dry-run.test.ts`

Expected: FAIL because `runBasicOfflineDryRun` does not exist.

- [ ] **Step 3: Implement normal sequencing only**

```ts
const run = await input.runner.run();
const bridge = await input.bridge.bridge({
  sourceRegister: run.sourceRegister,
  extractedFacts: run.extractedFacts,
  model: input.model,
});
if (!bridge.ok) return blockedFailure("draft-bridge", bridge.error.code);
```

Assemble, validate and create artifacts only after bridge success; use fixed stages and the fixed negative boundary verdict.

- [ ] **Step 4: Verify green and review**

Run the Step 2 command. Add runner throw, bridge failure and invalid draft tests proving no artifacts/fallback draft and redacted failures.

- [ ] **Step 5: Commit suggestion**

```bash
git add packages/db/src/collection/basic-offline-dry-run.ts packages/db/src/basic-offline-dry-run.test.ts
git commit -m "feat: run normal Basic offline dry run"
```

### Task 5: Add the three blocked scenarios

**Files:**
- Modify: `packages/db/src/collection/basic-offline-dry-run.ts`
- Modify: `packages/db/src/basic-offline-dry-run.test.ts`

**Produces:** strict missing/conflict/untrusted results with no dependency call.

- [ ] **Step 1: Write failing blocked-scenario tests**

```ts
test.each([
  ["missing", "MISSING_REQUIRED_FACT"],
  ["conflict", "UNRESOLVED_CONFLICT"],
  ["untrusted", "UNTRUSTED_INPUT"],
] as const)("%s blocks before every model-capable dependency", async (scenario, blocker) => {
  const spies = blockedDependencySpies();
  const result = await runBasicOfflineDryRun(blockedInput(scenario, materialFor(scenario), spies));
  expect(spies.calls).toEqual([]);
  expect(result.validation).toMatchObject({ valid: true, blockers: [blocker], readyForHumanReview: false });
  expect(result.artifacts).not.toBeNull();
});
```

- [ ] **Step 2: Verify red**

Run: `pnpm --filter @navigator/db test -- basic-offline-dry-run.test.ts`

Expected: FAIL because blocked unions/control flow are not implemented.

- [ ] **Step 3: Implement discriminated blocked inputs**

```ts
if (input.scenario !== "normal") {
  const bundle = assembleBasicCollectionAuditBundle(input.material);
  const validation = validateBasicCollectionAuditBundle(bundle);
  return requireExactScenarioBlocker(input.scenario, validation, bundle);
}
```

Do not place runner/bridge/model fields on the blocked input union. Reject extra/missing blockers and never mutate a prior bundle to resolve conflict.

- [ ] **Step 4: Verify green and review**

Run the Step 2 command. Review that each blocked material round-trips all four artifacts and that conflict report entries remain `unresolved`.

- [ ] **Step 5: Commit suggestion**

```bash
git add packages/db/src/collection/basic-offline-dry-run.ts packages/db/src/basic-offline-dry-run.test.ts
git commit -m "feat: block Basic offline dry-run scenarios"
```

### Task 6: Prove cross-boundary isolation

**Files:**
- Create: `packages/db/src/basic-offline-dry-run-boundaries.test.ts`
- Modify: `apps/web/src/features/countries/country-service.test.ts` only if an existing representative response assertion needs a fixture hook

**Consumes:** P1-6D artifacts, existing import plan, coverage validation and Web country service.

- [ ] **Step 1: Write failing sentinel tests**

```ts
test("offline sentinels cannot enter import, Web, coverage, or AI eligibility", () => {
  const result = offlineResultWithSentinels({ raw: "RAW_SENTINEL", path: "PATH_SENTINEL" });
  expect(JSON.stringify(buildBasicCountryImportPlan(validSeed()))).not.toContain("RAW_SENTINEL");
  expect(JSON.stringify(buildCountryDetailResponse("ID", { locale: "en" }))).not.toContain("PATH_SENTINEL");
  expect(result.boundaryVerdict).toEqual(expect.objectContaining({
    knowledgeChunkCount: 0, aiUsableTrueCount: 0, aiEligibleKnowledgeIds: [],
  }));
});
```

- [ ] **Step 2: Verify red**

Run: `pnpm --filter @navigator/db test -- basic-offline-dry-run-boundaries.test.ts`

Expected: FAIL because P1-6D boundary artifacts/verdict are not yet available to the test.

- [ ] **Step 3: Implement only necessary test seams**

Use existing public functions and serialized values; do not import Web or AI code into production P1-6D modules and do not add a KnowledgeChunk/RAG implementation.

- [ ] **Step 4: Verify green and review**

Run the Step 2 command plus `pnpm --filter @navigator/web test -- country-service.test.ts` when that file changes. Confirm raw/discovery/provider/path/manifest sentinels are absent and no real external runtime ran.

- [ ] **Step 5: Commit suggestion**

```bash
git add packages/db/src/basic-offline-dry-run-boundaries.test.ts apps/web/src/features/countries/country-service.test.ts
git commit -m "test: verify Basic offline dry-run boundaries"
```

### Task 7: Export public API and guard static boundaries

**Files:**
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/src/basic-offline-dry-run-exports.test.ts`

**Produces:** public P1-6D functions/types without leaking implementation-only ports or filesystem data.

- [ ] **Step 1: Write failing export tests**

```ts
test("db public API exports the three P1-6D functions", async () => {
  const db = await import("@navigator/db");
  expect(db.assembleBasicCollectionAuditBundle).toBeTypeOf("function");
  expect(db.createBasicCollectionAuditArtifacts).toBeTypeOf("function");
  expect(db.runBasicOfflineDryRun).toBeTypeOf("function");
});
```

- [ ] **Step 2: Verify red**

Run: `pnpm --filter @navigator/db test -- basic-offline-dry-run-exports.test.ts`

Expected: FAIL because the index does not export P1-6D symbols.

- [ ] **Step 3: Add explicit barrel exports**

```ts
export { assembleBasicCollectionAuditBundle } from "./collection/basic-offline-audit-assembler.js";
export { createBasicCollectionAuditArtifacts } from "./collection/basic-offline-audit-artifacts.js";
export { runBasicOfflineDryRun } from "./collection/basic-offline-dry-run.js";
```

Export the documented types only. Do not export raw-cache/staging/path helpers through this API.

- [ ] **Step 4: Verify green and review**

Run the Step 2 command and `rg -n "node:fs|node:path|child_process|fetch|Hermes|llama" packages/db/src/collection/basic-offline-*.ts`.

Expected: tests pass; the static search finds no forbidden production dependency.

- [ ] **Step 5: Commit suggestion**

```bash
git add packages/db/src/index.ts packages/db/src/basic-offline-dry-run-exports.test.ts
git commit -m "feat: export Basic offline dry-run API"
```

### Task 8: Run full verification and review the contract

**Files:**
- Modify: only files required by verified failures

- [ ] **Step 1: Run targeted tests**

```bash
pnpm --filter @navigator/db test -- basic-offline-audit-assembler.test.ts basic-offline-audit-artifacts.test.ts basic-offline-dry-run.test.ts basic-offline-dry-run-boundaries.test.ts basic-offline-dry-run-exports.test.ts
```

Expected: all targeted tests pass.

- [ ] **Step 2: Run repository checks**

```bash
pnpm lint
pnpm typecheck
pnpm test
rg -n "P1-6D|offline dry run|aiEligibleKnowledgeIds" docs/basic-country-offline-dry-run.md docs/basic-country-collection.md docs/roadmap.md
git diff --check
```

Expected: every command exits 0; documentation agrees; no whitespace errors.

- [ ] **Step 3: Review requirements before final commit**

Verify the normal-only runner/bridge rule, exact blocker sets, fixed four names, temporary-loader round trip, deep snapshots, redacted errors, no raw/staging/manifest/canonical/coverage/AI action, and no invented RAG claim.

- [ ] **Step 4: Commit suggestion**

```bash
git add packages/db/src packages/db/src/index.ts
git commit -m "test: verify P1-6D offline dry run"
```

## Plan Self-Review

Coverage is mapped task-by-task: documentation (Task 1), assembly (Task 2), artifacts (Task 3), normal orchestration (Task 4), all three blocked scenarios (Task 5), consumer-boundary sentinels (Task 6), public exports/static boundary (Task 7), and full checks (Task 8). The plan adds no schema or runtime capability, uses the existing type names, and every implementation slice has red, green, review and commit steps.
