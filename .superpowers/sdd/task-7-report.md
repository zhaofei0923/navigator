# Task 7 Indonesia BASIC v3 draft report

Status: DONE_WITH_CONCERNS

## Scope and output

- Country: `ID` only; run: `data-basic-id-20260720-r3`.
- Catalog identity: `2026-07-20.1` / `6afa620bfef537573e7a52522fa0ef10e4d23bb1a1b291e28401628370f2c249`.
- Batch command completed with `{"batchId":"basic-v2-202607","results":[{"countryCode":"ID","status":"ready"}]}` and exit `0`.
- The staging directory contains exactly four v3 draft artifacts: `source-register.json`, `extracted-facts.json`, `market-overview.draft.json`, and `review-report.json`.
- Review boundary: `ready-for-human-review`, `humanDecision = null`, `reviewStatus = draft`, and `aiUsable = false`.

## Fresh capture evidence

| Source | Retrieved at | SHA-256 | Result |
| --- | --- | --- | --- |
| `indonesia-esdm-2025-performance` | `2026-07-20T12:14:11.627Z` | `4a2e693487d6feef4e39b4a77f6dcb2feae56dc80e99496072394a66f2b0bf7f` | Fresh HTML bytes reviewed at the retained masthead and paragraphs 127/129/132 locators. |
| `world-bank-country` | `2026-07-20T12:21:28.851Z` | `f50a86f6cefbd35c9c6ebcef82e7c1c9db429d7290b2d49e16329dd55070f874` | Fresh deterministic capture. |
| `world-bank-gdp` | `2026-07-20T12:21:30.499Z` | `d4ae1ae2575ee65d00d3a122440f746b7e35175a197cd463089d02ffe5548ee1` | Fresh deterministic capture. |
| `world-bank-gdp-growth` | `2026-07-20T12:21:35.716Z` | `2525f82cef95b82644954e9d304989422cf391e71ad029fd0f4c55e76fc1ce1b` | Fresh deterministic capture. |
| `world-bank-population` | `2026-07-20T12:21:36.482Z` | `11b33b1ede3f96ab488b993cecfbb244ff3faac8bd447e68f8b62aab40c7ac2a` | Fresh deterministic capture. |
| `world-bank-electricity-access` | `2026-07-20T12:38:45.306Z` | `a923b45249596007186a5159bb1b44a17776fbffc4414beda7cb6a046e9bda56` | Fresh profile capture; 99.9%, 2024. |
| `world-bank-gdp-per-capita` | `2026-07-20T12:38:45.357Z` | `4c2f5d67266507bdb8bc36d1c8f45ad5d1a5b7dbd0ad631d3b1192da2c0b0a6d` | Fresh profile capture; current US$ 5,059.62596411213 per person, 2025. |

## Decisions and concerns

- The fresh ESDM HTML hash differs from historic r2. Its cited raw values were manually rechecked against fresh bytes: 2025 renewable-energy share `15.75%`, electricity consumption `1,584 kWh/person`, and total generation capacity `107.51 GW`.
- The JDIH policy PDF did not complete through the production Node transport within the bounded attempt. Per authorization, `indonesia-esdm-national-energy-policy-2025` was removed from r3 config, review, plan, and evidence; no 2030--2060 PDF targets are used.
- `marketOverview.renewableTarget` now states only the verified 2025 actual share and explicitly says it is not a verified long-term target. The supplied `iea-policies.snapshot` remains the separate manual BASIC-profile policy summary.
- Global Ember, Solar Atlas, Wind Atlas, and IRENASTAT input rows retain source-bound bilingual `NOT_AVAILABLE` values where collection is not approved or not available.
- ESDM's national EBT total and solar/wind capacity figures are intentionally not included in the BASIC `renewableCapacity` profile: that category remains bound to the approved IRENA harmonized-source contract, which is `NOT_AVAILABLE` in this batch. This run does not expand the contract or claim a conflict.
- Existing `data/indonesia/` canonical files predate this task and were not modified. No approval receipt, new manifest, Prisma, coverage, publication, or AI-index side effect was created.

## Verification

Commands run:

```text
timeout 120s pnpm basic:prepare-batch --countries=ID --batch-id=basic-v2-202607
pnpm --filter @navigator/db exec vitest run src/basic-batch-manual-blocked.test.ts src/prepare-basic-batch.test.ts src/basic-candidate-composition-integration.test.ts
git diff --check
```

Focused Vitest result: batch/composition suite 3 files passed, 51 tests passed; v3 parser/loader/validator and versioned-loader suite 4 files passed, 35 tests passed; combined focused run 7 files passed, 86 tests passed.

Boundary inspection: four staging files only; all three envelopes are `basic-country-audit/v3`; 12 sources and 52 facts; the profile category set is complete; draft review report has no missing fields, conflicts, or injection risks.

Commit SHA: updated by the final amend; the final SHA is reported with the task handoff.
