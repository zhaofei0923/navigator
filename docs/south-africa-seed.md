# south-africa-seed.md - South Africa BASIC draft candidate

> `data/staging/south-africa/data-basic-za-20260717-r1/` is rejected immutable audit history and must never be published. `data/staging/south-africa/data-basic-za-20260718-r2/` is the only current `DATA-BASIC-ZA-COLLECT` v2 draft candidate. It remains for human review only, not a canonical seed, approval receipt, manifest, or publication.

| Field | Value |
|---|---|
| `countryDirectory` | `south-africa` |
| `countryCode` | `ZA` |
| `region` | `africa` |
| `runId` | `data-basic-za-20260718-r2` |
| audit status | `ready-for-human-review` |
| `reviewStatus` | `draft` |
| `aiUsable` | `false` |
| `humanDecision` | `null` |

The current r2 candidate has exactly four artifacts:

| Candidate artifact | SHA-256 |
|---|---|
| `source-register.json` | `7a99e47484e038a708201981035da50de7309f09ede5ab235ad4f32151001e3f` |
| `extracted-facts.json` | `dc8387ad8569037d799e59b0be8502647bf2719d7b9395962d56901f9df1250c` |
| `market-overview.draft.json` | `16ea4b33672b0c5ff4ad025eca1ca8d2ca0ceb36f95bf8c8f8d7da93c6b91536` |
| `review-report.json` | `f73b93f10e3dc0d40eac7f918745bde855f11d49fed5a0259ea2fefa27e92a33` |

The reviewed source IDs are sorted and limited to the Eskom FY2025 results presentation, the Government of South Africa IRP 2025, the 2023 RMIPPPP hybrid-project announcement, and four World Bank responses. The draft uses `industryTags = ["grid", "solar", "storage", "wind"]` and `techTags = ["onshore-wind"]`.

Its three indicators retain their source scope: Eskom sales volumes were `189.7 TWh` in FY2025; Eskom-only energy sent out was `195702 GWh` in FY2025; and IRP 2025 sets cumulative planned wind additions of `43041 MW` for 2026-2042. The latter is a plan figure, not built or procured capacity. The `195702 GWh` indicator is not qualified as net of pumping or excluding wheeling.

The World Bank captures report 2025 population `64747319`, GDP `427184325997.307` current US dollars, and GDP growth `1.11462608103956%`. The current candidate has no approval receipt, no `collection-manifest.json`, no `data/south-africa/` canonical directory, no published record, and no AI eligibility. Any correction or publication must use the separate approval workflow and must not modify either immutable run.
