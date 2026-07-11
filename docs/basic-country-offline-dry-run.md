# basic-country-offline-dry-run.md - P1-6D Basic 离线 dry run 契约

> 本文件是 P1-6D 的规范性契约。它以 [basic-country-audit-contract.md](./basic-country-audit-contract.md) 的 `basic-country-audit/v1` 审计包为唯一产物形状，以 [basic-country-source-adapters.md](./basic-country-source-adapters.md) 和 [basic-country-hermes-llama-bridge.md](./basic-country-hermes-llama-bridge.md) 为既有 runner/bridge 边界。本任务只验证离线编排与隔离，不新增数据模型字段，不修改 Prisma、canonical seed、覆盖派生、AI prompt/retrieval、权限或发布能力，也不引入依赖。

## 1. 目的与非目标

P1-6D 用确定性的、纯内存的 dry run 验证 P1-6A/B/C 的组合边界。它可以把 P1-6B 的已注入结果和 P1-6C 的已注入草稿桥接为一个 P1-6A 审计包，并只输出四个审计工件的只读内存映射。

它不是生产采集、暂存或发布入口：不得创建 `.cache/`、`data/staging/`、`collection-manifest.json`、canonical 文件、Prisma 记录、覆盖结果、KnowledgeChunk 或任何 AI/publish action。它不调用 Hermes、SearXNG、真实 fetch、llama transport 或 child process。所有依赖均从调用方注入；生产 API 不接受路径、repo root、transport、fetch 或 filesystem 参数。

P1-6D 不验证不存在的 RAG。当前 `@navigator/ai-advisor` 只导出 `workspaceName`；`knowledgeChunkCount = 0`、`aiUsableTrueCount = 0`、`aiEligibleKnowledgeIds = []` 只作为 `boundaryVerdict` 内固定的 negative-only attestation，表示本次 dry run 没有产生这些能力。三者不是四文件工件内容，不是可供下游消费的 AI eligibility payload，也不证明执行了检索。

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

`BasicOfflineNormalDryRunInput` contains a required injected deterministic-runner port returning `Promise<BasicSourceAdapterRunResult>`, an injected P1-6C-compatible draft-bridge port, an injected `BasicDraftModelPort`, and explicit `sourceChecks`/`injectionRisks`. Runner 返回后必须先通过下文不依赖 draft 的 preflight；只有 `valid = true` 且 `blockers = []` 才能调用 bridge/model。最终成功仍要求 bridge 返回 `{ ok: true, data: BasicMarketOverviewDraft }`，且完整 P1-6A bundle validation 无 blocker。

`BasicOfflineBlockedDryRunInput` contains exactly one of `scenario: "missing" | "conflict" | "untrusted"` and a P1-6A-shaped in-memory material set (`sourceRegister`, `extractedFacts`, `marketOverviewDraft`, `sourceChecks`, `injectionRisks`). Its TypeScript union has no `runner`、`bridge` 或 `model` field；runtime 入口还必须按 scenario 检查 exact own keys，出现任一额外 model-capable key 时以 `input: blocked` 拒绝。结构有效的 blocked material 仍须 assemble、validate 并产生四文件；畸形或带额外 key 的输入不产生 artifacts。

The injected normal runner is the P1-6B boundary, not a new source runner. A caller that wants to adapt `runBasicDeterministicSourceAdapters()` does so outside P1-6D; P1-6D itself neither passes `repoRoot` nor creates raw capture. The injected bridge is the P1-6C boundary; the orchestrator only invokes it with the runner's `sourceRegister` and `extractedFacts` plus the injected model port.

## 3. Model-free preflight

实现提供内部纯函数 `preflightBasicOfflineCollection()`；它不是 `@navigator/db` 的新增公共导出，也不修改 P1-6A/B/C public semantics。输入只包含 runner 的 `sourceRegister`、`extractedFacts` 和调用方显式提供的 `sourceChecks`、`injectionRisks`，不得包含、构造或读取 `marketOverviewDraft`、bridge 或 model。

```ts
interface BasicOfflinePreflightInput {
  sourceRegister: unknown;
  extractedFacts: unknown;
  sourceChecks: unknown;
  injectionRisks: unknown;
}

interface BasicOfflinePreflightResult {
  valid: boolean;
  blockers: readonly BasicCollectionBlockerCode[];
  errors: readonly string[];
}

function preflightBasicOfflineCollection(
  input: BasicOfflinePreflightInput,
): BasicOfflinePreflightResult;
```

