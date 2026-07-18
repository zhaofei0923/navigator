# country-rollout.md — 国家建设与覆盖升级计划

> 本文件定义国家数据库的建设顺序、覆盖目标与升级门槛。
> 它不新增数据模型字段；如需把计划字段落库，必须先更新 `data-schema.md` 与 Prisma schema，并按 AGENTS.md §11 人工确认。
> Basic 国家采集、审核与发布必须遵循 [basic-country-collection.md](./basic-country-collection.md)。

---

## 1. 建设目标

MVP 到商业化初期的当前建设目标是经人工批准的国家先完成 Basic 首次交付。所有国家（包括 `ID`）的首次真实数据交付必须恰好为 `BASIC`。

| 覆盖等级 | 目标规模 | 说明 |
|----------|----------|------|
| Basic | 经人工批准的国家 | 全球国家池的统一入口与基础画像，包含 `ID` 的首次真实验证 |
| Standard | 后续单独升级 | Basic 验收后才可经人工批准启动 |
| Complete | 后续单独升级 | 首个深覆盖试点须先完成 Standard，再经新的人工批准启动 |

所有国家使用同一套 10 模块结构，差异只体现在数据深度，不体现在页面结构。

每个选定国家必须先完成其 `DATA-BASIC-<ISO2>` 任务卡并达到 Basic。六国 BASIC 基线完成后，首个深覆盖试点按 Standard → Complete 两张独立任务卡推进，每一步均另行人工批准；禁止任何国家直接以 Standard 或 Complete 进入产品。

---

## 2. 首批国家候选

| 阶段 | 国家码 | 国家 | 目标覆盖 | 角色 | 状态 |
|------|--------|------|----------|------|------|
| 首次真实验证 | ID | 印度尼西亚 | Basic | 验证 Basic 十模块骨架与人工发布闸门 | 已发布 Basic |
| 扩展 | VN | 越南 | Basic | 已按批准的 v2 candidate 发布基础画像；后续覆盖升级仍须独立人工决定 | 已发布 Basic |
| 扩展 | SA | 沙特阿拉伯 | Basic | r1 是不可变审计历史，永不得批准或发布，且不得作为任何批准决定或发布任务的输入；r2 是唯一 active publication，后续覆盖升级仍须独立人工批准 | 已发布 Basic |
| 扩展 | AE | 阿联酋 | Basic | 已按批准的 r1 v2 candidate 发布基础画像；后续覆盖升级仍须独立人工决定 | 已发布 Basic |
| 扩展 | BR | 巴西 | Basic | r1 为已拒绝的不可变审计历史；r2 是唯一 active publication，后续覆盖升级仍须独立人工批准 | 已发布 Basic |
| 基础池 | KE | 肯尼亚 | Basic | 非洲示范市场 | 待人工确认 |
| 扩展 | ZA | 南非 | Basic | r1 为已拒绝的不可变审计历史；r2 是唯一 active publication，后续覆盖升级仍须独立人工批准 | 已发布 Basic |
| 基础池 | MX | 墨西哥 | Basic | 北美近岸与新能源市场 | 待人工确认 |
| 基础池 | AU | 澳大利亚 | Basic | 成熟能源市场与储能机会 | 待人工确认 |

`ID` 是首个真实 Basic 验证国家；`VN`、`SA`、`AE`、`BR`、`ZA` 与其他候选国家同样必须先按 Basic 交付，再在独立、经人工批准的升级任务中决定是否推进 Standard 或 Complete。首批 30–50 个 Basic 国家清单、最终国家顺序和覆盖升级结论均属于业务优先级决策，必须由人工确认后再进入 seed 或后台录入。

### 六国 BASIC 基线与下一阶段启动门槛（已完成）

| 国家码 | active run | 当前覆盖 |
|--------|------------|----------|
| ID | `data-basic-id-20260711-r2` | BASIC |
| VN | `data-basic-vn-20260715-r3` | BASIC |
| SA | `data-basic-sa-20260717-r2` | BASIC |
| AE | `data-basic-ae-20260717-r1` | BASIC |
| BR | `data-basic-br-20260718-r2` | BASIC |
| ZA | `data-basic-za-20260718-r2` | BASIC |

