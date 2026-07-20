# data-schema.md — 统一国家数据模型（唯一事实来源）

> 本文件是全平台**数据模型的唯一事实来源（Single Source of Truth）**。
> 任何数据结构改动，必须**先改本文件**，再改 `packages/db` 的 Prisma schema，二者必须保持一致。
> 修改本文件属于 AGENTS.md 第 11 节「需人工确认的操作」，须在 PR 中标注并等待 Review。

---

## 0. 设计总则

1. **统一模型是地基**：所有国家共用同一套 10 个分析模块与同一套字段，页面结构完全一致。差异只体现在「数据深度」（覆盖等级），不体现在「结构」。禁止为单个国家新增特例字段或特例表。
2. **数据即产品**：每条核心业务数据必须携带完整元字段（来源、时间、可信度、审核状态、AI 可用性）。缺元字段的数据不允许入库。
3. **双语内建**：所有面向用户展示的可读文本字段一律用双语结构 `LocalizedText`（`{ zh, en }`）存储。非展示字段（枚举、ISO 码、URL、数值、时间）保持单一值。
4. **ISO 国家码为主键**：国家统一用 ISO 3166-1 alpha-2（如 `ID` = 印尼），禁止用中文名或自定义缩写。
5. **覆盖等级驱动展示**：前端按 `CoverageLevel` 与模块级覆盖状态动态渲染，未建设的模块显示占位而非报错。详见 [coverage-levels.md](./coverage-levels.md)。

---

## 1. 固定枚举

以下枚举为全平台固定值，新增/删除必须先在本文件登记并说明理由。

### 1.1 语言（Locale）
```
zh-CN   # 中文（默认）
en      # 英文（一等公民）
```

### 1.2 覆盖等级（CoverageLevel）
```
BASIC       # 基础覆盖
STANDARD    # 标准覆盖
COMPLETE    # 完整覆盖
```

### 1.3 模块标识（ModuleKey）—— 固定 10 个
```
market-overview     # 市场概览
policy              # 政策法规
risk                # 风险评估
opportunities       # 市场机会
projects            # 项目信息
partners            # 本地伙伴
chinese-companies   # 中资企业
entry-strategy      # 进入策略
ai-advisor          # AI 出海顾问
reports             # 研究报告
```
> 新增/删除模块必须先在本文件修改并说明理由，且同步更新前端路由与导航。

### 1.4 审核状态（ReviewStatus）
```
draft       # 草稿（不可展示，不可用于 AI）
pending     # 待审核（不可展示，不可用于 AI）
published   # 已发布（可展示，满足条件方可用于 AI）
```

### 1.5 可信度等级（Credibility）
```
OFFICIAL    # 官方来源（政府、监管机构、官方统计）
VERIFIED    # 经核实的二手来源（权威机构、主流媒体）
ESTIMATED   # 估算/推断（需标注）
UNVERIFIED  # 未经核实（默认不可用于 AI）
```

### 1.6 模块覆盖状态（ModuleCoverageStatus）
```
BUILDING    # 建设中（前端显示 "Data Building" 占位）
PARTIAL     # 部分覆盖
COMPLETE    # 完整覆盖
```

---

## 2. 通用类型

### 2.1 LocalizedText（双语文本）
所有面向用户展示的可读文本字段统一使用。类型与读取辅助函数（`pickLocale()`）统一放 `packages/shared-types`，禁止各端重复定义。

```ts
type Locale = 'zh-CN' | 'en';

interface LocalizedText {
  zh: string;   // 中文文本
  en: string;   // 英文文本
}
```

**降级规则**：当某一语言文本缺失（空串或缺字段）时，前端回退到另一语言并标注「未翻译 / Not translated」，不得报错或显示空白。

### 2.2 数据库存储形式
- Prisma 中 `LocalizedText` 以 `Json` 列存储，结构固定为 `{ zh: string; en: string }`。
- 富文本正文（如政策全文、报告正文）同样使用双语结构，值为 Markdown 字符串。

---

## 3. 元字段（Meta）—— 核心业务数据强制携带

以下模块的每条核心业务数据（政策 / 风险 / 机会 / 项目 / 伙伴 / 中资企业 / 知识片段）**必须**携带完整元字段。缺任一字段不允许入库。

