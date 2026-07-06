# testing.md — 测试规范

> 落实 AGENTS.md 第 8 节：**每个功能/接口必须附带测试，无测试的 PR 不予合并。**
> 提交前必须本地通过：`pnpm lint`、`pnpm typecheck`、`pnpm test`。

---

## 0. 总则

1. 工具链：**Vitest**（单元/集成）+ **Playwright**（E2E），沿用 AGENTS.md 技术栈，不得替换。
2. 无测试的 PR 不合并；修 bug 须先写复现测试再修。
3. 测试与被测代码同层就近放置或置于 `__tests__/`，命名 `*.test.ts` / `*.spec.ts`（E2E 用 `*.e2e.ts`）。
4. 测试必须可独立运行、可重复、无外部真实依赖（用测试库/mock，见 §5）。

---

## 1. 必须有单元测试的对象（AGENTS.md §8）

- **数据模型 / 校验逻辑**：字段校验、枚举约束、`LocalizedText` 结构校验。
- **覆盖等级判定**：模块级与国家级判定阈值（[coverage-levels.md §3](./coverage-levels.md)）。
- **i18n 降级**：`pickLocale` 三种缺失分支（[i18n.md §5](./i18n.md)）。
- **RAG 检索边界**：`aiUsable` 过滤硬约束（[data-schema.md §3.1](./data-schema.md)、AGENTS.md §9）。
- **权限门控**：会员等级对受控资源的放行/拒绝（[auth-membership.md](./auth-membership.md)）。

---

## 2. 必须有 E2E 覆盖的关键流程（AGENTS.md §8）

| 流程 | 断言要点 |
|------|----------|
| 国家详情页渲染 | 十模块骨架、`BUILDING` 模块显示占位不报错 |
| 国家对比 | 2–4 国对比矩阵、缺失模块占位 |
| AI 问答 | 有数据答案含来源/更新时间/风险提示；无数据答「暂无数据」 |
| 留资 | 提交成功、敏感字段不回显 |
| 语言切换 | UI 文案与业务数据同步切换 |

---

## 3. 双语测试（AGENTS.md §7、§8）—— 硬性

- **语言包 key 对齐**：断言各端 `zh-CN.json` 与 `en.json` 的 key 集完全一致（缺一即失败）。
- **双语字段降级回退**：`LocalizedText` 缺 zh / 缺 en / 全缺时的回退与 `fallback` 标记；接口 `_i18nFallback` 正确记录。
- **语言切换同步**：切换后 UI 文案与业务数据文本同时变化。
- **AI 语言一致性**：中文问中文答、英文问英文答；引用双语数据取对应语言，缺失降级。

---

## 4. AI 顾问专项测试（AGENTS.md §9 红线）

- 检索**仅命中** `reviewStatus=published` 且 `aiUsable=true` 且 `credibility!=UNVERIFIED` 的数据；注入 `draft`/`pending`/`UNVERIFIED` 数据后断言**不被检索**。
- 回答**必含** `sources` / `updatedAt` / `riskNote`，缺任一视为失败。
- 检索为空时断言回答为 `ai.noData`（「暂无数据」），**不得编造**。
- prompt 注入用例：来源内容含指令文本时，断言被转义隔离、不改变系统行为。

---

## 5. Mock 与测试数据

- 数据库：用独立测试库（`.env.test` 的 `DATABASE_URL`）或事务回滚/内存替身，禁止连生产库。
- LLM / embedding：mock `AI_PROVIDER` 调用，断言**过滤发生在检索层**而非依赖模型。
- 测试 fixture 参考印尼样板（[indonesia-seed.md](./indonesia-seed.md)），但用最小化数据集，避免为单国写特例。

---

## 6. 命令与 CI 门槛

| 命令 | 作用 |
|------|------|
| `pnpm lint` | 代码规范（含无硬编码文案检查，若配置） |
| `pnpm typecheck` | TS strict 类型检查，禁止 `any` |
| `pnpm test` | Vitest 单元/集成 |
| `pnpm test:e2e` | Playwright E2E |

- 三项（lint / typecheck / test）**本地必须通过**方可提交；E2E 至少在 CI 关键流程通过。
- 覆盖率不设唯一硬指标，但 §1–§4 列出的对象/流程**必须有对应用例**，缺失视为不达标。

---

## 7. 一致性检查清单

- [ ] 新功能/接口附带测试
- [ ] 数据校验、覆盖等级、i18n 降级、RAG 边界、权限门控均有单测
- [ ] 关键流程有 E2E
- [ ] 双语：key 对齐 / 降级 / 切换 / AI 语言一致性均覆盖
- [ ] AI 红线：过滤、来源三要素、空数据、注入防护均覆盖
- [ ] 不连真实生产库/真实 LLM，使用测试库与 mock
- [ ] 本地 `pnpm lint && pnpm typecheck && pnpm test` 通过