这六个 canonical publication、批准回执和十模块占位共同构成 M0 完成证据。它们已经验证统一模型和跨国复制能力，因此：

- 生产 PostgreSQL/Prisma 读取链路、NestJS API、运行治理、Admin 核心、鉴权与留资基础可以启动，不等待任何国家达到 COMPLETE。
- 项目所有者已选择 `ID` 作为首个 Standard 试点，并批准 `DATA-STANDARD-ID` 与 M1 并行启动。
- 该决定只批准试点选择与候选建设启动，不自动启用 AI，也不改变权限、计费或数据模型。来源、事实、双语文本、STANDARD 发布、`aiUsable`、真实 ID KnowledgeChunk 创建与可检索资格、COMPLETE 升级均须分别人工批准。
- 详细依赖和任务切片以 [六国 BASIC 后里程碑设计](./superpowers/specs/2026-07-18-six-basic-platform-milestone-design.md) 与 [roadmap.md](./roadmap.md) 为准。

2026-07-18 执行进度：M1 正在按 DB → API → OPS 严格串行推进。`PLATFORM-DB-1` 已完成；`PLATFORM-API-1` 仅完成无新增依赖的任务 1–2，仍须等待 Gate 0 对精确 NestJS 依赖集合的人工批准后才能执行任务 3–6；`PLATFORM-OPS-1` 必须继续等待 API 完成，因此 API 与 M1 均未完成。

与 M1 并行的 `DATA-STANDARD-ID` 已完成严格合成 fixture、parser、覆盖判定与 AI 负向边界切片。该切片不含真实 ID 来源、事实或双语业务文本，不构成 STANDARD 发布，也不授权 `aiUsable = true`、真实 KnowledgeChunk、AI 可检索资格或 COMPLETE；ID 的真实 canonical publication 仍恰好为 BASIC。上述真实数据与发布动作仍须逐项通过人工关口。

### SA r1 audit history and r2 Basic publication record

- `DATA-BASIC-SA-COLLECT` 的 `SA` / `saudi-arabia` / `data-basic-sa-20260717-r1` 保持 immutable history：其四个 artifact hash 仍为 `source-register.json` `fcc3de285225f2e26a04f82b72e53caf69df605971fd2eb10b0eacbe2e884711`、`extracted-facts.json` `7a423661d5b7bd2d43c7f81b39131eeea47fb82cf62624343d976128eb4d36d1`、`market-overview.draft.json` `567821ee55b5fd04cf4db198ee8a25629ec459a8f4542ae57185d478b800c92a`、`review-report.json` `a375cc5b759f3e1b619a3c1826adb0eaad48c5779a44a816a387fd021e301ee9`。r1 遗漏了官方对约 `92.5 GW` 与约 `340,430 GWh` 的限定词，故在批准前已 superseded；它是不可变审计历史，永不得批准或发布，且不得作为任何批准决定或发布任务的输入。
- 获批准并成为唯一 active publication 的是 `data-basic-sa-20260717-r2`，绑定 catalog `2026-07-17.1` 与 SHA-256 `3c174b76efe8c637436c52f473911d6409d79ac2e057eb251bb860dba4c417e7`。r2 的七个新鲜 source identities 来自上述三条 Saudi official manual-document sources 和四条 World Bank deterministic sources；其 source-register 记录的检索时间为 `2026-07-17T11:43:29.591Z` 至 `2026-07-17T11:43:39.177Z`，不复用 r1 capture identity。
- r2 staging 目录恰好包含 `source-register.json` (`b242dc902b7002dc3a2cec1bd87703760d776ada2b5c301329543b1f5945353d`)、`extracted-facts.json` (`bd0df36ba29453e0d337ad8401310c443ff26686cc8efc06994902b017814072`)、`market-overview.draft.json` (`2a297d007279afb80baeb316581aca874738ce614443a2a7944ad576e32c6285`) 与 `review-report.json` (`c8677f1bac448aa87ec79e35f3ffb9fc5b15c615f2b47ab3072ed588e09e6f9d`)。
- r2 candidate 在发布前通过 v2 validator：状态为 `ready-for-human-review`，有 7 个 sources、32 条 facts、零 blockers/errors/conflicts/missing/injection risks，并保持 `reviewStatus = draft`、`aiUsable = false`、`humanDecision = null`。其 immutable candidate bytes 未因发布而改变。
- 项目所有者已明确批准 `saudi-arabia` / `SA` / `data-basic-sa-20260717-r2`，reviewer 为 `github:zhaofei0923`，submitted / decided 均为 `2026-07-17T13:21:53.000Z`。独立批准回执 SHA-256 为 `b09aca2ea28e507977ab977246acdf0fc61c17337ddd7646e6b17b516b2ee5bc`。
- `data/saudi-arabia/` canonical publication 恰好包含 `country.json` (`0ea252d57e178f328435f87ba7b732f75137734d31ad4449dcf62a987d536db7`)、`market-overview.json` (`bd772ce5ba20b70920a85c54845a1683444ebe06aa258e16331f237399cb1037`) 与 `collection-manifest.json` (`40c26ae8199e2475577a60e909859eb6b025e447e76968bcc35af3fc75f4c71a`)。覆盖恰好为 `BASIC`，市场概览是唯一 `COMPLETE` 模块，其余九模块均为 `BUILDING`/零项，且 `aiUsable = false`。
- r1 仍是不可变审计历史，永不得批准或发布，且不得作为任何批准决定或发布任务的输入；r2 的本次 Basic 发布不授权 Standard、Complete、AI 或深度模块。任何后续升级均须单独取得人工批准。

