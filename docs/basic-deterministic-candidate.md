# basic-deterministic-candidate.md - Deterministic Basic v2 candidate

> 本文件定义 `DATA-BASIC-DETERMINISTIC-1` 的完成边界：从已审核的 catalog/capture/review/document/editorial material 生成可供人工审核的四文件 v2 candidate。它不修改 canonical 数据模型，不授权发布，也不改变 AI 检索边界。

## 1. 四文件 v2 契约

候选目录固定为：

```text
data/staging/<countryDirectory>/<runId>/
  source-register.json
  extracted-facts.json
  market-overview.draft.json
  review-report.json
```

只允许这四个文件。candidate writer 不生成 `collection-manifest.json`，也不写 `data/<countryDirectory>/`。

- `source-register.json` 是 `basic-country-audit/v2` envelope，精确包含 `schemaVersion`、`runId`、`countryCode`、`catalogVersion`、`catalogSha256` 和 `sources`。
- `extracted-facts.json` 是 `basic-country-audit/v2` envelope，精确包含 `schemaVersion`、`runId`、`countryCode` 和 `facts`。
- `review-report.json` 是 `basic-country-audit/v2` envelope。candidate 阶段的 `humanDecision` 固定为 `null`；就绪报告使用 `ready-for-human-review` / `request-human-review`，阻断报告不得伪装成就绪。
- `market-overview.draft.json` 沿用无 envelope 的 `BasicMarketOverviewDraft`，不得含 `schemaVersion` 或 `runId`，并固定 `reviewStatus = "draft"`、`aiUsable = false`。

三个 envelope、candidate input、catalog plan、raw-v2 manifests、review/document/editorial inputs 必须绑定同一 `runId`、`countryCode`、`catalogVersion` 和 `catalogSha256`。最终事实必须覆盖 20 个静态路径和至少从 `keyIndicators[0]` 开始的一个连续完整指标组；每个指标组必须同时有 `label`、`value`、`unit`、`year`。

## 2. Model-free core 与八个 stage

公开 core 是 `runBasicDeterministicCandidate()`。它只消费一个 exact input 和一个仅有 `run()` 的 native-Promise runner port；runner 恰好调用一次。正常路径不接受或调用 bridge、模型、Prompt、Hermes、SearXNG、自由文本上下文、filesystem、环境变量、socket、child process 或 global fetch。

stage 名称和顺序固定为：

```text
input
runner
preflight
draft-assemble
audit-assemble
validate
artifacts
boundary
```

结果始终列出全部八个 stage。首个失败 stage 为 `blocked`，之前为 `passed`，之后为 `skipped`，且 `failedStage` 指向首个失败；全通过时 `failedStage = null`。在 `validate` 前失败时 `validation = null`。dependency throw/reject、畸形值、identity/catalog drift 和 trust/completeness 违反都转换为稳定的 blocked result，不暴露外部错误内容。

四个 in-memory artifacts 只有在以下条件全部成立时才存在：

```text
all eight stages passed
validation.valid = true
validation.readyForHumanReview = true
validation.blockers = []
reviewReport.status = ready-for-human-review
reviewReport.publicationRecommendation = request-human-review
reviewReport.humanDecision = null
```

否则 `artifacts = null`。`ready-for-human-review` 只表示可以进入人工审核，不是批准、发布或 AI 资格。

## 3. Production composition 与 CLI

唯一生产命令为：

```bash
pnpm candidate:basic-country -- .cache/basic-country/<ISO2>/<runId>/candidate-config.json
```

必须从已验证的 `navigator` workspace 内运行。workspace marker 固定为根 `package.json` 的 `name = "navigator"`、`packages/db/package.json` 的 `name = "@navigator/db"`，并要求根 `pnpm-workspace.yaml` 存在。catalog 路径固定为 `packages/db/catalog/basic-source-catalog.json`，repo root、catalog path、URL、credentials 或 output path 都不是 config 能力。

config 的 schema 固定为 `basic-country-candidate-config/v1`，且只能有以下键：

```json
{
  "schemaVersion": "basic-country-candidate-config/v1",
  "countryDirectory": "<safe-country-directory>",
  "countryCode": "<ISO2>",
  "runId": "<safe-run-id>",
  "sourceIds": ["<sorted-source-id>"],
  "structuredReviewPath": "reviews/structured.json",
  "manualReviewPath": "reviews/manual.json",
  "documentPlanPaths": ["plans/<sorted-source-id>.json"],
  "editorialInputPath": "editorial.json"
}
```

`sourceIds` 与 `documentPlanPaths` 必须各自唯一且按 code-point 升序；不做自动排序。只有 selected plan 中相应 source kind 为空时，`structuredReviewPath` 或 `manualReviewPath` 才可为 `null`，且每个 manual source 必须恰有一个 document plan。所有输入路径都必须是 config 所在 run directory 的 normalized relative child；absolute、drive/UNC、`.`、`..`、反斜杠、NUL、重复角色路径、symlink、special file 和 outside read 全部 fail closed。config 自身只能位于精确路径 `.cache/basic-country/<ISO2>/<runId>/candidate-config.json`，且 path identity 必须与内容一致。

