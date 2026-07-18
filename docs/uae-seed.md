# uae-seed.md - 阿联酋真实 Basic 发布记录

> `data/united-arab-emirates/` 是 `DATA-BASIC-AE-PUBLISH` 交付的已批准真实
> `BASIC` canonical publication。它沿用统一 Basic v2 发布闸门，不包含国家特例、
> 深度模块或 AI 资格。

| 项目 | 精确值 |
|------|--------|
| `countryDirectory` | `united-arab-emirates` |
| `countryCode` | `AE` |
| `region` | `middle-east` |
| `runId` | `data-basic-ae-20260717-r1` |
| source catalog | `2026-07-17.2` |
| validator | `7` sources / `32` facts / ready for human review |
| reviewer | `github:zhaofei0923` |
| submitted / decided | `2026-07-18T02:51:43.000Z` |
| publication boundary | `coverageLevel = BASIC`; `aiUsable = false` |

候选目录恰好包含四个不可变文件：

| Candidate artifact | SHA-256 |
|--------------------|---------|
| `source-register.json` | `2430b3c80beb1d33de61aa0af82174d4c8a5d66ead95c38b4e6390e3f5cfd842` |
| `extracted-facts.json` | `f26bea5b799e2b5e3014b90783438d28f292424e4a927504992cb1f3384639e7` |
| `market-overview.draft.json` | `aa8ca2e01f0240abc7923cae991bf981a9d8982ff155c8ff9684b31db3255bfe` |
| `review-report.json` | `35da3331817a19d59b5b7c0ca01036117ff10095cff5be863171367e3f504b5c` |

独立批准回执为
`data/approvals/united-arab-emirates/data-basic-ae-20260717-r1.json`，其
SHA-256 为：

```text
41b2f9c18e27a77c3129125cb50d3d88fa7405ffb8729e3e97f593efab3341f4
```

canonical 三文件的 SHA-256 为：

| Canonical artifact | SHA-256 |
|--------------------|---------|
| `country.json` | `425d1ab993230698341a6972f1c671b2dcb68386e2c2809498400a5e4cfb9257` |
| `market-overview.json` | `aaf5fbf982ae757c90d50beb8e473190f3e7b5eceb68529bf8868ce98ac250fa` |
| `collection-manifest.json` | `20f44483962a6ee5b46de281ddff9768cc1fbe9ca4c50a8e46b21a031265e984` |

## Fresh raw-v2 绑定

七个来源均由本 run 现场抓取；候选绑定以下精确 capture 时间和内容哈希：

| `sourceId` | `retrievedAt` | `contentSha256` |
|------------|---------------|-----------------|
| `uae-admo-barakah-unit-4-2024` | `2026-07-17T16:18:59.197Z` | `fdb8290e2425ee2fc7e46fb616ae0f17a0d23a18aea6a82536c3fb8daa2f0d60` |
| `uae-admo-wind-program-2023` | `2026-07-17T16:19:01.816Z` | `527f5dc47235a1e415b2bad5bcc33eb6ed05b24ecfbdaa1070da4e68aa6a5ff3` |
| `uae-government-energy-strategy-2050` | `2026-07-17T16:19:04.861Z` | `4ce5db3455fa1246d5d745852be074e11a6dae3630707f4f9876066ed448a780` |
| `world-bank-country` | `2026-07-17T16:19:06.814Z` | `37338e2f806e62b7fd567763fc4c53946c7e21ab1bed7c1adf166bf6cf1f5db2` |
| `world-bank-gdp` | `2026-07-17T16:19:42.472Z` | `00bb8fec20143dccb75586a2eab16ea96d34e001092ecbce29c984a318324e7a` |
| `world-bank-gdp-growth` | `2026-07-17T16:20:40.444Z` | `b9de8024c348a7ff23094f2c5ebfeba6dbbd50e2c342b947a1181500f769363b` |
| `world-bank-population` | `2026-07-17T16:20:42.440Z` | `e07bf7b1ac682bbb6e6bc5a69d299d64df3e3f1a834b668643c91d6dfa8b9772` |

## 候选事实边界

- World Bank 最新返回值为：人口 `11,513,149` 人（`2025`）、GDP
  `552,324,919,095.872` current US$（`2024`）、GDP 增长率
  `3.99181200361831%`（`2024`）。
- 巴拉卡证据仅支持核电站年发电量 `40 TWh/year` 和其提供阿联酋电力
  **高达** `25%`；候选没有据此推算全国总发电量。
- 并网阿联酋风电项目总风电容量为 `103.5 MW`。四地点明细为 Sir
  Bani Yas `45 MW` 风电加 `14 MWp` 太阳能、Delma `27 MW`、Al Sila
  `27 MW`、Al Halah `4.5 MW`；“超过 23,000 户”仅属预期，未写成实际成果。
- 2030 年 `19.8 GW` 指已安装清洁能源容量目标。候选分别表述可再生能源
  和清洁能源，且注明清洁能源包括核能，不把二者混同。
- `industryTags` 精确为 `grid`、`solar`、`wind`。`techTags` 精确为空数组；
  独立的 reviewed `industryTags` taxonomy observation 仅证明来源没有支持任何
  已注册的产品级技术子类型，不构成 `techTags` catalog ownership。

`data/united-arab-emirates/` 必须且只能包含 `country.json`、
`market-overview.json` 与 `collection-manifest.json`。r1 是唯一 active
publication，并将阿联酋发布为恰好 `BASIC`：市场概览是唯一 `COMPLETE` 对象记录，
其余九模块均为 `BUILDING`/零项；`aiUsable = false`，不生成知识片段、不进入 AI
检索。

immutable candidate 继续保持 `reviewStatus = draft`、`aiUsable = false`、
`humanDecision = null` 且恰好四文件。本次发布不授权 `STANDARD`、`COMPLETE`、
AI 或任何深度模块；任何事实、翻译或元字段修正都必须新建 run、candidate 与回执，
任何覆盖升级也必须另行取得人工批准。
