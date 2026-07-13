# indonesia-seed.md — 印尼 fixture 与未来 Basic 交付规范

> `data/indonesia/` 是 inherited legacy synthetic regression fixture，只用于回归测试。它不是已完成的真实 Basic 数据、当前 rollout 样板或可复制 seed 模板。

所有国家（包括 `ID`）的首次真实数据交付必须恰好为 `BASIC`。真实 `ID` 交付须作为未来独立的 `DATA-BASIC-ID` 任务完成，并在 Basic 验收后才可通过单独、经人工批准的升级任务进入 `STANDARD` 或 `COMPLETE`。

---

## 1. 现有 fixture 的边界

- 不修改 `data/indonesia/`；它保留为 legacy synthetic regression fixture。
- 不得将该 fixture 视为真实、已审核或已发布的印度尼西亚业务数据。
- 不得复制 fixture 到其他国家，也不得以其内容作为采集、发布或 AI 数据的来源。
- 不得为 `ID` 或其他国家增加特例字段、文件或页面；固定 10 模块结构以 [data-schema.md](./data-schema.md) 为唯一事实来源。

---

## 2. 未来 `DATA-BASIC-ID` 的真实交付

未来真实 `ID` 数据必须遵循 [basic-country-collection.md](./basic-country-collection.md) 的采集、审核和发布流程，并与所有国家使用相同的国家中立模板。

Basic 验收形态必须恰好为：

- `country.json` 使用 `ID`（ISO 3166-1 alpha-2）并包含固定 10 个 `moduleCoverage` 行。
- `market-overview` 是唯一可展示的对象记录，状态为 `PARTIAL` 或 `COMPLETE`，并带齐双语展示字段与全部元字段。
- 其余九个模块均为 `BUILDING`、`dataCount = 0`，没有 `published` 记录，C 端显示统一占位。
- 国家 `coverageLevel` 由既有规则派生为恰好 `BASIC`，且不得满足 `STANDARD`。
- 所有 Basic 数据保持 `aiUsable = false`，不产生知识片段，也不进入 AI 检索。
- 数据先经历 `draft -> pending -> published`，只有独立人工审核批准后才能发布。

---

## 3. 数据与审核要求

每个未来真实 `ID` 记录均须遵守统一数据模型和治理规则：

1. 所有面向用户展示的文本使用 `{ zh, en }`；按既有降级规则处理缺失翻译。
2. 每条业务数据带有 `source`、`sourceUrl`、`collectedAt`、`updatedAt`、`credibility`、`reviewStatus`、`aiUsable`、`countryCode`、`industryTags` 和 `techTags`。
3. 来源、可信度、审核状态和标签遵循 [data-governance.md](./data-governance.md) 与 [data-schema.md](./data-schema.md)；未审核或 `UNVERIFIED` 内容不得进入 C 端覆盖计数或 AI。
4. `sourceUrl = null` 时，`source` 必须说明原因；不允许伪造来源或缺失元字段。

---

## 4. 验收与回归

- `DATA-BASIC-ID` 的真实交付使用与 `DATA-BASIC-<ISO2>` 相同的验证器、审核闸门和 Web 验收，不设国家特例。
- 对现有 `data/indonesia/` 的测试只能断言其 synthetic regression 行为，不能把它重新定义为真实 rollout 进度。
- 真实 `ID` Basic 验收完成后，任何 Standard 或 Complete 增量仍需独立、经人工批准的升级任务。
