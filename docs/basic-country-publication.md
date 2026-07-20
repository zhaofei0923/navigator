# basic-country-publication.md - Basic v2/v3 发布操作规范

> 本文件是 `DATA-BASIC-PUBLISH-V2-1` 交付的规范性发布边界，也是后续 `DATA-BASIC-<ISO2>-PUBLISH` 单国任务的操作依据。字段与覆盖判定仍以 [data-schema.md](./data-schema.md) 和 [coverage-levels.md](./coverage-levels.md) 为唯一事实来源，采集与 candidate 规则见 [basic-country-collection.md](./basic-country-collection.md) 和 [basic-deterministic-candidate.md](./basic-deterministic-candidate.md)。

## 1. 范围与不变量

Basic v2 发布闸门只接受一个确定性、可供人工审核的 `basic-country-audit/v2` candidate、一个独立的人工批准回执和与二者精确绑定的 canonical Basic 数据。它不创建批准、不写 canonical 文件，也不发布任何国家数据。

candidate 目录必须且只能包含以下四个文件：

```text
data/staging/<countryDirectory>/<runId>/
  source-register.json
  extracted-facts.json
  market-overview.draft.json
  review-report.json
```

这四个文件在 candidate 创建后不可变。`market-overview.draft.json.reviewStatus` 保持 `draft`，`market-overview.draft.json.aiUsable` 保持 `false`，`review-report.json.humanDecision` 保持 `null`。不得在该目录增加第五个文件，也不得通过修改其中任何文件记录人工批准。

人工批准只记录在 candidate 目录之外的独立回执中。任何 correction 都必须创建新的 `<runId>`、新的四文件 candidate 和新的批准回执；不得改写已有 candidate、批准回执或已批准 artifact。旧 run 和旧回执保留为不可变审计历史。

## 2. 独立批准回执

回执路径固定为：

```text
data/approvals/<countryDirectory>/<runId>.json
```

回执是 strict JSON，必须恰好具有以下结构和 keys，不允许扩展字段。任何层级的 object member name 都必须唯一；解码后相同的 escaped-equivalent name（例如 `a` 与 `\u0061`）也视为重复并 fail closed：

```json
{
  "schemaVersion": "basic-country-publication-approval/v1",
  "countryDirectory": "<countryDirectory>",
  "countryCode": "<ISO2>",
  "runId": "<runId>",
  "submission": {
    "fromReviewStatus": "draft",
    "toReviewStatus": "pending",
    "submittedAt": "<canonical UTC RFC 3339 timestamp>"
  },
  "decision": "approved",
  "reviewerId": "<bounded non-blank identifier>",
  "decidedAt": "<canonical UTC RFC 3339 timestamp>",
  "authorizedPublication": {
    "coverageLevel": "BASIC",
    "fromReviewStatus": "pending",
    "toReviewStatus": "published",
    "aiUsable": false
  },
  "artifactSha256": {
    "source-register.json": "<lowercase SHA-256>",
    "extracted-facts.json": "<lowercase SHA-256>",
    "market-overview.draft.json": "<lowercase SHA-256>",
    "review-report.json": "<lowercase SHA-256>"
  }
}
```

`schemaVersion`、`decision`、两个状态转换、`coverageLevel` 和 `aiUsable` 都是固定 literal。`countryDirectory`、`countryCode` 和 `runId` 分别遵守既有 safe slug、ISO 3166-1 alpha-2 和 safe run ID 规则。四个 hash key 必须完整且唯一，每个值必须是 64 字符小写十六进制 SHA-256。

`submittedAt` 不得早于 candidate 中最新的 source `retrievedAt` 或草稿 `collectedAt`；`decidedAt` 不得早于 `submittedAt`。没有批准决定的 rejected 或 correction-requested candidate 不生成此回执。

## 3. Publication manifest v2

每个已发布 canonical country 目录必须且只能包含 `country.json`、`market-overview.json` 和 `collection-manifest.json`。其中 manifest 是 strict JSON，必须恰好具有以下六个字段，并遵守与回执相同的全层级 member-name 唯一性规则：

```json
{
  "schemaVersion": "basic-country-publication-manifest/v2",
  "activeRunId": "<runId>",
  "mappingVersion": "basic-country-canonical/v2",
  "auditBundlePath": "data/staging/<countryDirectory>/<runId>",
  "approvalReceiptPath": "data/approvals/<countryDirectory>/<runId>.json",
  "approvalReceiptSha256": "<lowercase SHA-256>"
}
```