### AE r1 Basic publication record

- 获批准并成为唯一 active publication 的是 `united-arab-emirates` / `AE` /
  `data-basic-ae-20260717-r1`。其 immutable candidate 四文件 SHA-256 为
  `source-register.json` `2430b3c80beb1d33de61aa0af82174d4c8a5d66ead95c38b4e6390e3f5cfd842`、
  `extracted-facts.json` `f26bea5b799e2b5e3014b90783438d28f292424e4a927504992cb1f3384639e7`、
  `market-overview.draft.json` `aa8ca2e01f0240abc7923cae991bf981a9d8982ff155c8ff9684b31db3255bfe`
  与 `review-report.json` `35da3331817a19d59b5b7c0ca01036117ff10095cff5be863171367e3f504b5c`。
- 项目所有者已明确批准该 identity，reviewer 为 `github:zhaofei0923`，submitted /
  decided 均为 `2026-07-18T02:51:43.000Z`。独立批准回执 SHA-256 为
  `41b2f9c18e27a77c3129125cb50d3d88fa7405ffb8729e3e97f593efab3341f4`。
- `data/united-arab-emirates/` canonical publication 恰好包含 `country.json`
  (`425d1ab993230698341a6972f1c671b2dcb68386e2c2809498400a5e4cfb9257`)、
  `market-overview.json` (`aaf5fbf982ae757c90d50beb8e473190f3e7b5eceb68529bf8868ce98ac250fa`)
  与 `collection-manifest.json`
  (`20f44483962a6ee5b46de281ddff9768cc1fbe9ca4c50a8e46b21a031265e984`)。
  覆盖恰好为 `BASIC`，市场概览是唯一 `COMPLETE` 模块，其余九模块均为
  `BUILDING`/零项，且 `aiUsable = false`。
- candidate bytes 未因发布而改变。本次 Basic 发布不授权 Standard、Complete、
  AI 或深度模块；任何修正必须创建新 run，任何后续升级均须另行人工批准。

### BR r1 audit history and r2 Basic publication record

- `data-basic-br-20260717-r1` 是已拒绝的不可变审计历史，永不得批准、发布或作为
  后续发布输入；该 run 的四个 artifact hashes 继续记录在
  [brazil-seed.md](./brazil-seed.md)，且不存在 r1 approval receipt。
- 获批准并成为唯一 active publication 的是 `brazil` / `BR` /
  `data-basic-br-20260718-r2`。其 immutable candidate 四文件 SHA-256 为
  `source-register.json` `22b7800d29ad39408e62c2c84d78c643b3d70ed081dca528a15708c895bfced5`、
  `extracted-facts.json` `6c8cb2023f9b2e41afc06bc6d129db7289d7b6b81b2af8171f3eeac3681918d2`、
  `market-overview.draft.json` `2fcfa2d31c616ec99876a268330fd0c73e07e63c6a1fd1b0402de7927c1099e2`
  与 `review-report.json` `645e074ba71650fa250d792245fe0397f0f0b678292abce71744350c2fc3511e`。
