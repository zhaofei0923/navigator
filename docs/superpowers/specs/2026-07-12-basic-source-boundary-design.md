# Basic 国家确定性采集与来源边界设计

> 任务卡：`DATA-BASIC-SOURCE-BOUNDARY-1`
> 状态：项目所有者已确认，可按分片实施
> 日期：2026-07-12

## 1. 目标

为所有 `DATA-BASIC-<ISO2>` 任务建立国家中立、可复现、可审核的 Basic 数据采集框架。完整 Basic 候选流水线在 Windows `llama.cpp`、Hermes Agent、SearXNG 或任何生成式模型全部关闭时仍须正常运行。

本任务只交付确定性来源框架及印尼形状的离线集成验证。框架合并 `main` 后，当前 `DATA-BASIC-ID` 分支再合并最新 `main`，使用新运行标识 `data-basic-id-20260711-r2` 执行真实印尼候选采集。失败的 `r1` 不改写。

## 2. 核心决策

1. Basic 数值事实由版本化 source catalog 和固定 source adapters 获取，不在运行时搜索来源。
2. JSON、`+json`、CSV、CKAN JSON 和 SDMX-JSON 可形成机器验证证据；HTML/PDF 只进行原始字节捕获、哈希和人工证据登记。
3. `country.summary`、市场概述、能源需求、可再生能源目标和双语标签由人工基于已捕获来源填写，固定为 `extractionMethod = manual`。
4. Basic draft 由已验证 facts 确定性组装，不调用 llama.cpp，不进行模型翻译或模型摘要。
5. Hermes、SearXNG 和本地模型不是 Basic 采集依赖。它们只用于后续 AI 交互、报告制作，或在 source catalog 缺来源时提供不进入发布流水线的研究建议。
6. 所有候选保持 `reviewStatus = draft`、`aiUsable = false`；项目所有者审核四文件候选包前不生成 canonical 数据。
7. 现有 `basic-country-audit/v1`、`basic-country-raw-capture/v1` 和 `runBasicOfflineDryRun()` 保持兼容；新流程使用并行的 v2 audit/capture contract 与 model-free candidate API。
8. 唯一新增运行时依赖是 `csv-parse`。项目所有者已在本任务会话中批准安装解析依赖；本设计不引入 HTML/PDF 解析库。

## 3. 为什么更稳定

模型与 agent 擅长开放式研究和表达，但不适合作为 Basic 事实采集的控制平面。将它们移出必经链路后：

- 相同 source version、country code 和 run ID 产生相同请求、raw capture 和 facts；
- CI 与单元测试不依赖 Windows 服务、模型权重、Prompt、tool loop 或网络搜索排序；
- 查询、字段映射、单位、年份、许可和更新频率全部经过代码审查；
- 外部页面不能通过 prompt injection 改写 source policy 或字段映射；
- 失败表现为稳定错误和 blocked run，而不是模型补写或部分成功；
- 人工成本集中在少量双语叙述与政策判断，不浪费在可自动拉取的数值上。

这种方案不是“无人参与的全自动采集”，而是“结构化事实自动化、叙述和政策人工化”。这与 Basic 阶段先保证展示、追溯和审核的目标一致。

## 4. 范围

### 4.1 本任务包含

- 版本化、机器校验的 Basic source catalog。
- source-specific country identifier mapping，项目主键始终保持 ISO 3166-1 alpha-2。
- JSON/`+json`、CSV、HTML、PDF 的严格 MIME 捕获边界。
- CSV 的严格解析、行列 locator 和原始单元格验证。
- HTML/PDF 的人工证据输入、来源策略、capture hash 绑定和 `manual` fact 晋升。
- 人工双语 editorial input 的 exact schema、事实证据绑定和校验。
- 从完整 candidate facts 确定性组装 `BasicMarketOverviewDraft`。
- 把现有 World Bank country/indicator adapters 注册到 catalog，并证明既有请求与事实输出不变。
- 新增 v2 四文件 audit contract、catalog/capture 版本绑定与 model-free candidate API。
- 保留 v1 audit/capture、P1-6D dry-run、llama collection bridge 的兼容性与回归验证。
- 使用 `ID` 身份但不含真实国家事实的离线 integration fixture。
- 文档、单元测试、集成测试、独立代码审查与主线交付。

### 4.2 本任务不包含

- 真实印尼、越南、沙特、阿联酋、巴西或南非数据采集。
- 5 国试点和 30–50 国批量扩展。
- 运行时网页搜索、Hermes tool calls 或 llama.cpp calls。
- 自动解析 HTML/PDF、OCR 或模型翻译。
- 新增 IMF、IRENASTAT、Ember 或其他真实 source-specific adapters；它们各自通过后续任务卡接入。
- HTTP POST、SDMX-XML、XLSX、ZIP 或 credential 注入能力。
- 修改 canonical country/market-overview schema、10 模块、覆盖等级或 Prisma schema。
- 修改 AI 顾问检索边界、system prompt、权限、会员、计费或发布规则。
- 自动批准、自动发布、KnowledgeChunk、向量索引或 Basic AI 问答。
- 数据库写入、清理、迁移或其他破坏性操作。

### 4.3 兼容迁移决策

现有 P1-6A 到 P1-6D 是已经发布的严格 v1 边界，不能一边声明兼容、一边移除其 normal path 的 `bridge/model` 输入。本设计采用并行迁移：