manifest 位于 `data/<countryDirectory>/collection-manifest.json`。loader 在验证 `countryDirectory` 和 `activeRunId` 后自行派生以下两个期望路径：

```text
data/staging/<countryDirectory>/<activeRunId>
data/approvals/<countryDirectory>/<activeRunId>.json
```

`auditBundlePath` 和 `approvalReceiptPath` 必须与派生值逐字相等。它们只是 identity assertions，不是任意 filesystem capabilities。绝对路径、路径穿越、反斜杠、NUL、alias、symlink、special file、未知版本或非规范 hash 全部 fail closed。

## 4. 字节级 SHA-256 绑定

hash 始终针对稳定读取到的原始文件 bytes，而不是重新序列化后的 JSON：

1. `artifactSha256` 的四个值分别绑定四个 candidate 文件的精确 bytes。
2. `approvalReceiptSha256` 绑定独立批准回执的精确 bytes。
3. manifest、回执、candidate 和 canonical mapping 共同形成一个 country/run publication identity。

空白、换行或 object-key 顺序的任何字节变化都会改变 digest，即使解析后的 JSON 语义相同。digest 在严格解码小写 hex 后使用 constant-time byte comparison。loader 只从已派生的 repository path 读取 regular files，拒绝 symlink 和 special file，执行大小上限、held-descriptor identity checks、读取前后 identity checks，并要求 phase-two manifest bytes 与 phase-one 完全相同。manifest、回执、四个 candidate artifact 以及 canonical country/market bytes 都必须先通过 bounded strict JSON text scan；scan 拒绝任意层级重复 members、非 Unicode scalar 文本、畸形语法和超限结构，之后才允许把语义值交给 validator。

## 5. 审核生命周期

唯一允许的生命周期是 `draft -> pending -> published`：

1. immutable candidate 保持 `draft`，并以 zero blockers、`ready-for-human-review` 和 `request-human-review` 证明机器侧 readiness。
2. 回执的 `submission` 记录 `draft -> pending` 及提交时间。
3. 人工决定只授权回执中的 `pending -> published`。
4. 只有 canonical `market-overview.json.reviewStatus` 为 `published`；candidate 草稿和审核报告不被修改。

回执证明两个有序转换，但自身不写产品数据。任何跳过 `pending`、倒序时间、不同 run、不同国家或不同 bytes 的组合都不能通过发布闸门。

## 6. Validator 的固定顺序

`validateApprovedBasicCountryPublicationV2()` 按以下顺序 fail closed，首个失败阶段返回一个稳定 blocker code，不返回已验证数据：

1. 解析 strict manifest 和批准回执。
2. 校验支持的 schema version 与 mapping version literal。
3. 校验 country directory、ISO2、run ID、派生路径和 candidate envelope identity 完全一致。
4. 对批准回执 bytes 计算 SHA-256，并与 manifest 比较。
5. 对四个 candidate artifact bytes 分别计算 SHA-256，并与回执比较。
6. 运行既有 Basic v2 candidate validator，并要求 valid、ready、zero blockers、固定 readiness/recommendation、空人工决定、draft 状态和 `aiUsable = false`。
7. 校验 `draft -> pending -> published` literals 及两个 timestamp ordering rules。
8. 从唯一且有证据的 approved candidate facts 重建六个 country fields，并要求 canonical country mapping deep-equal。
9. 要求 canonical market overview 与 candidate draft deep-equal，唯一允许的变化是 `reviewStatus` 变为 `published`；`aiUsable` 仍为 `false`。
10. 按既有通用规则派生 coverage 并要求恰好为 `BASIC`：market overview 已发布，其余九个模块全部为 `BUILDING` 且 `dataCount = 0`。
11. 要求没有 deep-module records、KnowledgeChunk、AI-eligible IDs 或未预期的 canonical artifacts。

稳定 blocker category enumeration 的全集及公开 array 顺序恰好为：

```text
MANIFEST_INVALID
APPROVAL_RECEIPT_INVALID
APPROVAL_RECEIPT_HASH_MISMATCH
CANDIDATE_ARTIFACT_HASH_MISMATCH
PUBLICATION_IDENTITY_MISMATCH
CANDIDATE_NOT_READY
APPROVAL_TIMESTAMP_INVALID
CANONICAL_MAPPING_DRIFT
BASIC_COVERAGE_VIOLATION
AI_BOUNDARY_VIOLATION
PUBLICATION_READ_FAILED
```

这段 array 顺序是稳定的 category-set contract，不定义 validator 的 first-failure precedence。first-failure precedence 仅以上述编号 1-11 的 validator sequence 为准；因此 identity 在回执 hash 和 candidate hash 之前判定，即使公开 category array 中两个 hash category 排在 `PUBLICATION_IDENTITY_MISMATCH` 之前，也不得据此重排 validator。

