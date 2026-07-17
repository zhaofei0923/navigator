# AE, BR, and ZA Reviewed Source Catalog Implementation Plan

**Goal:** Expand the committed Basic source catalog with the eight reviewed official sources required before separate UAE, Brazil, and South Africa candidate runs.

**Architecture:** Keep the existing `basic-source-catalog/v1` schema, structured GET materializer, v2 transport, and generic manual-document executor unchanged. This slice updates only the reviewed source control plane, its regression locks, and documentation. Each future country candidate will consume this shared catalog from its own branch and run identity.

**Tech Stack:** Strict TypeScript, Vitest, JSON source catalog, pnpm workspace, existing `basic-manual-document-capture@1.0.0`.

## Scope And Invariants

- Upgrade the current catalog identity from `2026-07-17.1` to `2026-07-17.2`.
- Add exactly eight country-scoped sources: two for `BR`, three for `ZA`, and three for `AE`.
- Keep all 19 `sourceId` values and every `fieldPaths` list unique and strictly lexicographically sorted.
- Use only `GET`, `accessMode = open`, empty query/allowed-query lists, canonical HTTPS origins, format-matching Accept values, and `basic-manual-document-capture@1.0.0`.
- Record EPE's declared CC BY 4.0 license and source-page attribution. Do not assert an open-content license for the other seven sources.
- Do not grant `marketOverview.techTags` ownership to EPE, South Africa IRP, UAE Wind Program, or UAE Energy Strategy 2050 because their reviewed text does not establish an exact controlled tech enum. Keep `industryTags`; only South Africa RMIPPPP retains `techTags` ownership because it explicitly states Onshore Wind.
- Preserve every historical staging candidate byte-for-byte. Its embedded catalog version/SHA remains immutable even when tests separately lock the new current catalog.
- Do not modify source-catalog/parser/materializer/transport code, schema, dependencies, canonical data, approvals, manifests, Prisma, Web, AI, permissions, or publication state.

## Task 1: Write Focused Contract Tests First

**Files:**
- Modify: `packages/db/src/basic-source-catalog.test.ts`
- Modify: `packages/db/src/vietnam-basic-r3-candidate.test.ts`
- Modify: `packages/db/src/saudi-arabia-basic-r1-candidate.test.ts`
- Modify: `packages/db/src/saudi-arabia-basic-r2-candidate.test.ts`

- [x] Change the committed-catalog expectation to version `2026-07-17.2` and 19 sorted source IDs.
- [x] Add separate `BR`, `ZA`, and `AE` execution-plan tests that lock materialized URL, format, Accept, country scope, origin allowlist, empty query, open access, generic adapter identity, and exact field paths.
- [x] Lock the EPE CC BY 4.0 deed URL and attribution, and assert no open-content claim for the other seven sources.
- [x] Split Saudi tests into current-catalog constants and immutable candidate-catalog constants; update only current-catalog constants in the Vietnam test.
- [x] Run the four focused files and observe RED caused by catalog version/source absence. Historical candidate validation and artifact locks must remain green.

RED evidence: 126 focused tests ran; 11 failed because the catalog was still `2026-07-17.1`, the new sources were unknown, and current-catalog expectations intentionally differed. All historical candidate-bundle tests passed.

## Task 2: Add The Reviewed Catalog Entries

**File:**
- Modify: `packages/db/catalog/basic-source-catalog.json`

- [x] Insert the two Brazil entries before Indonesia.
- [x] Insert the three South Africa and three UAE entries between Saudi Arabia and Viet Nam.
- [x] Keep `countryMappings = []` and preserve every pre-existing source entry semantically.
- [x] Materialize all three country plans through the existing parser/materializer without production-code changes.
- [x] Compute and lock the parser's canonical digest after the final reviewed semantics are stable.

Final identity:

```text
catalogVersion = 2026-07-17.2
catalogSha256 = 6d4c6a27367eb36e4fe20df8fe78a9c9a9e865f84af563a22e31069c176d6f0a
sourceCount = 19
```

The two Abu Dhabi Media Office request templates materialize without a trailing slash and follow one same-origin `302` to the reviewed canonical trailing-slash page. This is already permitted and recorded by the existing v2 manual-redirect transport. The canonical page URLs remain the license/reference URLs; this slice does not expand request grammar.

Independent review removed `marketOverview.techTags` from `brazil-epe-ben-2026-summary`, `south-africa-government-irp-2025`, `uae-admo-wind-program-2023`, and `uae-government-energy-strategy-2050`. Only the RMIPPPP source can support the exact `onshore-wind` enum; no source in this slice may infer storage chemistry or photovoltaic equipment tags. Focused RED/green checks lock the narrower field ownership while historical candidate identities stay unchanged.

## Task 3: Record Evidence Guardrails And Exclusions

**Files:**
- Modify: `docs/basic-source-catalog.md`
- Modify: `docs/roadmap.md`
- Create: `docs/superpowers/plans/2026-07-17-ae-br-za-source-catalog-plan.md`

- [x] Add all eight sources to the production-source table and record the current catalog identity.
- [x] Record Brazil's future safe indicator assignment: final electricity-consumption YoY growth `2.7%`, solar capacity `64,793 MW`, and wind capacity `34,707 MW`.
- [x] State that EPE's `86.8%` electricity-mix figure is not selected as an indicator because the uncataloged dynamic BEN chapter reports `86.6%` under a different domestic-supply definition.
- [x] State that `20.4 TWh` is an increase rather than total supply, and that IPEA supports only a qualitative national energy-matrix target through 2030.
- [x] Record the exact 10 MiB hard cap and exclude UAE FCSC (~16.2 MB), Brazil BEN/PDE PDFs (`17,717,974` / `14,878,646` bytes), and the South Africa Eskom integrated report (`12,246,797` bytes).
- [x] Add one completed roadmap card for this shared catalog slice without marking any `AE`, `BR`, or `ZA` candidate or publication complete.

## Task 4: Verification

- [x] Run focused catalog and historical-candidate tests.
- [x] Run `pnpm lint`.
- [x] Run `pnpm typecheck`.
- [x] Run `pnpm test`.
- [x] Review the final diff and confirm no historical staging file, canonical data, approval, manifest, schema, AI, permission, dependency, or Web file changed.

The first full test run exposed one stale synthetic fixture assumption: it prepended `fixture-manual-document`, which was sorted before the old `indonesia...` first source but not before the new `brazil...` entries. The test fixture now explicitly constructs its synthetic catalog in `sourceId` order; the production parser remains strict and unchanged. The focused integration test and the subsequent full repository run both pass.

Expected result: all repository gates pass; the branch remains uncommitted for controller review.
