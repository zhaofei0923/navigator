# basic-country-offline-dry-run.md - P1-6D Basic 离线 dry run 契约

> 本文件是 P1-6D 的规范性契约。它以 [basic-country-audit-contract.md](./basic-country-audit-contract.md) 的 `basic-country-audit/v1` 审计包为唯一产物形状，以 [basic-country-source-adapters.md](./basic-country-source-adapters.md) 和 [basic-country-hermes-llama-bridge.md](./basic-country-hermes-llama-bridge.md) 为既有 runner/bridge 边界。本任务只验证离线编排与隔离，不新增数据模型字段，不修改 Prisma、canonical seed、覆盖派生、AI prompt/retrieval、权限或发布能力，也不引入依赖。

## 1. 目的与非目标

P1-6D 用确定性的、纯内存的 dry run 验证 P1-6A/B/C 的组合边界。它可以把 P1-6B 的已注入结果和 P1-6C 的已注入草稿桥接为一个 P1-6A 审计包，并只输出四个审计工件的只读内存映射。

它不是生产采集、暂存或发布入口：不得创建 `.cache/`、`data/staging/`、`collection-manifest.json`、canonical 文件、Prisma 记录、覆盖结果、KnowledgeChunk 或任何 AI/publish action。它不调用 Hermes、SearXNG、真实 fetch、llama transport 或 child process。所有依赖均从调用方注入；生产 API 不接受路径、repo root、transport、fetch 或 filesystem 参数。

P1-6D 不验证不存在的 RAG。当前 `@navigator/ai-advisor` 只导出 `workspaceName`；本契约仅要求干跑结果明确表明：`knowledgeChunkCount = 0`、`aiUsableTrueCount = 0`、`aiEligibleKnowledgeIds = []`，并由跨边界测试验证 P1-6D 工件不进入代表性 Web country service/API response、覆盖派生或任何已存在的 AI eligibility 输入。

## 2. 最小公共 API

实现放在 `packages/db/src/collection/`，每个生产 TypeScript 文件不超过 300 行；公共符号从 `packages/db/src/index.ts` 导出。下列类型复用既有 `Basic*` 类型，不复制或扩展 P1-6A schema。

```ts
export type BasicOfflineDryRunScenario =
  | "normal"
  | "missing"
  | "conflict"
  | "untrusted";

export type BasicCollectionAuditArtifactName =
  | "source-register.json"
  | "extracted-facts.json"
  | "market-overview.draft.json"
  | "review-report.json";

export interface BasicCollectionAuditAssemblyInput {
  countryDirectory: string;
  runId: string;
  sourceRegister: BasicSourceRegister;
  extractedFacts: BasicExtractedFacts;
  marketOverviewDraft: BasicMarketOverviewDraft;
  sourceChecks: readonly BasicSourceCheck[];
  injectionRisks: readonly BasicInjectionRisk[];
}

export function assembleBasicCollectionAuditBundle(
  input: BasicCollectionAuditAssemblyInput,
): BasicCollectionAuditBundle;

export type BasicCollectionAuditArtifacts = Readonly<{
  "source-register.json": Readonly<BasicSourceRegister>;
  "extracted-facts.json": Readonly<BasicExtractedFacts>;
  "market-overview.draft.json": Readonly<BasicMarketOverviewDraft>;
  "review-report.json": Readonly<BasicCollectionReviewReport>;
}>;

export function createBasicCollectionAuditArtifacts(
  bundle: BasicCollectionAuditBundle,
): BasicCollectionAuditArtifacts;

export type BasicOfflineDryRunInput =
  | BasicOfflineNormalDryRunInput
  | BasicOfflineBlockedDryRunInput;

export function runBasicOfflineDryRun(
  input: BasicOfflineDryRunInput,
): Promise<BasicOfflineDryRunResult>;
```

`BasicOfflineNormalDryRunInput` contains a required injected deterministic-runner port returning `Promise<BasicSourceAdapterRunResult>`, an injected P1-6C-compatible draft-bridge port, an injected `BasicDraftModelPort`, and explicit `sourceChecks`/`injectionRisks`. The normal path may succeed only after the runner result has passed the existing P1-6A input checks and the bridge returns `{ ok: true, data: BasicMarketOverviewDraft }`.