- `basic-country-audit/v1`、`basic-country-raw-capture/v1`、`runBasicOfflineDryRun()`、既有 stage names 和 exports 原样保留并继续通过全部测试；
- 新增 `basic-country-audit/v2`，四个文件名保持不变：`source-register.json`、`extracted-facts.json`、`review-report.json` 的 `schemaVersion` 都必须精确等于 `basic-country-audit/v2`；source register 顶层在既有 identity/sources 之外增加 `catalogVersion` 与 `catalogSha256`；`market-overview.draft.json` 继续是无 envelope 的既有 draft shape；
- 新增 `basic-country-raw-capture/v2`，在 v1 manifest 精确字段基础上增加相同的 `catalogVersion` 与 `catalogSha256`，二者进入 cache identity；
- v2 使用独立 exact types、parser、validator 和 backward-compatible loader 分支，不把新字段伪装成 v1 optional keys；同一 audit directory 的三个 envelope 文件必须全部为 v1 或全部为 v2，loader 拒绝混合版本；
- 新增 `runBasicDeterministicCandidate()`，normal input 不包含 bridge、model、Prompt 或生成式端口，并使用独立 stage/result contract；
- `collection-manifest.json` 在未来批准 v2 canonical 发布时使用 `mappingVersion = basic-v2`，同时由被引用的 v2 source register 提供完整 catalog digest；
- 旧 llama bridge 标记为 legacy collection compatibility，不接入新的 Basic CLI，也不复用为 AI 顾问或报告生成器。

v2 candidate API 成为后续 `DATA-BASIC-<ISO2>` 的唯一正常入口；v1 只用于兼容既有测试和历史调用。删除 v1 属于未来独立 breaking-change 任务，不在本设计范围内。

## 5. 分支与交付

当前 `feat/DATA-BASIC-SOURCE-BOUNDARY-1` 只承载本规格。规格经项目所有者复核后先独立提交、审查，以 `--no-ff` 合并并推送 `main`；后续实现使用 §16 的独立任务卡和分支，不在设计分支堆叠代码。所有分支都从当时最新 `main` 开始，不从尚未合并的 `DATA-BASIC-ID` 分支取代码。

§16 全部实现任务卡进入 `main` 后：

1. 合并最新 `main` 到 `feat/DATA-BASIC-ID-indonesia-basic`；
2. 将印尼候选运行器切换为 source catalog、结构化 capture 与 manual editorial input；
3. 使用 `data-basic-id-20260711-r2` 运行真实采集；
4. 生成且验证四文件候选包后停止，等待项目所有者事实与翻译审核。

## 6. 总体架构

```text
reviewed source catalog + country identifier map
  -> deterministic JSON/CSV source adapters
  -> immutable raw capture + SHA-256
  -> deterministic numeric facts
  -> reviewed HTML/PDF manual evidence + bilingual editorial input
  -> complete source register + extracted facts
  -> model-free completeness and trust preflight
  -> deterministic Basic draft assembler
  -> four-file candidate audit package
  -> project-owner review
```

来源批准、采集、事实晋升、叙述编写和 draft 组装保持独立边界。URL 不能代替 capture，capture 不能代替 evidence locator，人工叙述不能脱离已登记来源，draft 不能代替项目所有者批准。

## 7. 版本化 Source Catalog

### 7.1 Catalog 作用

Source catalog 是经过代码审查的采集控制平面。它不是 canonical 产品数据，也不进入 Prisma、C 端响应、覆盖计数或 AI 检索。

首版文件与职责固定为：

```text
packages/db/catalog/basic-source-catalog.json
packages/db/src/collection/basic-source-catalog.ts
packages/db/src/collection/basic-source-adapter-registry.ts
```

JSON 文件只保存数据；catalog 模块从 `unknown` 重建 exact schema、生成 execution plan 与 digest；registry 只把静态 `adapterId@adapterVersion` 映射到已导入实现，禁止动态 module path 或运行时插件加载。`catalogVersion` 使用 safe version token；`catalogSha256` 为重建后按 schema key order 输出的 compact JSON UTF-8 字节 SHA-256，因此不受 checkout 换行影响。

Catalog 是 source policy、request template 和允许字段的唯一权威；deterministic adapter implementation 是 response validation 与 extraction code 的唯一权威。对 `adapterKind = deterministic`，执行前必须逐字段验证 catalog 与 adapter 的 sourceId/name/family/credibility、adapter identity、materialized request method/URL/Accept/origins/query names 完全一致，执行后 observation paths 必须是 catalog fieldPaths 的非空子集。`adapterKind = manual-document` 使用唯一 generic capture executor，executor 不声明 source-specific metadata、不解析正文且不产生 preliminary facts；document plan 与人工输入承担后续事实边界。任一不匹配在 cache/network 前拒绝。

Catalog 顶层固定包含：

```text
schemaVersion = basic-source-catalog/v1
catalogVersion
sources[]
countryMappings[]
```

每个 source entry 精确包含：

```text
sourceId
sourceName
sourceFamily
credibility = OFFICIAL | VERIFIED | ESTIMATED | UNVERIFIED
format = json | csv | html | pdf
countryScope = all | ISO2[]
requestTemplate = { origin, pathSegments[], query[] }
accept
approvedOrigins
allowedQueryParameters
accessMode = open | optional-credentialed
licenseName
licenseUrl
attribution
refreshCadence = monthly | quarterly | annual | event-driven | manual
adapterId
adapterVersion
adapterKind = deterministic | manual-document
fieldPaths[]
```

`format = html | pdf` 必须使用 `manual-document`；首版 `json | csv` 必须使用 `deterministic`。manual-document entry 的 adapter identity 固定为 `basic-manual-document-capture@1.0.0`，指向 reviewed generic executor；国家与 URL 差异只存在 catalog 数据中，不形成国家特例代码。parser 与 runner 都必须在 cache/network 前复核该 identity。

`countryScope = ISO2[]` 时数组必须非空、去重并按字典序排序。单国政府或监管机构页面以相同 source entry 结构登记，并通过 `countryScope` 限制适用国家；不得在 adapter 代码中写国家特例。新增或变更国家专属 URL 仍须走 catalog code review。

`requestTemplate` 在首版只描述固定 `GET`，不包含 request body、fragment 或运行时 headers。`origin` 必须是无 credentials、无 path/query/fragment 的 approved HTTPS origin；每个 path segment 和 query value 是 exact `{ kind: literal, value }` 或 `{ kind: placeholder, value: countryCode | sourceCountryId }`，query name 只能是唯一、非空 literal。placeholder 必须占完整 path segment 或完整 query value，绝不能出现在 scheme、host、port、query name 或 literal 的子串中。

