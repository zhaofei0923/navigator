# Brazil Basic Atomic Publication Implementation Plan

**Goal:** Publish the explicitly approved `BR` / `brazil` /
`data-basic-br-20260718-r2` candidate as the canonical `BASIC` Brazil dataset
without modifying either Brazil candidate or enabling AI.

**Architecture:** Reuse the country-generic Basic v2 publication gate used by
Indonesia, Vietnam, Saudi Arabia, and the United Arab Emirates. Bind the immutable
r2 four-file candidate to an external strict approval receipt, derive the canonical
country and market records, bind the receipt through manifest v2, register the
canonical records in the existing Web seed registry, and verify DB, import, API,
bilingual UI, and E2E boundaries. The rejected r1 run remains immutable audit
history and has no approval or publication role.

## Approved Identity

- `countryDirectory`: `brazil`
- `countryCode`: `BR`
- `runId`: `data-basic-br-20260718-r2`
- `reviewerId`: `github:zhaofei0923`
- `submittedAt`: `2026-07-18T02:51:43.000Z`
- `decidedAt`: `2026-07-18T02:51:43.000Z`
- `coverageLevel`: `BASIC`
- `aiUsable`: `false`

Candidate SHA-256 identity:

| Artifact | SHA-256 |
| --- | --- |
| `source-register.json` | `22b7800d29ad39408e62c2c84d78c643b3d70ed081dca528a15708c895bfced5` |
| `extracted-facts.json` | `6c8cb2023f9b2e41afc06bc6d129db7289d7b6b81b2af8171f3eeac3681918d2` |
| `market-overview.draft.json` | `2fcfa2d31c616ec99876a268330fd0c73e07e63c6a1fd1b0402de7927c1099e2` |
| `review-report.json` | `645e074ba71650fa250d792245fe0397f0f0b678292abce71744350c2fc3511e` |

## Constraints

- Both Brazil candidates remain byte-identical. Each staging directory contains
  exactly four files, with `draft`, `aiUsable = false`, and `humanDecision = null`.
- Rejected r1 never receives an approval receipt and never becomes active.
- Canonical market data differs from the r2 draft only by
  `reviewStatus = published`; `techTags = []` and `aiUsable = false` remain exact.
- Canonical country data has ten fixed modules: one `COMPLETE` market overview and
  nine `BUILDING` modules with zero records, deriving exactly `BASIC`.
- The non-comparable EPE `86.8` / `86.6` figures and non-total `20.4 TWh` figure
  remain excluded from facts, copy, and indicators.
- The IPEA 2030 item remains a qualitative national energy-matrix target, without
  numeric, electricity-only, or independent legal characterization.
- No deeper-module data, KnowledgeChunk, AI index, Prisma schema change, dependency,
  permission change, or external datastore mutation is allowed.

## Tasks

- [x] Add the Brazil publication lock and update r1/r2 candidate repository-state
  assertions without changing candidate artifacts.
- [x] Create the strict r2 external approval receipt and bind all four candidate
  byte hashes.
- [x] Deterministically create `country.json` and `market-overview.json`, promoting
  only the canonical review status.
- [x] Create manifest v2 with the exact approval receipt SHA-256.
- [x] Extend all-publication validation, country-generic import, and root command
  coverage to the five approved countries.
- [x] Register Brazil in the country-neutral Web seed registry and verify English,
  Chinese, API, filter, nine-placeholder, and empty-AI behavior.
- [x] Record the approved identity, r1 history, exact hashes, semantic limits, and
  Basic/AI boundaries in seed, rollout, and roadmap documentation.
- [x] Run focused DB, Web/API, root command, publication validation, bilingual
  Playwright, repository lint/typecheck/test, and final immutable/scope checks.

Verification completed with focused DB `20/20`, focused Web/API `48/48`, root
command `5/5`, country explorer Playwright `8/8`, repository lint `6/6`,
typecheck `6/6`, root tests `23/23`, Web tests `86/86`, and DB tests
`2724/2724` passing.

## Publication Hashes

| Artifact | SHA-256 |
| --- | --- |
| approval receipt | `47136fb4516cc6d7a2fe4c104542f184c8190201ba6e5b772b796d55f215cf01` |
| `country.json` | `1a472079dc82589e50f4ed05885c9161d90f4b42e115c7852c69c8da7593d6e5` |
| `market-overview.json` | `79b76a56d878493ec91ba774f156301a6d85c688ae51c8aaf7ac71384a5db53a` |
| `collection-manifest.json` | `ff6f8a99e369f1fadf560858332c8589f1d6a8eb72e0d2751acf540cdb6f3421` |

## Verification Boundary

The final diff is limited to the Brazil receipt and canonical three-file
publication, publication/import/candidate locks, Web registry and API/E2E
expectations, and publication documentation. Clean verification requires exact
r1/r2 candidate hashes, no r1 receipt, the canonical three-file allowlist, five
approved publication identities, and no schema, dependency, AI, permission, or
external database change.