错误结果不包含 raw source content、绝对路径、reviewer notes、parser details 或底层 filesystem message。

## 7. Basic 与 AI 边界

此闸门只授权 `BASIC`。canonical `market-overview.json` 必须为 `published` 且 `aiUsable = false`；其余九个模块不得有记录，knowledge 必须为空，不创建 KnowledgeChunk，不产生 AI-eligible ID，也不写 AI index。`STANDARD`、`COMPLETE`、`aiUsable = true` 或任何 deeper-module data 都必须被阻断，并由后续单独、经人工批准的任务处理。

## 8. 信任边界与只读 loader

批准回执不是 reviewer 的 cryptographic signature。hash 能防止意外替换和 mapping drift，但不能防御能够同时改写代码、文件和 Git history 的恶意 repository administrator。授权信任边界仍是显式人工决定、protected Git review 和不可改写的提交历史。

`loadApprovedBasicCountryPublicationV2()` 只接受绝对且规范化的 repository root 与已验证 country directory。它只读 canonical 三文件、独立回执和 immutable candidate 四文件，再调用 validator；不写文件、不调用 Prisma、不导入数据库、不暴露 API、不执行 AI/RAG/KnowledgeChunk 操作、不导入 coverage 数据，也不访问网络、child process 或环境变量。coverage 只在内存中按既有通用规则派生并校验。

`collection-manifest.json` 和批准回执都是 non-product sidecars：不进入 Prisma、seed records、API responses、C 端业务数据、coverage counts 或 AI retrieval。因此本发布契约不修改 `docs/data-schema.md`，也不修改 Prisma schema。

## 9. 单国发布任务操作顺序

后续单国原子发布任务必须：

1. 重新稳定读取已获人工确认的四文件 candidate，并核对其精确 SHA-256 identity。
2. 为同一 country/run 创建新的独立批准回执，不修改 candidate。
3. 由 candidate 确定性生成 canonical `country.json` 和 `market-overview.json`，仅将 canonical review status 提升为 `published`。
4. 创建六字段 manifest v2，并以回执 bytes 的 SHA-256 绑定它。
5. 通过只读 loader 和 validator 后，才可在该单国任务中原子提交 canonical 数据、回执和 manifest。
6. 若任何事实、翻译、元字段或 artifact 需要修正，停止当前发布并创建新 run 与新回执。

`DATA-BASIC-PUBLISH-V2-1` 只交付上述通用能力和规范，不创建真实回执、canonical country 或任何国家发布。

## 10. Basic v3 单国快速发布 CLI

`basic-country-audit/v3` candidate 增加经审核的八类 `basicProfile`，但仍沿用第 2 节的
`basic-country-publication-approval/v1` 人工回执。v3 发布使用独立版本 literal：

```text
manifest schemaVersion: basic-country-publication-manifest/v3
mappingVersion:         basic-country-canonical/v3
```

CLI 只接受一个国家、一个 run 和一个已存在的受控仓库内回执：

```bash
pnpm basic:publish \
  --country=ID \
  --run-id=<runId> \
  --approval-file=data/approvals/<countryDirectory>/<runId>.json
```

`--approval-file` 不是任意 filesystem capability。它必须逐字等于由回执 identity 派生的
`data/approvals/<countryDirectory>/<runId>.json`；绝对路径、alias、路径穿越、symlink、不同
country/run、硬链接和批量 country 参数均拒绝。四个 candidate 文件同样必须各自只有一个
硬链接。CLI 不创建、修改或补全批准回执，也不产生人工批准
决定。

发布前，CLI 以 descriptor-relative、`O_NOFOLLOW`、bounded read 读取并持有回执和四个
candidate 文件的 identity 与精确 bytes，校验四个回执 hash、`draft -> pending -> published`、
`BASIC`、`aiUsable=false`、其余九模块为空和 KnowledgeChunk 为空。原子写入前再次按持有的
dev/ino、metadata 和 bytes 复核授权输入。

通过 `validateApprovedBasicCountryPublicationV3()` 后，只在单个
`data/<countryDirectory>/` 目录生成以下三个文件：

```text
collection-manifest.json
country.json
market-overview.json
```

writer 先在 `data/` 下创建私有 UUID 临时目录，以 exclusive regular files 写入、fsync 并复核
exact-three 内容，再用 no-replace rename 发布。既有 canonical 目录绝不替换；发布前失败只按
已登记的 dev/ino 清理本次拥有的部分文件和临时目录。该命令不写 candidate、approval、Prisma、
AI index 或其他国家目录，也不提供批量发布模式。

