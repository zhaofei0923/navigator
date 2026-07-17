# saudi-arabia-seed.md - 沙特阿拉伯真实 Basic 发布记录

> `data/saudi-arabia/` 是 `DATA-BASIC-SA-PUBLISH` 交付的已批准真实 `BASIC` canonical publication。它沿用统一 Basic v2 发布闸门，不包含国家特例、深度模块或 AI 资格。

| 项目 | 精确值 |
|------|--------|
| `countryDirectory` | `saudi-arabia` |
| `countryCode` | `SA` |
| `runId` | `data-basic-sa-20260717-r2` |
| reviewer | `github:zhaofei0923` |
| submitted / decided | `2026-07-17T13:21:53.000Z` |

immutable r2 candidate 仍仅包含四个文件，SHA-256 为：

| Candidate artifact | SHA-256 |
|--------------------|---------|
| `source-register.json` | `b242dc902b7002dc3a2cec1bd87703760d776ada2b5c301329543b1f5945353d` |
| `extracted-facts.json` | `bd0df36ba29453e0d337ad8401310c443ff26686cc8efc06994902b017814072` |
| `market-overview.draft.json` | `2a297d007279afb80baeb316581aca874738ce614443a2a7944ad576e32c6285` |
| `review-report.json` | `c8677f1bac448aa87ec79e35f3ffb9fc5b15c615f2b47ab3072ed588e09e6f9d` |

独立批准回执为 `data/approvals/saudi-arabia/data-basic-sa-20260717-r2.json`，其 SHA-256 为：

```text
b09aca2ea28e507977ab977246acdf0fc61c17337ddd7646e6b17b516b2ee5bc
```

canonical 三文件的 SHA-256 为：

| Canonical artifact | SHA-256 |
|--------------------|---------|
| `country.json` | `0ea252d57e178f328435f87ba7b732f75137734d31ad4449dcf62a987d536db7` |
| `market-overview.json` | `bd772ce5ba20b70920a85c54845a1683444ebe06aa258e16331f237399cb1037` |
| `collection-manifest.json` | `40c26ae8199e2475577a60e909859eb6b025e447e76968bcc35af3fc75f4c71a` |

`data/saudi-arabia/` 必须且只能包含 `country.json`、`market-overview.json` 与 `collection-manifest.json`。r2 是唯一 active publication，并将沙特阿拉伯发布为恰好 `BASIC`：市场概览是唯一 `COMPLETE` 对象记录，其余九模块均为 `BUILDING`/零项；`aiUsable = false`，不生成知识片段、不进入 AI 检索。

`data-basic-sa-20260717-r1` 仅保留为不可变审计历史，永不得批准或发布，也永不得作为任何批准决定或发布任务的输入。此 r2 发布不授权 `STANDARD`、`COMPLETE`、AI 或任何深度模块；任何事实、翻译或元字段修正都必须新建 run、candidate 与回执，任何覆盖升级也必须另行取得人工批准。
