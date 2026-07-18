# South Africa Basic Atomic Publication Implementation Plan

**Goal:** Publish the explicitly approved `ZA` / `south-africa` /
`data-basic-za-20260718-r2` candidate as the canonical `BASIC` South Africa
dataset without modifying either candidate or enabling AI.

**Architecture:** Reuse the country-generic Basic v2 publication gate used by
Indonesia, Vietnam, Saudi Arabia, the United Arab Emirates, and Brazil. Bind the
immutable r2 four-file candidate to an external strict approval receipt, derive
the canonical country and market records, bind the receipt through manifest v2,
register the canonical records in the existing Web seed registry, and verify DB,
import, API, bilingual UI, and E2E boundaries. The rejected r1 run remains
immutable audit history and has no approval or publication role.

## Approved Identity

- `countryDirectory`: `south-africa`
- `countryCode`: `ZA`
- `runId`: `data-basic-za-20260718-r2`
- `reviewerId`: `github:zhaofei0923`
- `submittedAt`: `2026-07-18T02:51:43.000Z`
- `decidedAt`: `2026-07-18T02:51:43.000Z`
- `coverageLevel`: `BASIC`
- `aiUsable`: `false`

Candidate SHA-256 identity:

| Artifact | SHA-256 |
| --- | --- |
| `source-register.json` | `7a99e47484e038a708201981035da50de7309f09ede5ab235ad4f32151001e3f` |
| `extracted-facts.json` | `dc8387ad8569037d799e59b0be8502647bf2719d7b9395962d56901f9df1250c` |
| `market-overview.draft.json` | `16ea4b33672b0c5ff4ad025eca1ca8d2ca0ceb36f95bf8c8f8d7da93c6b91536` |
| `review-report.json` | `f73b93f10e3dc0d40eac7f918745bde855f11d49fed5a0259ea2fefa27e92a33` |

## Constraints

- Both South Africa candidates remain byte-identical. Each staging directory
  contains exactly four files; r2 remains `draft`, `aiUsable = false`, and
  `humanDecision = null`.
- Rejected r1 never receives an approval receipt and never becomes active.
- Canonical market data differs from the r2 draft only by
  `reviewStatus = published`; `aiUsable = false` remains exact.
- Canonical country data has ten fixed modules: one `COMPLETE` market overview
  and nine `BUILDING` modules with zero records, deriving exactly `BASIC`.
- Preserve the exact Eskom sales, Eskom-only energy-sent-out, IRP current-base,
  planned-additions, update-date, and registered-tag scopes in the approved r2
  candidate. Do not introduce self-generation, pumping, or wheeling qualifiers.
- No deeper-module data, KnowledgeChunk, AI index, Prisma schema change,
  dependency, permission change, or external datastore mutation is allowed.

## Tasks

- [x] Add the South Africa publication lock and update r1/r2 candidate
  repository-state assertions without changing candidate artifacts.
- [x] Create the strict r2 external approval receipt and bind all four candidate
  byte hashes.
- [x] Deterministically create `country.json` and `market-overview.json`,
  promoting only the canonical review status.
- [x] Create manifest v2 with the exact approval receipt SHA-256.
- [x] Extend all-publication validation, country-generic import, and root command
  coverage to the six approved countries.
- [x] Register South Africa in the country-neutral Web seed registry and verify
  English, Chinese, API, filters, nine placeholders, and empty AI behavior.
- [x] Record the approved identity, r1 history, exact hashes, semantic limits,
  and Basic/AI boundaries in seed, rollout, and roadmap documentation.
- [x] Run focused DB, Web/API, root command, publication validation, bilingual
  Playwright, repository lint/typecheck/test, and final immutable/scope checks.

Verification completed with focused DB `20/20`, focused Web/API `50/50`, root
command `5/5`, country explorer Playwright `9/9`, repository lint `6/6`,
typecheck `6/6`, root tests `23/23`, Web tests `88/88`, and DB tests
`2729/2729` passing.

## Publication Hashes

| Artifact | SHA-256 |
| --- | --- |
| approval receipt | `5e82bf08c86218c9b141d17b9f17bbadf7ca1a6f5634058abafb89e14e065e56` |
| `country.json` | `44249f810ff09bdfbaf2d4e53c99412df7e10f245872aa8bac3c52a6e6a7270c` |
| `market-overview.json` | `3a45fd2eeba92cd8cb3f85f1ed6b492ffe2fe28defadab619d61450769657f77` |
| `collection-manifest.json` | `26b338493345f432f84420d50ef3acafbc2974d96bc24036f7d049b01401065c` |

## Verification Boundary

The final diff is limited to the South Africa receipt and canonical three-file
publication, publication/import/candidate locks, Web registry and API/E2E
expectations, and publication documentation. Clean verification requires exact
r1/r2 candidate hashes, no r1 receipt, the canonical three-file allowlist, six
approved publication identities, and no schema, dependency, AI, permission, or
external database change.
