# basic-source-formats.md — Basic 多格式传输、捕获与 CSV 合同

> 本文件是 `DATA-BASIC-FORMATS-1` 的规范性合同。来源选择、许可、请求模板和 adapter identity 以 [basic-source-catalog.md](./basic-source-catalog.md) 为准；总体边界以 [Basic 国家确定性采集与来源边界设计](./superpowers/specs/2026-07-12-basic-source-boundary-design.md) 为准。本任务只建立 package-private 的 v2 transport、raw capture 和 CSV utility，不修改 v1、audit、canonical、Prisma、AI、权限、计费或 Web。

## 1. v2 Request 与 Response

`BasicSourceRequestV2` 是从 reviewed catalog execution plan 取得的不可变快照，只允许以下 exact own keys：

```text
method = GET
url
accept
allowedOrigins[]
allowedQueryParameters[]
```

`accept` 只能是 `application/json`、`text/csv`、`text/html` 或 `application/pdf`。URL 最多 8,192 UTF-8 bytes；其他字符串最多 65,536 UTF-8 bytes；数组最多 256 项。Origin 必须是无 credentials、path、query、fragment 的 exact HTTPS origin。Origin 和 query-name list 必须唯一，并保留 execution plan 的 reviewed 顺序，不能排序。

`BasicSourceTransportResponseV2` 的 exact keys 为：

```text
status
finalUrl
contentType
retrievedAt
redirectChain[]
body
```

`retrievedAt` 必须是 strict UTC RFC3339。Transport 只发送 `Accept`，固定 `GET` 和 `redirect: manual`；最多跟随三个 `301`、`302`、`303`、`307` 或 `308` redirect。每个原始或 redirect URL 都必须保持 HTTPS、无 credentials/fragment、origin 在 allowlist 中，并且每个 query name 只出现一次且属于 allowlist。

## 2. Exact MIME Matrix

响应 `Content-Type` 去除合法参数后只对 media type 做大小写归一化；原始值仍原样进入 manifest。缺失、多个逗号分隔值、非法参数、首尾空白或跨类型响应全部拒绝。

| Request Accept | 唯一允许的响应 media type |
|---|---|
| `application/json` | `application/json` 或合法 `application/*+json` |
| `text/csv` | `text/csv` |
| `text/html` | `text/html` |
| `application/pdf` | `application/pdf` |

`application/octet-stream`、`application/vnd.ms-excel` 和不完整 `+json` suffix 没有例外。新增格式或例外必须经过独立设计和 code review，不能由运行时内容或 adapter 临时放宽。

## 3. raw-capture/v2 Manifest

v2 manifest 的 `schemaVersion` 精确等于：

```text
basic-country-raw-capture/v2
```

顶层 exact key order 与字段固定为：

```text
schemaVersion
countryCode
runId
catalogVersion
catalogSha256
adapterId
adapterVersion
sourceId
request
response
```

`request` keys 与 §1 相同。`response` exact keys 为 `status`、`finalUrl`、`redirectChain`、`contentType`、`retrievedAt`、`byteLength`、`contentSha256`。`catalogSha256` 与 `contentSha256` 都必须是 lowercase 64-hex。Manifest parser 从 `unknown` 重建 plain data，拒绝 extra/missing/accessor/symbol/proxy/cyclic/sparse、非有限数值和资源超限，并递归冻结结果。

Catalog version/digest、country/run、adapter identity、source ID，以及 request URL、Accept、origin/query list 的值和顺序全部属于 cache identity。任一变化都不能复用既有 capture。

## 4. Immutable raw-v2 Cache

v2 只使用以下本地、不可提交 namespace：

```text
.cache/basic-country/<ISO2>/<runId>/raw-v2/<sourceId>/capture.json
.cache/basic-country/<ISO2>/<runId>/raw-v2/<sourceId>/<contentSha256>.bin
```

