# 六国 BASIC 后平台化与单国深覆盖并行里程碑设计

日期：2026-07-18
状态：已由项目所有者确认；2026-07-19 Gate 0 精确依赖、ID STANDARD 试点设计与首批来源目录已批准，ID 仅授权 draft candidate

## 1. 背景与已验证基线

仓库已有六个经独立批准并发布的 canonical BASIC 国家：

| 国家码 | canonical 目录 | active run |
|--------|----------------|------------|
| ID | data/indonesia/ | data-basic-id-20260711-r2 |
| VN | data/vietnam/ | data-basic-vn-20260715-r3 |
| SA | data/saudi-arabia/ | data-basic-sa-20260717-r2 |
| AE | data/united-arab-emirates/ | data-basic-ae-20260717-r1 |
| BR | data/brazil/ | data-basic-br-20260718-r2 |
| ZA | data/south-africa/ | data-basic-za-20260718-r2 |

六国都使用同一十模块结构，首次真实交付恰好为 BASIC；只有
market-overview 有 published 数据，其他九个模块保持 BUILDING，且不存在
KnowledgeChunk 或 AI eligibility。这一基线已经足以验证国家中立模型、发布闸门、
Web 占位和跨国复制能力。

## 2. 决策

1. 六国 BASIC 基线完成后，启动生产数据库、NestJS API 与运行时治理；Admin 核心、
   鉴权和留资基础在 M1 验收完成后按独立任务启动。以上均不等待任何国家达到 COMPLETE。
2. 项目所有者已选择 `ID` 作为首个深覆盖试点，并批准 `DATA-STANDARD-ID` 的设计与
   首批来源目录；该任务与 M1 并行，当前仅授权生成 draft candidate。首批来源目录的
   身份和采集范围获批，不等于其中任何提取事实、双语文本或编辑结论获批。候选必须
   保持 `reviewStatus = draft`、`aiUsable = false`，不得进入 `pending`、`published`、
   canonical、生产数据库、KnowledgeChunk 或 AI 检索；当前 M2 不得标记完成。
   ID 的真实 canonical publication 仍恰好为 BASIC。
3. 平台底座与试点国 STANDARD 建设并行；任何一方都不需要等待另一方全部完成才
   能启动。
4. RAG 离线管道和问答接口骨架可在平台底座完成后用严格 fixtures 开发，但真实 AI
   Beta 必须等待试点数据和 AI 人工关口。
5. 会员、报告和受控资源基础在 M3 后按独立任务开发；付费或会员 Beta 必须等待真实
   受控资源、服务端权限验证及权益人工确认。

## 3. 里程碑

| 里程碑 | 状态 | 核心交付 | 完成闸门 |
|--------|------|----------|----------|
| M0 六国 BASIC | 已完成 | 六国 canonical publication、批准回执、Web/API Basic 展示 | 六国均恰好为 BASIC，无深层模块与 AI eligibility |
| M1 生产平台底座 | 收尾验证中 | PostgreSQL/Prisma 生产导入与读取、NestJS /api/v1、连接治理、缓存/健康检查/可观测性、容量基线及故障演练均已完成 | 全量验证、独立审查、merged-main 推送与 CI-SHA 对齐全部通过后方可标记完成 |
| M2 ID STANDARD 试点 | 设计与首批来源目录已批准；与 M1 并行，仅授权 draft candidate | 按已批准目录生成 ID policy、risk、opportunities 的双语、可追溯不可变候选 | 当前只验收 `reviewStatus = draft`、`aiUsable = false` 的候选；事实、双语文本和发布分别批准并通过 STANDARD 机器判定后，M2 才可完成 |
| M3 运营与权限基础 | M1 完整验收后启动 | Admin 核心编辑/审核、JWT 与服务端守卫、留资加密 | P4-1 权限逻辑另行人工批准；draft 到 pending 到 published 闭环；未授权访问失败；敏感信息不回显 |
| M4 AI 受控 Beta | 骨架可在 M1 后开发 | RAG 离线管道、问答接口、限流、失效同步 | 试点为 STANDARD；ai-advisor 至少 20 个可用片段且覆盖至少 3 个来源模块；正式 Prompt 和检索默认值经人工确认 |
| M5 会员与报告受控 Beta | M3 后开发 | 报告下载、访问等级、短时效绑定用户链接、真实用户试用 | 至少一个真实受控资源；服务端权限矩阵通过；权益和计费边界经人工确认 |
| M6 试点 COMPLETE 与复制 | 后续 | 试点十模块完整闭环，并验证向其他 BASIC 国家复制 | 试点经独立任务达到 COMPLETE；AI/会员 Beta 验收通过；再逐国、逐任务批准复制 |

