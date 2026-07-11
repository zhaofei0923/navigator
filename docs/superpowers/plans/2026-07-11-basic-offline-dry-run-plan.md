# P1-6D Basic Offline Dry Run Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a pure-memory, injected P1-6A/B/C dry run that produces only a validated four-file Basic audit package and proves blocked paths stop before model invocation.

**Architecture:** Keep contracts, model-free source preflight, assembly, artifact creation and orchestration in separate `packages/db/src/collection/` modules. Normal input calls the injected P1-6B runner, passes its source/fact snapshots plus explicit checks/risks through preflight, and only then may call the injected P1-6C bridge/model. Blocked inputs contain P1-6A-shaped material and cannot contain model-capable ports；DB and Web prove isolation independently inside their own packages.

**Tech Stack:** TypeScript strict mode, Vitest, existing P1-6A/B/C contracts, existing `loadBasicCollectionAuditBundle()`, pnpm workspace. No new dependency.

## Global Constraints

- Follow [basic-country-offline-dry-run.md](../../basic-country-offline-dry-run.md), [basic-country-audit-contract.md](../../basic-country-audit-contract.md), [basic-country-source-adapters.md](../../basic-country-source-adapters.md), and [basic-country-hermes-llama-bridge.md](../../basic-country-hermes-llama-bridge.md).
- Do not modify `docs/data-schema.md`, Prisma schema/migrations, canonical country data, raw-cache implementation, coverage rules, AI prompt/retrieval, permissions, billing or memberships.
- Do not add a dependency or call real fetch, Hermes, llama transport, child process, raw cache, staging, manifest, canonical or Prisma API.
- Production modules accept no filesystem/transport/path/repo-root input and remain under 300 lines each.
- Validate, deep-clone and deep-freeze every external/dependency snapshot; errors are deterministic and redact raw/discovery/provider/path sentinels.
- Only normal may call runner → model-free preflight → bridge；every preflight blocker stops before bridge/model.
- Blocked union members have no runner/bridge/model fields；runtime rejects those extra own keys and marks runner/draft-bridge skipped.
- DB tests never import Web app code or inject P1-6D values into a nonexistent Web seam；each package owns its behavior regression.

---

### Task 1: Freeze the P1-6D documentation contract (completed in `fef8d31`)

This task is complete. Implementation execution starts at Task 2.

**Files:**
- Create: `docs/basic-country-offline-dry-run.md`
- Create: `docs/superpowers/specs/2026-07-11-basic-offline-dry-run-design.md`
- Modify: `docs/basic-country-collection.md`
- Modify: `docs/roadmap.md`
- Test: documentation consistency commands

**Produces:** normative API, scenario blockers, boundary matrix, and scope links.

- [x] **Step 1: Run the documentation consistency check**

```bash
rg -n "P1-6D|assembleBasicCollectionAuditBundle|createBasicCollectionAuditArtifacts|runBasicOfflineDryRun|aiEligibleKnowledgeIds" \
  docs/basic-country-offline-dry-run.md docs/basic-country-collection.md docs/roadmap.md
```

Result: P1-6D contract/API names are present and aligned.

- [x] **Step 2: Write the normative contract and design**

Document the exact API and require `humanDecision: null`, explicit `sourceChecks`/`injectionRisks`, fixed four artifact names, and the following negative AI result:

```ts
{
  knowledgeChunkCount: 0,
  aiUsableTrueCount: 0,
  aiEligibleKnowledgeIds: [],
}
```

- [x] **Step 3: Link collection and roadmap boundaries**

Add P1-6D as the offline orchestration boundary only; retain existing collection/publish scope and add the precise four-scenario/cross-boundary acceptance criterion.

- [x] **Step 4: Re-run and review**

Run the Step 1 command and `git diff --check`. Review that no document promises RAG, staging writes or automatic resolution.

- [x] **Step 5: Commit**

```bash
git add docs/basic-country-offline-dry-run.md docs/superpowers/specs/2026-07-11-basic-offline-dry-run-design.md docs/basic-country-collection.md docs/roadmap.md
git commit -m "docs: define P1-6D offline dry-run contract"
```

Commit: `fef8d31 docs: define P1-6D offline dry-run contract`

### Task 2: Add contracts, model-free preflight and the audit assembler

**Files:**
- Create: `packages/db/src/collection/basic-offline-dry-run-contracts.ts`
- Create: `packages/db/src/collection/basic-offline-source-preflight.ts`
- Create: `packages/db/src/collection/basic-offline-audit-assembler.ts`
- Test: `packages/db/src/basic-offline-source-preflight.test.ts`
- Test: `packages/db/src/basic-offline-audit-assembler.test.ts`

