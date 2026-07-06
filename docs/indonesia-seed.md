# indonesia-seed.md — 印尼样板数据规范

> 印尼（`ID`）为首个 **COMPLETE Coverage** 样板国家，其数据结构与深度是复制到其他 30–50 国的**基线参照**。
> 落实 AGENTS.md：**模板化、可复制**，禁止硬编码国家名/数据。字段以 [data-schema.md](./data-schema.md) 为唯一事实来源。

---

## 0. 定位

- 印尼数据放 `data/indonesia/`，作为 seed 导入 `packages/db`。
- 其价值是**验证统一模型的完整性**并提供复制模板：换一个国家只需替换数据文件，结构零改动。
- **禁止**为印尼新增特例字段或特例页面（AGENTS.md §5）。

---

## 1. 目录与文件组织

```
data/indonesia/
├── country.json                # Country 骨架 + moduleCoverage
├── market-overview.json        # 对象型
├── policy.json                 # 列表型
├── risk.json                   # 列表型
├── opportunities.json          # 列表型
├── projects.json               # 列表型
├── partners.json               # 列表型
├── chinese-companies.json      # 列表型
├── entry-strategy.json         # 对象型
├── reports.json                # 列表型（文件另存对象存储，此处存元信息）
└── knowledge/                  # ai-advisor 知识片段源（分块前的原文，标注来源模块）
```

- 每个文件对应 [data-schema.md §5](./data-schema.md) 的一个模块，字段严格对齐。
- 文件名用 `ModuleKey`（kebab-case），与 [data-schema.md §1.3](./data-schema.md) 一致。

---

## 2. 数据填充标准（达到 COMPLETE）

按 [coverage-levels.md §3](./coverage-levels.md) 的 COMPLETE 阈值填充：

| 模块 | 印尼样板最低量 |
|------|----------------|
| market-overview | 核心字段填充 ≥ 80%，含 `keyIndicators` |
| entry-strategy | 核心字段填充 ≥ 80%，含 `steps` |
| policy / risk / opportunities / projects / partners / chinese-companies / reports | 各 ≥ 5 条 |
| ai-advisor（knowledge） | ≥ 20 片段且覆盖 ≥ 3 个来源模块 |

- 所有模块 `moduleCoverage.status` = `COMPLETE`，`Country.coverageLevel` = `COMPLETE`。

---

## 3. 字段规范（每条数据必须满足）

1. **双语**：所有展示文本字段用 `{ zh, en }`，两语言均填充（样板不留待译）。非展示字段单一值。
2. **元字段齐全**（[data-schema.md §3](./data-schema.md)）：`source`、`sourceUrl`、`collectedAt`、`updatedAt`、`credibility`、`reviewStatus`、`aiUsable`、`countryCode`、`industryTags`、`techTags`。
3. **国家码**：`countryCode` 一律 `ID`（ISO 3166-1 alpha-2），禁止用「印尼/Indonesia」做标识。
4. **AI 可用性**：样板中用于 AI 的数据须 `reviewStatus='published'` 且 `aiUsable=true` 且 `credibility∈{OFFICIAL,VERIFIED,ESTIMATED}`；示范一条 `UNVERIFIED` 或 `draft` 数据用于验证「不被 AI 检索」。
5. **枚举合法**：`credibility` / `industryTags` / `techTags` / `policyType` 等取值必须来自 data-schema 登记枚举。

---

## 4. 示例片段（policy.json 单条）

```json
{
  "id": "id_pol_001",
  "title": { "zh": "可再生能源上网电价（FiT）政策", "en": "Renewable Energy Feed-in Tariff Policy" },
  "summary": { "zh": "…", "en": "…" },
  "body": { "zh": "…(Markdown)…", "en": "…(Markdown)…" },
  "policyType": "incentive",
  "effectiveDate": "2024-03-01",
  "authority": { "zh": "能源与矿产资源部", "en": "Ministry of Energy and Mineral Resources" },
  "source": "MEMR 官网",
  "sourceUrl": "https://...",
  "collectedAt": "2025-10-01T00:00:00Z",
  "updatedAt": "2025-11-02T00:00:00Z",
  "credibility": "OFFICIAL",
  "reviewStatus": "published",
  "aiUsable": true,
  "countryCode": "ID",
  "industryTags": ["solar", "wind"],
  "techTags": ["pv-module"]
}
```

---

## 5. 复制到新国家的流程（模板化验证）

1. 复制 `data/indonesia/` 为 `data/<new-country>/`。
2. 替换 `country.json` 的 `code`（新 ISO 码）、`name`、`region` 等。
3. 逐模块替换数据内容（结构不动），未建设模块留空并将 `moduleCoverage.status` 设为 `BUILDING`。
4. 依据实际填充量，`Country.coverageLevel` 按 [coverage-levels.md §3.2](./coverage-levels.md) 自动/标注得出。
5. **不得**修改任何模块的字段结构或页面组件。

> 若复制过程中发现需要改结构，说明统一模型不完备——应回到 [data-schema.md](./data-schema.md) 修改（属「需人工确认」），而非为单国打补丁。

---

## 6. Seed 校验（配合 [testing.md](./testing.md)）

- 导入前用 schema 校验每条数据：元字段齐全、双语字段完整、枚举合法、`countryCode` 合规。
- 断言印尼达到 COMPLETE（各模块量满足 §2）。
- 断言标记为 `UNVERIFIED`/`draft` 的示范数据**不被 AI 检索**。

---

## 7. 一致性检查清单

- [ ] 目录/文件名与 ModuleKey 对齐
- [ ] 每条数据双语齐全、元字段齐全、枚举合法
- [ ] `countryCode='ID'`，无中文名/自定义缩写做标识
- [ ] 达到 COMPLETE 阈值，含反例数据验证 AI 过滤
- [ ] 无印尼特例字段/特例页面
- [ ] 复制流程仅替换数据、不改结构
