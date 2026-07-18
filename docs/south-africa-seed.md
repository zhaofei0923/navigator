# south-africa-seed.md - South Africa BASIC publication

> `data/staging/south-africa/data-basic-za-20260717-r1/` is rejected immutable audit history and must never be published. `data-basic-za-20260718-r2` is the only active publication identity. Its candidate remains an immutable four-file draft bundle; the explicit human decision is recorded in a separate approval receipt and activates the canonical three-file `BASIC` publication.

| Field | Value |
|---|---|
| `countryDirectory` | `south-africa` |
| `countryCode` | `ZA` |
| `region` | `africa` |
| `runId` | `data-basic-za-20260718-r2` |
| audit status | `ready-for-human-review` candidate; approved publication |
| candidate `reviewStatus` | `draft` |
| canonical `reviewStatus` | `published` |
| `aiUsable` | `false` |
| `humanDecision` | `null` |
| reviewer | `github:zhaofei0923` |
| submitted / decided | `2026-07-18T02:51:43.000Z` |

The r2 candidate still has exactly four immutable artifacts:

| Candidate artifact | SHA-256 |
|---|---|
| `source-register.json` | `7a99e47484e038a708201981035da50de7309f09ede5ab235ad4f32151001e3f` |
| `extracted-facts.json` | `dc8387ad8569037d799e59b0be8502647bf2719d7b9395962d56901f9df1250c` |
| `market-overview.draft.json` | `16ea4b33672b0c5ff4ad025eca1ca8d2ca0ceb36f95bf8c8f8d7da93c6b91536` |
| `review-report.json` | `f73b93f10e3dc0d40eac7f918745bde855f11d49fed5a0259ea2fefa27e92a33` |

The external approval receipt is
`data/approvals/south-africa/data-basic-za-20260718-r2.json`, SHA-256
`5e82bf08c86218c9b141d17b9f17bbadf7ca1a6f5634058abafb89e14e065e56`.
It records the exact `draft -> pending -> published` lifecycle and authorizes only
`BASIC` with `aiUsable = false`. No r1 receipt exists.

The canonical directory contains exactly three files:

| Canonical artifact | SHA-256 |
|---|---|
| `country.json` | `44249f810ff09bdfbaf2d4e53c99412df7e10f245872aa8bac3c52a6e6a7270c` |
| `market-overview.json` | `3a45fd2eeba92cd8cb3f85f1ed6b492ffe2fe28defadab619d61450769657f77` |
| `collection-manifest.json` | `26b338493345f432f84420d50ef3acafbc2974d96bc24036f7d049b01401065c` |

The canonical market overview is deep-equal to the r2 draft except for
`reviewStatus = published`; `aiUsable = false` remains unchanged. The country has
exactly one `COMPLETE` `market-overview` record and nine `BUILDING` modules with
zero records, so coverage derives to exactly `BASIC`.

The reviewed source IDs are sorted and limited to the Eskom FY2025 results presentation, the Government of South Africa IRP 2025, the 2023 RMIPPPP hybrid-project announcement, and four World Bank responses. The publication uses `industryTags = ["grid", "solar", "storage", "wind"]` and `techTags = ["onshore-wind"]` because only the RMIPPPP source explicitly owns that registered subtype.

Its three indicators retain their source scope: Eskom sales volumes were `189.7 TWh` in FY2025; Eskom-only energy sent out was `195702 GWh` in FY2025; and IRP 2025 sets cumulative planned wind additions of `43041 MW` for 2026-2042. The latter is a plan figure, not built or procured capacity. The `195702 GWh` indicator is not qualified as net of pumping or excluding wheeling.

The World Bank captures report 2025 population `64747319`, GDP `427184325997.307` current US dollars, and GDP growth `1.11462608103956%`. This publication creates no deep-module record, KnowledgeChunk, AI index, Prisma write, or external database mutation. Any correction requires a new run and approval receipt; any Standard, Complete, or AI upgrade requires a separate explicit decision.