**Consumes:** existing `BasicSourceAdapterRunResult`, `BasicDraftModelPort`, `BasicBridgeResult`, and P1-6A types.

**Produces:** internal `preflightBasicOfflineCollection(input)`, public `assembleBasicCollectionAuditBundle(input)`, and discriminated normal/blocked dry-run input types. Preflight is not exported from `packages/db/src/index.ts`.

- [ ] **Step 1: Write failing model-free preflight tests**

```ts
test.each([
  ["failed source check", preflightInput({ sourceChecks: [failedCheck()] }), "UNTRUSTED_INPUT"],
  ["injection risk", preflightInput({ injectionRisks: [suspectedRisk()] }), "UNTRUSTED_INPUT"],
  ["missing fact", preflightInput({ facts: missingRequiredFact() }), "MISSING_REQUIRED_FACT"],
  ["conflict fact", preflightInput({ facts: conflictFact() }), "UNRESOLVED_CONFLICT"],
] as const)("blocks %s without a draft or model", (_name, input, blocker) => {
  expect(preflightBasicOfflineCollection(input)).toMatchObject({
    valid: true,
    blockers: [blocker],
  });
  expect(input).not.toHaveProperty("marketOverviewDraft");
  expect(input).not.toHaveProperty("model");
});

test.each(["discoveryOnly", "UNVERIFIED", "restricted", "unknown", "untrusted"] as const)(
  "blocks unsafe source/fact state %s",
  (kind) => expect(preflightBasicOfflineCollection(unsafePreflightInput(kind)).blockers)
    .toContain("UNTRUSTED_INPUT"),
);
```

- [ ] **Step 2: Verify preflight red**

Run: `pnpm --filter @navigator/db test -- basic-offline-source-preflight.test.ts`

Expected: FAIL because the preflight module/function does not exist.

- [ ] **Step 3: Implement model-free preflight**

```ts
export function preflightBasicOfflineCollection(
  input: BasicOfflinePreflightInput,
): BasicOfflinePreflightResult {
  const snapshot = snapshotPreflightInput(input);
  const structure = validatePreflightStructure(snapshot);
  if (!structure.valid) return deepFreezeOfflineValue(structure);
  return deepFreezeOfflineValue({
    valid: true,
    blockers: derivePreflightBlockers(structure.data),
    errors: [],
  });
}
```

Validate source/fact schemas and identities, required paths/indicator completeness, unique IDs/paths, evidence source/locator references and candidate normalized-value agreement. Derive P1-6A blocker semantics from source/fact states plus explicit checks/risks. Do not accept or synthesize a draft, passed source check, bridge or model.

- [ ] **Step 4: Verify preflight green and review**

Run the Step 2 command. Review that malformed/proxy/cyclic inputs return `valid = false`, blocker ordering is stable, and every risky but structurally valid case returns the expected blocker without model-capable input.

- [ ] **Step 5: Write failing assembler tests**

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

- [ ] **Step 6: Verify assembler red**

Run: `pnpm --filter @navigator/db test -- basic-offline-audit-assembler.test.ts`

Expected: FAIL because the module/function does not exist.

- [ ] **Step 7: Implement the minimum assembler**

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

- [ ] **Step 8: Verify assembler green and review**

Run the Step 6 command. Review invalid/proxy/cyclic values, mutation after return, missing facts and duplicate conflict ordering.

- [ ] **Step 9: Commit**

