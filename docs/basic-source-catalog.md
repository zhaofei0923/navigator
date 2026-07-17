# basic-source-catalog.md — Basic 来源目录合同

> 本文件始于 `DATA-BASIC-CATALOG-1`，并作为后续 `DATA-BASIC-<ISO2>` 任务追加已审核来源时继续适用的规范性合同。总体边界以 [Basic 国家确定性采集与来源边界设计](./superpowers/specs/2026-07-12-basic-source-boundary-design.md) 为准；v2 transport、capture 与 CSV 边界以 [basic-source-formats.md](./basic-source-formats.md) 为准。Catalog 本身不写入 canonical、staging、Prisma 或 AI 索引。

## 1. 职责与文件

Basic source catalog 是经过代码审查的来源政策与请求控制平面：

```text
packages/db/catalog/basic-source-catalog.json
  -> parseBasicSourceCatalog(unknown)
  -> createBasicSourceExecutionPlan(...)
  -> resolveBasicSourceAdapter(...)
```

Catalog 是 `source policy`、request template、许可、访问方式和允许字段的唯一权威；adapter implementation 是响应校验与 extraction code 的唯一权威。Catalog 不是产品数据，不进入 seed、C 端、覆盖计数、KnowledgeChunk 或 AI 检索。

本任务内的 parser、materializer 和 registry 都保持 `@navigator/db` 包内部使用，不由 `packages/db/src/index.ts` 导出。后续 v2 runner 只能消费已解析并携带 digest 的 execution plan，不能在运行时添加来源、origin、query name、字段路径或 credential。

## 2. Exact JSON 合同

Catalog 顶层只允许以下 own keys：

```text
schemaVersion = basic-source-catalog/v1
catalogVersion
sources[]
countryMappings[]
```

每个 `sources[]` entry 只允许以下 own keys：

```text
sourceId
sourceName
sourceFamily
credibility
format
countryScope
requestTemplate
accept
approvedOrigins
allowedQueryParameters
accessMode
licenseName
licenseUrl
attribution
refreshCadence
adapterId
adapterVersion
adapterKind
fieldPaths
```

枚举固定为：

| 字段 | 允许值 |
|---|---|
| `sourceFamily` | `international-organization` / `official-statistics` / `government` / `energy-authority` / `regulator` / `grid-operator` / `industry-association` / `verified-research` |
| `credibility` | `OFFICIAL` / `VERIFIED` / `ESTIMATED` / `UNVERIFIED` |
| `format` | `json` / `csv` / `html` / `pdf` |
| `countryScope` | `all` 或非空、唯一、字典序排列的 ISO2 数组 |
| `accept` | `application/json` / `text/csv` / `text/html` / `application/pdf`，且必须与 `format` 精确对应 |
| `accessMode` | `open` / `optional-credentialed` |
| `refreshCadence` | `monthly` / `quarterly` / `annual` / `event-driven` / `manual` |
| `adapterKind` | `deterministic` / `manual-document` |

`sourceId` 与 `adapterId` 使用小写连字符安全 ID；`catalogVersion` 与 `adapterVersion` 使用安全版本 token。`licenseName`、`attribution` 和 `licenseUrl` 必须非空，`licenseUrl` 必须为无 credentials、无 fragment、未经 URL parser 静默改写的 canonical HTTPS URL。

`sources[]` 按 `sourceId` 严格字典序排列。`fieldPaths[]` 非空、唯一、有序，只能使用现有 audit allowlist 的 exact path；关键指标必须登记明确数字 index，例如 `marketOverview.keyIndicators[0].value`，不允许 wildcard。

## 3. Digest

Parser 不保留调用者对象。它先拒绝 accessor、symbol key、proxy、循环、稀疏数组和非普通 JSON 结构，再按本合同的 schema key 顺序重建并递归冻结 catalog。

`catalogSha256` 的计算固定为：

