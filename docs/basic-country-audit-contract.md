# basic-country-audit-contract.md - Basic 国家采集审计契约

> 本文件定义 P1-6A 的机器可读审计包边界。它补充而不替代 [basic-country-collection.md](./basic-country-collection.md)、[data-governance.md](./data-governance.md) 与 [data-schema.md](./data-schema.md)；不新增 canonical 数据模型字段，不授权自动发布、canonical 写入或 AI 检索。

## 1. 版本、文件与包边界

```text
schemaVersion = basic-country-audit/v1

BasicCollectionAuditBundle:
  countryDirectory, runId, sourceRegister, extractedFacts,
  marketOverviewDraft, reviewReport

source-register.json:
  schemaVersion, runId, countryCode, sources

extracted-facts.json:
  schemaVersion, runId, countryCode, facts

review-report.json:
  schemaVersion, runId, countryCode, status, missingFields,
  conflicts, sourceChecks, injectionRisks,
  publicationRecommendation, humanDecision
```

生产暂存区在 `data/staging/<country>/<runId>/` 将以下四个产物分别存储为独立文件：`source-register.json`、`extracted-facts.json`、`market-overview.draft.json` 与 `review-report.json`。为便于确定性离线校验，已提交测试可以将相同四个产物包裹在一个 `BasicCollectionAuditBundle` 形状的 fixture JSON 文件中。四个 committed fixture 固定在 `packages/db/fixtures/basic-collection/{normal,missing,conflict,untrusted}.json`，并由静态测试以完整 bundle envelope 重复读取、验证，不表示生产暂存目录。fixture 不等于 canonical seed，暂存产物不得进入 Prisma 导入、C 端响应、覆盖计数或 AI 检索。

`countryDirectory` 是与 `data/<country>/` 一致的国家目录名；`runId` 是稳定的批次标识。`source-register.json`、`extracted-facts.json` 与 `review-report.json` 是三个 envelope：它们的 `schemaVersion` 必须均为本契约版本，`runId` 必须等于 bundle 的 `runId`，且三者的 `countryCode` 必须相同。`market-overview.draft.json` 不是 envelope，不得包含 `schemaVersion` 或 `runId`；它只以 `countryCode` 与上述三个工件对齐，其批次归属由它在 bundle 中的位置及 `data/staging/<countryDirectory>/<runId>/` 路径关联。`countryCode` 是两个大写字母的 ISO 3166-1 alpha-2 代码。

## 2. 通用值与枚举

`BasicCollectionJsonValue` 仅可为 `null`、布尔值、有限数值、字符串、上述值的数组，或键值同为该类型的对象。除该递归 JSON 值内的自由字符串以及 `LocalizedText.zh` / `LocalizedText.en` 外，所有声明为非 `null` `string` 的契约字段必须是非空字符串：`trim()` 后长度至少为 1。`locator` 和 `evidenceLocators` 的每一项也适用此规则；它们必须是可审计的、非空的证据位置字符串，不能以 `null`、空字符串或纯空白代替。

所有时间戳必须是严格 UTC RFC3339：匹配 `YYYY-MM-DDTHH:mm:ssZ` 或 `YYYY-MM-DDTHH:mm:ss.SSSZ`（小数秒为 1--3 位）、日历日期和时分秒有效、且只允许大写结尾 `Z`；不得使用时区偏移、小写 `z`、缺失秒或闰秒。`contentSha256` 必须完全匹配 `/^[0-9a-f]{64}$/`，即 64 个小写十六进制字符。所有非 `null` URL 字段必须由 URL 解析器接受且协议仅为 `http:` 或 `https:`；其他绝对 URL 协议不允许。

`fieldPath` 只能是以下精确 allowlist 中的一项，名称固定使用 `country.*` 和 `marketOverview.*`，不得使用 `market-overview.*`：

