# basic-country-source-adapters.md — P1-6B 确定性来源适配器与原始采集边界

> 本文件是 P1-6B 的规范性运行时与来源溯源边界。它实现 [basic-country-collection.md](./basic-country-collection.md) 的原始采集与证据登记约定，使用 [basic-country-audit-contract.md](./basic-country-audit-contract.md) 的既有字段和路径，不新增 canonical 数据模型字段、审核状态或 AI 检索范围。

## 1. 范围与职责

P1-6B 为国家中立的、可复现的确定性来源适配器运行时。它把获准的结构化 HTTPS 来源转换为：

1. `.cache` 下不可变的本地原始字节采集；
2. 精确对应 P1-6A 的 `BasicSourceRecord` 来源登记；
3. 带有原始值、标准化值、单位、年份和证据定位符的 `BasicExtractedFact` 事实证据。

适配器只负责来源知识：请求 URL、接受的媒体类型、来源身份和确定性解析。共享 runner 负责跨来源不变量：HTTPS 与 origin 策略、请求参数白名单、重定向、字节上限、SHA-256、缓存不可变性、路径安全、来源登记、事实分组和冲突保留。

P1-6B 不生成双语市场草稿，不写入 canonical seed，不发布数据，不创建知识片段，也不调用 Hermes、SearXNG 或 Windows `llama.cpp`。Hermes discovery、浏览器编排、本地模型草稿桥接和运行时/模型失败处理属于 P1-6C；离线端到端 dry run 与完整 pipeline boundary verification 属于 P1-6D。

## 2. 固定运行时常量与路径

以下常量是实现契约的一部分，不得由国家、来源或运行参数覆盖：

```text
rawCaptureSchemaVersion = basic-country-raw-capture/v1
maxRawCaptureBytes = 10485760
maxRedirects = 3
```

raw capture 是本地专用、永不提交的缓存。每个来源的文件路径固定为：

```text
.cache/basic-country/<ISO2>/<runId>/raw/<sourceId>/<sha256>.bin
.cache/basic-country/<ISO2>/<runId>/raw/<sourceId>/capture.json
```

其中 `<ISO2>` 是大写 ISO 3166-1 alpha-2 国家码，`<runId>` 是稳定批次标识，`<sourceId>` 是适配器声明的来源标识，`<sha256>` 是内容地址文件名。raw cache、`data/staging/`、`collection-manifest.json` 和其他 audit artifacts 均不是产品数据，不能进入 seed 记录、C 端响应、覆盖计数或 AI 检索。

## 3. 运行时接口边界

每个适配器必须声明唯一的 `adapterId`、`adapterVersion`、`sourceId`、`sourceName`、`sourceFamily` 和 `credibility`，并提供：

```text
request(countryCode) -> BasicSourceRequest
extract(BasicDeterministicAdapterInput) -> BasicDeterministicAdapterOutput
```

`BasicSourceRequest` 固定使用 `GET`，并包含 `url`、`accept`、精确的 `allowedOrigins` 和精确、区分大小写的 `allowedQueryParameters`。适配器输入包含国家码、请求 URL、最终 URL、响应媒体类型、`retrievedAt` 和已验证的原始字节；适配器输出包含 `publishedAt`、`promptInjectionRisk`、`accessNotes` 和零个或多个确定性 observation。

每个 observation 必须包含：

```text
fieldPath
locator
rawValue
normalizedValue
unit
year
uncertainty
```

`fieldPath` 必须属于 P1-6A allowlist；`locator` 必须是非空、可审计的证据位置；`rawValue` 是来源中的精确 JSON 值，`normalizedValue` 是不改变事实含义的标准化值；`unit`、`year` 和 `uncertainty` 按 P1-6A 允许的 `null` 规则记录。runner 对未知路径、不安全值、非有限数值和无效引用 fail closed。

runner 的结果只暴露 `sourceRegister`、`extractedFacts` 和不含缓存路径的 receipts。每个 receipt 仅包含 `sourceId`、`contentSha256`、`byteLength` 和 `reused`。runner 将每个来源记录固定为 `accessStatus = "open"`、`discoveryOnly = false`；适配器不能覆盖这两个字段。重复 `sourceId` 必须在任何缓存或网络操作前拒绝。

## 4. Raw capture 合同

每个 `capture.json` 必须是只含以下键的 `BasicRawCaptureManifest`：

```text
schemaVersion: "basic-country-raw-capture/v1"
countryCode
runId
adapterId
adapterVersion
sourceId
request: { method, url, accept, allowedOrigins, allowedQueryParameters }
response: { status, finalUrl, redirectChain, contentType, retrievedAt,
            byteLength, contentSha256 }
```

