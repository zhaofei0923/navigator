# brazil-seed.md - Brazil Basic publication record

`data/brazil/` is the approved canonical `BASIC` publication derived from
`data-basic-br-20260718-r2`. The immutable candidate remains a four-file,
draft-only audit bundle under `data/staging/brazil/`, with
`reviewStatus = draft`, `aiUsable = false`, and `humanDecision = null`.

`data-basic-br-20260717-r1` was rejected by independent review. Preserve r1
byte-for-byte as audit history, but never approve, publish, or use it as input
to a later run.

| Item | Exact r2 value |
| --- | --- |
| country directory / code | `brazil` / `BR` |
| run ID | `data-basic-br-20260718-r2` |
| catalog | `2026-07-17.2` / `6d4c6a27367eb36e4fe20df8fe78a9c9a9e865f84af563a22e31069c176d6f0a` |
| validation | 6 sources, 32 facts, zero blockers, ready for human review |
| reviewer | `github:zhaofei0923` |
| submitted / decided | `2026-07-18T02:51:43.000Z` |
| publication boundary | `coverageLevel = BASIC`; `aiUsable = false` |

## Current r2 candidate artifacts

| Artifact | SHA-256 |
| --- | --- |
| `source-register.json` | `22b7800d29ad39408e62c2c84d78c643b3d70ed081dca528a15708c895bfced5` |
| `extracted-facts.json` | `6c8cb2023f9b2e41afc06bc6d129db7289d7b6b81b2af8171f3eeac3681918d2` |
| `market-overview.draft.json` | `2fcfa2d31c616ec99876a268330fd0c73e07e63c6a1fd1b0402de7927c1099e2` |
| `review-report.json` | `645e074ba71650fa250d792245fe0397f0f0b678292abce71744350c2fc3511e` |

## Approved publication artifacts

The external approval receipt is
`data/approvals/brazil/data-basic-br-20260718-r2.json`, with SHA-256:

```text
47136fb4516cc6d7a2fe4c104542f184c8190201ba6e5b772b796d55f215cf01
```

The canonical directory contains exactly three files:

| Canonical artifact | SHA-256 |
| --- | --- |
| `country.json` | `1a472079dc82589e50f4ed05885c9161d90f4b42e115c7852c69c8da7593d6e5` |
| `market-overview.json` | `79b76a56d878493ec91ba774f156301a6d85c688ae51c8aaf7ac71384a5db53a` |
| `collection-manifest.json` | `ff6f8a99e369f1fadf560858332c8589f1d6a8eb72e0d2751acf540cdb6f3421` |

## Fresh r2 captures

Every source was retrieved live into the new r2 namespace. The r2 retrieval
times and raw-file identities are distinct from r1; identical hashes for five
sources mean that those sources returned the same payload bytes, not that r1
cache files were reused.

| Source | Retrieved at | Published at | Content SHA-256 |
| --- | --- | --- | --- |
| EPE BEN 2026 summary | `2026-07-18T02:15:39.781Z` | `2026-06-03T00:00:00.000Z` | `133d98ebe4f228110620a07b86313f4cc34ffcae63caf5d0501fe8c6bc57da9f` |
| IPEA ODS 7 | `2026-07-18T02:15:42.439Z` | `null` | `1236c59d4dc783d8d145645a661fbf9aafb9e0643298f1e1374b1b5225e42569` |
| World Bank country | `2026-07-18T02:15:43.243Z` | `null` | `9ba15dd0206c394794295ee818cf986c12a513a306723785cc845ea8aeaa1669` |
| World Bank GDP | `2026-07-18T02:15:43.530Z` | `null` | `1e7e6d6c24d45edea5ad6c7d51ca1b55b1e731a13f3048eecdd6a67698368534` |
| World Bank GDP growth | `2026-07-18T02:15:43.804Z` | `null` | `737fe896e4c99bea79476a144828fb99f20ab974ce446501b989c9dd9d4fa04d` |
| World Bank population | `2026-07-18T02:15:44.080Z` | `null` | `df53cd21ccfcaff8d86b226e32a32161cd44e1a73008d6f07c4d735d46fab1ba` |

The fresh World Bank observations are GDP `2,279,920,092,492.13` current US$,
GDP growth `2.2857464902475%`, and population `212,812,405`, all for 2025.

## Editorial and audit conclusions

- EPE supports 2025 final electricity-consumption growth of `2.7%`, solar PV
  generation/capacity of `88.1 TWh` / `64,793 MW`, and wind
  generation/capacity of `116.5 TWh` / `34,707 MW`; wind plus solar is `26.4%`
  of total generation and MMGD is `7.0%`.
- The EPE `86.8` and `86.6` renewable-mix figures use non-comparable
  definitions. Both are excluded from candidate facts, copy, and indicators;
  the candidate does not select or reconcile either figure.
- `20.4 TWh` is only the increase in internal supply. It is not a total and is
  excluded from candidate facts, copy, and indicators.
- IPEA's 2030 language is qualitative: maintain a high renewable share in the
  national energy matrix. It is not numeric, not electricity-specific, and is
  not characterized as an independent legal obligation.
- EPE owns `industryTags = ["solar", "wind"]`, not catalog `techTags`. The
  native empty-tech helper binds `techTags = []` to a second, distinct EPE
  `industryTags` observation whose raw value contains only the reviewed broad
  solar PV and wind generation/capacity values. The non-null uncertainty alone
  records that no exact registered product-level subtype is supported; there is
  no direct document `techTags` observation.
- The approved publication makes no market-opportunity claim and adds no fact,
  translation, indicator, or tag beyond the reviewed r2 candidate.

## Rejected r1 history

The rejected r1 candidate remains in
`data/staging/brazil/data-basic-br-20260717-r1/` with these immutable hashes:

| Artifact | SHA-256 |
| --- | --- |
| `source-register.json` | `1416669e59c990c08064df9045855b4940818853aeaa2cae31289f3352b92f0a` |
| `extracted-facts.json` | `27dc9ecea66a05537a640eb387331cccfdde939720360978bef82fffa0b959dd` |
| `market-overview.draft.json` | `10f1d093f4fc76bd6d50082ef3a4a353ee9218d7a4ec6578433cd343de4c60a9` |
| `review-report.json` | `9c6886c4f855cb8e7053b6b5e5c33a42fc8eed65ef0cc71717ad83f6fc42b43d` |

The publication-aware r1 candidate test SHA-256 is
`579c965909056b9b21c66a5d346941c898b8cc908445ba8a31e1bb87433567b8`.
Only its repository-state expectations changed to require the r2 canonical
publication while continuing to require that no r1 approval receipt exists;
the four rejected r1 candidate artifacts remain byte-identical.

## Publication boundary

`data-basic-br-20260718-r2` is the only active Brazil publication. Its canonical
market overview is deep-equal to the r2 draft except for
`reviewStatus = published`; `aiUsable` remains `false`. Brazil derives exactly
`BASIC`: `market-overview` is `COMPLETE` with one record, and all other nine
fixed modules are `BUILDING` with zero records.

No KnowledgeChunk, AI-eligible ID, deep-module record, external datastore write,
or `STANDARD` / `COMPLETE` authorization is part of this publication. Any data
correction requires a new run, candidate, and approval receipt. Any coverage or
AI upgrade requires a separate explicit human decision.