Preflight 对输入做防御性快照，并在不需要模型草稿的范围内验证 P1-6A 等价规则：schema/run/country identity、plain JSON shape、唯一 source/fact ID、允许且完整的 required fact paths、连续完整的 indicator paths、evidence source/locator 引用，以及同一 candidate fact 内 normalized evidence 的深度一致性。随后保守派生 blocker：

- 缺 required path 或 `status = missing` 产生 `MISSING_REQUIRED_FACT`；
- 任一 `status = conflict` 产生 `UNRESOLVED_CONFLICT`，不选择 winner；
- 任一 `status = untrusted`、`discoveryOnly`、`UNVERIFIED`、`restricted` / `unknown`、source prompt-injection risk、显式 `injectionRisks`、failed `sourceChecks`，或 evidence source 缺少显式 passed check，产生 `UNTRUSTED_INPUT`。

Malformed shape/reference/identity 令 `valid = false`；结构有效但有风险令 `valid = true` 且返回稳定去重的 blockers。Preflight 绝不自动补 passed check，也不以未来 draft 作为来源安全判定的前提。Normal 只有在 `valid = true` 且 `blockers = []` 时才可进入 `draft-bridge`；bridge 仍负责自身既有的 source/fact grounding 防线，模型后的 assembler 与完整 bundle validator 负责 draft-to-fact 一致性和最终 readiness。

## 4. Assembler rules

`assembleBasicCollectionAuditBundle()` is synchronous and only assembles/rebuilds data. It must defensively deep-clone and deep-freeze its returned snapshot, reject invalid/uncloneable input fail-closed, and never mutate an input object.

The caller must supply every `sourceChecks` and `injectionRisks` entry explicitly. The assembler never invents a `passed` source check, never clears a supplied risk, never chooses a conflict winner, and always sets `reviewReport.humanDecision` to `null`. It derives only the conservative fields already defined by P1-6A:

- `missingFields`: unique, stable field paths whose fact has `status = "missing"`, plus required paths absent from the facts;
- `conflicts`: one unresolved review conflict for every fact with `status = "conflict"`, preserving its `factId` and using deterministic non-empty notes;
- `status` and `publicationRecommendation`: `blocked` / `do-not-publish` when any P1-6A blocker follows from the assembled material; otherwise `ready-for-human-review` / `request-human-review`.

The existing `validateBasicCollectionAuditBundle()` remains the authority for structural validity, blockers and readiness. The assembler must validate its own result and throw a deterministic, redacted error if it cannot produce a structurally valid P1-6A bundle. A `blocked` bundle is allowed only when it is structurally valid; it remains a valid four-file package with `readyForHumanReview = false`.

## 5. Artifacts and immutability

`createBasicCollectionAuditArtifacts()` first calls `validateBasicCollectionAuditBundle()`. A result with `valid = false` throws a deterministic, redacted error and returns no partial map. `readyForHumanReview = false` alone is not an error: valid blocked materials must be serializable for review.

The returned map has exactly these four keys, no aliases and no path keys:

```text
source-register.json
extracted-facts.json
market-overview.draft.json
review-report.json
```

`BasicCollectionAuditArtifacts` 中的 `Readonly` 只描述 TypeScript 的静态浅层表面；runtime 必须递归冻结 map、对象、数组和嵌套值，并以嵌套 mutation 测试证明。Each value is a fresh deeply immutable snapshot. The mapping has no country directory, staging path, raw-capture receipt, provider/discovery material, transport object, model object, path sentinel, manifest data, canonical data, coverage data or AI eligibility data. Tests may serialize this map into a temporary directory and prove that the existing `loadBasicCollectionAuditBundle()` reads it back；production APIs never write those files.

## 6. Scenario contract

All scenario results expose `scenario`, ordered `stages`, P1-6A `validation`, optional `artifacts`, and a `boundaryVerdict`. Stage names are fixed: `input`, `runner`, `preflight`, `draft-bridge`, `assemble`, `validate`, `artifacts`, `boundary`. A stage has a fixed outcome of `passed`, `blocked`, or `skipped`; unknown/exceptional input yields a fail-closed `input: blocked` result with no artifacts，且 `runner` / `draft-bridge` 均为 `skipped`。