```text
country.code
country.name
country.summary
country.region
country.flagEmoji
country.updatedAt
marketOverview.overview
marketOverview.population
marketOverview.gdp
marketOverview.gdpGrowth
marketOverview.energyDemand
marketOverview.renewableTarget
marketOverview.keyIndicators[non-negative-index].label
marketOverview.keyIndicators[non-negative-index].value
marketOverview.keyIndicators[non-negative-index].unit
marketOverview.keyIndicators[non-negative-index].year
marketOverview.source
marketOverview.sourceUrl
marketOverview.collectedAt
marketOverview.updatedAt
marketOverview.credibility
marketOverview.countryCode
marketOverview.industryTags
marketOverview.techTags
```

其中 `[non-negative-index]` 表示十进制 `0` 或不以零开头的非负整数（例如 `[0]`、`[12]`）。根对象路径、未列出的子字段和任何其他路径均无效；尤其禁止 `workflow`、`coverage`、`coverageLevel`、`moduleCoverage`、`reviewStatus`、`aiUsable`、`audit`、`knowledge`、manifest、staging 与 raw-cache 路径。所有引用的 `sourceId` 与 `factId` 必须在同一 bundle 中存在。

必需事实契约固定为上表中的 20 个非指标静态路径，加上 `marketOverviewDraft.keyIndicators` 中每个现有索引 `i` 的 `label`、`value`、`unit`、`year` 四条路径。也就是说，包含一个关键指标的完整 fixture 恰好覆盖 24 条必需路径。`extractedFacts.facts` 缺少任一必需路径时，无论 review report 是否主动列出该字段，都必须产生 `MISSING_REQUIRED_FACT`；清空 `sources`、`facts` 与 `sourceChecks` 不能形成可就绪的空包。

每个 `status = candidate` 的事实必须至少有一条 evidence。`country.*` 因本 bundle 不包含 country draft，只要求 candidate evidence 存在；每个 `marketOverview.*` candidate evidence 的 `normalizedValue` 必须与 `fieldPath` 指向的 `marketOverviewDraft` 值深度一致，对象键、数组顺序、标量与 `null` 均参与比较。不一致或 candidate 指向不存在的 draft 路径是路径明确的结构错误，而不是 blocker。每个被任一 evidence 引用的 `sourceId` 必须在 `reviewReport.sourceChecks` 中至少有一条 `status = passed` 的检查；缺少 passed 检查产生 `UNTRUSTED_INPUT`，已有 passed 检查不会抵消同一来源的 failed 检查或其他不可信条件。

| 类型 | 允许值 |
|---|---|
| `BasicSourceFamily` | `international-organization`、`official-statistics`、`government`、`energy-authority`、`regulator`、`grid-operator`、`industry-association`、`verified-research` |
| `BasicSourceAccessStatus` | `open`、`restricted`、`unknown` |
| `BasicPromptInjectionRisk` | `none`、`suspected`、`confirmed` |
| `BasicFactStatus` | `candidate`、`missing`、`conflict`、`untrusted` |
| `BasicExtractionMethod` | `deterministic`、`hermes`、`manual` |
| `BasicCollectionBlockerCode` | `MISSING_REQUIRED_FACT`、`UNRESOLVED_CONFLICT`、`UNTRUSTED_INPUT` |
| `Credibility` | 采用共享类型登记的 `OFFICIAL`、`VERIFIED`、`ESTIMATED`、`UNVERIFIED` |
| `IndustryTag`、`TechTag` | 仅采用 `@navigator/shared-types` 已登记枚举 |

`LocalizedText` 必须是标准 plain object，且恰好拥有两个 own 字符串键 `zh` 与 `en`，不得缺少、增加或通过继承提供键。两侧值必须均为字符串；任一侧允许在 `trim()` 后为空，以保留既有双语降级展示规则，但 `zh.trim()` 与 `en.trim()` 不得同时为空。除非下文明确为 `null`，字段均为必填且不可为 `null`。

## 3. 工件字段

### 3.1 `source-register.json`