```bash
git add packages/db/src/collection/basic-offline-dry-run-contracts.ts packages/db/src/collection/basic-offline-source-preflight.ts packages/db/src/collection/basic-offline-audit-assembler.ts packages/db/src/basic-offline-source-preflight.test.ts packages/db/src/basic-offline-audit-assembler.test.ts
git commit -m "feat: preflight and assemble Basic offline audits"
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
  expect(() => {
    (artifacts["source-register.json"].sources as BasicSourceRecord[])[0]!.sourceName = "mutated";
  }).toThrow();
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

- [ ] **Step 5: Commit**

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
test("normal runs preflight before bridge and returns a ready four-file result", async () => {
  const calls: string[] = [];
  const result = await runBasicOfflineDryRun(normalInput({
    runner: async () => { calls.push("runner"); return normalRunResult(); },
    bridge: async () => { calls.push("bridge"); return { ok: true, data: normalDraft() }; },
  }));
  expect(calls).toEqual(["runner", "bridge"]);
  expect(result.stages).toContainEqual({ name: "preflight", outcome: "passed" });
  expect(result.validation).toMatchObject({ valid: true, blockers: [], readyForHumanReview: true });
  expect(result.artifacts).not.toBeNull();
});

test.each([
  ["failed source check", normalInput({ sourceChecks: [failedCheck()] })],
  ["injection risk", normalInput({ injectionRisks: [suspectedRisk()] })],
  ["missing", normalInput({ runnerResult: missingRunResult() })],
  ["conflict", normalInput({ runnerResult: conflictRunResult() })],
  ["untrusted", normalInput({ runnerResult: untrustedRunResult() })],
] as const)("normal blocks %s before bridge/model", async (_name, input) => {
  const result = await runBasicOfflineDryRun(input);
  expect(input.bridge.bridge).not.toHaveBeenCalled();
  expect(input.model.complete).not.toHaveBeenCalled();
  expect(result.stages).toContainEqual({ name: "preflight", outcome: "blocked" });
  expect(result.artifacts).toBeNull();
});
```

- [ ] **Step 2: Verify red**

Run: `pnpm --filter @navigator/db test -- basic-offline-dry-run.test.ts`

Expected: FAIL because `runBasicOfflineDryRun` does not exist.

- [ ] **Step 3: Implement normal sequencing only**

```ts
const run = await input.runner.run();
const preflight = preflightBasicOfflineCollection({
  sourceRegister: run.sourceRegister,
  extractedFacts: run.extractedFacts,
  sourceChecks: input.sourceChecks,
  injectionRisks: input.injectionRisks,
});
if (!preflight.valid || preflight.blockers.length > 0) {
  return preflightFailure(preflight);
}
const bridge = await input.bridge.bridge({
  sourceRegister: run.sourceRegister,
  extractedFacts: run.extractedFacts,
  model: input.model,
});
if (!bridge.ok) return blockedFailure("draft-bridge", bridge.error.code);
```

Preflight uses no draft/model and must finish before resolving or invoking the bridge method. Assemble, validate and create artifacts only after bridge success；use fixed stages and the fixed negative-only boundary verdict.

- [ ] **Step 4: Verify green and review**

Run the Step 2 command. Add runner throw, malformed preflight input, every preflight blocker, bridge failure and invalid draft tests. Prove preflight failures leave bridge/model uncalled, produce no artifacts/fallback draft and expose only redacted failures.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/collection/basic-offline-dry-run.ts packages/db/src/basic-offline-dry-run.test.ts
git commit -m "feat: run normal Basic offline dry run"
```

### Task 5: Add the three blocked scenarios

**Files:**
- Modify: `packages/db/src/collection/basic-offline-dry-run.ts`
- Modify: `packages/db/src/basic-offline-dry-run.test.ts`

**Produces:** strict missing/conflict/untrusted results whose type/runtime shapes contain no model-capable dependency.

- [ ] **Step 1: Write failing compile-time blocked-union tests**

```ts
const blocked = {
  scenario: "missing",
  material: materialFor("missing"),
} satisfies BasicOfflineDryRunInput;

// @ts-expect-error blocked scenarios cannot carry a runner
const invalidBlockedRunner: BasicOfflineDryRunInput = { scenario: "missing", material: materialFor("missing"), runner: fakeRunner };
// @ts-expect-error blocked scenarios cannot carry a bridge
const invalidBlockedBridge: BasicOfflineDryRunInput = { scenario: "missing", material: materialFor("missing"), bridge: fakeBridge };
// @ts-expect-error blocked scenarios cannot carry a model
const invalidBlockedModel: BasicOfflineDryRunInput = { scenario: "missing", material: materialFor("missing"), model: fakeModel };
```

- [ ] **Step 2: Write failing runtime blocked-scenario tests**

```ts
test.each([
  ["missing", "MISSING_REQUIRED_FACT"],
  ["conflict", "UNRESOLVED_CONFLICT"],
  ["untrusted", "UNTRUSTED_INPUT"],
] as const)("%s returns its exact blocker with model-capable stages skipped", async (scenario, blocker) => {
  const result = await runBasicOfflineDryRun(blockedInput(scenario, materialFor(scenario)));
  expect(result.validation).toMatchObject({ valid: true, blockers: [blocker], readyForHumanReview: false });
  expect(result.stages).toEqual(expect.arrayContaining([
    { name: "runner", outcome: "skipped" },
    { name: "draft-bridge", outcome: "skipped" },
  ]));
  expect(result.artifacts).not.toBeNull();
});

