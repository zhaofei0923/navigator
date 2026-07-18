# DATA-BASIC-ZA-COLLECT r2 Correction Plan

## Objective

Create `data-basic-za-20260718-r2` as the only current South Africa BASIC v2 draft candidate. The r1 candidate remains rejected, immutable audit history and must never be published or modified.

## Evidence Boundary

Capture all seven reviewed source IDs live into the new r2 raw-v2 namespace. Bind reviews, document plans, and editorial evidence to the exact r2 URLs, retrieval timestamps, byte lengths, and SHA-256 values. The official IRP source is published at `2025-10-28T00:00:00.000Z`, evidenced by `pdf:page=1#government-notice-6767-28-october-2025` and its review provenance.

## Corrections

- Use `Eskom口径送出电量` for the Chinese label and prose for Eskom-only energy sent out; do not use `自发` or `自发电量`.
- Keep `195702 GWh` limited to Eskom-only energy sent out. Do not attach the pumping or wheeling qualifier, which belongs to the separate electricity-breakdown context.
- State in both languages that the IRP current base of `5,344 MW` wind and `3,646 MW` grid-tied solar includes installed, under-construction, and deemed-online-in-2025 capacity.
- Label the final indicator as cumulative planned wind additions for `2026-2042`, `43041 MW`; do not describe it as built or procured capacity.

## Acceptance

- The candidate remains draft-only with `aiUsable = false` and `humanDecision = null`.
- The r2 validator reports seven sources and 32 facts with all source checks passed.
- Staging contains exactly the four candidate artifacts and no manifest, approval, canonical data, Prisma, Web, AI, shared-type, schema, or dependency change.
- The r1 candidate's four artifact hashes remain unchanged and the new r2 test locks r1 history, fresh r2 source-register timestamps and hashes, source bindings, evidence locators, bilingual text, and r2 hashes. The manual controller verifies raw-cache file inodes and the byte cap outside committed tests because `.cache/` is ignored in CI.