顶层字段为 `schemaVersion`（固定 `basic-country-audit/v1`）、`runId`（字符串）、`countryCode`（字符串）和 `sources`（`BasicSourceRecord[]`）。每个 `BasicSourceRecord` 包含：

| 字段 | 类型与约束 |
|---|---|
| `sourceId` | 非空字符串；在 `sources` 内唯一 |
| `sourceName` | 非空字符串 |
| `sourceUrl` | 非空 HTTP(S) URL |
| `retrievedAt` | 严格 UTC RFC3339 时间戳 |
| `publishedAt` | 严格 UTC RFC3339 时间戳或 `null` |
| `contentSha256` | 恰好 64 个小写十六进制字符的 SHA-256 摘要 |
| `evidenceLocators` | 非空证据定位符字符串数组；每项 `trim()` 后非空 |
| `sourceFamily` | `BasicSourceFamily` |
| `accessStatus` | `BasicSourceAccessStatus` |
| `accessNotes` | 字符串或 `null` |
| `credibility` | `Credibility` |
| `discoveryOnly` | 布尔值 |
| `promptInjectionRisk` | `BasicPromptInjectionRisk` |

### 3.2 `extracted-facts.json`

顶层字段为 `schemaVersion`（固定版本）、`runId`（非空字符串）、`countryCode`（字符串）和 `facts`（`BasicExtractedFact[]`）。每个事实包含 `factId`（唯一非空字符串）、`fieldPath`（有效 allowlist 路径）、`status`（`BasicFactStatus`）、`evidence`（`BasicFactEvidence[]`）、`extractionMethod`（`BasicExtractionMethod`）和 `uncertainty`（非空字符串或 `null`）。

每个 `BasicFactEvidence` 包含 `sourceId`（引用已登记的非空 ID）、`locator`（非空证据定位符字符串）、`rawValue`（`BasicCollectionJsonValue`）、`normalizedValue`（`BasicCollectionJsonValue`）、`unit`（非空字符串或 `null`）和 `year`（有限数值或 `null`）。

Each extracted-facts fieldPath occurs at most once.
Each evidence locator must exactly match one locator in the referenced source record's evidenceLocators array.

### 3.3 `market-overview.draft.json`

该草稿是唯一的 `BasicMarketOverviewDraft` 对象，不带 `schemaVersion` 包装。它包含：

| 字段 | 类型与约束 |
|---|---|
| `overview`、`energyDemand`、`renewableTarget` | `LocalizedText` |
| `population`、`gdp`、`gdpGrowth` | 数值或 `null` |
| `keyIndicators` | `BasicDraftKeyIndicator[]`；每项为 `label: LocalizedText`、`value: string`、`unit: string`、`year: number` |
| `source` | 非空字符串；当 `sourceUrl` 为 `null` 时必须包含字面量 `sourceUrl null` |
| `sourceUrl` | 非空 HTTP(S) URL 或 `null`；完整表示字段存在，而非必须有 URL |
| `collectedAt`、`updatedAt` | 严格 UTC RFC3339 时间戳字符串 |
| `credibility` | `Credibility` |
| `reviewStatus` | 固定为 `draft` |
| `aiUsable` | 固定为 `false` |
| `countryCode` | 字符串，与其他工件相同 |
| `industryTags`、`techTags` | 已登记的 `IndustryTag[]`、`TechTag[]` |

### 3.4 `review-report.json`

顶层字段为 `schemaVersion`（固定版本）、`runId`（非空字符串）、`countryCode`（字符串）、`status`（`ready-for-human-review` 或 `blocked`）、`missingFields`（有效 allowlist `fieldPath` 字符串数组）、`conflicts`（`BasicReviewConflict[]`）、`sourceChecks`（`BasicSourceCheck[]`）、`injectionRisks`（`BasicInjectionRisk[]`）、`publicationRecommendation`（`request-human-review` 或 `do-not-publish`）和 `humanDecision`（`BasicHumanDecision` 或 `null`）。没有自动 `publish` 推荐值。

