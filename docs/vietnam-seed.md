# vietnam-seed.md - 越南真实 Basic 发布记录

> `data/vietnam/` 是 `DATA-BASIC-VN-PUBLISH` 交付的已批准真实 `BASIC` canonical publication。它与印尼遵循同一发布闸门，不包含国家特例、深度模块或 AI 资格。

| 项目 | 精确值 |
|------|--------|
| `countryDirectory` | `vietnam` |
| `countryCode` | `VN` |
| `runId` | `data-basic-vn-20260715-r3` |
| reviewer | `github:zhaofei0923` |
| submitted / decided | `2026-07-17T09:31:27.000Z` |

immutable candidate 仍仅包含四个文件，SHA-256 为：

| Candidate artifact | SHA-256 |
|--------------------|---------|
| `source-register.json` | `9a164b73048b290a2fd964a292158149d722adcd6edc54d4fea1d67f6cb879a3` |
| `extracted-facts.json` | `ca66fb3f8ee67c69ae9f33b4d941bf84209311cee139b68ed0a84d15ea9b99ce` |
| `market-overview.draft.json` | `3aa83f37cf0177e043d3ed0d5493c6193cb68e9f8dd33c75a46958a0079b5a95` |
| `review-report.json` | `163107e63f1ae72288dc10c8ed0770f94f9b93bf3dd896e67f0870f588492a1e` |

独立批准回执为 `data/approvals/vietnam/data-basic-vn-20260715-r3.json`，其 SHA-256 为：

```text
da457ef9dd8418a8a17b0f94e52504492da4f33fe3cdbb5b48434bf9b110df02
```

canonical 三文件的 SHA-256 为：

| Canonical artifact | SHA-256 |
|--------------------|---------|
| `country.json` | `d8d00dddee04363a7e7d52b7d1397e3bbb3c7a336d2477bd4755ec9313981257` |
| `market-overview.json` | `77f2a10ea4fb464a72a85512e52bf9a4ba75544e94538dea284aee3ad5675bfb` |
| `collection-manifest.json` | `3533142523da8d87813c85f1467fe07327e29b7d8008b0a080329a5b1e16adaa` |

`data/vietnam/` 必须且只能包含 `country.json`、`market-overview.json` 与 `collection-manifest.json`。它将越南发布为 `BASIC`：市场概览为唯一 `COMPLETE` 对象记录，其余九模块均为 `BUILDING`/零项；`aiUsable = false`，不生成知识片段、不进入 AI 检索。任何事实、翻译或元字段修正都必须新建 run、candidate 与回执；任何 Standard/Complete 升级也必须单独经人工批准。