Materializer 使用 `URL`、逐 segment percent-encoding 和 `URLSearchParams` 结构化构造 URL，禁止字符串替换。`countryCode` 先验证大写 ISO2 形状；`sourceCountryId` 先从 exact mapping 读取，再作为单一 component 编码。构造完成后重新验证无 credentials/fragment、origin、query name/cardinality 与 canonical URL；`allowedQueryParameters` 必须与 template query names 完全一致。`fieldPaths[]` 必须非空、唯一、有序，并只包含现有 audit allowlist 中的 exact path；indicator 也必须登记 exact numeric index，不能使用 wildcard。adapter 每次输出必须是 catalog `fieldPaths[]` 的非空子集，且不能超出其自身 reviewed allowlist。

运行时不能添加来源、origin、query 名、字段路径或 credential 参数。HTTP POST、SDMX-XML、XLSX 和 ZIP 必须由后续独立 adapter 设计引入。

`licenseName`、`attribution` 必须非空，`licenseUrl` 必须为已批准 HTTPS URL；无法确认许可或引用条件的来源不能进入 execution plan。任何 executable entry 变化都必须提升 `catalogVersion`；request、format、field mapping 或 normalization 变化还必须提升 `adapterVersion`。同一 run 只能绑定一个 catalog version。

Execution plan 显式携带 `catalogVersion/catalogSha256`；每个 raw-capture/v2 manifest 和最终 audit/v2 source register 必须逐字相等。runner 禁止合并不同 digest 的 capture、manual input 或 facts；digest mismatch 在事实物化前阻断。已提交 audit 包所在 Git commit 同时保留对应 catalog 文件，形成 artifact digest + repository snapshot 的双重绑定。

### 7.2 Country identifier map

项目身份始终使用 ISO2。外部来源需要 ISO3、机构代码或国家名称时，使用 version-controlled mapping：

```text
countryCode = ISO2
sourceId
sourceCountryId
```

只有 `requestTemplate` 使用 `{sourceCountryId}` 时才需要 mapping，并且目标国家必须恰好存在一条 `(countryCode, sourceId)`；使用 `{countryCode}` 或固定单国 URL 时不得存在未使用 mapping。`countryMappings[]` 因而可以为空。重复、缺失、空白、孤立 mapping 或一个 source ID 映射到错误国家时 fail closed。映射来自来源 metadata 和人工审核，不由名称模糊匹配或模型推断。

### 7.3 初始来源策略

默认 Basic 流水线只能依赖 `accessMode = open` 的来源。v2 runner 只能选择和执行 `open` entry；`optional-credentialed` 仅用于记录后续增强候选，进入 execution plan 时立即拒绝。credential transport 是需另行批准的任务，secret 永远不能出现在 request URL、query、catalog 或 raw manifest 中。任何 required fact 都不得把 credentialed source 作为唯一来源。

首批 source family 规划：

| 来源 | 主要用途 | 本任务状态 |
| --- | --- | --- |
| World Bank Indicators API | 国家英文名、人口、GDP、GDP 增速、通电率及可用能源指标 | 注册现有开放 adapters，作为首版机器采集基线 |
| IMF DataMapper v2 / SDMX-JSON | 增长、通胀等宏观补充与交叉核验 | catalog 可表达，真实 adapter 后续实现 |
| IRENASTAT versioned GET download / JSON | 可再生能源容量与发电 | catalog 可表达，真实 adapter 后续实现 |
| Ember API / versioned data | 电力需求与发电结构 | credentialed entry 不可执行；开放版本化 adapter 后续实现 |
| IEA/政府/监管机构原始 HTML/PDF | 政策目标和人工概述 | 实现通用 capture/manual evidence 边界；真实链接随国家任务审核登记 |

本任务不会承诺尚未验证 endpoint 的可用性，也不会为了接入 PxWeb POST、SDMX-XML 或下载工作簿扩大 transport。具体 endpoint、许可与字段映射每次通过 catalog code review；来源网站首页、搜索摘要和模型记忆不能登记为事实来源。

### 7.4 官方参考入口