`BasicOfflineBlockedDryRunInput` contains exactly one of `scenario: "missing" | "conflict" | "untrusted"` and a P1-6A-shaped in-memory material set (`sourceRegister`, `extractedFacts`, `marketOverviewDraft`, `sourceChecks`, `injectionRisks`). It has no runner, bridge, or model field. This makes a model call impossible by construction. The material must still assemble, validate, and produce all four files; an ill-shaped input fails closed before artifacts are made.

The injected normal runner is the P1-6B boundary, not a new source runner. A caller that wants to adapt `runBasicDeterministicSourceAdapters()` does so outside P1-6D; P1-6D itself neither passes `repoRoot` nor creates raw capture. The injected bridge is the P1-6C boundary; the orchestrator only invokes it with the runner's `sourceRegister` and `extractedFacts` plus the injected model port.

## 3. Assembler rules

`assembleBasicCollectionAuditBundle()` is synchronous and only assembles/rebuilds data. It must defensively deep-clone and deep-freeze its returned snapshot, reject invalid/uncloneable input fail-closed, and never mutate an input object.

The caller must supply every `sourceChecks` and `injectionRisks` entry explicitly. The assembler never invents a `passed` source check, never clears a supplied risk, never chooses a conflict winner, and always sets `reviewReport.humanDecision` to `null`. It derives only the conservative fields already defined by P1-6A:

- `missingFields`: unique, stable field paths whose fact has `status = "missing"`, plus required paths absent from the facts;
- `conflicts`: one unresolved review conflict for every fact with `status = "conflict"`, preserving its `factId` and using deterministic non-empty notes;
- `status` and `publicationRecommendation`: `blocked` / `do-not-publish` when any P1-6A blocker follows from the assembled material; otherwise `ready-for-human-review` / `request-human-review`.

The existing `validateBasicCollectionAuditBundle()` remains the authority for structural validity, blockers and readiness. The assembler must validate its own result and throw a deterministic, redacted error if it cannot produce a structurally valid P1-6A bundle. A `blocked` bundle is allowed only when it is structurally valid; it remains a valid four-file package with `readyForHumanReview = false`.

## 4. Artifacts and immutability

`createBasicCollectionAuditArtifacts()` first calls `validateBasicCollectionAuditBundle()`. A result with `valid = false` throws a deterministic, redacted error and returns no partial map. `readyForHumanReview = false` alone is not an error: valid blocked materials must be serializable for review.

The returned map has exactly these four keys, no aliases and no path keys:

```text
source-register.json
extracted-facts.json
market-overview.draft.json
review-report.json
```

Each value is a fresh deeply immutable snapshot. The mapping has no country directory, staging path, raw-capture receipt, provider/discovery material, transport object, model object, path sentinel, manifest data, canonical data, coverage data or AI eligibility data. Tests may serialize this map into a temporary directory and prove that the existing `loadBasicCollectionAuditBundle()` reads it back; production APIs never write those files.

## 5. Scenario contract

All scenario results expose `scenario`, ordered `stages`, P1-6A `validation`, optional `artifacts`, and a `boundaryVerdict`. Stage names are fixed: `input`, `runner`, `draft-bridge`, `assemble`, `validate`, `artifacts`, `boundary`. A stage has a fixed outcome of `passed`, `blocked`, or `skipped`; unknown/exceptional input yields a fail-closed `input: blocked` result with no artifacts and no downstream call.