test.each(["runner", "bridge", "model"] as const)("rejects blocked own key %s", async (key) => {
  const malformed = { ...blockedInput("missing", materialFor("missing")), [key]: {} } as unknown;
  const result = await runBasicOfflineDryRun(malformed as BasicOfflineDryRunInput);
  expect(result.stages).toEqual(expect.arrayContaining([
    { name: "input", outcome: "blocked" },
    { name: "runner", outcome: "skipped" },
    { name: "draft-bridge", outcome: "skipped" },
  ]));
  expect(result.artifacts).toBeNull();
});
```

- [ ] **Step 3: Verify red**

Run: `pnpm --filter @navigator/db test -- basic-offline-dry-run.test.ts`

Expected: FAIL because blocked unions/control flow are not implemented.

- [ ] **Step 4: Implement discriminated blocked inputs and exact-own-key guards**

```ts
if (input.scenario !== "normal") {
  if (!hasExactBlockedInputKeys(input)) return invalidBlockedInput(input.scenario);
  const preflight = preflightBasicOfflineCollection({
    sourceRegister: input.material.sourceRegister,
    extractedFacts: input.material.extractedFacts,
    sourceChecks: input.material.sourceChecks,
    injectionRisks: input.material.injectionRisks,
  });
  const bundle = assembleBasicCollectionAuditBundle(input.material);
  const validation = validateBasicCollectionAuditBundle(bundle);
  return requireExactScenarioBlocker(input.scenario, preflight, validation, bundle);
}
```

Do not place runner/bridge/model fields on the blocked input union. Check exact own data keys before reading material；reject extra/missing blockers and never mutate a prior bundle to resolve conflict. Blocked preflight may continue only into non-model assembly so structurally valid evidence packages still produce four artifacts.

- [ ] **Step 5: Verify green and review**

Run the Step 3 command. Review that `@ts-expect-error` is active, extra model-capable keys fail at `input`, runner/draft-bridge stages stay skipped, each valid blocked material round-trips all four artifacts, and conflict entries remain `unresolved`.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/collection/basic-offline-dry-run.ts packages/db/src/basic-offline-dry-run.test.ts
git commit -m "feat: block Basic offline dry-run scenarios"
```

### Task 6: Prove cross-boundary isolation

**Files:**
- Create: `packages/db/src/basic-offline-dry-run-boundaries.test.ts`
- Modify: `apps/web/src/features/countries/country-service.test.ts`
- Modify: `apps/web/src/app/api/v1/countries/[code]/route.test.ts`

**Consumes:** P1-6D artifacts and existing DB canonical import/coverage/AI eligibility boundaries；existing Web canonical seed registry, country service and route. DB tests do not import Web modules.

- [ ] **Step 1: Write failing DB package boundary tests**

```ts
test("artifacts are not canonical import or coverage input", () => {
  const artifacts = createBasicCollectionAuditArtifacts(validBlockedBundle());
  expect(() => buildBasicCountryImportPlan(artifacts as never)).toThrow();

  const canonical = createValidBasicCountryBundle();
  const validation = validateBasicCountryBundle(canonical);
  const plan = buildBasicCountryImportPlan(canonical);
  expect(validation.summary.coverageLevel).toBe("BASIC");
  expect(plan.aiEligibleKnowledgeIds).toEqual([]);
  expect(plan.operations.some(({ model }) => model === "knowledgeChunk")).toBe(false);
});

test("P1-6D production modules have no downstream or Web dependency", () => {
  const sources = readOfflineProductionSources();
  expect(sources).not.toMatch(/apps\/web|country-service|basic-country-import|coverage-validation|ai-advisor|prisma/i);
  expect(sources).not.toMatch(/node:fs|node:path|child_process|fetch|Hermes|llama transport/i);
  expect(JSON.stringify(createBasicCollectionAuditArtifacts(validBlockedBundle())))
    .not.toMatch(/canonical|coverage|aiEligibleKnowledgeIds|publishAction/);
});
```

The static test may read source files because test-only file inspection is allowed；production P1-6D modules remain I/O-free. Reuse existing canonical fixtures instead of injecting P1-6D sentinels into nonexistent import/coverage seams.

- [ ] **Step 2: Verify DB red**

Run: `pnpm --filter @navigator/db test -- basic-offline-dry-run-boundaries.test.ts`

Expected: FAIL because P1-6D boundary artifacts/verdict are not yet available to the test.

