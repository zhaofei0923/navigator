# 六国 BASIC 后平台化与单国深覆盖并行里程碑设计

日期：2026-07-18
状态：已由项目所有者确认；2026-07-18 追加批准 ID 作为 STANDARD 试点并与 M1 并行

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

1. 六国 BASIC 基线完成后，立即启动生产数据库、NestJS API、运行时治理、Admin
   核心和鉴权基础；不等待五个或六个国家达到 COMPLETE。
2. 项目所有者已选择 `ID` 作为首个深覆盖试点，并批准启动独立的
   `DATA-STANDARD-ID`；该任务与 M1 并行。此决定只批准试点选择和候选建设启动，
   不预先批准来源、事实、发布、`aiUsable`、KnowledgeChunk 或后续 COMPLETE 升级。
3. 平台底座与试点国 STANDARD 建设并行；任何一方都不需要等待另一方全部完成才
   能启动。
4. RAG 离线管道和问答接口骨架可在平台底座完成后用严格 fixtures 开发，但真实 AI
   Beta 必须等待试点数据和 AI 人工关口。
5. 会员、报告和受控资源基础可提前开发；付费或会员 Beta 必须等待真实受控资源、
   服务端权限验证及权益人工确认。

## 3. 里程碑

| 里程碑 | 状态 | 核心交付 | 完成闸门 |
|--------|------|----------|----------|
| M0 六国 BASIC | 已完成 | 六国 canonical publication、批准回执、Web/API Basic 展示 | 六国均恰好为 BASIC，无深层模块与 AI eligibility |
| M1 生产平台底座 | 可立即启动 | PostgreSQL/Prisma 生产导入与读取、NestJS /api/v1、连接治理、缓存/健康检查/可观测性和容量基线 | 六国幂等导入；数据库 API 与当前 canonical JSON 结果等价；失败可回滚且不改写 canonical 文件 |
| M2 ID STANDARD 试点 | 已批准启动，与 M1 并行 | ID 的 policy、risk、opportunities 双语、可追溯候选及后续独立发布 | 国家满足 STANDARD 机器判定；来源、事实和发布分别审核；不得自动启用 AI |
| M3 运营与权限基础 | M1 后启动 | Admin 核心编辑/审核、JWT 与服务端守卫、留资加密 | draft 到 pending 到 published 闭环；未授权访问失败；敏感信息不回显 |
| M4 AI 受控 Beta | 骨架可在 M1 后开发 | RAG 离线管道、问答接口、限流、失效同步 | 试点为 STANDARD；ai-advisor 至少 20 个可用片段且覆盖至少 3 个来源模块；正式 Prompt 和检索默认值经人工确认 |
| M5 会员与报告受控 Beta | M3 后开发 | 报告下载、访问等级、短时效绑定用户链接、真实用户试用 | 至少一个真实受控资源；服务端权限矩阵通过；权益和计费边界经人工确认 |
| M6 试点 COMPLETE 与复制 | 后续 | 试点十模块完整闭环，并验证向其他 BASIC 国家复制 | 试点经独立任务达到 COMPLETE；AI/会员 Beta 验收通过；再逐国、逐任务批准复制 |

执行依赖为：

- M0 完成后，M1 可立即启动。
- 项目所有者已批准 ID 试点启动，M2 与 M1 并行。
- M3 依赖 M1 的数据库和 API 核心。
- M4 生产 Beta 同时依赖 M1 的 AI 骨架和 M2 的真实数据。
- M5 依赖 M3 和至少一个真实受控资源。
- M6 依赖试点 STANDARD、AI/会员相关 Beta 验收及新的 COMPLETE 人工批准。

## 4. 任务切片

- PLATFORM-DB-1：只完成六国 approved Basic 的生产数据库导入、幂等性和读取端口。
- PLATFORM-API-1：只完成 NestJS 服务骨架与现有公开国家 GET 接口迁移。
- PLATFORM-OPS-1：只完成连接池、缓存边界、健康检查、可观测性和负载基线。
- `DATA-STANDARD-ID`：只建设已选定的 ID STANDARD 试点；来源登记、事实候选、
  人工审核和原子发布保持分阶段闸门，不夹带平台代码。
- P5-1 / P5-2：先完成 Admin 数据管理与审核，不等待 AI 或会员业务全部完成。
- P3-1 / P3-2：先实现严格边界内的 AI 管道和接口骨架；生产启用由 M4 闸门决定。
- P4-1 / P4-3：先完成鉴权、守卫和留资；报告权益和付费 Beta 由 M5 闸门决定。
- `DATA-COMPLETE-<ISO2>`：仅在试点 STANDARD 验收后另行批准和实施。

每个切片仍遵守“一张任务卡 = 一件事 = 独立 review / 测试 / 回滚”。

## 5. 明确不授权的事项

本里程碑更新不执行或授权以下操作：

- 不选择 ID 以外的深覆盖试点国家，也不自动批准 ID 的 COMPLETE 升级。
- 不修改 docs/data-schema.md 或 Prisma 数据模型。
- 不因试点启动而预先批准任何来源、事实、STANDARD 发布或 KnowledgeChunk；这些
  仍须在 `DATA-STANDARD-ID` 的对应阶段分别审核。
- 不编写正式 AI 系统 Prompt，不确定或放宽检索边界。
- 不修改会员等级、价格、计费或权限矩阵。
- 不引入第三方依赖，不部署数据库，不迁移生产流量。

上述事项仍分别受 AGENTS.md 第 11 节的人工确认关口约束。
