# scoring-framework.md — 国家重点信号与评分框架

> 本文件定义国家列表、首页和报告入口可展示的重点信号。
> 当前策略为“派生优先”：先从已发布数据计算展示值，不新增数据库字段。若后续需要持久化评分，必须先更新 `data-schema.md` 与 Prisma schema，并按 AGENTS.md §11 人工确认。

---

## 1. 评分目标

评分不是替代研究判断，而是帮助用户快速识别：

- 哪些国家机会更高。
- 哪些国家风险更高。
- 哪些国家政策环境更友好。
- 哪些国家更适合优先进入。
- 适合采用何种进入模式。

评分必须可追溯到具体数据来源和更新时间，不得凭空生成。

---

## 2. MVP 展示信号

| 信号 | 用途 | 建议展示 | 数据来源 |
|------|------|----------|----------|
| `opportunityLevel` | 机会强度 | High / Medium / Low | `market-overview`、`opportunities`、`projects` |
| `riskLevel` | 风险强度 | High / Medium / Low | `risk`、`policy` |
| `policyFriendliness` | 政策友好度 | High / Medium / Low | `policy`、`market-overview` |
| `recommendedPriority` | 推荐优先级 | Priority / Watch / Explore | 机会、风险、覆盖等级综合 |
| `recommendedEntryMode` | 进入方式提示 | 文本摘要 | `entry-strategy` |

这些信号用于国家卡片、首页重点国家与报告摘要。详情页仍以 10 模块原始数据为主。

---

## 3. 计算原则

1. 只使用 `reviewStatus = published` 的数据。
2. AI 相关信号只使用 `aiUsable = true` 且 `credibility != UNVERIFIED` 的数据。
3. 缺少足够数据时显示“数据建设中”，不输出看似确定的评级。
4. 评分必须保留 `source`、`sourceUrl`、`updatedAt` 或可追溯的来源集合。
5. 不同国家使用同一套规则，不为印尼或任何单个国家写特例。

---

## 4. 派生规则建议

MVP 可采用保守规则：

- `opportunityLevel`：项目机会、市场需求、政策支持共同指向正向时为 High；仅有部分证据为 Medium；有充分负向证据时才可为 Low；证据不足只能返回 Data Building / insufficient data。
- `riskLevel`：政策不确定、准入限制、汇率/安全/履约风险任一高风险项明确时为 High；多项中等风险为 Medium；缺少风险数据时不得默认 Low。
- `policyFriendliness`：补贴、税收、并网、采购、本地化规则等政策对目标企业有明确支持时为 High；政策混合或不稳定为 Medium；限制明显为 Low。
- `recommendedPriority`：机会高且风险可控且覆盖等级不低于 Standard 时为 Priority；机会存在但关键数据不足为 Watch；数据不足或风险过高为 Explore。
- `recommendedEntryMode`：优先取 `entry-strategy` 模块中的双语摘要；缺失时不自动生成。

---

## 5. 接口与前端约定

在未落库前，评分可作为服务端 view model 或前端派生值返回，但不得写入新的持久化字段。

国家卡片可展示：

```json
{
  "signals": {
    "opportunityLevel": "High",
    "riskLevel": "Medium",
    "policyFriendliness": "High",
    "recommendedPriority": "Priority",
    "updatedAt": "2026-07-01T00:00:00Z",
    "sources": ["..."]
  }
}
```

当前 `api-contract.md` 已将 `signals` 标为可选派生字段；若后续要扩大为必需字段或落库，应先走接口/数据模型人工确认。

---

## 6. 测试要求

- 覆盖数据不足时返回 Data Building / insufficient data，不输出虚假评级。
- 覆盖高风险证据优先级，避免机会高时掩盖风险。
- 覆盖双语展示与降级标记。
- 覆盖不同国家使用同一规则。
- 覆盖来源与更新时间可追溯。