| 字段 | 类型 | 说明 |
|------|------|------|
| `source` | `string` | 来源名称（机构/媒体/文件名） |
| `sourceUrl` | `string \| null` | 来源链接（无链接时为 null，但需在 source 说明） |
| `collectedAt` | `DateTime` | 采集时间 |
| `updatedAt` | `DateTime` | 最近更新时间 |
| `credibility` | `Credibility` | 可信度等级 |
| `reviewStatus` | `ReviewStatus` | 审核状态 |
| `aiUsable` | `boolean` | 是否可用于 AI 问答（详见 §3.1） |
| `countryCode` | `string` | ISO 3166-1 alpha-2 |
| `industryTags` | `string[]` | 行业标签（枚举，见 §7） |
| `techTags` | `string[]` | 技术类型标签（枚举，见 §7） |

### 3.1 `aiUsable` 硬约束
数据可被 AI 出海顾问检索，**当且仅当**同时满足：
- `reviewStatus === 'published'`
- `aiUsable === true`
- `credibility !== 'UNVERIFIED'`

服务端检索管道必须强制该过滤，禁止在应用层放宽。详见 AGENTS.md 第 9 节与 [api-contract.md](./api-contract.md) 的 AI 接口约定。

### 3.2 稳定记录身份（STANDARD 候选数据）

- `policy`、`risk`、`opportunities` 的既有 `id` 字段是记录身份。新接收的 STANDARD 候选记录在进入候选管道时，使用 Node.js `crypto.randomUUID()` **仅生成一次**规范小写 UUID v4，并显式持久化。
- 修订或后续候选批次必须显式沿用上一版记录的 `id`。`id` 不得由标题、数组顺序、内容哈希、来源 URL、国家或模块推导。
- `id` 在适用记录集合内唯一；一个身份不得跨国家或模块复用、移动。
- 本约定不要求数据库迁移：Prisma 继续使用现有 `String` 主键定义，STANDARD 候选写入时显式提供 UUID v4。既有数据身份不在本次约定中重写。

---

## 4. 顶层实体：Country（国家）

国家详情页的骨架。所有国家共用同一结构。

| 字段 | 类型 | 说明 |
|------|------|------|
| `code` | `string` (PK) | ISO 3166-1 alpha-2，如 `ID` |
| `name` | `LocalizedText` | 国家名（如 `{ zh: "印度尼西亚", en: "Indonesia" }`） |
| `region` | `string` | 所属地区枚举（见 §7.3） |
| `coverageLevel` | `CoverageLevel` | 整体覆盖等级 |
| `flagEmoji` | `string` | 国旗 emoji（展示用） |
| `summary` | `LocalizedText` | 一句话概述 |
| `moduleCoverage` | `ModuleCoverage[]` | 各模块覆盖状态（见 §4.1） |
| `updatedAt` | `DateTime` | 国家数据整体更新时间 |

### 4.1 ModuleCoverage（模块覆盖状态）
描述某国某模块的建设深度，驱动前端占位/渲染。

| 字段 | 类型 | 说明 |
|------|------|------|
| `moduleKey` | `ModuleKey` | 模块标识 |
| `status` | `ModuleCoverageStatus` | 建设状态 |
| `dataCount` | `number` | 该模块已入库的数据条数 |
| `updatedAt` | `DateTime` | 模块更新时间 |

---

## 5. 10 个模块字段定义

> 所有模块的展示文本字段均为 `LocalizedText`，并携带 §3 的元字段（`ai-advisor` 的知识片段亦然）。以下仅列模块特有字段，元字段不再重复。

### 5.1 market-overview（市场概览）
单条国家级概览对象（每国一条）。

| 字段 | 类型 | 说明 |
|------|------|------|
| `overview` | `LocalizedText` | 市场总体描述（Markdown） |
| `population` | `number \| null` | 人口 |
| `gdp` | `number \| null` | GDP（美元） |
| `gdpGrowth` | `number \| null` | GDP 增速（%） |
| `energyDemand` | `LocalizedText` | 能源需求概况 |
| `renewableTarget` | `LocalizedText` | 可再生能源目标 |
| `keyIndicators` | `Indicator[]` | 关键指标数组（见下） |
| `basicProfile` | `BasicProfile \| null` | 可选 BASIC v2 八类市场画像；旧数据缺省时按 `null` 处理（见 §5.1.1） |

