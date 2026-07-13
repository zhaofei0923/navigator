# coverage-levels.md — 覆盖等级定义

> 本文件定义国家的**覆盖等级（CoverageLevel）**与**模块覆盖状态（ModuleCoverageStatus）**，
> 用于驱动前端动态渲染。字段定义以 [data-schema.md](./data-schema.md) 为准，本文件不重复定义字段，只定义「等级判定规则与展示行为」。

---

## 0. 为什么需要覆盖等级

统一数据模型下，所有国家共用同一套 10 个模块与页面结构，差异只体现在「数据深度」。
覆盖等级是对「数据深度」的标准化分级，使得：

- 产品可以通过国家中立模板零成本复制到 30-50 国，未建设的模块**显示占位而非报错**；
- 用户对每个国家的数据完备度有明确预期；
- 运营侧有清晰的建设目标（从 BASIC → STANDARD → COMPLETE）。

---

## 1. 覆盖等级枚举（固定三级）

| 等级 | 含义 | 定位 |
|------|------|------|
| `BASIC` | 基础覆盖 | 有基本市场画像，供快速筛选 |
| `STANDARD` | 标准覆盖 | 有政策/风险/机会等决策要素 |
| `COMPLETE` | 完整覆盖 | 十模块齐备，支持深度决策与 AI 问答 |

> 枚举固定为三级，禁止新增其他值（AGENTS.md 第 5 节）。

---

## 2. 模块覆盖状态（单模块粒度）

每个国家的每个模块单独标记状态（`ModuleCoverage.status`）：

| 状态 | 含义 | 前端展示 |
|------|------|----------|
| `BUILDING` | 建设中，暂无有效数据 | 显示占位卡片 "Data Building / 数据建设中" |
| `PARTIAL` | 部分覆盖，有少量 C 端可展示数据 | 正常渲染 + 「持续更新中」标记 |
| `COMPLETE` | 完整覆盖 | 正常渲染 |

**判定基准**：某模块状态由「C 端可展示数据条数」决定。C 端可展示数据必须满足 `reviewStatus = published` 且 `credibility != UNVERIFIED`；`draft` / `pending` / `UNVERIFIED` 不计入覆盖判定，具体阈值见 §3。

---

## 3. 等级判定规则

### 3.1 模块级判定（每个模块的 `status`）
以模块内**C 端可展示数据条数**为准（`market-overview`、`entry-strategy` 为单条对象型，以字段填充率计）：

| 模块类型 | BUILDING | PARTIAL | COMPLETE |
|----------|----------|---------|----------|
| 列表型模块（policy / risk / opportunities / projects / partners / chinese-companies / reports） | 0 条 | 1–4 条 | ≥ 5 条 |
| 对象型模块（market-overview / entry-strategy） | 核心字段全空 | 核心字段填充 < 80% | 核心字段填充 ≥ 80% |
| ai-advisor | 无可用知识片段 | 有片段但 < 20 | ≥ 20 且覆盖 ≥ 3 个来源模块 |

> 阈值为初始约定，可由运营在本文件调整并同步到判定逻辑；判定逻辑必须有单元测试覆盖（AGENTS.md 第 8 节）。

### 3.2 国家级判定（`Country.coverageLevel`）
以各模块状态聚合得出。设「达标模块」= 状态为 `PARTIAL` 或 `COMPLETE` 的模块数。

| 国家等级 | 判定条件 |
|----------|----------|
| `BASIC` | `market-overview` 达标，其余模块可全部为 `BUILDING` |
| `STANDARD` | `market-overview` 达标，且 `policy`、`risk`、`opportunities` 三个模块均至少 `PARTIAL` |
| `COMPLETE` | 全部 10 个模块均为 `COMPLETE`（`ai-advisor` 亦须 `COMPLETE`） |

> 国家等级为「向下取整」：任一更高等级条件不满足，则归入其能满足的最高等级。

---

## 4. 前端渲染契约

前端**必须**遵循以下规则，不得因数据缺失而报错或白屏：

1. **占位优先**：模块 `status = BUILDING` 时渲染统一占位组件（文案走 i18n key，如 `coverage.dataBuilding`），不请求或渲染空数据。
2. **部分覆盖提示**：`status = PARTIAL` 时正常渲染并显示「持续更新中 / Continuously updating」标记（i18n key）。
3. **等级徽章**：国家详情页头部展示 `coverageLevel` 徽章（BASIC / STANDARD / COMPLETE），文案与颜色由前端主题统一定义。
4. **模块导航禁用态**：`BUILDING` 模块在导航中可见但标注建设中，点击后进入占位页，不返回错误。
5. **双语同步**：占位文案、等级徽章、更新标记全部走 i18n，中英文案 key 对齐（AGENTS.md 第 7 节）。

---

## 5. AI 顾问与覆盖等级

- AI 出海顾问仅在 `ai-advisor` 模块达到 `PARTIAL` 及以上、且存在满足 [data-schema.md §3.1](./data-schema.md) 约束的知识片段时才可用。
- 对 `BASIC` 国家，AI 顾问入口可见但应明确提示「该国数据建设中，暂无法提供深度问答 / Data is being built」。
- AI 检索不到有效数据时必须回答「暂无数据 / No data available」，禁止臆测（AGENTS.md 第 9 节）。

---

## 6. 运营建设路径（参考）

所有国家（包括 `ID`）的首次真实数据交付必须恰好为 `BASIC`。`STANDARD` 与 `COMPLETE` 保留为通用等级，只能在该国 Basic 验收后，通过单独、经人工批准的升级任务启动。

| 阶段 | 目标等级 | 建设重点 |
|------|----------|----------|
| 入库 | BASIC | 填充 `market-overview` 核心字段与国家元信息 |
| 决策要素 | STANDARD | 补齐 policy / risk / opportunities |
| 深度覆盖 | COMPLETE | 补齐 projects / partners / chinese-companies / entry-strategy / reports，并沉淀 ai-advisor 知识片段 |

---

## 7. 一致性检查清单

- [ ] 覆盖等级仅使用 `BASIC` / `STANDARD` / `COMPLETE`
- [ ] 模块状态仅使用 `BUILDING` / `PARTIAL` / `COMPLETE`
- [ ] `draft` / `pending` / `UNVERIFIED` 不计入覆盖判定
- [ ] 等级判定逻辑与本文件阈值一致且有单元测试
- [ ] 前端对 `BUILDING` 模块显示占位，不报错/白屏
- [ ] 占位/徽章/更新标记文案走 i18n，中英对齐
- [ ] AI 顾问可用性与本文件 §5 一致
