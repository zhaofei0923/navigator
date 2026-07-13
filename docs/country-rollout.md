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
| Complete | 后续单独升级 | Basic 验收后才可经人工批准启动 |

所有国家使用同一套 10 模块结构，差异只体现在数据深度，不体现在页面结构。

每个选定国家必须先完成其 `DATA-BASIC-<ISO2>` 任务卡并达到 Basic；只有在此后，才可由人工批准单独的 Standard 或 Complete 升级任务。禁止任何国家直接以 Standard 或 Complete 进入产品。

---

## 2. 首批国家候选

| 阶段 | 国家码 | 国家 | 目标覆盖 | 角色 | 状态 |
|------|--------|------|----------|------|------|
| 首次真实验证 | ID | 印度尼西亚 | Basic | 验证 Basic 十模块骨架与人工发布闸门 | 待人工批准启动 |
| 扩展 | VN | 越南 | Basic -> Standard | 先以基础画像进入，再由人工决定是否升级为东南亚重点制造与新能源市场的 Standard 覆盖 | 待人工确认 |
| 扩展 | SA | 沙特阿拉伯 | Basic -> Standard | 先以基础画像进入，再由人工决定是否升级为中东能源转型重点市场的 Standard 覆盖 | 待人工确认 |
| 扩展 | AE | 阿联酋 | Basic -> Standard | 先以基础画像进入，再由人工决定是否升级为中东枢纽与项目合作市场的 Standard 覆盖 | 待人工确认 |
| 扩展 | BR | 巴西 | Basic -> Standard | 先以基础画像进入，再由人工决定是否升级为拉美重点新能源市场的 Standard 覆盖 | 待人工确认 |
| 基础池 | KE | 肯尼亚 | Basic | 非洲示范市场 | 待人工确认 |
| 基础池 | ZA | 南非 | Basic | 非洲重点能源市场 | 待人工确认 |
| 基础池 | MX | 墨西哥 | Basic | 北美近岸与新能源市场 | 待人工确认 |
| 基础池 | AU | 澳大利亚 | Basic | 成熟能源市场与储能机会 | 待人工确认 |

`ID` 是首个真实 Basic 验证国家；`VN`、`SA`、`AE`、`BR` 与其他候选国家同样必须先按 Basic 交付，再在独立、经人工批准的升级任务中决定是否推进 Standard 或 Complete。首批 30–50 个 Basic 国家清单、最终国家顺序和覆盖升级结论均属于业务优先级决策，必须由人工确认后再进入 seed 或后台录入。

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
- 能支持基础 AI 咨询的政策/风险/机会知识片段。
- 国家卡片能展示机会、风险、政策友好度等重点信号。

### Complete

- 10 个模块均达到可展示标准。
- 项目、伙伴、中资企业、报告、AI 知识片段形成闭环。
- 可支撑完整国家详情、AI 问答、报告下载与销售线索转化。

---

## 4. 建设流程

1. 人工确认国家优先级、建议试点顺序和 Basic 启动决定。
2. 按 [basic-country-collection.md](./basic-country-collection.md) 建立国家基础记录、10 个模块状态和可追溯的暂存产物。
3. 录入或导入双语市场基础画像，并补齐元字段。
4. 经人工审核完成 `draft -> pending -> published`；Basic 发布记录保持 `aiUsable = false`。
5. 运行覆盖等级判定与数据质量检查，确认国家为 Basic。
6. 通过代表性 Web 占位与基础画像验收后对外展示。
7. 后续 Standard 或 Complete 升级以单独任务卡提交；仅已完成 `DATA-BASIC-<ISO2>` 并达到 Basic 的国家可升级，由人工决定是否启用合格的 published 数据用于 AI。

---

## 5. 人工确认项

以下事项不得由 Codex 自行决定：

- 首批 30–50 国家完整清单。
- 国家建设优先级。
- 国家覆盖等级升级结论。
- Basic 试点顺序及每个国家的数据工作启动决定。
- 是否新增国家计划字段到数据库。
- 是否将商业评分或推荐等级作为持久化字段。
