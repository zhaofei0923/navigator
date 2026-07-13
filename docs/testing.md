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
- **数据治理校验**：元字段齐全、来源/可信度合法、`draft` / `pending` / `UNVERIFIED` 不进入 C 端展示或覆盖判定。
- **覆盖等级判定**：模块级与国家级判定阈值（[coverage-levels.md §3](./coverage-levels.md)）。
- **i18n 降级**：`pickLocale` 三种缺失分支（[i18n.md §5](./i18n.md)）。
- **RAG 检索边界**：`aiUsable` 过滤硬约束（[data-schema.md §3.1](./data-schema.md)、AGENTS.md §9）。
- **权限门控**：会员等级对受控资源的放行/拒绝（[auth-membership.md](./auth-membership.md)）。

---

## 2. 必须有 E2E 覆盖的关键流程（AGENTS.md §8）

| 流程 | 断言要点 |
|------|----------|
| 首页四板块导航 | 首页 / 国家 / AI 咨询 / 报告可访问，语言切换后导航与核心文案同步变化 |
| 国家列表 / 地图 | 地区、行业、技术、覆盖等级筛选生效；国家卡片显示覆盖等级、更新时间与重点信号 |
| 国家详情页渲染 | 十模块骨架、`BUILDING` 模块显示占位不报错 |
| AI 问答 | 有数据答案含来源/更新时间/风险提示；无数据答「暂无数据」 |
| 报告入口 | 报告列表/申请入口可用；受控下载不暴露真实地址 |
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

## 4.1 派生评分测试

- 数据不足时返回 Data Building / insufficient data，不输出虚假评级。
- 高风险证据优先，不因机会高而掩盖风险提示。
- 评分结果可追溯来源与更新时间。
- 不同国家使用同一套规则，不为单国写特例。
- 双语展示与降级标记符合 [i18n.md](./i18n.md)。

---

## 5. Mock 与测试数据

- 数据库：用独立测试库（`.env.test` 的 `DATABASE_URL`）或事务回滚/内存替身，禁止连生产库。
- LLM / embedding：mock `AI_PROVIDER` 调用，断言**过滤发生在检索层**而非依赖模型。
- 现有 `data/indonesia/` 是 legacy synthetic regression fixture，不是 rollout sample、真实已发布国家数据或可复制 seed 模板；测试使用最小化数据集，避免为单国写特例。
- Deterministic Basic candidate 的 `ID` fixture 只能验证 ISO2/coverage shape；名称、URL、来源内容、值和时间必须明确标为 synthetic fixture-only，不能复制或声称任何真实印度尼西亚事实。

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

### 6.1 Deterministic Basic candidate

candidate writer 测试必须先在 Linux filesystem clean-build native helper，再运行 core/composition/index integration：

```bash
rm -f packages/db/.cache/native/basic-candidate-fs.node
pnpm --filter @navigator/db run build:basic-candidate-native
pnpm --filter @navigator/db exec vitest run src/basic-deterministic-candidate-integration.test.ts src/basic-candidate-composition-integration.test.ts src/index.test.ts
```

composition integration 在 Linux `/tmp` 建立真实临时 workspace，使用 fake transport 填充真实 `raw-v2` cache；第二阶段 transport 必须在任何网络调用时抛错。测试必须使用生产 catalog/review/document/editorial/composition/native writer 模块，验证 object-key permutation 的 byte identity、unsorted array 拒绝、blocked 不写 final staging、ready 只写四文件，以及无 manifest/canonical/Prisma/KnowledgeChunk/AI side effect。每次测试都必须关闭 workspace handles 并删除临时目录。

native helper 需要 `/proc/self/fd` 与 `renameat2(RENAME_NOREPLACE)`。不得在 DrvFS（如 `/mnt/c`）执行 writer 验证；不支持该 syscall/flag 时必须 fail closed，禁止 JavaScript rename/copy fallback。本卡没有 Web 行为，定向验收不要求 E2E；完整 branch gate 仍为 `pnpm lint`、`pnpm typecheck`、`pnpm test` 和 `pnpm turbo run lint typecheck test --force`。

---

## 7. 一致性检查清单

- [ ] 新功能/接口附带测试
- [ ] 数据校验、覆盖等级、i18n 降级、RAG 边界、权限门控均有单测
- [ ] 关键流程有 E2E
- [ ] 双语：key 对齐 / 降级 / 切换 / AI 语言一致性均覆盖
- [ ] AI 红线：过滤、来源三要素、空数据、注入防护均覆盖
- [ ] 不连真实生产库/真实 LLM，使用测试库与 mock
- [ ] 本地 `pnpm lint && pnpm typecheck && pnpm test` 通过

---

## 8. Deferred 流程

| 流程 | 恢复条件 | 恢复后测试要求 |
|------|----------|----------------|
| 国家对比 | `roadmap.md` 重新激活任务卡，`api-contract.md` 取消 Deferred 标记 | 2–4 国对比矩阵、缺失模块占位、`codes` 边界校验、E2E |
