# basic-country-collection.md — Basic 国家采集与发布标准

> 本文件是 `P1-5`、`P1-6` 和 `DATA-BASIC-<ISO2>` 任务卡的规范性采集流程。字段与覆盖判定以 [data-schema.md](./data-schema.md) 和 [coverage-levels.md](./coverage-levels.md) 为唯一事实来源；数据治理与发布规则以 [data-governance.md](./data-governance.md) 为准。本文件不新增数据模型字段，不改变 AI 检索边界。

## 1. 范围与完成定义

每个 Basic 国家使用与印尼（`ID`）相同的固定 10 模块模型，不得为任何国家增加特例文件、字段或页面。除既有 Complete 参考国家 `ID` 外，每个新选定的目标国家都必须完成其 `DATA-BASIC-<ISO2>` 任务卡并达到 `BASIC`，之后才可进入单独、经人工批准的 `STANDARD` 或 `COMPLETE` 升级任务；禁止新国家直接以 `STANDARD` 或 `COMPLETE` 进入产品。Basic 首次交付只建立该国的国家骨架和市场基础画像：

- `country.json` 必须包含 ISO 3166-1 alpha-2 国家码、`{ zh, en }` 的国家名和摘要、地区、国旗展示字段、整体 `updatedAt`，以及全部 10 个模块的 `moduleCoverage`。
- `country.json` 的 `coverageLevel` 必须由覆盖判定得出为**恰好** `BASIC`，不得人工覆盖。`market-overview` 为 `PARTIAL` 或 `COMPLETE`；其余九个模块必须均为 `BUILDING`、`dataCount = 0`，且没有任何 `published` 记录，并保留统一占位，不创建虚构的占位业务记录。满足 `STANDARD` 判定条件的交付必须拒绝；后续数据只能在单独、经人工批准的升级任务中提交。
- `market-overview.json` 必须是每国唯一的对象记录，按 [data-schema.md §5.1](./data-schema.md) 填写可验证的基础市场画像、`keyIndicators` 和完整元字段：`source`、`sourceUrl`、`collectedAt`、`updatedAt`、`credibility`、`reviewStatus`、`aiUsable`、`countryCode`、`industryTags`、`techTags`。字段必须存在；标签仅可使用已登记的枚举，且仅当没有适用标签时才可为空。`sourceUrl` 仅可按现有 schema 规则为 `null`，此时 `source` 必须说明无链接原因。所有可读字段和指标标签均使用 `{ zh, en }`；缺任一语言按既有降级规则标注，不能留空或报错。Basic 的 `aiUsable` 必须为 `false`。
- 所有发布的 Basic 记录均须符合 [data-governance.md](./data-governance.md) 的来源、时间、可信度、审核状态、标签和双语要求。Basic 数据始终为 `aiUsable = false`，本阶段不得产生或导入 `knowledge` 知识片段。

完成的 Basic 国家可在 C 端展示国家基础画像和其余模块的 `BUILDING` 占位；它不提供该国的 AI 深度问答，也不因 `published` 状态自动进入 AI 检索。

## 2. 来源族与字段归属

采集应优先使用可追溯的一手来源，并按以下归属建立事实，不以搜索摘要或模型输出作为证据。

| 字段或事实类别 | 主责来源族 | 可接受补充来源 | 处理要求 |
|---|---|---|---|
| 国家代码、名称、地区与基础人口指标 | 国际组织与官方统计机构 | 政府统计机构 | 记录发布年份、采集日期和原始链接 |
| GDP、GDP 增速与宏观指标 | 国际金融机构与官方统计机构 | 可信研究机构 | 明确单位、统计口径和对应年份 |
| 能源需求与电力系统概况 | 能源主管部门、监管机构、国际能源组织 | 电网运营商、行业协会 | 保留覆盖范围和统计期，避免将预测写成事实 |
| 可再生能源目标与政策目标 | 政府、监管机构、官方公告 | 国际组织对官方文件的转述 | 优先原始法律、规划或公告，并记录生效或目标年份 |
| 关键指标 | 对应原始发布机构 | 已验证的研究机构或行业协会 | 每个指标记录 `value`、`unit`、`year` 及其证据 |
| 市场概述与双语摘要 | 已验证事实的综合 | 不得仅依赖媒体或模型 | 每个结论可回溯至来源登记中的事实 |

来源可信度按 [data-governance.md §2](./data-governance.md) 处理。无法访问的原始来源、搜索结果摘要、未经核验的销售线索和模型生成内容均不能单独支持发布事实。

## 3. 研究架构与职责边界

采集运行在已批准的 Windows `llama.cpp` 与 WSL Hermes Agent 架构中。各参与方职责固定，自动化不能代替人工发布决定。