`Indicator`：`{ label: LocalizedText; value: string; unit: string; year: number }`

#### 5.1.1 BASIC v2 市场画像（BasicProfile）

`basicProfile` 是 `market-overview` 上的可空、国家中立 JSON 投影，不改变既有
`MarketOverview` 核心字段、覆盖等级判定或 AI 检索边界。schema version 固定为
`basic-market-profile/v2`。既有 canonical 输入省略该字段时，在数据库边界归一化为
`null`；既有 canonical 文件本身不因本字段而重写。

顶层对象必须且只能包含：

```ts
interface BasicProfile {
  schemaVersion: 'basic-market-profile/v2';
  categories: BasicProfileCategories;
  sources: BasicProfileSource[];
  updatedAt: string; // RFC3339
}
```

`categories` 必须且只能包含以下八个固定 key，所有国家顺序与结构一致：

```
countryBasics
electricityMarket
energyAccess
renewableCapacity
solarResource
windResource
policyOverview
marketSummary
```

每个 category 必须且只能包含 `{ fields: BasicProfileField[] }`。同一 category 内
`field.key` 必须是唯一的 lower camel token。每个 field 必须且只能包含下列字段：

| 字段 | 类型 | 约束 |
|------|------|------|
| `key` | `string` | lower camel token，同一 category 内唯一 |
| `label` | `LocalizedText` | 双语字段标签 |
| `status` | `'AVAILABLE' \| 'NOT_AVAILABLE'` | 字段证据状态 |
| `value` | `finite number \| non-empty string \| LocalizedText \| null` | 经过来源核验的值 |
| `unit` | `non-empty string \| null` | 单位；不适用时为 `null` |
| `year` | `integer \| null` | 数据年份；不适用时为 `null` |
| `sourceIds` | `string[]` | 非空、数组内唯一，引用本 profile 的 `sources[].id` |
| `checkedAt` | `string` | 有效 `YYYY-MM-DD` 日期 |
| `reason` | `LocalizedText \| null` | 不可得原因 |
| `note` | `LocalizedText \| null` | 可选双语限定说明 |

状态不变量：

- `AVAILABLE`：`value` 非 `null`，至少一个唯一 `sourceId`，且 `reason = null`。
- `NOT_AVAILABLE`：`value = null`、`unit = null`、`year = null`，至少一个唯一的已检查
  `sourceId`，且 `reason.zh` 与 `reason.en` 都是非空文本。
- 每个被引用的 `sourceId` 必须在 `sources` 中恰好存在一次。

每个 source 必须且只能包含：

| 字段 | 类型 | 约束 |
|------|------|------|
| `id` | `non-empty string` | profile 内唯一，供 field 引用 |
| `publisher` | `non-empty string` | 发布机构 |
| `title` | `LocalizedText` | 双语来源标题 |
| `url` | `string` | 仅允许绝对 HTTP(S) URL |
| `publishedAt` | `RFC3339 \| null` | 来源发布时间 |
| `retrievedAt` | `RFC3339` | 实际获取时间 |
| `credibility` | `Credibility` | 使用 §1.5 固定枚举 |

`energyAccess` 仅收录电力可及率，不采集 clean cooking。此投影不生成
`KnowledgeChunk`，也不改变 §3.1 的 AI 可用性硬约束。

八类字段采用下列国家中立的精确清单；每个 category 的 `fields` 必须恰好包含对应
key，不得缺失、留空或增加临时字段：

| category | 必需 field key |
|----------|----------------|
| `countryBasics` | `countryCode`、`countryName`、`region`、`population`、`gdp`、`gdpPerCapita`、`gdpGrowth` |
| `electricityMarket` | `totalGeneration`、`electricityConsumption`、`electricityMix`、`renewableGenerationShare` |
| `energyAccess` | `electricityAccess` |
| `renewableCapacity` | `totalRenewableCapacity`、`solarCapacity`、`windCapacity`、`hydroCapacity` |
| `solarResource` | `ghi`、`pvout`、`solarPotentialSummary` |
| `windResource` | `onshoreWindClass`、`offshoreWindClass`、`resourceSummary` |
| `policyOverview` | `summary` |
| `marketSummary` | `opportunitySummary` |