manifest 不得包含任意请求头、凭证、cookie、authorization 值、canonical 值、审核状态或 AI 标志。嵌套对象必须从精确 own keys、严格标量和标准 JSON 数组重建后，才可用于缓存复用。

### 4.1 字节、哈希与缓存复用

`contentSha256` 覆盖 transport 在 HTTP transfer decoding 之后交付的精确字节，并且计算发生在 parsing、text decoding 或 JSON reserialization 之前。哈希不覆盖 URL、manifest、解码后的文本或重新序列化的 JSON。`maxRawCaptureBytes = 10485760` 是 10 MiB 上限；`captureBasicRawSource()` 必须在收集 async stream 和计算 SHA-256 时执行上限检查，不得只信任 `Content-Length`。

当一个有效的既有 capture 存在时，runner 必须重新读取 content-addressed payload、重新计算并验证哈希，然后复用该 capture，**不发起网络调用**。复用要求以下字段完全相等：国家、批次、来源 ID、adapter ID/version、GET URL、Accept 值、排序后的 origin 白名单、排序后的 query 参数白名单、状态码、最终 URL、重定向链、媒体类型、payload 文件名、字节数和哈希。manifest 损坏、只有 payload 没有 manifest、或任一字段不一致都必须 fail closed；刷新来源必须使用新的 `runId`。

缓存按 `(countryCode, runId, sourceId)` 不可变。写入必须先在 `raw/` 下构建完整的 sibling `.tmp-<sourceId>-<uuid>` 目录（mode `0700`），以 mode `0600` 写入并 fsync payload 与 `capture.json`，在平台支持时 fsync 临时目录，再把完整目录原子 rename 为最终 `<sourceId>`；最终来源目录不得预创建。相同字节的并发写入可以收敛到同一份已验证采集，不同字节不得覆盖同一身份。孤儿 `.tmp-*` 目录不是采集，也不能阻塞后续 capture；只有 payload 没有 `capture.json` 是无效的 partial capture。raw-cache root 下任意已有 symlink 都必须拒绝；绝对路径、traversal segment、不安全 ID、NUL 和反斜杠分隔符必须在 transport 执行前拒绝。缓存文件使用本地 restrictive permissions。

## 5. 网络与请求参数边界

生产 transport 只接受 HTTPS，拒绝 URL credentials，并要求请求 origin 以及每个重定向 origin 都出现在适配器的精确 origin 白名单中。重定向必须手动处理、遵守同一策略，且最多允许 `maxRedirects = 3`，即 three redirects。只有成功的 2xx 响应，并且其媒体类型被适配器接受为 JSON，才可以 capture。

每个请求 URL 和每个重定向 URL 只能包含适配器声明的 query 参数名称；每个名称最多出现一次。未声明的名称在继续 transport 前拒绝。World Bank country adapter 只允许 `format`；每个 World Bank indicator adapter 只允许 `source`、`format`、`mrv` 和 `per_page`。增加 query 参数必须经过 reviewed adapter code change，不能未经审查地持久化 credential 参数。错误只说明失败规则，不回显 URL、query、响应体、参数值或 secret。

`BasicSourceTransport` 通过注入的 fetch/transport 实现测试；P1-6B 测试不得访问网络。transport 只验证 URL、重定向、状态码和 MIME policy，response body 由 `captureBasicRawSource()` 唯一消费并计量。

## 6. 来源登记与事实物化

source register 的 `sourceUrl` 保留原始请求 URL；最终 URL 和重定向链只保留在本地 `capture.json`，因为 P1-6A 没有已提交的 final-URL 字段。`contentSha256` 只能来自已验证的 raw payload，不得来自解析后的内容或外部声明。

每个 observation 必须使用 P1-6A allowlisted canonical field path 和非空 locator。runner 必须验证每个 locator **恰好匹配** 被引用 source record 的 `evidenceLocators` 数组中的一个定位符。每个 `extracted-facts` `fieldPath` 最多出现一次；同一字段的多来源证据必须合并到该唯一事实的 `evidence` 中。

runner 按 field path 的稳定字典序分组 observation，再按 `sourceId` 分组。每个来源在该 field path 下的 `(normalizedValue, unit, year)` tuple set 必须恰好只有一个值；任何来源内部出现两个 tuple 都先 fail closed，之后才进行跨来源比较。对象递归按排序后的 own keys 比较，数组保留顺序，数值使用 `Object.is`，其他标量比较类型和值。物化规则固定为：

- Equal tuples from one or more `sourceId` values produce one `candidate` fact with all evidence.
- Differing tuples from at least two distinct `sourceId` values produce one `conflict` fact with all evidence.
- Differing tuples within one `sourceId` are malformed adapter output and fail closed; the runner neither selects a value nor fabricates another source.
- Every `conflict` fact therefore contains evidence from at least two distinct `sourceId` values.