- 项目所有者已明确批准该 identity，reviewer 为 `github:zhaofei0923`，submitted /
  decided 均为 `2026-07-18T02:51:43.000Z`。独立批准回执 SHA-256 为
  `47136fb4516cc6d7a2fe4c104542f184c8190201ba6e5b772b796d55f215cf01`。
- `data/brazil/` canonical publication 恰好包含 `country.json`
  (`1a472079dc82589e50f4ed05885c9161d90f4b42e115c7852c69c8da7593d6e5`)、
  `market-overview.json` (`79b76a56d878493ec91ba774f156301a6d85c688ae51c8aaf7ac71384a5db53a`)
  与 `collection-manifest.json`
  (`ff6f8a99e369f1fadf560858332c8589f1d6a8eb72e0d2751acf540cdb6f3421`)。
  覆盖恰好为 `BASIC`，市场概览是唯一 `COMPLETE` 模块，其余九模块均为
  `BUILDING`/零项，且 `aiUsable = false`。
- canonical 保留 2025 年最终电力消费同比增长 `2.7%`、太阳能光伏装机
  `64,793 MW` 和风电装机 `34,707 MW`；排除不可比的 `86.8` / `86.6` 口径和
  非总量的 `20.4 TWh`。2030 项仅是全国能源矩阵定性目标，`techTags = []`。
  本次发布不授权 Standard、Complete、AI 或深度模块。

### ZA r1 audit history and r2 Basic publication record

- `data-basic-za-20260717-r1` 是已拒绝的不可变审计历史，永不得批准、发布或作为
  后续发布输入；其四文件 identity 继续由 candidate lock 保留，且不存在 r1
  approval receipt。
- 获批准并成为唯一 active publication 的是 `south-africa` / `ZA` /
  `data-basic-za-20260718-r2`。其 immutable candidate 四文件 SHA-256 为
  `source-register.json` `7a99e47484e038a708201981035da50de7309f09ede5ab235ad4f32151001e3f`、
  `extracted-facts.json` `dc8387ad8569037d799e59b0be8502647bf2719d7b9395962d56901f9df1250c`、
  `market-overview.draft.json` `16ea4b33672b0c5ff4ad025eca1ca8d2ca0ceb36f95bf8c8f8d7da93c6b91536`
  与 `review-report.json` `f73b93f10e3dc0d40eac7f918745bde855f11d49fed5a0259ea2fefa27e92a33`。
- 项目所有者已明确批准该 identity，reviewer 为 `github:zhaofei0923`，submitted /
  decided 均为 `2026-07-18T02:51:43.000Z`。独立批准回执 SHA-256 为
  `5e82bf08c86218c9b141d17b9f17bbadf7ca1a6f5634058abafb89e14e065e56`。
- `data/south-africa/` canonical publication 恰好包含 `country.json`
  (`44249f810ff09bdfbaf2d4e53c99412df7e10f245872aa8bac3c52a6e6a7270c`)、
  `market-overview.json` (`3a45fd2eeba92cd8cb3f85f1ed6b492ffe2fe28defadab619d61450769657f77`)
  与 `collection-manifest.json`
  (`26b338493345f432f84420d50ef3acafbc2974d96bc24036f7d049b01401065c`)。
  覆盖恰好为 `BASIC`，市场概览是唯一 `COMPLETE` 模块，其余九模块均为
  `BUILDING`/零项，且 `aiUsable = false`。
- canonical 保留 FY2025 Eskom 售电量 `189.7 TWh` 与 Eskom 口径送出电量
  `195,702 GWh`；后者不表述为自发电量，也不添加 pumping 或 wheeling 限定。
  `43,041 MW` 是 2026-2042 年累计规划新增风电，年份为 2042，不是当前、已建或
  已采购容量；当前基础中的 `5,344 MW` 风电和 `3,646 MW` 并网太阳能包括已投运、
  在建及视为于 2025 年投运的容量。IRP 更新时间为 `2025-10-28T00:00:00.000Z`，
  `techTags = ["onshore-wind"]` 仅由 RMIPPPP 明确支持。本次发布不授权 Standard、
  Complete、AI 或深度模块。