每个必需字段都必须按上述状态不变量表示：有审核事实时使用 `AVAILABLE`；缺失指标也
必须保留该字段并使用 `NOT_AVAILABLE`，同时提供非空 `sourceIds`、有效 `checkedAt`
以及中英文均非空的 `reason`。因此，空或部分 `BasicProfile` 不得进入候选
`ready-for-human-review`，也不得发布。`countryName` 表示中英双语国家名；
`energyAccess` 不得加入清洁烹饪率。

### 5.2 policy（政策法规）
数组，每条为一项政策/法规。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `string`（UUID v4） | STANDARD 候选记录的稳定不透明身份（见 §3.2） |
| `title` | `LocalizedText` | 政策标题 |
| `summary` | `LocalizedText` | 摘要 |
| `body` | `LocalizedText` | 全文（Markdown） |
| `policyType` | `string` | 政策类型枚举（见 §7.4） |
| `effectiveDate` | `DateTime \| null` | 生效日期 |
| `authority` | `LocalizedText` | 发布机构 |

### 5.3 risk（风险评估）
数组，每条为一项风险。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `string`（UUID v4） | STANDARD 候选记录的稳定不透明身份（见 §3.2） |
| `title` | `LocalizedText` | 风险名称 |
| `category` | `RiskCategory` | 风险类别机器值（固定枚举见 §7.5，展示标签走 i18n） |
| `level` | `'LOW' \| 'MEDIUM' \| 'HIGH'` | 风险等级 |
| `description` | `LocalizedText` | 风险描述 |
| `mitigation` | `LocalizedText` | 缓解建议 |

### 5.4 opportunities（市场机会）
数组，每条为一个机会点。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `string`（UUID v4） | STANDARD 候选记录的稳定不透明身份（见 §3.2） |
| `title` | `LocalizedText` | 机会名称 |
| `description` | `LocalizedText` | 描述 |
| `marketSize` | `LocalizedText \| null` | 市场规模描述 |
| `timeWindow` | `LocalizedText \| null` | 时间窗口 |

### 5.5 projects（项目信息）
数组，每条为一个项目。

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | `LocalizedText` | 项目名称 |
| `description` | `LocalizedText` | 项目描述 |
| `status` | `'PLANNING' \| 'BIDDING' \| 'CONSTRUCTION' \| 'OPERATIONAL'` | 项目状态 |
| `capacity` | `string \| null` | 装机/产能 |
| `investment` | `number \| null` | 投资额（美元） |
| `location` | `LocalizedText \| null` | 所在地区 |

### 5.6 partners（本地伙伴）
数组，每条为一个潜在伙伴/服务机构。

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | `LocalizedText` | 伙伴名称 |
| `partnerType` | `string` | 类型枚举（律所/咨询/EPC/金融/政府关系/物流） |
| `description` | `LocalizedText` | 简介 |
| `contactHint` | `LocalizedText \| null` | 联系提示（脱敏，具体联系走会员门控） |

### 5.7 chinese-companies（中资企业）
数组，每条为一家已出海该国的中资企业。

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | `LocalizedText` | 企业名称 |
| `industry` | `string` | 行业标签 |
| `businessScope` | `LocalizedText` | 业务范围 |
| `entryYear` | `number \| null` | 进入年份 |
| `caseStudy` | `LocalizedText \| null` | 案例简述 |

### 5.8 entry-strategy（进入策略）
单条国家级策略对象（每国一条）。

| 字段 | 类型 | 说明 |
|------|------|------|
| `overview` | `LocalizedText` | 策略总述 |
| `steps` | `StrategyStep[]` | 进入步骤 |
| `recommendedMode` | `LocalizedText` | 推荐进入模式（独资/合资/并购等） |

`StrategyStep`：`{ order: number; title: LocalizedText; detail: LocalizedText }`

### 5.9 ai-advisor（AI 出海顾问）
本模块不直接展示静态数据，而是承载 **RAG 知识片段（KnowledgeChunk）** 的检索。

