# United Arab Emirates Basic Atomic Publication Implementation Plan

**Goal:** Publish the explicitly approved `AE` / `united-arab-emirates` /
`data-basic-ae-20260717-r1` candidate as the canonical `BASIC` UAE dataset without
modifying the candidate or enabling AI.

**Architecture:** Reuse the country-generic Basic v2 publication gate used by
Indonesia, Vietnam, and Saudi Arabia. Bind the immutable four-file candidate to an
external strict approval receipt, derive the canonical country and market records,
bind the receipt through manifest v2, register the canonical records in the existing
Web seed registry, and verify DB, import, API, bilingual UI, and E2E boundaries.

## Approved Identity

- `countryDirectory`: `united-arab-emirates`
- `countryCode`: `AE`
- `runId`: `data-basic-ae-20260717-r1`
- `reviewerId`: `github:zhaofei0923`
- `submittedAt`: `2026-07-18T02:51:43.000Z`
- `decidedAt`: `2026-07-18T02:51:43.000Z`
- `coverageLevel`: `BASIC`
- `aiUsable`: `false`

Candidate SHA-256 identity:

| Artifact | SHA-256 |
|----------|---------|
| `source-register.json` | `2430b3c80beb1d33de61aa0af82174d4c8a5d66ead95c38b4e6390e3f5cfd842` |
| `extracted-facts.json` | `f26bea5b799e2b5e3014b90783438d28f292424e4a927504992cb1f3384639e7` |
| `market-overview.draft.json` | `aa8ca2e01f0240abc7923cae991bf981a9d8982ff155c8ff9684b31db3255bfe` |
| `review-report.json` | `35da3331817a19d59b5b7c0ca01036117ff10095cff5be863171367e3f504b5c` |

## Constraints

- The candidate remains byte-identical, `draft`, `aiUsable = false`, and
  `humanDecision = null`, with exactly four files.
- Canonical market data may differ only by `reviewStatus: "published"`.
- Canonical country data has ten fixed modules: one `COMPLETE` market overview and
  nine `BUILDING` modules with zero records, deriving exactly `BASIC`.
- No r2, deeper-module data, KnowledgeChunk, AI index, Prisma schema change,
  dependency, permission change, external datastore mutation, or country-specific
  service logic is allowed.
- Existing i18n paths and bilingual business data are reused; no UI text is added.

## Tasks

- [x] Add the failing UAE publication lock, all-publication, import, Web/API, root
  command, and bilingual E2E expectations.
- [x] Create the strict external approval receipt and bind the exact candidate bytes.
- [x] Deterministically create `country.json` and `market-overview.json`, promoting
  only the canonical review status.
- [x] Create manifest v2 with the exact approval receipt SHA-256.
- [x] Register UAE in the country-neutral Web seed registry and verify AI remains an
  empty `BUILDING` module.
- [x] Record the approved identity, candidate/receipt/canonical hashes, and Basic/AI
  boundaries in the seed, rollout, and roadmap documents.
- [x] Run focused DB/Web/root tests, all-publication validation, the country explorer
  E2E, repository lint/typecheck/test, and final immutable/scope checks.

Verification completed with focused DB `14/14`, focused Web/API `46/46`, root command
`5/5`, country explorer Playwright `7/7`, repository lint `6/6`, typecheck `6/6`,
root tests `23/23`, Web tests `84/84`, and DB tests `2719/2719` passing.

## Publication Hashes

| Artifact | SHA-256 |
|----------|---------|
| approval receipt | `41b2f9c18e27a77c3129125cb50d3d88fa7405ffb8729e3e97f593efab3341f4` |
| `country.json` | `425d1ab993230698341a6972f1c671b2dcb68386e2c2809498400a5e4cfb9257` |
| `market-overview.json` | `aaf5fbf982ae757c90d50beb8e473190f3e7b5eceb68529bf8868ce98ac250fa` |
| `collection-manifest.json` | `20f44483962a6ee5b46de281ddff9768cc1fbe9ca4c50a8e46b21a031265e984` |

## Verification Boundary

The final diff must remain limited to the receipt, canonical three-file publication,
publication/import locks, Web registry and API/E2E expectations, and publication
documentation. A clean verification requires candidate hashes and four-file allowlist
to remain exact, canonical allowlist to remain exactly three files, all publication
validation to include `AE`, and no schema, dependency, AI, permission, or external
database change.