no-replace rename 成功是不可逆的 commit point。命令结果固定包含
`postCommitVerified`：正常的 rename 后 held-child、parent fsync、hierarchy、exact-three file
复核和资源关闭全部成功时为 `true`；其中任一后置检查或关闭失败时仍返回
`status: "published"`，但将该字段设为 `false`，提示操作者进行只读复核。此时 canonical 已经
durable published，命令不得返回“未发布”，再次执行也会因 no-replace 明确拒绝，而不是产生
含糊的二次发布。
native ABI 必须区分 `OK` 与 `COMMITTED_UNVERIFIED`：后者表示 `renameat2` 已成功、但 native
目标 identity 后验失败，仍属于已提交且不得清理，只会令 `postCommitVerified=false`。只有明确
发生在 rename commit point 之前的 native error 才属于未发布失败。

现有 v2 parser、materializer、validator、loader 和六国 canonical bytes 保持不变；v3 profile
只由新的 v3 parser/materializer/validator/CLI 路径处理。

## 11. Basic v3 单国刷新 CLI

刷新既有已批准 BASIC publication 必须使用独立的 `basic:refresh` capability；不得删除既有
canonical 目录后复用 `basic:publish`，也不得给首次发布命令增加 replace 参数。命令只接受一个
国家、一个不同的新 run 和由该 country/run identity 精确派生的既有批准回执：

```bash
pnpm basic:refresh \
  --country=ID \
  --run-id=<newRunId> \
  --approval-file=data/approvals/<countryDirectory>/<newRunId>.json
```

CLI 从一个经验证的 repository root 打开并持有全部 filesystem capabilities。它先稳定读取并验证
当前 active v2 或 v3 exact-three publication，再稳定读取目标 v3 candidate 与
`basic-country-publication-approval/v1` 回执；active、target 与命令参数的 country identity 必须完全
一致，run 必须不同，目标 `decidedAt` 必须严格晚于 active 回执，并且 target 四文件 bytes 必须与
回执 hash 完全一致。目标在 private mode-`0700` transaction 中完成 exact-three 确定性构造、fsync
和 approved-publication validation 后，立即在 commit 前重新验证 active/target 的 held identity 与
bytes。任何 commit 前错误只返回固定脱敏错误，不创建或补全批准，不改变 canonical。

Linux 原生 `renameat2(RENAME_EXCHANGE)` 成功交换 transaction `canonical` 与
`data/<countryDirectory>` 的时刻是刷新 **commit point**；没有 JavaScript rename、copy、普通 rename、
跨 filesystem 或不支持 ABI 的 fallback。commit 后发生 native 后验、held-child、exact-three、fsync、
validator 或 capability close 失败时，结果仍固定为 `status: "refreshed"`，仅将
`postCommitVerified` 设为 `false`，不得把已提交刷新报告为未提交，也不得自动回滚。

旧 canonical exact-three tree 不做逐文件删除。writer 创建 private mode-`0700`
`recovery-<transactionUuid>` 空占位，并通过同一 authenticated `RENAME_EXCHANGE` 将完整旧 tree 原子
保留到 `.cache/basic-country-refresh/recovery-<transactionUuid>`。只允许按已登记 identity 删除交换后
的空占位和空 transaction wrapper；任何 retention 或清理失败都必须保留一棵完整旧 tree。即使刷新
完全验证通过，recovery artifact 也继续作为受限恢复证据保留；其 garbage collection 是未来独立、
明确审核的任务，本 CLI 不实现 deferred GC。

rollback 不由 CLI 执行。需要回退时，对包含该单国 canonical 与回执变更的 publication commit 执行
单独审核的 `git revert <publication-commit>`，随后重新运行 approved-publication validation、lint、
typecheck、tests、E2E、合并/推送策略与 CI-SHA 对齐。禁止直接恢复文件、force push、hard reset，或
删除旧 candidate/receipt/recovery history。

刷新只改变 repository 中该国的 canonical tracked bytes；它不调用 Prisma、不连接或写入
PostgreSQL、不导入 seed、不修改 KnowledgeChunk 或 AI index、不调用 API/Web service，也不改变
`aiUsable=false`、BASIC 覆盖和其余九个 `BUILDING`/`dataCount=0` 模块。持久数据库或 AI runtime 的
任何更新都属于另一项需要明确授权的任务。命令不支持 batch，不自动批准，不修改 candidate、回执、
其他国家、deep-module 数据或 schema。