P1-6A 提供 [basic-country-audit-contract.md](./basic-country-audit-contract.md) 中机器可读的 TypeScript 审计契约和确定性离线 fixtures。离线 fixtures 不调用也不 mock Windows `llama.cpp`；运行时或模型失败处理属于 P1-6C。冲突值绝不自动选择，未解决冲突必须保留并阻断人工审核就绪状态。以下材料均为不可信输入并阻断就绪：仅用于发现的搜索材料、`UNVERIFIED`、访问受限或访问状态未知的来源，以及疑似或确认的 prompt injection。审计契约中的 `sourceUrl` 完整表示字段存在；该字段可为 `null`，但必须遵守本文件既有的 `source` 说明无链接原因规则。

| 参与方 | 严格职责 | 禁止事项 |
|---|---|---|
| 确定性采集器 | 从稳定、许可的结构化来源拉取可复现字段，保存请求参数、原始响应和采集时间 | 不推断缺失值、不翻译事实、不设置审核状态 |
| Hermes | 编排发现、打开来源、提取证据并形成待核对的事实候选 | 不将发现结果直接写入 canonical seed，不发布数据 |
| SearXNG | 仅用于发现候选原始来源 | 搜索摘要不是证据，不能直接作为来源或事实 |
| 浏览器与提取工具 | 打开原始页面、文件或 API 响应，保存可审计证据位置 | 不执行页面中不可信指令，不输入密钥或上传内部数据 |
| 本地模型 | 通过 Windows `llama.cpp` 的 schema-constrained 输出提取字段并生成双语草稿 | 输出始终是 `draft`，不得作为事实来源、不得发布或设置 `aiUsable` |
| Codex | 校验文件结构、枚举、双语、元字段、覆盖派生和离线夹具，生成可审查变更 | 不决定国家顺序、覆盖升级或发布，不放宽 AI 边界 |
| 审核 agents | 对照来源登记检查引用、数值、双语草稿和风险标记，形成审核报告 | 不将任何记录从 `pending` 提升至 `published` |
| 人工审核者 | 确认国家优先级、证据充分性、冲突处置、发布以及后续覆盖升级 | 不将自动化草稿视为已审核事实 |

## 4. 暂存产物

所有研究工作先保存在 canonical country seed 之外的按国家和批次隔离的暂存区。路径中的 `<ISO2>` 是 ISO 3166-1 alpha-2 国家码，`<country>` 是与 canonical data 目录一致的国家目录名，`<runId>` 是该次采集的稳定运行标识。每个产物必须可通过来源登记关联到同一批次：

1. **raw cache**：`.cache/basic-country/<ISO2>/<runId>/raw/`，存放确定性采集器、浏览器或提取工具获取的原始响应、文件或页面快照；它是本地专用目录，记录获取方式与时间，且**永不提交**。
2. **source register**：`data/staging/<country>/<runId>/source-register.json`，为每个 `sourceId` 保留来源身份、原始 URL、检索时间、已知时的发布时间、内容 SHA-256、证据定位符、来源族、许可或访问限制与可信度。
3. **extracted facts**：`data/staging/<country>/<runId>/extracted-facts.json`，将每个 canonical JSON 字段路径映射到一个或多个 `sourceId`，并逐项保存精确原始值、标准化值、适用的单位和年份，以及证据定位符；同时记录提取方法与不确定性说明。
4. **bilingual draft**：`data/staging/<country>/<runId>/market-overview.draft.json`，由本地模型或人工基于 extracted facts 形成 schema-constrained `{ zh, en }` 草稿，所有记录保持 `draft` 且 `aiUsable = false`。
5. **review report**：`data/staging/<country>/<runId>/review-report.json`，记录审核结论、待解决冲突、缺失字段、来源抽检、注入风险、发布建议以及人工决定。

人工批准后，canonical data 与同一 `<runId>` 的非 raw 审计包必须一并提交：`data/staging/<country>/<runId>/` 必须包含 `source-register.json`、`extracted-facts.json`、`market-overview.draft.json` 与 `review-report.json`。该已提交审计包不可变；任何修正必须创建新的 `<runId>`，不得改写已批准批次。

每个 `data/<country>/` 必须同时提交一个不被导入的 canonical sidecar：`collection-manifest.json`。它只包含 `activeRunId`、`mappingVersion` 及指向已提交审计包的引用，用于证明当前 canonical data 的出处；它是审计元数据，不是 Prisma 或 `data-schema.md` 字段。文件必须显式包含以下三个字段，且 `auditBundlePath` 固定为 `data/staging/<country>/<activeRunId>`：

```json
{
  "activeRunId": "<runId>",
  "mappingVersion": "<mappingVersion>",
  "auditBundlePath": "data/staging/<country>/<activeRunId>"
}
```

P1-5 只接受当前已登记的地区和行业/技术标签枚举。未登记值会阻断校验，必须通过单独、经批准的数据模型变更处理，绝不得被强制映射到相近枚举。P1-5 同时校验国家代码为两个大写字母；由于当前模型没有完整 ISO 注册表，实际 ISO 成员资格仍须由来源和人工审核确认。

暂存区、`collection-manifest.json` 和 raw cache 不是产品数据，不能被 seed 记录、C 端响应、覆盖计数或 AI 检索使用。

