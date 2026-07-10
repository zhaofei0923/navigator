# basic-country-hermes-llama-bridge.md - P1-6C Hermes discovery 与 llama.cpp 草稿桥接边界

> 本文件是 P1-6C 的规范性运行时边界。它补充 [basic-country-collection.md](./basic-country-collection.md)、[basic-country-audit-contract.md](./basic-country-audit-contract.md) 与 [basic-country-source-adapters.md](./basic-country-source-adapters.md)，不新增 canonical 数据模型字段、审核状态、AI 检索范围或第五个 committed audit artifact。

## 1. 目标与非目标

P1-6C 在 P1-6A/B 之间增加两个受控桥接层：

1. Hermes discovery bridge 把 SearXNG 搜索结果重建为本地、临时、`discoveryOnly = true` 的候选记录；
2. llama.cpp draft bridge 把已验证、无 blocker 的 P1-6A facts 发送到本地 schema-constrained 模型，并重建 `BasicMarketOverviewDraft`。

P1-6C 不直接调用 canonical import，不写 `data/<country>/`、`data/staging/`、`collection-manifest.json`、Prisma、knowledge 或 AI 索引。它只返回内存对象。四文件 audit bundle 组装、review report 和离线端到端边界验证属于 P1-6D。

P1-6C 不定义或修改 AI 顾问 system prompt。llama.cpp 请求没有 `system` message、tools 或检索上下文；固定 user message 只是版本化协议框架。协议版本固定为 `basic-country-draft/v1`，operation 固定为 `return-exact-draft`，二者以导出只读常量和精确 request snapshot 测试锁定。任何修改该协议常量、新增 system message、增加开放式语义生成规则或放宽事实一致性校验的变更，都视为 collection model prompt 变更，必须按 `AGENTS.md` 的人工闸门单独审核。

## 2. 首版来源范围

P1-6B 当前只允许 `Accept: application/json` 的 HTTPS 原始来源，因此 P1-6C 首版只晋升可由 P1-6B `captureBasicRawSource()` 捕获和验证的 JSON 或 `+json` 原始来源。

- HTML、PDF、搜索结果页、登录后页面和浏览器截图可由 Hermes 发现，但只能保留为临时 discovery candidate。
- P1-6C 不建立平行 raw cache，不绕过 P1-6B MIME、URL、redirect、size、hash 或 path policy。
- 扩展 HTML/PDF 原始证据必须先在独立任务卡中修改 P1-6B 规范、实现和安全测试。

## 3. Hermes discovery contract

Hermes 通过注入的 `BasicHermesDiscoveryPort` 运行。仓库不依赖 Hermes Python 包、CLI 输出格式或 ACP 实现，也不把 query 放入 shell 命令参数。生产编排器负责把已配置 Hermes Agent 的结构化结果交给该 port；测试只使用内存替身。

### 3.1 请求

`BasicHermesDiscoveryRequest` 精确包含：

```text
countryCode, runId, queries, maxResults
```

- `countryCode` 为两个大写字母；`runId` 使用既有 safe run ID。
- `queries` 是 1-20 个去除首尾空白后非空、每项最多 256 字符的标准数组。
- `maxResults` 是 1-50 的整数，默认上限常量为 50。
- 请求不包含 repo path、环境变量、密钥、raw bytes、system prompt 或 canonical data。

### 3.2 响应 envelope

Hermes port 返回 `unknown`，bridge 只接受以下精确 envelope：

```text
schemaVersion = basic-hermes-discovery/v1
runId, countryCode, candidates
```

每个 candidate 精确包含：

```text
discoveryId, provider, query, title, snippet, url,
discoveredAt, discoveryOnly
```

- `provider` 固定为 `searxng`；`discoveryOnly` 固定为 `true`。
- `url` 必须是无用户名/密码的 HTTPS URL；字面量 loopback、private、link-local、multicast 或 unspecified IP 均拒绝。
- `title`、`snippet` 和 URL 均视为不可信数据。它们不得成为 `BasicSourceRecord`、`BasicFactEvidence`、模型输入或错误文本。
- `discoveryId` 和 canonical URL 在同一 batch 内唯一；输出按 canonical URL、再按 ID 稳定排序。
- envelope、对象和数组必须是标准 exact-own-key data-property 结构；accessor、symbol、继承键、稀疏数组、额外键和超限结果 fail closed。

`runBasicHermesDiscovery()` 使用 300 秒默认 timeout，并向 port 传入 `AbortSignal`。timeout、同步 throw、异步 rejection 和 malformed output 均返回去敏感失败，不保留外部 `message` 或 `cause`。

## 4. 打开原始来源与证据晋升

发现候选不能自授权来源。候选被选中后，调用方必须提供独立审核的 source policy，并使用 P1-6B raw capture 获取原始 JSON。`promoteBasicHermesJsonEvidence()` 的输入包括：