| Scenario | Required execution | Expected blockers/readiness | Calls prohibited before model | Artifacts |
|---|---|---|---|---|
| `normal` | injected P1-6B runner → model-free preflight → injected P1-6C bridge → assemble/validate/artifacts | preflight 与最终 validation 均 `blockers = []`；最终 `readyForHumanReview = true` | bridge/model 在 preflight 通过前禁止 | four files present |
| `missing` | preflight supplied material, then assemble/validate; runner and draft-bridge stages skipped | exactly `MISSING_REQUIRED_FACT`; not ready; report is `blocked` / `do-not-publish` | runner, bridge, model | four files present |
| `conflict` | preflight supplied material, then assemble/validate; runner and draft-bridge stages skipped | exactly `UNRESOLVED_CONFLICT`; not ready; every derived conflict is `unresolved`; no winner | runner, bridge, model | four files present |
| `untrusted` | preflight supplied material, then assemble/validate; runner and draft-bridge stages skipped | exactly `UNTRUSTED_INPUT`; not ready; report is `blocked` / `do-not-publish` | runner, bridge, model | four files present |

The three blocked scenarios must reject material that produces an extra or missing blocker. Their runtime proof is exact-own-key rejection plus `runner: skipped` / `draft-bridge: skipped` stages；compile-time proof uses `@ts-expect-error` assignments showing the blocked union cannot contain `runner`、`bridge` 或 `model`，而不是未连接到调用点的 spies。A conflict is not resolved by a later method call or mutation: the only resolution workflow is a new, separately identified run with new input material. P1-6D never rewrites an old bundle.

For normal, any runner throw/rejection、preflight structural failure/blocker、bridge failure、invalid bridge draft 或 failed final P1-6A validation is fail-closed: no artifacts, no canonical/coverage/AI/publish action, and a redacted stage result. Failed source checks、injection risks 和所有 preflight blocker 都必须在 bridge/model 调用前停止。A bridge failure cannot fall back to a caller-provided draft.

## 7. Boundary verdict and package-local test matrix

`boundaryVerdict` is a fixed negative-only value-level attestation of P1-6D outputs, not artifact content、not an AI eligibility payload，也不是执行不存在 RAG 的声明。It contains only negative capabilities:

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

DB tests must never import `apps/web`. Boundary proof combines static architecture checks with package-local behavior regressions；tests do not inject P1-6D sentinels into a seam that does not exist.

| Boundary | Required proof |
|---|---|
| DB static architecture | Scan P1-6D production imports/keys: no Web app、canonical/import、coverage、AI/RAG、Prisma、filesystem/transport dependency；result/artifact keys exclude raw/staging/manifest/canonical/coverage/AI/publish payloads |
| DB import/coverage/AI behavior | In `@navigator/db` tests, verify four-file artifacts are not accepted as a canonical `BasicCountryBundle`/import input；existing canonical fixture still produces the unchanged Basic import/coverage result, no KnowledgeChunk operation, `aiUsable = true` count 0, and `aiEligibleKnowledgeIds = []` |
| Web service/API behavior | In `apps/web` tests only, verify country service and representative route consume the existing canonical seed registry, import no P1-6D module/API, and expose none of the P1-6D result/artifact field names；do not import Web code from DB tests |
| artifact serialization | only the four fixed file names round-trip through a temporary-directory loader; no production filesystem write occurs |

## 8. Determinism, errors and confidentiality

Given equivalent injected snapshots and dependency results, output ordering, blockers, stage order, review fields and artifact values must be deterministic. Arrays derived from facts use stable field-path/fact-ID ordering; no clock, random ID, environment value, network response or filesystem state may affect output. Inputs, dependency outputs and returned values are deep-cloned before use and deep-frozen before return.

Errors and failed stage diagnostics are stable codes/messages only. They must not leak raw payloads, evidence `rawValue`, discovery title/snippet/URL, provider response, adapter request/final URL, raw-cache path, staging path, manifest path, filesystem sentinel, credentials or model transport details. The returned bundle/artifacts must contain only P1-6A-permitted fields; a test sentinel in any prohibited category must be absent.

## 9. Acceptance

- Normal is the only scenario permitted to invoke the injected P1-6B runner and injected P1-6C model bridge；runner 结果与显式 checks/risks 必须先通过 model-free preflight，且最终仅在无 blocker、`readyForHumanReview = true` 时成功。
- Missing, conflict and untrusted have no runner/bridge/model union fields, reject those extra own keys at runtime, mark both model-capable stages skipped, preserve valid P1-6A four-file packages, and have exactly their named blocker.
- No implementation path auto-passes a source, auto-publishes, auto-selects/resolves a conflict, creates a human decision, or returns forbidden canonical/Prisma/coverage/AI/publish data.
- Production APIs are pure in-memory and dependency-injected; tests use no real fetch, Hermes, llama transport or child process.
- P1-6A/B/C public contracts remain unchanged; no schema/Prisma/canonical/AI prompt/retrieval/permission change or dependency is introduced. No AGENTS.md §11 manual-confirmation item is touched.