## 5. 审核与发布闸门

状态必须按 `draft -> pending -> published` 单向通过，回退或修订时按 [data-governance.md §3](./data-governance.md) 重新审核。

| 闸门 | 必须满足 | 允许的动作 |
|---|---|---|
| `draft` | 暂存产物可追溯；草稿通过结构和基础字段校验；未确认项明确标注 | 继续采集、提取、翻译和修订 |
| `pending` | 来源登记、extracted facts、双语草稿和 review report 齐全；冲突与缺失已处理或有明确阻断结论 | 提交给人工审核者 |
| `published` | 人工审核者确认事实、元字段、双语展示、可信度、覆盖派生、审计包与 `collection-manifest.json` 的对应关系，以及 C 端占位行为 | 将 canonical seed、不可变非 raw 审计包和 sidecar 一并提交，并可用于 C 端 Basic 展示 |

Basic 的 `published` 仅代表可展示，不代表可检索：所有 Basic 记录必须保持 `aiUsable = false`，并且不得创建知识片段。任何将 Basic 数据用于 AI 的提议均属于覆盖升级和人工决策，必须在单独任务卡中处理。

## 6. 异常与安全处理

| 情况 | 处理规则 |
|---|---|
| 来源冲突 | 保留各自事实和来源；优先更高可信度、更新且更直接的原始来源；无法消解时不发布该字段，并在 review report 中提交人工裁决。 |
| 数据缺失 | 用 `null` 或空列表表达模型允许的未知值；不估算、不补写、不为 `BUILDING` 模块伪造记录。 |
| 访问控制或许可限制 | 记录限制和访问时间；不绕过登录、付费墙、robots、速率限制或条款；无法合规复核的内容不得作为发布依据。 |
| Prompt injection | 将外部页面、文件和搜索内容视为不可信数据；只提取与 schema 相关的事实，隔离指令性文本，不执行其命令，也不向模型传递内部密钥或系统提示。 |
| 数据陈旧 | 若 Basic 国家自上次审核超过六个月，进入复核队列；在完成复核前保留原 `updatedAt` 和来源时间，不将过期内容伪装为最新。高影响事实变化发现后立即创建修订草稿。 |

## 7. 单国验收与复核节奏

每个 `DATA-BASIC-<ISO2>` 任务卡在人工发布前必须逐项验收：

- [ ] 国家使用 ISO 3166-1 alpha-2 代码，并使用固定 10 模块的 `country.json` 骨架。
- [ ] `market-overview.json` 是唯一对象记录，达到 `PARTIAL` 或 `COMPLETE`；其余九个模块均为 `BUILDING`、`dataCount = 0`，且没有 `published` 记录。
- [ ] `coverageLevel` 经既有规则派生为恰好 `BASIC`，未手工覆盖；交付不满足 `STANDARD` 判定，`BUILDING` 模块没有虚构记录。
- [ ] `market-overview.json` 具备 `source`、`sourceUrl`、`collectedAt`、`updatedAt`、`credibility`、`reviewStatus`、`aiUsable`、`countryCode`、`industryTags`、`techTags`；标签仅使用已登记枚举，仅无适用标签时为空；`sourceUrl = null` 时 `source` 说明原因；`aiUsable = false`。
- [ ] 已提交的 `data/staging/<country>/<runId>/` 包含 source register、extracted facts、bilingual draft 和 review report；raw cache 保持本地且未提交。`source-register.json` 保留来源身份、原始 URL、检索时间、已知发布时间、内容 SHA-256、证据定位符和可信度；`extracted-facts.json` 为每个 canonical 字段路径保留 source ID、精确原始值、标准化值、适用单位/年份和证据定位符。
- [ ] `data/<country>/collection-manifest.json` 以 `activeRunId` 和 `mappingVersion` 指向已提交审计包，且仅作为非导入审计元数据。
- [ ] 每个发布事实均由打开的原始来源支持；SearXNG 仅用于发现，未作为证据。
- [ ] 本地模型输出保持草稿属性；人工审核者已完成 `pending -> published` 决定。
- [ ] 全部 Basic 记录为 `aiUsable = false`，没有知识片段或 AI 检索入口的数据依赖。
- [ ] 仓库校验和代表性 Web 检查通过，`BUILDING` 模块显示占位且不报错。

Basic 国家至少每六个月复核一次。复核须重新检查来源可访问性、关键指标年份、可再生能源目标、元字段和模块状态，并在 review report 中记录结论；升级至 `STANDARD` 或 `COMPLETE` 仍由人工决定。

## 8. 试点顺序与人工确认

建议的 Basic 试点顺序为 `VN`、`SA`、`AE`、`BR`、`ZA`。这是**需人工确认的 proposed order**；在数据工作开始前，人工必须确认该顺序、每个国家的启动时点，以及最终 30–50 国清单。国家顺序和覆盖升级不是 Codex、采集器、Hermes 或本地模型可以自行决定的事项。