```text
base P1-6B result
validated discovery batch
openedSources[]:
  discoveryId
  sourcePolicy
  BasicRawCaptureResult
  Hermes observations
```

`sourcePolicy` 提供 source ID、来源名、原始 URL、来源族、可信度、访问状态、访问说明、发布时间、prompt injection 风险、approved origins 与允许的 query 参数。来源族、可信度和 approved origins 只能来自调用方审核配置，不能取自搜索标题、snippet 或页面指令。

每个 opened source 必须满足：

1. `discoveryId` 引用同一 batch 的 candidate，policy `sourceUrl` 与 candidate canonical URL 完全一致；
2. policy origin 属于非空、去重、审核的 HTTPS `approvedOrigins`；`allowedQueryParameters` 是去重的安全参数名数组，candidate/policy URL 与 capture final URL 的每个 query 参数名都必须在 allowlist 中，且同一 URL 不得重复参数名；
3. capture final URL canonical href 必须与审核的 policy `sourceUrl` 完全一致；P1-6C 首版不晋升发生 redirect 的候选，避免 P1-6A 只能保存原始 `sourceUrl` 时产生归属歧义；
4. capture `contentType` 是 JSON/`+json`，bridge 对 body 重新计算 SHA-256，并与 capture receipt 一致；
5. body 必须解析为有限 JSON；每个 locator 固定使用 `json:<RFC6901 pointer>`；
6. observation `rawValue` 必须与 locator 在实际 captured JSON body 中指向的值深度一致；
7. observation `fieldPath` 使用 P1-6A allowlist，normalized value 为有限 JSON，unit/year/uncertainty 符合既有契约；
8. source ID、field path 和 locator 的排序与合并是确定性的。

`BasicSourceRecord` 字段映射固定如下：`sourceId`、`sourceName`、`sourceUrl`、`publishedAt`、`sourceFamily`、`accessStatus`、`accessNotes`、`credibility` 与 `promptInjectionRisk` 来自审核的 source policy；`retrievedAt` 与 `contentSha256` 来自已重建并复核的 `BasicRawCaptureResult`；`evidenceLocators` 来自该来源全部已验证 observations 的 locator 去重排序；`discoveryOnly` 固定为 `false`。capture 缺任一必需字段、hash/body 不一致或 observations 为空都必须拒绝。

Hermes observations 只能为 P1-6B base 尚未覆盖的 field path 补空缺。deterministic/Hermes 同一路径、重复 source ID 或同一来源对同一路径给出不同 tuple 均 fail closed，不自动选择。

多个 Hermes 原始来源支持同一路径时：

- 相同 `(normalizedValue, unit, year)` 形成一个 `candidate`；
- 不同 tuple 且至少两个 source ID 形成一个 `conflict`；
- 任一来源 `accessStatus != open`、`credibility = UNVERIFIED` 或 `promptInjectionRisk != none` 时，相同 tuple 形成 `untrusted`；不同 tuple 仍保留 `conflict`，同时 source metadata 使审计分类产生 `UNTRUSTED_INPUT`。

晋升结果使用 `extractionMethod = hermes`，source record 固定 `discoveryOnly = false`。返回值只包含合并后的 `BasicSourceRegister`、`BasicExtractedFacts` 与 path-free receipts；不包含 candidate title、snippet、raw body、cache path 或 source policy。

Hermes fact ID 复用 P1-6B 的稳定算法：`fact-` 加 `SHA-256(fieldPath UTF-8)` 的前 16 个小写十六进制字符。P1-6A 的一条 field path 只能出现一次，且 deterministic/Hermes overlap 会先被拒绝，因此该算法在同一 bundle 内唯一；合并后必须再次验证 fact ID 与 field path 均无重复。

## 5. llama.cpp schema draft bridge

### 5.1 模型输入闸门

`bridgeBasicMarketOverviewDraft()` 只接受通过以下预检的 source register/facts：

- identity 与 schema version 一致；
- 所有来源均为 `open`、非 `UNVERIFIED`、`discoveryOnly = false`、`promptInjectionRisk = none`；
- facts 的 required static paths 完整，indicator 索引从 0 连续且每项四个子路径齐全；
- 每个 fact 恰好出现一次、状态均为 `candidate`、evidence 非空且引用合法；
- 每个 candidate 的全部 normalized values 深度一致；
- 不存在 missing、conflict、untrusted 或未知路径。

预检失败返回 `DRAFT_INPUT_BLOCKED`，不得调用 llama transport。

bridge 从 candidate normalized values 确定性重建 expected draft，并固定：

```text
reviewStatus = draft
aiUsable = false
```

模型请求只包含 expected draft，不包含 discovery title/snippet、rawValue、raw bytes、页面全文、repo path、cache path、环境变量、密钥或 review/canonical 字段。