Payload 是 HTTP transfer decoding 之后、任何 JSON/CSV/document 解析之前的原始 bytes。单个 payload 上限为 10 MiB；允许空 body。Capture 对 bytes 计算 SHA-256，以临时 sibling directory 写入 payload 和 compact manifest，sync 后原子 rename 发布。并发同内容 capture 收敛到同一结果；已发布 identity 的不同内容被拒绝。

Cache reuse 前重新解析 manifest、复核全部 identity/request/response policy、payload 文件名、大小和 SHA-256。缺文件、多文件、tamper、symlink、路径穿越或不完整 publication 全部 fail closed。v2 不读取、复制或回退到 v1 `raw/<sourceId>`；v1 同样不读取 `raw-v2/<sourceId>`。

## 5. Strict CSV Grammar

`parseBasicCsv()` 使用 `csv-parse/sync` 的 strict comma-delimited mode：

- UTF-8 fatal decode；最多剥离一个开头 BOM，第二个或 interior BOM 拒绝；
- 第一条 record 是 header；header 非空、trim 后不变、唯一；
- 只接受 LF 或 CRLF，拒绝空 physical line 和 comment line；
- 不启用 relaxed quotes、relaxed column count、skip empty lines、comment、trim 或 type casting；
- 支持 quoted comma/newline 和 doubled quote；所有 cell 保持 string，不转换 number、date、boolean、formula 或空值；
- 每个 data row 的列数必须与 header 完全一致；header-only table 合法。

资源上限为：

| 对象 | 上限 |
|---|---:|
| raw payload | 10 MiB |
| data rows | 100,000 |
| columns | 256 |
| 单 header | 256 UTF-8 bytes |
| 单 cell | 65,536 UTF-8 bytes |
| 单 parser record | 1,048,576 bytes |

所有边界均允许 exact limit，超过一个 byte/item 即整体失败，不截断。Parser 只返回重建并递归冻结的 `{ headers, rows }`。

## 6. CSV Locator

`locateBasicCsvCell()` 只接受 parser 产生的 exact、递归冻结 table、非负 safe-integer data-row index 和 exact header。Locator 固定为：

```text
csv:/rows/<zero-based-data-row>/columns/<RFC6901-escaped-header>
```

Header token 先将 `~` 转义为 `~0`，再将 `/` 转义为 `~1`。返回的 `rawValue` 必须与目标解析 cell 逐字一致；source-specific row selection、数值 normalization、unit/year 和 fact mapping 属于后续 reviewed adapter，不属于 generic CSV parser。

## 7. Document 与后续边界

`text/html` 和 `application/pdf` 在本任务中只允许 transport、raw byte capture、hash 和 manifest 登记。不得自动解析 DOM、正文、OCR 或 PDF text，也不得产生 preliminary fact。Document locator、人工 source review 和 evidence promotion 必须等待 `DATA-BASIC-DOCUMENTS-1`。

所有 v2 API 保持 `@navigator/db` package-private，`packages/db/src/index.ts` 不导出。`csv-parse` 精确固定为 `7.0.1`，许可证为 MIT；本任务不引入其他依赖。

## 8. 稳定失败与 v1 不变声明

Transport/capture/CSV 失败只返回稳定边界错误，不回显 URL/query value、header、response body、CSV header/cell、token、cookie、filesystem path 或外部异常。外部 bytes 始终是不可信数据，不能修改 catalog、request policy 或 field mapping。

以下 v1 行为保持原样：`BasicSourceRequest` 的既有 TypeScript shape、`BasicSourceTransport`、`captureBasicRawSource()`、`basic-country-raw-capture/v1`、v1 `raw/` cache namespace、P1-6C/P1-6D compatibility path 和 package root exports。v1 runtime 继续只允许 `application/json`，回归测试明确拒绝 CSV、HTML 和 PDF request；本任务不收窄或扩宽既有 v1 TypeScript 类型。
