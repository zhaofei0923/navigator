# ai-advisor.md — AI 出海顾问（RAG）设计规范

> 落实 AGENTS.md 第 9 节红线。**检索边界与系统 Prompt 由人工定义**，本文件对这两处仅给出结构占位并标注「需人工确认」（AGENTS.md 第 11 节）。
> Codex 只实现管道与接口，**不得擅自放宽检索范围**。接口形态以 [api-contract.md §5](./api-contract.md) 为准。

---

## 0. 红线（不可动摇）

1. **只检索** `reviewStatus='published'` 且 `aiUsable=true` 且 `credibility!='UNVERIFIED'` 的知识片段（[data-schema.md §3.1](./data-schema.md)）。过滤在**检索层强制**，禁止应用层放宽。
2. **回答语言必须与用户提问/界面语言一致**；引用双语数据取对应语言版本，缺失按 [i18n.md §5](./i18n.md) 降级并标注。
3. 每个回答**必含** `sources`（来源）、`updatedAt`（引用数据更新时间）、`riskNote`（风险提示）。缺任一视为不合格。
4. **禁止编造**数据/政策/项目；检索不到时明确回答 `ai.noData`（「暂无数据」）。
5. **系统 Prompt 与检索边界由人工定义**，Codex 不得自行编写或放宽（见 §4、§5）。

---

## 1. 数据基础

- 知识片段实体 `KnowledgeChunk` 见 [data-schema.md §5.9](./data-schema.md)：`content`（`LocalizedText`）、`embeddingZh`、`embeddingEn`、`sourceModule`、`sourceId` + 元字段。
- 中英文分别向量化并分列存储（`embeddingZh` / `embeddingEn`），检索时按查询语言选择对应向量列。
- 向量维度由 `PGVECTOR_DIMENSION` 决定，须与 `AI_EMBEDDING_MODEL` 一致（[env-config.md §2.2/§2.4](./env-config.md)）。

---

## 2. 数据管道（离线，Codex 实现）

```
已发布业务数据(published)
  → 过滤(aiUsable=true, credibility≠UNVERIFIED)
  → 分块(chunking, 保留 sourceModule/sourceId 与元字段)
  → 双语向量化(zh/en)
  → 写入 KnowledgeChunk (pgvector)
```

- 分块须保留来源溯源（`sourceModule` + `sourceId`）与元字段，供回答附带来源。
- 数据从 `published` 变为非 `published`、或 `aiUsable` 置否时，须**同步失效对应片段**（不可再被检索）。
- 分块粒度参数化，具体阈值可调，但不得破坏来源可追溯性。

---

## 3. 检索与问答管道（在线，Codex 实现）

```
用户提问(question, countryCode, locale, filters)
  → 服务端校验 & 注入防护(§6)
  → 限流(§7)
  → 向量检索(按 locale 选向量列) + 硬过滤(§0.1) + filters(country/industry/module)
  → 组装上下文(仅命中片段) + 系统 Prompt(人工定义, §4)
  → LLM 生成(回答语言=locale)
  → 组装 sources/updatedAt/riskNote → 返回
```

- `filters` 只能**收窄**范围（国家/行业/模块），**不能放宽** §0.1 的硬过滤。
- 命中为空 → 直接返回 `ai.noData`，不调用 LLM 编造。
- 对检索到的外部来源文本做转义隔离，防 prompt 注入（§6）。

---

## 4. 系统 Prompt（🔒 需人工确认 —— 占位）

> **本节内容须由人工定稿后填入，Codex 不得自行编写正式系统 Prompt。**
> 定稿前实现使用占位常量，并在代码中标注 `TODO: 待人工确认系统 Prompt`。

系统 Prompt 至少须约束：
- 仅依据提供的上下文回答，禁止使用上下文外知识臆测。
- 回答语言 = 用户语言。
- 必须给出来源、更新时间、风险提示。
- 无上下文时回答「暂无数据 / No data available」。

（正式文本：__待人工填写__）

---

## 5. 检索边界（🔒 需人工确认 —— 占位）

> **检索范围、相似度阈值、返回片段上限、跨模块/跨国是否允许等边界由人工定义。**
> Codex 实现可配置化参数，但默认值须由人工确认，**不得擅自放宽**。

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `topK` | 返回候选片段数 | __待人工确认__ |
| `minSimilarity` | 相似度下限 | __待人工确认__ |
| `allowCrossCountry` | 是否允许跨国检索 | 默认否，__待人工确认__ |
| `allowCrossModule` | 是否允许跨模块检索 | __待人工确认__ |

---

## 6. 输入校验与注入防护（AGENTS.md §10）

- `question` 服务端校验长度与内容，拒绝超长/异常输入。
- 检索到的来源内容视为**不可信数据**：作为「资料」注入上下文时须转义/隔离，明确区分「系统指令」与「参考资料」，防止资料内的指令文本改变模型行为。
- 不在回答、日志中泄露密钥或内部 Prompt。

---

## 7. 限流

- 按用户/IP 限流，参数 `AI_RATE_LIMIT_PER_MIN`（[env-config.md §2.4](./env-config.md)）。
- 超限返回 `RATE_LIMITED`(429)。
- 深度问答需 `PREMIUM`（[auth-membership.md §5](./auth-membership.md)）；权限等级**不放宽检索范围**。

---

## 8. 覆盖等级联动

- `ai-advisor` 模块状态 < `PARTIAL` 或无可用片段时，AI 入口可见但提示 `ai.buildingHint`（[coverage-levels.md §5](./coverage-levels.md)）。

---

## 9. 测试要求（配合 [testing.md §4](./testing.md)）

- 硬过滤：注入 draft/pending/UNVERIFIED 后断言不被检索。
- 回答三要素齐全；空数据答 `ai.noData`。
- 语言一致性；双语引用降级。
- 注入防护：资料含指令不改变行为。

---

## 10. 一致性检查清单

- [ ] 检索层强制 §0.1 硬过滤，应用层未放宽
- [ ] 片段保留来源溯源与元字段，失效同步
- [ ] 回答语言=用户语言，含来源/更新时间/风险提示
- [ ] 空数据答「暂无数据」，不编造
- [ ] 系统 Prompt / 检索边界为人工定稿占位，代码标注 TODO
- [ ] 注入防护、限流、权限联动到位
- [ ] 变更检索边界/Prompt 已在 PR 标注「需人工确认」