`BasicReviewConflict` 为 `fieldPath`（有效 allowlist 路径）、`factIds`（至少一个已登记的非空事实 ID）、`resolution`（`unresolved` 或 `resolved`）和 `notes`（非空字符串）。`BasicSourceCheck` 为 `sourceId`（已登记的非空来源 ID）、`status`（`passed` 或 `failed`）和 `notes`（非空字符串或 `null`）。`BasicInjectionRisk` 为 `sourceId`（已登记的非空来源 ID）、`locator`（非空证据定位符字符串）、`severity`（`suspected` 或 `confirmed`）和 `details`（非空字符串）。`BasicHumanDecision` 为 `decision`（`approved` 或 `rejected`）、`reviewerId`（非空字符串）、`decidedAt`（严格 UTC RFC3339 时间戳）和 `notes`（非空字符串）。

## 4. 验证、阻断与人工边界

```text
valid = all artifact shapes, identities, JSON values, hashes, URLs,
        timestamps, field paths, and references are structurally valid

readyForHumanReview = valid and blockers is empty and the report says
                      ready-for-human-review/request-human-review

blockers:
  MISSING_REQUIRED_FACT
  UNRESOLVED_CONFLICT
  UNTRUSTED_INPUT
```

缺失、冲突或不可信的审计包只要结构正确，仍可 `valid`，但绝不可 `readyForHumanReview`。缺少必需事实路径、`missingFields` 非空或有 `status = missing` 的事实产生 `MISSING_REQUIRED_FACT`；任一 `status = conflict` 的事实或任一 `resolution = unresolved` 的冲突产生 `UNRESOLVED_CONFLICT`；发现缺少 passed source check 的 evidence 来源、discovery-only 材料、`UNVERIFIED` 可信度、`restricted` / `unknown` 访问状态、`suspected` / `confirmed` 注入风险、`injectionRisks`、`status = untrusted` 的事实，或任一 `status = failed` 的 `sourceChecks` 时产生 `UNTRUSTED_INPUT`。

readiness 是单向安全约束，允许配对固定如下：

| blocker 状态 | `status` / `publicationRecommendation` | `valid` | `readyForHumanReview` |
|---|---|---|---|
| 有 blocker | 仅 `blocked` / `do-not-publish` | `true`（若无其他结构错误） | `false` |
| 有 blocker | 其他任意配对 | `false` | `false` |
| 无 blocker | `ready-for-human-review` / `request-human-review` | `true` | `true` |
| 无 blocker | 保守的 `blocked` / `do-not-publish` | `true` | `false` |
| 无 blocker | 两种交叉配对 | `false` | `false` |

冲突值永不由系统自动选择；未解决的冲突必须被保留并阻断。即使 `humanDecision.decision = approved`，本契约也不会写入 canonical 数据、改变审核状态、执行发布，或使数据可用于 AI；这些动作继续由既有人工审核与发布闸门控制。

## 5. 验证结果形状

每次验证均返回 `BasicCollectionAuditSummary`：`countryCode`（字符串）、`runId`（字符串）、`sourceCount`（数值）和 `factCount`（数值）。`BasicCollectionAuditValidationResult` 是以下二选一结果：

| `valid` | `data` | `errors` | `readyForHumanReview` | `blockers` | `summary` |
|---|---|---|---|---|---|
| `true` | 重建后的 `BasicCollectionAuditBundle` | 空数组 `[]` | 布尔值 | `BasicCollectionBlockerCode[]` | `BasicCollectionAuditSummary` |
| `false` | `null` | 至少一个路径明确的错误字符串 | 固定 `false` | `BasicCollectionBlockerCode[]` | `BasicCollectionAuditSummary` |

验证器不会为未知 JSON 抛出异常。它只在结构有效时返回重建后的 bundle；阻断仅影响人工审核就绪，不会把结构有效的审计包变成无效输入。