`KnowledgeChunk`：

| 字段 | 类型 | 说明 |
|------|------|------|
| `content` | `LocalizedText` | 知识片段正文（分语言存储与向量化） |
| `embeddingZh` | `vector` | 中文向量（pgvector） |
| `embeddingEn` | `vector` | 英文向量（pgvector） |
| `sourceModule` | `ModuleKey` | 片段来源模块 |
| `sourceId` | `string` | 来源数据 ID |

> 知识片段必须携带 §3 元字段，检索时强制 §3.1 的 `aiUsable` 约束。AI 回答语言必须与用户提问语言一致，缺失时按 §2.1 降级并标注。

### 5.10 reports（研究报告）
数组，每条为一份报告。

| 字段 | 类型 | 说明 |
|------|------|------|
| `title` | `LocalizedText` | 报告标题 |
| `abstract` | `LocalizedText` | 摘要 |
| `fileUrl` | `string` | 报告文件地址（下载走会员门控 + 服务端权限校验） |
| `publishedAt` | `DateTime` | 发布时间 |
| `accessLevel` | `'FREE' \| 'MEMBER' \| 'PREMIUM'` | 访问级别 |

---

## 6. 留资 / 线索（Lead）

会员转化相关，非国家数据模型的一部分，但需登记。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `string` (PK) | 主键 |
| `name` | `string` | 用户姓名 |
| `company` | `string \| null` | 公司 |
| `contact` | `string` | 联系方式（服务端加密存储） |
| `interestedCountry` | `string \| null` | 意向国家（ISO 码） |
| `source` | `string` | 留资入口 |
| `createdAt` | `DateTime` | 留资时间 |

> 联系方式属敏感数据，禁止在日志/前端明文暴露，须服务端加密（AGENTS.md 第 10 节）。

---

## 7. 标签与地区枚举

> 标签用于筛选与 AI 检索过滤。以下为初始枚举，新增值需在本文件登记。

### 7.1 行业标签（industryTags）
```
solar         # 光伏
wind          # 风电
storage       # 储能
ev            # 新能源汽车
hydrogen      # 氢能
grid          # 电网/输配电
bess-mfg      # 电池制造
epc           # 工程总承包
```

### 7.2 技术类型标签（techTags）
```
pv-module     # 光伏组件
inverter      # 逆变器
onshore-wind  # 陆上风电
offshore-wind # 海上风电
lfp           # 磷酸铁锂
ncm           # 三元锂
electrolyzer  # 电解槽
```

### 7.3 地区（region）
```
southeast-asia   # 东南亚
south-asia       # 南亚
middle-east      # 中东
africa           # 非洲
latin-america    # 拉美
europe           # 欧洲
central-asia     # 中亚
```

### 7.4 政策类型（policyType）
```
incentive     # 激励补贴
tariff        # 关税
localization  # 本地化要求
permit        # 许可审批
tax           # 税收
import-export # 进出口
```

### 7.5 风险类别（riskCategory）

以下值是非展示机器值，顺序与 `packages/shared-types` 保持一致。不得接受 `other`、大小写变体或任何未登记值；用户界面标签必须通过 i18n key 展示。

```
political    # 政治
economic     # 经济
legal        # 法律
exchange-rate # 汇率
operational  # 运营
social       # 社会
environmental # 环境
```

---

## 8. 一致性检查清单（改模型时自检）

- [ ] 已在本文件登记字段/枚举变更并说明理由
- [ ] `packages/db` Prisma schema 与本文件一致
- [ ] `packages/shared-types` 类型已同步派生
- [ ] 所有展示文本字段为 `LocalizedText`，非展示字段为单一值
- [ ] 核心业务数据元字段齐全（§3）
- [ ] 国家主键使用 ISO 3166-1 alpha-2
- [ ] STANDARD 政策/风险/机会候选记录使用 §3.2 的稳定 UUID v4 身份
- [ ] 覆盖等级与模块覆盖状态逻辑与 [coverage-levels.md](./coverage-levels.md) 一致
- [ ] AI 检索过滤符合 §3.1 硬约束
- [ ] 变更已在 PR 标注为「需人工确认」