执行依赖为：

- M0 完成后，M1 已按 DB → API → OPS 顺序实施，当前处于收尾验证。
- 项目所有者已批准 ID 试点设计与首批来源目录，M2 与 M1 并行，但仅可生成 draft candidate。
- M3 与 M4 fixture 骨架均依赖 M1 的全量验证、独立审查、merged-main 推送和 CI-SHA 对齐全部通过。
- M4 生产 Beta 还依赖 M2 经独立批准发布的真实 STANDARD 数据，以及 KnowledgeChunk 数量/模块覆盖、正式 Prompt、检索默认值和 `aiUsable` 等全部 AI 人工关口。
- M5 依赖 M3 和至少一个真实受控资源。
- M6 依赖试点 STANDARD、AI/会员相关 Beta 验收及新的 COMPLETE 人工批准。

## 4. 任务切片

- PLATFORM-DB-1：只完成六国 approved Basic 的生产数据库导入、幂等性和读取端口。
- PLATFORM-API-1：只完成 NestJS 服务骨架与现有公开国家 GET 接口迁移。
- PLATFORM-OPS-1：只完成连接池、缓存边界、健康检查、可观测性和负载基线。
- `DATA-STANDARD-ID`：只建设已选定的 ID STANDARD 试点；来源登记、事实候选、
  人工审核和原子发布保持分阶段闸门，不夹带平台代码。
- P5-1 / P5-2：M1 完整验收后完成 Admin 数据管理与审核，不等待 AI 或会员业务全部完成。
- P3-1 / P3-2：M1 完整验收后实现严格边界内的 AI 管道和接口骨架；生产启用由 M4 闸门决定。
- P4-1：权限逻辑须另行人工批准后实施；P4-3 可在 M1 完整验收后按独立任务实施。报告权益和付费 Beta 由 M5 闸门决定。
- `DATA-COMPLETE-<ISO2>`：仅在试点 STANDARD 验收后另行批准和实施。

每个切片仍遵守“一张任务卡 = 一件事 = 独立 review / 测试 / 回滚”。

## 5. 明确不授权的事项

本里程碑更新不执行或授权以下操作：

- 不选择 ID 以外的深覆盖试点国家，也不自动批准 ID 的 COMPLETE 升级。
- 不修改 docs/data-schema.md 或 Prisma 数据模型。
- 除已批准的 ID STANDARD 首批来源目录身份与采集范围外，不批准任何新增或替换
  来源，也不批准其中任何提取事实、双语文本、STANDARD 发布、canonical/生产数据库
  写入或 KnowledgeChunk；这些仍须在 `DATA-STANDARD-ID` 的对应阶段分别审核。
- 不编写正式 AI 系统 Prompt，不确定或放宽检索边界。
- 不修改会员等级、价格、计费或权限矩阵。
- Gate 0 仅批准 roadmap 已列明的精确 NestJS 依赖版本；不引入其他第三方依赖，
  不部署数据库，不迁移生产流量。

上述事项仍分别受 AGENTS.md 第 11 节的人工确认关口约束。
