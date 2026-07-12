# basic-source-catalog.md — Basic 来源目录合同

> 本文件是 `DATA-BASIC-CATALOG-1` 的规范性合同。总体边界以 [Basic 国家确定性采集与来源边界设计](./superpowers/specs/2026-07-12-basic-source-boundary-design.md) 为准；本任务只建立目录、请求计划与既有 World Bank adapter 绑定，不执行 v2 capture，不写入 canonical、staging、Prisma 或 AI 索引。

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

`sourceId` 与 `adapterId` 使用小写连字符安全 ID；`catalogVersion` 与 `adapterVersion` 使用安全版本 token。`licenseName`、`attribution` 和 `licenseUrl` 必须非空，`licenseUrl` 必须为无 credentials、无 fragment 的 HTTPS URL。

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

Placeholder 不能进入 scheme、authority、query name 或 literal 子串。Literal 与 source mapping 值不得预编码 `%HH`。Materializer 验证大写 ISO2 后，以 `URL`、逐 path component 的 percent encoding 和 `URLSearchParams` 构造 URL；外部 ID 中的 `/` 只能成为 `%2F`，不能改变 path 层级。构造后再次验证 HTTPS、credentials、fragment、approved origin、query name 顺序与 cardinality。

Query name 必须唯一且为非空 literal。`allowedQueryParameters[]` 必须逐项、按顺序等于 template query names；query 顺序是已审核请求的一部分，不自动排序。

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

## 7. 首版 World Bank Sources

首版 catalog 只含四个 `open` World Bank JSON sources，`countryMappings = []`：

| sourceId | 用途 | fieldPaths |
|---|---|---|
| `world-bank-country` | ISO2 与英文国家名 | `country.code`, `country.name` |
| `world-bank-gdp` | GDP | `marketOverview.gdp` |
| `world-bank-gdp-growth` | GDP 增速 | `marketOverview.gdpGrowth` |
| `world-bank-population` | 人口 | `marketOverview.population` |

请求 URL、query 顺序和 adapter output 与既有 P1-6B fixtures 保持一致。Catalog 使用 World Bank Indicators API 和 World Development Indicators 的已审核归属信息；参考 [World Bank Indicators API documentation](https://datahelpdesk.worldbank.org/knowledgebase/articles/889392-about-the-indicators-api-documentation) 与 [World Bank public licenses](https://datacatalog.worldbank.org/public-licenses)。首版不包含 IMF、IRENA、Ember、HTML、PDF 或 credentialed source。

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

所有超限均 fail closed，不截断。稳定错误边界为：

```text
basic source catalog is invalid
source catalog execution plan is invalid
source catalog mapping is invalid
source catalog adapter binding is invalid
```

这些错误不得包含 secrets、URL/query value、raw payload、外部异常或 filesystem path。

## 9. v1 不变边界

`DATA-BASIC-CATALOG-1` 不修改以下既有行为：

- `BasicSourceRequest`、`BasicSourceTransport` 与 `captureBasicRawSource()`；
- `basic-country-raw-capture/v1` 与 `basic-country-audit/v1`；
- `runBasicDeterministicSourceAdapters()` 与四个 World Bank adapter；
- P1-6C llama bridge、P1-6D offline dry run 与 `packages/db/src/index.ts` exports。

Catalog 目前只生成计划和执行绑定，不调用网络、不创建 cache 或 audit artifacts。多 MIME raw-capture/v2、CSV、document evidence、editorial input 和 model-free candidate runner 分属后续独立任务卡。