composition 按生产顺序调用 catalog parser、execution plan、v2 runner/raw cache、structured/manual review parsers、document parser/materializer、editorial parser、reviewed materializer 和 candidate core。raw-v2 cache 命中时不重新请求网络。CLI stdout/stderr 和 exit code 固定为：

| 结果 | 输出 | exit code | staging write |
|---|---|---:|---|
| ready 且原子写入成功 | `basic candidate written` | `0` | 四文件 |
| trust/completeness blocked | `basic candidate blocked` | `2` | 无 |
| config/composition/native/write error | `basic candidate error` | `1` | 无 |

## 4. Native Linux 写入边界

原子 writer 依赖 package-private Linux N-API helper。运行环境必须提供 `/proc/self/fd`、`openat`、`mkdirat`、`fstatat`、`renameat2(RENAME_NOREPLACE)`、C11 `cc` 和 active Node 安装的 headers。先执行 clean build：

```bash
rm -f packages/db/.cache/native/basic-candidate-fs.node
pnpm --filter @navigator/db run build:basic-candidate-native
```

candidate 命令的 package `precandidate` 也会执行 native build。writer 使用 held directory descriptors、mode-`0700` temporary sibling、exclusive files、fsync 和 no-replace rename，只接受由真实 production composition 生成的 ready candidate。没有 JavaScript copy/rename、跨设备或非 native fallback。

必须在 Linux filesystem（例如 WSL 的 `/home/...`）中运行，不得把 staging workspace 放在 DrvFS（例如 `/mnt/c/...`）。已观察到不支持 `RENAME_NOREPLACE` 的 DrvFS 返回 `EINVAL`；这是预期的 fail-closed error，不能通过普通 rename/copy 降级绕过。

## 5. 人工审核与副作用边界

CLI 成功只创建 isolated staging 四文件并停止。它不执行以下任何动作：

- 不创建或修改 canonical `data/<countryDirectory>/`；
- 不创建独立批准回执或 `collection-manifest.json`；
- 不调用 Prisma，不创建 `KnowledgeChunk`，不改变 coverage；
- 不设置 `published`，不执行 publish action；
- 不把记录设为 `aiUsable = true`，不写 AI index；
- 不供 AI 顾问或报告能力直接消费。

成功 candidate 必须永久保持恰好四个文件：草稿 `reviewStatus = draft`、`aiUsable = false`，审核报告 `humanDecision = null`。项目所有者必须逐项审核来源、事实、冲突、双语内容、taxonomy、元字段和风险。之后的单独、经人工批准的原子任务才可按 [basic-country-publication.md](./basic-country-publication.md) 创建 candidate 目录之外的独立回执，以 byte-level SHA-256 绑定同一 country/run 的四个 artifacts，记录 `draft -> pending -> published`，并创建 canonical mapping 与六字段 manifest v2。任何 correction 都创建新 run 和新回执，绝不改写 candidate 或既有回执。

独立回执不是 reviewer 的 cryptographic signature；显式人工决定、protected Git review 和不可改写的提交历史仍是授权信任边界。publication loader 只读 repository files 并 fail closed，不执行 Prisma/API/AI/coverage import。现有 llama bridge 标记为 `legacy collection compatibility`，新 CLI 不使用它。

## 6. v1/v2 loader 行为

`loadBasicCollectionAuditBundle()` 保持原有 v1-only public contract。`loadBasicCollectionAuditBundleVersioned()` 从同一四文件 staging layout 加载纯 v1 或纯 v2：

- 三个 envelope 全为 `basic-country-audit/v1` 时使用 v1 validator；
- 三个 envelope 全为 `basic-country-audit/v2` 时使用 v2 validator；
- 任意 v1/v2 混合、未知 schema、identity drift、symlink/special file、超限、读取期间文件或目录变化都 fail closed；
- error 不泄露绝对路径或底层 filesystem 文本。

versioned loader 只读取并验证，不发布、不导入，也不把 staging 变成 product data。

## 7. 测试与 fixture 声明

`packages/db/fixtures/basic-collection-v2/id-ready.json` 只是 synthetic ID-shaped coverage fixture。`ID` 仅用于 ISO2 contract shape；所有名称、URL、来源内容、数值、时间和说明都是明确的 fixture-only 值，不代表任何真实印度尼西亚事实，也不是 canonical data。

定向验证：

```bash
pnpm --filter @navigator/db exec vitest run src/basic-deterministic-candidate-integration.test.ts src/basic-candidate-composition-integration.test.ts src/index.test.ts
```

分支完整门槛：

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm turbo run lint typecheck test --force
```

本任务没有 Web 行为，不要求 Playwright E2E。