所有 runner 生成的 fact 使用 `extractionMethod = "deterministic"`。

evidence 按 `sourceId`、`locator`、canonical raw JSON、canonical normalized JSON、unit（`null` 在文本前）和 year（`null` 在数字前）稳定排序。fact 的 `uncertainty` 是去重、trim 后非空 uncertainty 的字典序拼接，以 `" | "` 分隔；没有时为 `null`。`factId` 固定为 `fact-` 加上 field path UTF-8 字节 SHA-256 的前 16 个小写十六进制字符。

observation 数量为零时拒绝 adapter output，不产生 source-register result。World Bank 的 `null` WDI record 必须产生一个 `candidate` observation，其 `rawValue` 和 `normalizedValue` 都是 `null`；它不得被省略，也不会使 source run 变成 observation-free。

## 7. World Bank 适配器

### 7.1 Country profile

country-profile adapter 对大写 `<ISO2>` 请求的 URL 必须恰好为：

```text
https://api.worldbank.org/v2/country/<ISO2>?format=json
```

它只产生确定性支持的 `country.code` 和 `country.name` evidence。World Bank 的英文名称原样进入 `{ zh: "", en: value }`，沿用既有双语降级规则，不得自行翻译。响应 metadata 必须表示 page 1 of 1、total 1；唯一 country record 必须包含请求的 `iso2Code`。

### 7.2 WDI indicators

WDI 实现导出三个 source adapters，每个 indicator 一个。请求 URL 必须恰好为：

```text
https://api.worldbank.org/v2/country/<ISO2>/indicator/SP.POP.TOTL?source=2&format=json&mrv=1&per_page=1
https://api.worldbank.org/v2/country/<ISO2>/indicator/NY.GDP.MKTP.CD?source=2&format=json&mrv=1&per_page=1
https://api.worldbank.org/v2/country/<ISO2>/indicator/NY.GDP.MKTP.KD.ZG?source=2&format=json&mrv=1&per_page=1
```

大写 ISO2、query 参数顺序、`source=2` 和 `per_page=1` 都固定。`mrv=1` 表示请求最近一期值，而不是最近一期非空值。每个响应 metadata 必须包含 `page = 1`、`pages = 1`、`per_page = 1`、`total = 1`、`sourceid = "2"` 和 `lastupdated` 日期；不得静默忽略 pagination。唯一 data record 必须标识该 adapter 请求的 indicator 和 ISO2 country。

| Indicator | canonical fieldPath | unit |
|---|---|---|
| `SP.POP.TOTL` | `marketOverview.population` | `people` |
| `NY.GDP.MKTP.CD` | `marketOverview.gdp` | `current US$` |
| `NY.GDP.MKTP.KD.ZG` | `marketOverview.gdpGrowth` | `%` |

每个 record 的精确 `value`（包括 `null`）是 `rawValue`。有限数值原样作为 `normalizedValue`，`null` 仍为 `null`；四位数字的 `date` 提供 `year`。缺少 data record 或出现第二个 data record 都必须拒绝。API 的 `lastupdated` 不是 `publishedAt`；没有明确发布时间时，`publishedAt` 必须为 `null`。

World Bank recorded fixtures 仅用于离线测试，不是 canonical 国家数据；测试解码并验证 fixture body 的 SHA-256 后再解析，绝不重新请求网络。

## 8. 与 P1-6A、P1-6C、P1-6D 的边界

- P1-6A 定义 `source-register.json`、`extracted-facts.json`、双语草稿、review report、allowlisted field paths、evidenceLocators 和 blocker/readiness 规则。P1-6B 只能产生符合该契约的来源登记与事实证据。
- P1-6C 负责 Hermes discovery 和 Windows `llama.cpp` schema-constrained draft bridge。SearXNG 只能 discovery-only；本地模型输出始终是 `draft` 且 `aiUsable = false`，不能替代 P1-6B 的原始来源或写入 canonical seed。
- P1-6D 负责 offline end-to-end dry run 和完整 pipeline boundary verification，验证 raw cache、staging、manifest、audit artifacts、seed、C 端、覆盖计数和 AI 检索之间没有越界。

P1-6B 的 transport 或 adapter 失败不产生 source register 或 facts；失败后可能残留本地 raw files，但 API 不写入 staging 或 canonical data。Malformed JSON、意外 envelope、国家码不匹配、重复 indicator、非有限值、无效年份、未知 field path、unsupported MIME、unsafe redirect、content overflow 和 cache tampering 都必须以确定性、去敏感的错误 fail closed。