```text
canonical = JSON.stringify(reconstructedCatalog)
catalogSha256 = SHA-256(UTF-8(canonical))，输出小写十六进制
```

因此输入 JSON 的缩进、换行和原始 object key 顺序不改变 digest；任何重建后的语义字段、数组内容或数组顺序变化都会改变 digest。Execution plan 同时携带 `catalogVersion` 与 `catalogSha256`，伪造或不匹配的 digest 在计划生成前拒绝。

## 4. Structured Request Grammar

`requestTemplate` 只允许：

```text
origin
pathSegments[]
query[] = { name, value }
```

首版隐含且只支持固定 `GET`。`origin` 必须是无 credentials、path、query、fragment 的 exact HTTPS origin，并且出现在有序、唯一、非空的 `approvedOrigins[]` 中。

每个 path segment 和 query value 必须是完整 token：

```json
{ "kind": "literal", "value": "v2" }
{ "kind": "placeholder", "value": "countryCode" }
{ "kind": "placeholder", "value": "sourceCountryId" }
```

Placeholder 不能进入 scheme、authority、query name 或 literal 子串。Literal 与 source mapping 值不得预编码 `%HH`；path component 不能是会被 URL parser 规范化的 `.` 或 `..`。Materializer 验证大写 ISO2 后，以 `URL`、逐 path component 的 percent encoding 和 `URLSearchParams` 构造 URL；外部 ID 中的 `/` 只能成为 `%2F`，不能改变 path 层级。构造后再次验证 HTTPS、credentials、fragment、approved origin、query name 顺序与 cardinality。

Query name 必须唯一且为非空 literal；允许由 `URLSearchParams` 安全编码的 `$filter` 等结构化名称，但不允许 placeholder、预编码 `%HH`、控制字符或首尾空白。`allowedQueryParameters[]` 必须逐项、按顺序等于 template query names；query 顺序是已审核请求的一部分，不自动排序。

单次计划的 `sourceIds[]` 必须非空、唯一、按字典序排列，最多 64 项。只允许选择 `accessMode = open` 且覆盖目标国家的 source；`optional-credentialed` 只能登记，不能进入 execution plan。

## 5. Country Mapping

项目身份始终是 ISO 3166-1 alpha-2。外部来源需要其他标识时，只能使用 exact mapping：

```text
countryCode
sourceId
sourceCountryId
```

`countryMappings[]` 按 `(countryCode, sourceId)` 严格排序并唯一。Mapping 的 `sourceId` 必须存在，其 request template 必须实际使用 `{sourceCountryId}`，目标国家必须位于该 source 的 `countryScope`。使用 `{countryCode}` 或固定 URL 的 source 不得保留 orphan mapping。

创建单国 execution plan 时，使用 `{sourceCountryId}` 的每个 source 必须恰好找到一条 `(countryCode, sourceId)` mapping；缺失或多条都以 `source catalog mapping is invalid` 阻断。不得做国家名称模糊匹配或模型推断。

## 6. Adapter Binding

静态 registry 只导入仓库内已审核 adapter，不接受 module path、动态 import 或运行时插件。Binding key 固定为 `adapterId@adapterVersion`。

对首版 deterministic JSON entry，registry 在返回 adapter 前逐项比较：

- `sourceId`、`sourceName`、`sourceFamily`、`credibility`；
- `adapterId`、`adapterVersion`；
- `adapterKind = deterministic`、`format = json`、`accessMode = open`；
- materialized request 的 method、URL、Accept、origin list 和 query-name list；
- catalog entry 自身的 Accept/origins/query names 与 materialized request。

任一漂移统一返回 `source catalog adapter binding is invalid`，不回显 URL value、query value、payload 或外部错误。后续 runner 仍须在 extraction 后验证 observations 是 catalog `fieldPaths[]` 的非空子集。

格式与 executor 身份矩阵固定为：