- [World Bank Indicators API documentation](https://datahelpdesk.worldbank.org/knowledgebase/articles/889392-about-the-indicators-api-documentation)
- [IMF Data APIs](https://data.imf.org/en/Resource-Pages/IMF-API)
- [IRENASTAT downloads](https://www.irena.org/Data/Downloads/IRENASTAT)
- [Ember API documentation](https://api.ember-energy.org/docs)
- [IEA Global Energy Policies Hub](https://www.iea.org/data-and-statistics/data-tools/global-energy-policies-hub) 与 [IEA terms](https://www.iea.org/terms)

这些入口只用于 adapter 任务的人工核验；真正可执行的 endpoint、许可、字段和版本仍以 reviewed catalog entry 为准。

## 8. 多格式 Raw Capture

现有 `BasicSourceRequest`、`BasicSourceTransport` 和 `captureBasicRawSource()` 属于 v1，继续只接受 `GET + application/json`，其 TypeScript union、runtime parser 和行为均不扩宽。新增 `BasicSourceRequestV2`、`BasicSourceTransportV2` 与 `captureBasicRawSourceV2()`；v2 request 保持相同的 method/url/origin/query 结构，但 `accept` 使用以下精确 union：

| Accept | 允许响应 MIME |
| --- | --- |
| `application/json` | `application/json` 或合法 `+json` |
| `text/csv` | `text/csv` |
| `text/html` | `text/html` |
| `application/pdf` | `application/pdf` |

MIME 参数按既有规范化逻辑处理，但主类型必须精确匹配。`application/octet-stream`、`application/vnd.ms-excel`、缺失/冲突 Content-Type 均拒绝；例外必须通过后续 reviewed adapter code change。

以下 P1-6B 安全边界在 v2 中原样继承：

- HTTPS original source、无 URL credentials；
- 精确 origin 与 query parameter allowlist；
- 手动 redirect，最多 3 次；
- raw payload 上限 10 MiB；
- transfer decoding 后、解析前原始字节 SHA-256；
- content-addressed immutable cache、原子发布、symlink/traversal 拒绝；
- capture manifest 不记录 headers、tokens、cookies、canonical 值或审核状态。

`captureBasicRawSourceV2()` 的 exact input 还包含 `catalogVersion/catalogSha256`；v2 manifest 使用 §4.3 的 raw-capture/v2 schema。每个 catalog digest、adapter/version/source ID、request 和 `accept` 都属于 cache identity；来源版本或格式变化必须使用新的 adapter version 或 run ID。v1 与 v2 cache 不能相互复用。

## 9. 结构化事实采集

### 9.1 JSON、CKAN 与 SDMX

JSON 保持现有 RFC 6901 `json:` pointer、raw-value 深度一致、有限 JSON、hash 和 source policy 校验。CKAN 和 SDMX 不创建绕行管道：优先选择官方 JSON endpoint，并沿用相同证据规则。

每个 adapter 只负责已批准字段，不能根据响应中出现的额外内容动态扩展 field path。数值不做估算；null 只有在现有字段合同允许时才保留。

JSON/CSV sources 使用 exact、临时 `basic-structured-source-review/v1` 输入：

```text
schemaVersion = basic-structured-source-review/v1
runId
countryCode
catalogVersion
catalogSha256
sources[] = { sourceId, sourceCheck = { status, notes } }
injectionRisks[] = { sourceId, locator, severity, details }
```

identity/digest 必须与 execution plan 一致；sources 必须非空、sourceId 唯一有序并恰好覆盖 deterministic run 的 sources；injectionRisks 使用既有 exact shape，允许空数组但不得引用外部 source/locator。`passed` 表示审核者已确认 catalog 许可/访问策略、国家和指标身份、capture hash 与 deterministic adapter validation 均通过；它不替代程序对 rawValue/locator 的验证。该临时输入只生成最终 sourceChecks/injectionRisks，不新增 committed artifact。

deterministic adapter observations 在 preliminary 阶段按路径所有权分流：source-backed path 形成 preliminary fact；`country.name` 形成等待受控 enrichment 的 preliminary fact；editorial-owned path 只形成按 sourceId/fieldPath/locator/rawValue 稳定排序的 `structuredEditorialEvidence` 中间值；derived path 立即拒绝。`structuredEditorialEvidence` 不新增 committed artifact，只允许 §10.2 editorial item 逐字引用。不得把 editorial observation 先物化成 deterministic final fact，再与 manual editorial fact 产生伪冲突。

### 9.2 CSV

CSV 使用 `csv-parse` 严格解析：

- UTF-8 fatal decode，允许单个 UTF-8 BOM；
- 第一行是 header；header 必须非空、trim 后不变且唯一；
- 行列数量必须一致，不接受 relaxed column count；
- delimiter 固定为逗号，不启用 comment、relax quotes、skip empty lines 或自动列发现；
- 不自动转换 number、date、boolean、formula 或空值；raw cell 一律先保留 string；
- quoted delimiter、quoted newline 和 escaped quote 按 RFC 4180 语义处理；
- 畸形引号、重复 header、缺失 header、超限 record 或目标行列不存在均 fail closed。

资源上限固定为：raw payload 继续受 10 MiB 总上限；最多 100,000 个 data rows、256 columns；header name 最多 256 UTF-8 bytes；单 cell 最多 65,536 UTF-8 bytes；`max_record_size = 1,048,576`。超限时整个 source run 失败，不截断数据。

CSV locator 固定为：

```text
csv:/rows/<zero-based-data-row>/columns/<RFC6901-escaped-header>
```

`rawValue` 必须与解析后的目标 cell 逐字一致。`normalizedValue`、unit、year 和 uncertainty 来自 reviewed adapter mapping，并继续通过有限 JSON、field-path allowlist 和 canonical/draft deep-equality 校验。CSV facts 使用 `extractionMethod = deterministic`。

## 10. HTML/PDF 与人工 Editorial Input

### 10.1 Document evidence

HTML/PDF 只扩展 raw capture 和人工 evidence promotion，不做自动 DOM、OCR 或 PDF text extraction。

HTML/PDF source 必须同时提供 exact、临时 `basic-manual-source-review/v1` 输入，不新增 committed artifact：

```text
schemaVersion = basic-manual-source-review/v1
runId
countryCode
catalogVersion
catalogSha256
sources[] = {
  sourceId,
  publishedAt,
  accessNotes,
  promptInjectionRisk,
  sourceCheck = { status, notes },
  injectionRisks[] = { locator, severity, details }
}
```

`runId`、`countryCode`、`catalogVersion`、`catalogSha256` 必须与 execution plan 完全一致；sources 必须非空、sourceId 唯一有序并恰好覆盖本次 HTML/PDF sources。`publishedAt` 必须是 strict UTC RFC3339 或 null；为 null 时 `sourceCheck.notes` 必须非空说明无法确定发布时间。`accessNotes` 为非空字符串或 null；`promptInjectionRisk` 只能是 `none | suspected | confirmed`，必须由人工显式选择，不能默认成 `none`。risk 为 none 时 injectionRisks 必须为空；risk 为 suspected/confirmed 时至少有一条同 severity、locator 存在于该 source document plan 的风险记录。`sourceCheck` 只能是既有 passed/failed 结构，并进入最终 review report。structured 与 manual review 不能重复同一 sourceId。

合法 `BasicSourceRecord` 的字段所有权固定如下：

| 字段 | 唯一所有者 |
| --- | --- |
| sourceId/sourceName/sourceFamily/credibility | reviewed catalog |
| sourceUrl/retrievedAt/contentSha256 | verified v2 raw capture；sourceUrl 为原始 materialized request URL |
| publishedAt/accessNotes/promptInjectionRisk | JSON/CSV adapter output；HTML/PDF 为 manual source review |
| evidenceLocators | 已接受 document/editorial/derived observations 的 locator 去重排序 |
| accessStatus | catalog accessMode；v2 只可能物化 open |
| discoveryOnly | v2 固定 false |
| source check | manual source review 或结构化来源审核输入，写入 review report 而非 source record |

任一字段缺失、多个所有者给出不同值，或 catalog/adapter/manual review identity 不一致时 fail closed。

每个 HTML/PDF source 必须提供一个 exact、临时 document plan：

```text
schemaVersion = basic-document-observation-plan/v1
runId
countryCode
catalogVersion
catalogSha256
sourceId
capture = {
  adapterId, adapterVersion, requestUrl,
  retrievedAt, contentType, byteLength, contentSha256
}
observations[] = {
  usage = source-fact,
  fieldPath, locator, rawValue, normalizedValue, unit, year, uncertainty
} | {
  usage = editorial-evidence,
  fieldPath, locator, rawValue
}
```

顶层 identity/digest、sourceId、adapter identity、request URL 和 capture fields 必须与 catalog execution plan 及 raw-capture/v2 manifest 完全一致。observations 必须非空；locator 必须非空，rawValue 必须为与 capture 完全一致的有限 JSON 值。source-fact path 只能属于 §12 source-backed 集合，其 normalizedValue/unit/year/uncertainty 满足既有合同；editorial-evidence path 只能属于 §10.2 allowlist，且不接受 normalizedValue/unit/year/uncertainty keys。manual source review 的 `passed` 明确表示审核者已在该 exact `contentSha256` 对应字节中核对本 source 的全部 observation locator 与 rawValue，并确认 source identity、访问/许可和 prompt-injection 结论；少核对一项不能标 passed。

HTML locator 使用 `html:` 前缀并描述页面 section/table/label；PDF locator 使用 `pdf:page=<positive-integer>#<nonblank-anchor>`。locator 只证明人工审查位置，不声称程序已解析正文。

Document facts 固定为 `extractionMethod = manual`。只有 source 为 open、非 `UNVERIFIED`、promptInjectionRisk 为 none，且 review report 对该 source ID 至少有一个 `passed` source check 时，事实才可能通过 preflight。

`usage = source-fact` 直接形成 §12 的 source-backed fact；`usage = editorial-evidence` 只能被一个 §10.2 item 以 exact sourceId/locator/rawValue 引用。同一 observation 不得同时以两种方式物化；editorial-owned path 必须经过 editorial input，不能由 document plan 绕过双语、枚举或 enrichment 校验。

### 10.2 Bilingual editorial input

人工输入使用 exact、临时 operator schema，不新增第五个 committed audit artifact。顶层固定包含：

```text
schemaVersion = basic-country-editorial-input/v1
runId
countryCode
catalogVersion
catalogSha256
primarySourceId
items[]
```

`runId`、`countryCode`、`catalogVersion`、`catalogSha256` 必须与 collection execution plan 完全一致。`primarySourceId` 只能选择本次事实实际引用、catalog 允许该国家使用、capture 已验证、access 为 open 且 source check passed 的来源。它只决定现有单值 `marketOverview.source/sourceUrl` 的代表来源，不会隐藏 source register 中的其他证据来源。

每个 `items[]` entry 固定包含：

```text
fieldPath
normalizedValue
evidence[] = sourceId + locator + rawValue + unit + year
uncertainty
```

items 必须按 fieldPath 唯一并稳定排序；每项 evidence 按 sourceId/locator 唯一排序。所有 editorial allowlist 路径，包括 indicator label，其 evidence 必须固定 `unit = null`、`year = null`；来源发布时间只存在 `BasicSourceRecord.publishedAt`，不得放进 editorial tuple。document `editorial-evidence` 引用必须逐字匹配 sourceId/fieldPath/locator/rawValue；deterministic source 引用必须逐字匹配对应 preliminary observation 的 sourceId/fieldPath/locator/rawValue，但不继承其 unit/year。

Editorial input 只允许以下路径：

- `country.name` 的中文补全；
- `country.region`；
- `country.summary`；
- `marketOverview.overview`；
- `marketOverview.energyDemand`；
- `marketOverview.renewableTarget`；
- `marketOverview.industryTags`；
- `marketOverview.techTags`；
- `marketOverview.keyIndicators[i].label`；

`country.name` 是受控 enrichment：既有 World Bank adapter 的请求和 English-only observation 输出保持不变；v2 enrichment layer 消费该 observation，要求英文与来源原值完全一致，只允许人工补全非空中文，然后在最终 v2 extracted facts 中以一个 manual candidate 取代 preliminary fact，同时保留原 sourceId、locator 和 rawValue。adapter-level output 与 final audit facts 是两个明确阶段，不能把替换误写成 adapter 行为变化。`country.region` 是项目七区 taxonomy 的人工分类，必须来自既有 `Region` 枚举并绑定支持该分类的来源；不得把 World Bank 等机构的不同地区体系按字符串自动映射。其他展示文本使用 `{ zh, en }`，两侧必须同时非空；不启用自动翻译。tag 值只能来自既有 `IndustryTag` / `TechTag` 枚举，去重并稳定排序。

综合叙述可以绑定多个来源，各 evidence 可保留不同 rawValue，但必须支持同一个 reviewed normalizedValue。人工输入转换为现有 `BasicExtractedFact` 后固定 `extractionMethod = manual`，完整内容保留在 `extracted-facts.json` 和 source register 关系中。

Editorial input 不得填写或覆盖以下受保护值：国家码、国旗、时间；人口、GDP、GDP 增速；source metadata、可信度；指标 value/unit/year。受保护业务值只能来自 JSON/CSV adapter 或 §10.1 中绑定 raw capture 的人工 document observation；系统 metadata 只能按 §10.3 派生。任何未列入 allowlist 的 editorial path 都 fail closed。

搜索 title/snippet、页面指令、raw document bytes 与未审核摘录不进入 draft assembler，更不会进入 AI 索引。

### 10.3 系统派生 facts

在事实合并完成后，runner 从本次非派生 candidate facts 实际引用的 source IDs 形成 `activeEvidenceSources`，再生成以下确定性 facts；operator 不能直接提供这些值：

- `country.flagEmoji`：按 ISO2 转为两个 Unicode regional indicator symbols；
- `marketOverview.source` / `marketOverview.sourceUrl`：取已验证 `primarySourceId` 的 `sourceName` / `sourceUrl`；
- `marketOverview.collectedAt`：取 active sources 中最大的 `retrievedAt`；
- `marketOverview.updatedAt` 与 `country.updatedAt`：取 active sources 中最大的非空 `publishedAt`；若全部为空，回退到最大的 `retrievedAt` 并在 fact uncertainty 标记该回退；
- `marketOverview.credibility`：按 `OFFICIAL > VERIFIED > ESTIMATED > UNVERIFIED` 取 active sources 中最低可信度；
- `marketOverview.countryCode`：取已验证 run identity 的 ISO2。

派生 fact 不创建 synthetic source，证据归属固定如下：

- `country.flagEmoji` 与 `marketOverview.countryCode` 复用唯一 candidate `country.code` fact 的全部 sourceId、原 locator 和 raw ISO2；只把 normalizedValue 分别变为国旗或同一 ISO2；
- source/sourceUrl 绑定 primary source，并分别使用 `metadata:/sourceName`、`metadata:/sourceUrl`；
- collectedAt 对每个 active source 使用 `capture:/retrievedAt`；
- updatedAt 对有发布时间的 active source 使用 `metadata:/publishedAt`，全空回退时对每个 active source 使用 `capture:/retrievedAt`；
- credibility 对每个 active source 使用 `metadata:/credibility`。

metadata/capture locator 必须在最终 source record 的 `evidenceLocators` 中按确定性规则加入、去重和排序；fact evidence 的 `sourceId` 必须指向该 record。`rawValue` 保留参与派生的 source metadata 或 ISO2，所有 evidence 的 `normalizedValue` 必须等于最终聚合值，`extractionMethod = deterministic`。active source 为空、country.code 非唯一 candidate、primary source 不在 active set、时间不可比较或值不满足现有 schema 时阻断运行。

## 11. 确定性 Draft Assembler

### 11.1 Model-free candidate API

`runBasicDeterministicCandidate()` 是新的 in-memory v2 orchestrator。它的 exact input 为：

```text
countryDirectory
countryCode
runId
catalogVersion
catalogSha256
runner = { run(): Promise<BasicDeterministicMaterializationResultV2> }
sourceChecks[]
injectionRisks[]
```

`BasicDeterministicMaterializationResultV2` 只包含 v2 sourceRegister、v2 extractedFacts 和既有 path-free receipts；它是经过 catalog、capture、structured/manual review、document/editorial materialization 与 derived-fact 阶段后的最终事实输入。runner port 只能有一个 `run` method，并被调用恰好一次；orchestrator 不读取 env、文件路径、filesystem、global fetch、socket 或 child process。生产 CLI 在 composition layer 创建 runner，测试使用 injected fake。

Stage names 固定为：

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

result exact keys 为 `stages`、`failedStage`、`validation`、`artifacts`、`boundaryVerdict`。stages 始终按上述八项完整输出，每个 outcome 只能是 passed/blocked/skipped；首个失败 stage 为 blocked，后续全部 skipped，`failedStage` 指向该 stage；成功时 `failedStage = null`。在 validate stage 前失败时 `validation = null`，否则保存 exact v2 validation result。失败、blocker 或未达到 ready-for-human-review 时 `artifacts = null`；只有全部前置 stage passed、v2 validation valid、无 blockers 且 ready-for-human-review 时才生成四个 in-memory artifacts。所有 dependency throw/reject、non-native promise、畸形对象或 identity/catalog mismatch 都转换为去敏感 blocked result，不向外抛出外部错误。

Boundary verdict 沿用“不触碰 canonical/Prisma/coverage/KnowledgeChunk/AI index”的 exact 语义；core 自身也不写 staging。未来 `candidate:basic-country` CLI 只有在 core 返回 ready artifacts 后，才可把四文件原子写入隔离的 `data/staging/<country>/<runId>/`，不得写 canonical 或 `collection-manifest.json`。

### 11.2 Internal assembler

现有 llama draft bridge 已在模型调用前从 facts 重建 expected draft。本任务把这段纯函数能力提取为 `assembleBasicMarketOverviewDraft()`，Basic candidate runner 直接使用它。

v2 orchestrator 先调用 trust preflight。Preflight 的 exact input 包含 source register、extracted facts、sourceChecks 和 injectionRisks，独占 access、credibility、discovery、prompt injection、failed/missing source check、identity 与 blocker 判断。只有无 errors、无 blockers 的同一份 deep-frozen material 才能进入 assembler；assembler 为 package-internal pure function，不从 package root 单独导出。

Assembler 自身只负责以下结构与确定性重建条件：

- identity 与 schema version 一致；
- required static paths 完整且唯一；
- indicator 索引从 0 连续，每项具备 label/value/unit/year；
- facts 全部为 candidate，evidence 非空并引用合法来源；
- normalized values 深度一致；
- 不存在 missing、conflict 或 untrusted fact。

输出按事实确定性重建，并固定：

```text
reviewStatus = draft
aiUsable = false
```

Assembler 不接受 source checks、injection risks、model port、Prompt、自由文本上下文或网络能力；这些输入分别属于 preflight 或完全不属于 Basic。未来新增的 `candidate:basic-country` CLI 只调用 v2 deterministic orchestrator。现有 llama.cpp transport 与 bridge 只保留给 v1 collection compatibility，不用于新 CLI、AI 顾问或报告能力。

## 12. 事实合并与完整性

来源结果继续输出既有 `BasicSourceRegister`、`BasicExtractedFacts` 和 path-free receipts。相同字段的证据按既有 tuple 规则处理：相同 normalized tuple 为 candidate，不同来源不同 tuple 为 conflict，单一来源对同一路径产生多个 tuple 为结构错误。

一个最终 fact 只能有一个 extractionMethod。除 `country.name` 的受控 enrichment 和 §10.3 系统派生外，同一 fieldPath 同时出现 deterministic 与 manual source-fact observations 时直接拒绝，不采用优先级、不合并为一个 fact；人工交叉核验可写 sourceCheck notes，但不能伪装成混合 evidence。全 deterministic observations 物化为 deterministic fact，全 manual observations 物化为 manual fact。`country.name` 先消费 deterministic preliminary observation，再只输出一个 manual final fact；derived paths 在 source-backed/editorial merge 完成后只输出 deterministic fact。

Required path ownership 固定如下，不允许 runner 临时改变：

- source-backed：`country.code`、人口、GDP、GDP 增速及 indicator value/unit/year；
- hybrid enrichment：`country.name` 的来源英文值 + 人工中文值；
- editorial：`country.region`、`country.summary`、三项市场叙述、industry/tech tags 及 indicator label；
- deterministic derived：国旗、国家/市场更新时间、market source/sourceUrl/collectedAt/credibility/countryCode。

source-backed 值可由 JSON/CSV adapter 或受 §10.1 约束的 document observation 提供；同一路径出现不同 normalized tuple 仍按 conflict 处理，不能由 editorial input 覆盖。

在 draft 组装前必须完整覆盖：

- `country.code/name/summary/region/flagEmoji/updatedAt`；
- market overview 的 14 个静态审计路径；
- 至少一个 `keyIndicators[0]`，以及其后每个连续 `keyIndicators[i]` 的 `label/value/unit/year`。

最终 v2 fact 在 candidate public boundary 必须再次按路径检查 extractionMethod，而不能只相信上游 runner：`country.name` 与 editorial paths 必须为 `manual`；derived paths 必须为 `deterministic`；source-backed paths 可为 deterministic adapter 或 reviewed document 产生的 `manual`。任一错误所有权在 artifact 生成前阻断。

每个 evidence source 必须有 passed source check。missing、conflict、untrusted、非 open、`UNVERIFIED`、prompt injection 风险或 source check failure 均阻断；不得用模型、搜索摘要、估算或占位文案补齐必需事实。

## 13. Hermes、本地模型与报告能力的新定位

### Hermes

Hermes 可在 source catalog 缺少某国来源时辅助研究能源部、监管机构或政策文件。其结果是人类研究建议，不是 discovery batch、source policy 或 evidence。新增来源必须由人工打开、核验许可和字段，再通过独立 catalog code review 才能进入下一批运行。

### 本地模型

本地模型用于：

- 基于已发布、可检索数据的 AI 咨询；
- 报告草稿和表达优化；
- 人工明确触发的翻译建议。

这些输出不得反向覆盖 Basic 事实、source metadata、审核状态或 `aiUsable`。报告与 AI 任务继续遵守 published + aiUsable 检索红线；Basic 数据仍固定 `aiUsable = false`。

仓库现有 llama draft bridge 是 `basic-country-draft/v1` 的 legacy collection compatibility 实现，只为保持已发布 P1-6C/P1-6D 合同与测试而保留。未来 AI 顾问和报告制作必须在各自任务中建立独立输入、Prompt、权限与发布边界，不能直接复用该 bridge。

## 14. 失败与安全语义

- Catalog、mapping、request、MIME、redirect、origin、query、hash、cache、CSV、document locator 或 editorial evidence 任一失败均使用稳定、去敏感错误。
- v2 execution plan 出现 credentialed source 时立即失败；其未配置状态对默认 Basic 没有影响，也不能造成隐式降级或模型补写。
- 错误不回显 URL 参数值、响应体、文件摘录、token、cookie 或外部 error message。
- 外部内容全部视为不可信数据，不执行其中命令，不允许其修改 catalog、source policy、字段映射或 draft 规则。
- raw capture 失败不写 staging/canonical；不生成部分四文件包。
- 不自动选择 conflict、不自动升级可信度、不执行发布。

非 raw 输入同样有固定资源边界：catalog 最多 2,048 个 sources、10,000 个 mappings，每个 entry 最多 128 个 field paths 和 64 个 query entries；单次国家运行最多 64 个 active sources；manual review 最多 64 个 source reviews；editorial input 最多 256 items、每项最多 32 个 evidence。除 catalog 顶层 sources/mappings 的上述专用上限外，重建 JSON 使用最大深度 64、单数组最多 256 项、单字符串最多 65,536 UTF-8 bytes；URL 另限 8,192 bytes。超限、稀疏数组、accessor、proxy、循环或非有限数值全部 fail closed。

## 15. 测试策略

### 15.1 Catalog 与 adapters

- catalog exact schema、版本、唯一 source ID、format/accept 矩阵和字段 allowlist；
- canonical catalog digest 对 object key/checkout 换行稳定，任一语义变化改变 digest；
- `countryScope` 的 all/非空唯一有序 ISO2、越界国家与国家专属 entry；
- `{countryCode}` / `{sourceCountryId}` placeholder、mapping 必需/禁止条件、唯一性、孤立值与稳定排序；
- request template 只能是 GET；拒绝 authority/query-name/sub-string placeholder、双重编码、credentials、fragment 和构造后 origin/query 漂移；
- `fieldPaths[]` exact path、indicator index、排序及 adapter output 子集；
- catalog/registry/adapter 的每个重复 metadata/request 字段逐项漂移测试；
- `optional-credentialed` 不能进入 v2 execution plan，也不能成为 required fact 的唯一来源；
- 现有 World Bank adapters 注册后保持 exact request 和 observation 行为；
- source response 的国家、指标、单位、年份和 pagination 必须匹配 adapter；
- global fetch、Hermes、SearXNG、llama、socket 和 child process 使用抛错哨兵。

### 15.2 Capture 与 CSV

- v1 request/transport/capture 的 public types 与 runtime 继续拒绝非 JSON；v2 API 独立接受四类 MIME，双方 cache 不互用；
- 四类 Accept/MIME 正常矩阵与所有 mismatch；
- raw-capture/v2 的 catalog version/digest 必须与 execution plan 和 audit/v2 完全一致，并进入 cache identity；
- redirect、origin/query allowlist、10 MiB、hash、cache reuse/tampering、symlink 原有测试回归；
- CSV BOM、delimiter、quoted newline、escaped quote、空 cell；
- duplicate/blank header、列数不齐、畸形 quote、无效 UTF-8、每一种资源超限、缺失 locator；
- raw cell 逐字验证、normalized finite JSON、稳定 locator/fact ordering。

### 15.3 Manual evidence 与 deterministic draft

- HTML/PDF 只允许 `manual` extractionMethod；
- manual source review exact schema、字段所有权、null publishedAt 说明、显式 injection risk 和 failed check；
- source/capture/catalog digest/MIME/hash/locator mismatch 和空 observations；
- editorial 顶层 identity、primary source、双语两侧缺失、无 evidence、unsupported/protected path、不同 normalized tuple；
- `country.name` 只补中文且英文 exact match、region/tag enum、去重/排序；
- 国旗、primary source metadata、时间回退、最低可信度和 countryCode 的 exact 派生；
- 每个 derived evidence 的 sourceId/locator 在 source record 中存在，禁止 synthetic source；
- 缺 passed check、failed check、UNVERIFIED、非 open 和 injection risk 阻断；
- assembler 在完整 candidate facts 上产生 exact draft，并锁定 draft/false；
- deterministic candidate exact input/runner port、runner exactly once、stage 顺序、首错 blocked/后续 skipped、artifact 生成条件；
- candidate normal path 调用 model、Hermes 或 search 哨兵时测试失败；
- v1 audit/capture/dry-run exports、stage names、fixtures 与行为完全回归；v2 input 不接受 v1 bridge/model keys；
- v2 三个 envelope schemaVersion 一致、draft 无 envelope、loader 拒绝 v1/v2 混合目录；
- 同一语义的乱序 catalog/manual/editorial 输入产生 byte-identical v2 artifacts；
- deterministic/manual 同 path 拒绝、同 method 合并，以及 country.name/derived 两个显式例外；
- 至少一个完整 `keyIndicators[0]`，零指标或非连续指标阻断；
- 所有失败路径验证 URL 参数值、raw 文本、token、cookie 和外部错误不泄漏；
- ID-shaped fixture 完整覆盖 20 个静态路径和至少一个完整指标组；
- 临时仓库中的 synthetic ID 集成从 catalog/execution plan、真实 v2 capture/cache、reviews、document/editorial materialization、candidate artifacts 一直运行到原子 staging writer，并逐边界验证同一 catalog digest、blocked 不写入、成功只有四文件且无 manifest/canonical 写入；
- 无 canonical、Prisma、KnowledgeChunk、AI index、环境副作用或 Web import。

## 16. 多 Agent 执行与验收

为遵守“一次一个任务卡”，本设计批准后先把规格提交并合并，再按顺序建立五个独立分支；前一张卡合并并推送 `main` 后才开始下一张：

1. `DATA-BASIC-CATALOG-1`：catalog exact parser/digest、structured request materializer、country mapping、static adapter registry 和现有 World Bank 注册/漂移测试；不新增依赖，不改 capture/audit v1。
2. `DATA-BASIC-FORMATS-1`：raw-capture/v2 的 catalog binding、四 MIME、CSV parser/locator/resource limits；本卡单独引入已批准的 `csv-parse`。
3. `DATA-BASIC-DOCUMENTS-1`：audit/v2 source identity、manual source review、HTML/PDF document evidence 和 locator/source ownership；不处理双语 editorial 或组装 draft。
4. `DATA-BASIC-EDITORIAL-1`：editorial exact input、country.name enrichment、region/tags/narratives、derived facts 和确定性事实终态；不调用模型、不组装完整 draft。
5. `DATA-BASIC-DETERMINISTIC-1`：v2 trust preflight、internal draft assembler、`runBasicDeterministicCandidate()`、未来 `candidate:basic-country` CLI、v1/v2 loader compatibility、ID-shaped offline integration 与规范迁移。

每张任务卡由实现 agent 编码和运行定向测试；独立审查 agent 对照本设计、`AGENTS.md` 与相关 docs 检查。Critical/Important 问题必须由修复 agent 修复并由同一审查范围复审通过。主 agent 负责该卡最终 diff、全量测试、`--no-ff` 合并 `main` 与推送 GitHub；不得把五张卡积压到一次合并。

分支与合并后的 `main` 都必须通过：

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm turbo run lint typecheck test --force
```

本任务不修改 Web 用户流程，因此不运行 Playwright。验收还要求工作区干净、除 `csv-parse` 外无新增依赖、无 canonical/data/database 变更，且 `main` 推送后与 `origin/main` 指向同一 merge commit。

## 17. 后续任务

五张实现任务卡全部合并并推送后恢复 `DATA-BASIC-ID`，以 `r2` 做首个真实、无 AI 服务依赖的集成验证。印尼四文件候选包只有在来源、事实、双语人工输入、风险和 review report 均通过独立审查后才提交项目所有者；项目所有者批准前不生成 canonical 数据。

印尼验证通过后，另行创建 5 国 Basic 试点任务，建议顺序为 `VN`、`SA`、`AE`、`BR`、`ZA`。每国保持 `BASIC`、其他九模块 `BUILDING`、所有 Basic 数据 `aiUsable = false`；30–50 国扩展不属于本任务。