### 5.2 llama.cpp transport

`createBasicLlamaCppDraftTransport()` 使用注入的 fetch，并只允许：

- `http://127.0.0.1:<port>/v1` 或 `http://[::1]:<port>/v1`；
- 显式 model alias，不接受文件路径或空白；
- `POST /v1/chat/completions`，`redirect = error`，无 cookie、无 API key、无 proxy 配置；
- `stream = false`、`temperature = 0`、`chat_template_kwargs.enable_thinking = false`；
- `response_format.type = json_schema`，schema 全层 `additionalProperties = false`；
- 默认 timeout 120 秒，请求最多 1 MiB，响应最多 256 KiB；
- 不自动 retry。

请求协议常量固定为 `BASIC_LLAMA_DRAFT_PROTOCOL_VERSION = "basic-country-draft/v1"` 与 `BASIC_LLAMA_DRAFT_OPERATION = "return-exact-draft"`。测试必须断言完整 user message envelope、message role/count、schema 与锁字段的精确快照；当前任务不得从环境或调用方覆盖这些常量。

HTTP 非 2xx、redirect、错误 MIME、timeout、超限 body、畸形 OpenAI-compatible envelope、空 choices、非 `stop` finish reason、非字符串 content、非 JSON content 均 fail closed。响应只重建首个 choice 的 content，忽略并不保留其他 provider 字段。

### 5.3 输出校验

模型 content 先由独立 draft parser 重建为精确 `BasicMarketOverviewDraft`，再与 expected draft 深度比较。以下任一情况失败且不返回部分 draft：

- 缺键、额外键、错误类型、非法枚举、非有限数值或非法时间/URL；
- `{ zh, en }` 双语对象形状错误或两侧均为空；
- `reviewStatus != draft`、`aiUsable != false` 或出现 policy/canonical/knowledge/workflow 字段；
- 任一模型值与已验证 facts 派生值不一致。

成功结果是新建、冻结、path-free 的 draft 内存对象。bridge 不执行发布，也不把 Basic 数据加入 AI 检索。

## 6. 错误与重试

公共失败使用去敏感 discriminated result，不抛出外部错误：

```text
{ ok: false, error: { code, phase, retryable } }
```

错误 message 若通过 `BasicCollectionBridgeError` 暴露，只能是 `P1-6C bridge failed: <CODE>`，不得带 `cause`。固定错误码为：

```text
INPUT_INVALID
HERMES_TIMEOUT
HERMES_UNAVAILABLE
HERMES_RESPONSE_INVALID
SEARXNG_RECORD_INVALID
DISCOVERY_URL_FORBIDDEN
ORIGINAL_SOURCE_REQUIRED
SOURCE_CAPTURE_INVALID
EVIDENCE_INVALID
EVIDENCE_UNTRUSTED
DRAFT_INPUT_BLOCKED
LLAMA_TIMEOUT
LLAMA_UNAVAILABLE
LLAMA_RESPONSE_INVALID
LLAMA_OUTPUT_NOT_JSON
LLAMA_OUTPUT_INCOMPLETE
LLAMA_OUTPUT_SCHEMA_INVALID
LLAMA_OUTPUT_UNGROUNDED
DRAFT_LOCK_VIOLATION
```

只有 timeout/unavailable 默认为 `retryable = true`。core 不自动 retry，避免重复 Hermes/模型副作用；上层可在人工可见的运行边界决定是否重试。

## 7. 配置与环境

P1-6C core 不读取 `process.env`。Hermes port、loopback llama base URL、model alias、timeout 和 fetch/process adapter 均由调用方显式注入，因此本任务不新增 `.env` 字段，也不复用 AI 顾问的 `AI_*` 配置。

当前已验证的本地开发实例可通过显式参数使用 `http://127.0.0.1:8080/v1` 与 model alias `qwen35b`。真实连通性检查是 opt-in smoke test，不属于 `pnpm test`，不写入仓库数据。

## 8. 测试与 P1-6D 边界

P1-6C 单元测试必须使用 injected fakes/fetch 和 fake timers，并把 global fetch 设为抛错哨兵；测试不得启动或访问 Hermes、SearXNG、llama.cpp、socket 或 child process。

测试至少覆盖 discovery exact parsing/timeout/redaction、search snippet 隔离、原始 JSON pointer 与 SHA 校验、source policy、冲突/不可信处理、base path collision、模型请求 schema、loopback policy、body/time limits、所有 model failure 类别、draft lock、双语降级、facts grounding、公共导出和 canonical/import/AI 隔离。

P1-6D 负责把 P1-6A/B/C 内存产物组装为离线四文件 audit bundle，生成保守 review report，并验证 normal/missing/conflict/untrusted 四条完整路径。P1-6D 仍不得自动发布或选择冲突值。