| 格式 | adapter kind | 身份 |
|---|---|---|
| JSON / CSV | `deterministic` | reviewed source-specific adapter |
| HTML / PDF | `manual-document` | `basic-manual-document-capture@1.0.0` |

所有 HTML/PDF entry 都必须使用唯一 generic capture executor 身份。Parser 已复核该身份；未来 document runner 还必须在 cache/network 前再次复核。Generic executor 只捕获原始字节和 hash，不解析正文，不声明 source-specific metadata，也不产生 preliminary facts。

## 7. 已登记生产来源

Catalog 保留四个覆盖所有国家的 `open` World Bank JSON deterministic sources，`countryMappings = []`：

| sourceId | 用途 | fieldPaths |
|---|---|---|
| `world-bank-country` | ISO2 与英文国家名 | `country.code`, `country.name` |
| `world-bank-gdp` | GDP | `marketOverview.gdp` |
| `world-bank-gdp-growth` | GDP 增速 | `marketOverview.gdpGrowth` |
| `world-bank-population` | 人口 | `marketOverview.population` |

请求 URL、query 顺序和 adapter output 与既有 P1-6B fixtures 保持一致。Catalog 使用 World Bank Indicators API 和 World Development Indicators 的已审核归属信息；参考 [World Bank Indicators API documentation](https://datahelpdesk.worldbank.org/knowledgebase/articles/889392-about-the-indicators-api-documentation) 与 [World Bank public licenses](https://datacatalog.worldbank.org/public-licenses)。

单国任务可在同一 exact contract 下增加 country-scoped HTML/PDF manual sources。当前已登记：

| sourceId | 国家 | 格式 | 官方发布方 | 字段归属 |
|---|---|---|---|---|
| `indonesia-esdm-2025-performance` | ID | HTML | Indonesia Ministry of Energy and Mineral Resources | 能源市场基线、摘要与关键指标 |
| `indonesia-esdm-national-energy-policy-2025` | ID | PDF | Government of Indonesia | 国家能源政策目标 |
| `saudi-gastat-electrical-energy-statistics-2024` | SA | PDF | General Authority for Statistics | `country.summary`、`marketOverview.energyDemand`、关键指标组 0 和 2、`marketOverview.overview` |
| `saudi-gastat-renewable-energy-statistics-2024` | SA | HTML | General Authority for Statistics | `country.region`、`country.summary`、`marketOverview.industryTags`、关键指标组 1、`marketOverview.overview`、`marketOverview.techTags` |
| `saudi-spa-energy-storage-2025` | SA | HTML | Saudi Press Agency | `country.summary`、`marketOverview.industryTags`、`marketOverview.overview`、`marketOverview.renewableTarget`、`marketOverview.techTags` |
| `vietnam-chinhphu-adjusted-pdp8-2025` | VN | HTML | Government of Viet Nam | 调整后的电力规划 VIII 目标与产业方向 |
| `vietnam-evn-annual-report-2024-2025` | VN | PDF | Vietnam Electricity (EVN) | 2024 年装机、电力生产与购入基线 |

这些 manual sources 只通过 `basic-manual-document-capture@1.0.0` 捕获原始 bytes/hash；HTML/PDF evidence 绝不直接解析为 candidate facts。事实、双语编辑输入和 source check 必须继续由绑定 capture hash 的人工 observation plan 与人工审核提供。当前 catalog 不包含 IMF、IRENA、Ember 或 credentialed source。

`DATA-BASIC-SA-COLLECT` 的 `SA` / `data-basic-sa-20260717-r1` 是不可变的审核历史，而非可发布候选。它绑定 catalog `2026-07-17.1` 和 SHA-256 `3c174b76efe8c637436c52f473911d6409d79ac2e057eb251bb860dba4c417e7`，四个 artifact hash 分别为 `source-register.json` `fcc3de285225f2e26a04f82b72e53caf69df605971fd2eb10b0eacbe2e884711`、`extracted-facts.json` `7a423661d5b7bd2d43c7f81b39131eeea47fb82cf62624343d976128eb4d36d1`、`market-overview.draft.json` `567821ee55b5fd04cf4db198ee8a25629ec459a8f4542ae57185d478b800c92a`、`review-report.json` `a375cc5b759f3e1b619a3c1826adb0eaad48c5779a44a816a387fd021e301ee9`。由于其遗漏官方对约 `92.5 GW` 与约 `340,430 GWh` 的限定词，r1 在任何人工批准前已被 superseded；它永不得批准或发布，且不得作为任何批准决定或发布任务的输入。

唯一可供后续人工审核的 Saudi candidate 是 `SA` / `data-basic-sa-20260717-r2`。它使用相同 catalog identity 和恰好七条已登记来源：三条 Saudi official manual-document sources 与四条 World Bank deterministic sources；其 `source-register.json` 记录了七条新鲜 r2 capture identity（检索时间从 `2026-07-17T11:43:29.591Z` 至 `2026-07-17T11:43:39.177Z`，不复用 r1 capture identity）。r2 四个 staging artifact hash 分别为 `source-register.json` `b242dc902b7002dc3a2cec1bd87703760d776ada2b5c301329543b1f5945353d`、`extracted-facts.json` `bd0df36ba29453e0d337ad8401310c443ff26686cc8efc06994902b017814072`、`market-overview.draft.json` `2a297d007279afb80baeb316581aca874738ce614443a2a7944ad576e32c6285`、`review-report.json` `c8677f1bac448aa87ec79e35f3ffb9fc5b15c615f2b47ab3072ed588e09e6f9d`。r2 validator 为 valid 且 `ready-for-human-review`，有 7 个 sources、32 条 facts、零 blockers/errors/conflicts/missing/injection risks；它仍是 `reviewStatus = draft`、`aiUsable = false`、`humanDecision = null`，不是 canonical、未发布且不可用于 AI。只有独立人工决定批准 r2 后，才可创建单独的 `DATA-BASIC-SA-PUBLISH` 任务；r1 是不可变审计历史，永不得批准或发布，且不得作为该决定或任何发布任务的输入。

## 8. 资源与错误边界

| 对象 | 上限 |
|---|---:|
| catalog sources | 2,048 |
| country mappings | 10,000 |
| 每 source field paths | 128 |
| 每 request query entries | 64 |
| 其他数组 | 256 |
| JSON 深度 | 64 |
| 单字符串 | 65,536 UTF-8 bytes |
| URL | 8,192 UTF-8 bytes |
| 单国 active sources | 64 |

所有字符串还必须是可确定编码为 UTF-8 的良构 Unicode。所有超限均 fail closed，不截断。稳定错误边界为：

```text
basic source catalog is invalid
source catalog execution plan is invalid
source catalog mapping is invalid
source catalog adapter binding is invalid
```

这些错误不得包含 secrets、URL/query value、raw payload、外部异常或 filesystem path。

## 9. v1 不变与 Formats Handoff

`DATA-BASIC-CATALOG-1` 不修改以下既有行为：

- `BasicSourceRequest`、`BasicSourceTransport` 与 `captureBasicRawSource()`；
- `basic-country-raw-capture/v1` 与 `basic-country-audit/v1`；
- `runBasicDeterministicSourceAdapters()` 与四个 World Bank adapter；
- P1-6C llama bridge、P1-6D offline dry run 与 `packages/db/src/index.ts` exports。

Catalog 模块自身只生成计划和执行绑定，不调用网络、不创建 cache 或 audit artifacts。已完成的 v2 source runner 消费 reviewed execution plan，并通过四 MIME transport 建立 catalog-bound `raw-v2` cache；document evidence、editorial input 和 model-free candidate runner 再消费这些受绑定的捕获结果。HTML/PDF 仍只由 generic executor 捕获原始 bytes 与 hash，不自动解析、翻译或发布事实，也不修改本节 v1 边界。