---

## 3. 覆盖升级门槛

覆盖等级的机器判定以 [coverage-levels.md](./coverage-levels.md) 为准，本节只定义运营建设口径。

### Basic

- 国家基础画像可用。
- `market-overview` 为 `PARTIAL` 或 `COMPLETE`；其余九个模块均为 `BUILDING`、没有 published 记录且显示占位。
- 覆盖等级必须恰好派生为 `BASIC`，不满足 `STANDARD` 判定；后续数据仅可在单独、经人工批准的升级任务中加入。
- 数据元字段齐全。
- 所有 Basic 数据保持 `aiUsable = false`，不创建知识片段；AI 顾问仅显示数据建设中提示。

### Standard

- `market-overview`、`policy`、`risk`、`opportunities` 至少达到可展示状态。
- 形成可供后续 AI 审核的政策/风险/机会知识内容，但达到 Standard 本身不自动创建或启用可检索知识片段。
- 国家卡片能展示机会、风险、政策友好度等重点信号。
- 首个深覆盖试点必须通过独立的 `DATA-STANDARD-<ISO2>` 任务，试点选择、来源、事实和发布分别受人工审核。
- 真实 AI Beta 还需 `ai-advisor` 至少 20 个合格可检索片段、覆盖至少 3 个来源模块，并由人工批准正式 Prompt 与检索默认值。

### Complete

- 10 个模块均达到可展示标准。
- 项目、伙伴、中资企业、报告、AI 知识片段形成闭环。
- 可支撑完整国家详情、AI 问答、报告下载与销售线索转化。
- 首个 Complete 试点只能在同一国家 Standard 验收后，以新的 `DATA-COMPLETE-<ISO2>` 任务启动。
- Complete 不是生产数据库、NestJS API、Admin 核心、鉴权或留资基础的前置条件。
- 先验收一个 Complete 试点及 AI/会员受控 Beta，再决定如何逐国复制；不得自动批量升级其他 BASIC 国家。

---

## 4. 建设流程

1. 人工确认 Basic 国家优先级、采集顺序和每国启动决定。
2. 按 [basic-country-collection.md](./basic-country-collection.md) 建立国家基础记录、10 个模块状态和可追溯的暂存产物。
3. 录入或导入双语市场基础画像，并补齐元字段。
4. 经人工审核完成 `draft -> pending -> published`；Basic 发布记录保持 `aiUsable = false`。
5. 运行覆盖等级判定与数据质量检查，确认国家为 Basic。
6. 通过代表性 Web 占位与基础画像验收后对外展示。
7. 六国 BASIC 基线完成后按 PLATFORM-DB-1 → PLATFORM-API-1 → PLATFORM-OPS-1 严格串行；当前 DB 已完成，API 任务 1–2 已完成但仍等待 Gate 0 精确依赖批准，OPS 不得提前启动；这条平台链路不等待 Complete。
8. 已选定 `ID` 作为首个深覆盖试点，以独立 `DATA-STANDARD-ID` 任务与平台链路并行推进；来源、事实和发布分别审核，达到 Standard 不自动启用 AI。
9. 平台与试点数据分别达到门槛后，AI 和会员/报告各以受控 Beta 任务启用，并分别经过 AI、权限和计费人工关口。
10. 只有 Standard 试点与相关 Beta 验收后，才另行批准 `DATA-COMPLETE-<ISO2>`；完成一个闭环试点后再逐国拆卡复制。

---

## 5. 人工确认项

以下事项不得由 Codex 自行决定：

- 首批 30–50 国家完整清单。
- 国家建设优先级。
- 国家覆盖等级升级结论。
- Basic 扩展顺序及每个国家的数据工作启动决定。
- ID Standard 的来源、事实与发布决定，ID Complete 的启动和发布决定，以及未来其他深覆盖试点选择。
- AI 正式 Prompt、检索默认值、aiUsable 决定与生产 Beta 启用。
- 会员权益、价格、计费、真实受控资源与会员/报告 Beta 启用。
- 是否新增国家计划字段到数据库。
- 是否将商业评分或推荐等级作为持久化字段。