| Scenario | Required execution | Expected blockers/readiness | Calls prohibited before model | Artifacts |
|---|---|---|---|---|
| `normal` | injected P1-6B runner, then injected P1-6C bridge, then assemble/validate/artifacts | `blockers = []`, `readyForHumanReview = true` | none after valid runner result | four files present |
| `missing` | assemble supplied material; runner and bridge stages skipped | exactly `MISSING_REQUIRED_FACT`; not ready; report is `blocked` / `do-not-publish` | runner, bridge, model | four files present |
| `conflict` | assemble supplied material; runner and bridge stages skipped | exactly `UNRESOLVED_CONFLICT`; not ready; every derived conflict is `unresolved`; no winner | runner, bridge, model | four files present |
| `untrusted` | assemble supplied material; runner and bridge stages skipped | exactly `UNTRUSTED_INPUT`; not ready; report is `blocked` / `do-not-publish` | runner, bridge, model | four files present |

The three blocked scenarios must reject material that produces an extra or missing blocker. A conflict is not resolved by a later method call or mutation: the only resolution workflow is a new, separately identified run with new input material. P1-6D never rewrites an old bundle.

For normal, any runner throw/rejection, bridge failure, invalid bridge draft, invalid explicit checks/risks, or failed P1-6A validation is fail-closed: no artifacts, no canonical/coverage/AI/publish action, and a redacted stage result. A bridge failure cannot fall back to a caller-provided draft.

## 6. Boundary verdict and test matrix

`boundaryVerdict` is a value-level attestation of P1-6D outputs, not a claim that a nonexistent RAG was executed. It contains fixed negative capabilities:

```ts
interface BasicOfflineBoundaryVerdict {
  rawCache: "not-produced";
  stagingWrite: "not-attempted";
  manifest: "not-produced";
  canonicalWrite: "not-attempted";
  prismaWrite: "not-attempted";
  coverageDerivation: "not-attempted";
  publishAction: "not-attempted";
  knowledgeChunkCount: 0;
  aiUsableTrueCount: 0;
  aiEligibleKnowledgeIds: readonly [];
}
```

The unit/integration test matrix must additionally inject unique raw, discovery/provider, filesystem-path and manifest sentinels, then prove all of the following:

| Boundary | Required proof |
|---|---|
| import plan | `buildBasicCountryImportPlan()` receives/returns no raw cache, staging, manifest or four-artifact sentinel |
| representative Web service/API | `buildCountryDetailResponse()` and its representative route response expose no sentinel |
| coverage | existing Basic coverage validation/derivation uses no sentinel and P1-6D does not invoke it |
| AI eligibility | no KnowledgeChunk is created, no `aiUsable = true` is emitted, and `aiEligibleKnowledgeIds` remains `[]`; no RAG claim or RAG test is added |
| artifact serialization | only the four fixed file names round-trip through a temporary-directory loader; no production filesystem write occurs |

## 7. Determinism, errors and confidentiality

Given equivalent injected snapshots and dependency results, output ordering, blockers, stage order, review fields and artifact values must be deterministic. Arrays derived from facts use stable field-path/fact-ID ordering; no clock, random ID, environment value, network response or filesystem state may affect output. Inputs, dependency outputs and returned values are deep-cloned before use and deep-frozen before return.

Errors and failed stage diagnostics are stable codes/messages only. They must not leak raw payloads, evidence `rawValue`, discovery title/snippet/URL, provider response, adapter request/final URL, raw-cache path, staging path, manifest path, filesystem sentinel, credentials or model transport details. The returned bundle/artifacts must contain only P1-6A-permitted fields; a test sentinel in any prohibited category must be absent.

## 8. Acceptance

- Normal is the only scenario permitted to invoke the injected P1-6B runner and injected P1-6C model bridge, and it succeeds only with no blockers and `readyForHumanReview = true`.
- Missing, conflict and untrusted fail before every model call, preserve valid P1-6A four-file packages, and have exactly their named blocker.
- No implementation path auto-passes a source, auto-publishes, auto-selects/resolves a conflict, creates a human decision, or returns forbidden canonical/Prisma/coverage/AI/publish data.
- Production APIs are pure in-memory and dependency-injected; tests use no real fetch, Hermes, llama transport or child process.
- P1-6A/B/C public contracts remain unchanged; no schema/Prisma/canonical/AI prompt/retrieval/permission change or dependency is introduced. No AGENTS.md §11 manual-confirmation item is touched.
