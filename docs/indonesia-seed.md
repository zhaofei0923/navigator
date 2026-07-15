# indonesia-seed.md — 印度尼西亚真实 Basic 发布记录

> `data/indonesia/` 是 `DATA-BASIC-ID-PUBLISH` 交付的已批准真实 `BASIC` canonical publication，不是国家特例或可跳过统一发布闸门的样板。

所有国家（包括 `ID`）的首次真实数据交付必须恰好为 `BASIC`。印度尼西亚已完成该首次交付；`STANDARD` 与 `COMPLETE` 仍只能在 Basic 验收后，通过单独、经人工批准的升级任务启动。

---

## 1. 发布身份

| 项目 | 精确值 |
|------|--------|
| `countryDirectory` | `indonesia` |
| `countryCode` | `ID` |
| `runId` | `data-basic-id-20260711-r2` |
| reviewer | `github:zhaofei0923` |
| submitted / decided | `2026-07-15T00:01:43.000Z` |

immutable candidate 必须始终只有以下四个文件，其 SHA-256 绑定为：

| Candidate artifact | SHA-256 |
|--------------------|---------|
| `source-register.json` | `842f5675cc2ce3f5e18bb05b4b1dc016ec5e838e059cdfaf5b9025bc785f2799` |
| `extracted-facts.json` | `953d200e586582cc21a74cc1837e5fa72ed83b2f532d4a264a205d6e7ae4b038` |
| `market-overview.draft.json` | `dd6172f7a8047b8f2701b9eb57b56681f6b7543da18dfed84055d1c3cf17adb7` |
| `review-report.json` | `a644f07748f39870e57beb0915091d002acee2aab4d41401968f59e40f157409` |

独立批准回执位于 `data/approvals/indonesia/data-basic-id-20260711-r2.json`，精确 bytes 的 SHA-256 为：

```text
aad39cb02b3d24aec4b57d2275062062b0a9a3b5531eb1289461ef41fbe73bb1
```

canonical 三文件的精确 SHA-256 为：

| Canonical artifact | SHA-256 |
|--------------------|---------|
| `country.json` | `bac4b7a7845d643ae5306f1dc159b0f3df50620d0998d073103c616386809c63` |
| `market-overview.json` | `ae3343c2d015d283169ef86f8c41e4880a56604d78502006b77add9782938ba0` |
| `collection-manifest.json` | `a30d8cf66d1ff1a45cb85eb4878f48c9ebaa993aaead01c547d7eb64a6135e41` |

任何事实、翻译、元字段或 artifact correction 都必须创建新 run、新 candidate 和新批准回执，不得改写上述 identity。

## 2. Canonical 与覆盖边界

`data/indonesia/` 必须且只能包含：

```text
country.json
market-overview.json
collection-manifest.json
```

- 国家 `coverageLevel = BASIC`，固定保留 10 个 `moduleCoverage` 行。
- `market-overview` 是唯一可展示的对象记录，状态为 `COMPLETE`、`dataCount = 1`、`reviewStatus = published`。
- 其余九个模块均为 `BUILDING`、`dataCount = 0`，没有任何 `published` 记录，Web 与 API 返回统一占位。
- Basic 数据固定 `aiUsable = false`，不产生知识片段，不创建 `KnowledgeChunk`，不进入 AI 检索。
- manifest 与批准回执是 non-product sidecars，不进入 DB import、API、coverage counts 或 AI retrieval。

## 3. DB 与 Web 验收

- DB 入口先调用通用只读 publication loader，再生成 country、10 条 module coverage 和 market overview 的 country-generic upsert plan。
- `@navigator/db` 公共入口只暴露经批准的 import builder；结构级 transformer 保持包内实现，不能绕过回执与 hash 校验。
- import plan 不携带 approval、candidate、manifest、deep-module 或 KnowledgeChunk 数据，也不执行数据库删除。
- Web registry 只消费 canonical `country.json` 与 `market-overview.json`；中英文切换时业务文本同步切换。
- Web `prebuild` 与 CI 必须先运行 country-generic publication validation，任一 canonical/receipt/manifest/candidate 漂移都应阻断构建。
- policy、risk、opportunities、projects、partners、chinese-companies、entry-strategy、ai-advisor、reports 必须返回 `BUILDING` 和零项，不能返回历史 synthetic IDs。
- 外部 datastore 若曾导入 legacy Complete 行，其清理由单独批准的 `OPS-DATA-ID-BASIC-CLEANUP` 执行；本任务不执行数据库破坏性操作。

## 4. 后续升级

印度尼西亚已经先按 Basic 交付。任何 `STANDARD` 或 `COMPLETE` 增量必须在 Basic 验收后，以单独、经人工批准的升级任务完成，并继续遵守统一 10 模块模型、双语、元字段、发布和 AI 边界。