- [ ] **Step 3: Add independent Web package regressions**

```ts
test("country detail consumes canonical registry and exposes no P1-6D fields", () => {
  const response = buildCountryDetailResponse("ID", { locale: "en" });
  expect(JSON.stringify(response)).not.toMatch(
    /source-register\.json|extracted-facts\.json|market-overview\.draft\.json|review-report\.json|boundaryVerdict|artifacts|stages/,
  );
  expect(readCountryServiceSource()).not.toMatch(/@navigator\/db|basic-offline-dry-run/);
});

test("country detail route exposes no P1-6D contract fields", async () => {
  const body = await getCountryDetailRouteBody();
  expect(JSON.stringify(body)).not.toMatch(/boundaryVerdict|artifacts|source-register\.json/);
});
```

These tests stay under `apps/web` and exercise the existing canonical registry/service/route path. They do not import P1-6D, accept P1-6D input, or invent a sentinel injection hook. No DB test imports `apps/web`.

- [ ] **Step 4: Verify package-local regressions**

Run:

```bash
pnpm --filter @navigator/db test -- basic-offline-dry-run-boundaries.test.ts
pnpm --filter @navigator/web test -- country-service.test.ts route.test.ts
```

Expected: both packages pass independently；static scans show no forbidden import/key, canonical DB behavior remains unchanged, and Web responses contain no P1-6D fields.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/basic-offline-dry-run-boundaries.test.ts apps/web/src/features/countries/country-service.test.ts apps/web/src/app/api/v1/countries/[code]/route.test.ts
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
  expect(db).not.toHaveProperty("preflightBasicOfflineCollection");
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

Export the documented types only. Keep `preflightBasicOfflineCollection()` internal；do not export raw-cache/staging/path helpers through this API.

- [ ] **Step 4: Verify green and review**

Run the Step 2 command and:

```bash
rg -n "node:fs|node:path|child_process|fetch|Hermes|apps/web|country-service|basic-country-import|coverage-validation|ai-advisor|prisma" \
  packages/db/src/collection/basic-offline-*.ts
```

Expected: tests pass; the static search finds no forbidden production dependency.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/index.ts packages/db/src/basic-offline-dry-run-exports.test.ts
git commit -m "feat: export Basic offline dry-run API"
```

### Task 8: Run full verification and review the contract

**Files:**
- Modify: only files required by verified failures

- [ ] **Step 1: Run targeted tests**

```bash
pnpm --filter @navigator/db test -- basic-offline-source-preflight.test.ts basic-offline-audit-assembler.test.ts basic-offline-audit-artifacts.test.ts basic-offline-dry-run.test.ts basic-offline-dry-run-boundaries.test.ts basic-offline-dry-run-exports.test.ts
pnpm --filter @navigator/web test -- country-service.test.ts route.test.ts
```

Expected: all targeted tests pass.

- [ ] **Step 2: Run repository checks**

```bash
pnpm lint
pnpm typecheck
pnpm test
rg -n "P1-6D|preflight|offline dry run|aiEligibleKnowledgeIds|runner|draft-bridge|apps/web" \
  docs/basic-country-offline-dry-run.md \
  docs/superpowers/specs/2026-07-11-basic-offline-dry-run-design.md \
  docs/superpowers/plans/2026-07-11-basic-offline-dry-run-plan.md \
  docs/basic-country-collection.md docs/roadmap.md
git diff --check
```

Expected: every command exits 0; documentation agrees; no whitespace errors.

- [ ] **Step 3: Review requirements before final commit**

Verify runner → model-free preflight → bridge ordering；preflight blockers leave bridge/model uncalled；blocked compile-time/runtime own-key guards and skipped stages；exact blocker sets；fixed four names；temporary-loader round trip；recursive freeze；package-local DB/Web isolation；negative-only boundary verdict；redacted errors；and no raw/staging/manifest/canonical/coverage/AI action or invented RAG claim.

- [ ] **Step 4: Commit**

```bash
git add packages/db/src packages/db/src/index.ts
git commit -m "test: verify P1-6D offline dry run"
```

## Plan Self-Review

Coverage is mapped task-by-task: completed documentation (Task 1), model-free preflight and assembly (Task 2), artifacts (Task 3), normal orchestration (Task 4), all three blocked scenarios (Task 5), package-local DB/Web isolation (Task 6), public exports/static boundary (Task 7), and full checks (Task 8). Execution begins at Task 2. The plan adds no schema or runtime capability, uses the existing type names, and every implementation slice has red, green, review and commit steps.
