# DATA-BASIC-ZA-COLLECT Candidate Plan

## Objective

Create one immutable, model-free South Africa BASIC v2 draft candidate for `ZA` in `africa`. The run is `data-basic-za-20260717-r1`; it stops at the human-review gate and never creates canonical data, a manifest, an approval receipt, or AI-eligible content.

## Evidence Boundary

Use only the preserved raw-v2 captures under `.cache/basic-country/ZA/data-basic-za-20260717-r1/`. Each capture must remain below the `10,485,760` byte cap and its review, document plan, and editorial evidence must bind the exact URL, retrieval timestamp, byte length, and SHA-256.

| Source ID | Capture | Retrieval time | Bytes | SHA-256 |
|---|---|---|---:|---|
| `south-africa-eskom-results-presentation-2025` | PDF | `2026-07-17T16:14:44.039Z` | 4,987,471 | `85192e6a0da922be7fbdf5a6f985193043bac8e7450db844fbd35bc4c1c72c18` |
| `south-africa-government-irp-2025` | PDF | `2026-07-17T16:14:47.506Z` | 4,317,129 | `82690b0dec299326c538888ebdf515515b1cd522490db08d03c7bdecf4b93da4` |
| `south-africa-government-rmippp-hybrid-projects-2023` | HTML | `2026-07-17T16:14:52.987Z` | 44,510 | `897d8c29dd37ae192d4d9f54b0de5c02e6969707fffc323c4032ef892fb43237` |
| `world-bank-country` | JSON | `2026-07-17T16:14:54.768Z` | 464 | `fefa34282d0ae0f5287744a1d7c3383c751b7a3ca2ad64bf08cac12da1c7c157` |
| `world-bank-gdp` | JSON | `2026-07-17T16:15:15.975Z` | 301 | `a53c054fdc3956399fd4bb6127c898bafbc3b7ee0e8038197c8218a406a7f926` |
| `world-bank-gdp-growth` | JSON | `2026-07-17T16:15:17.173Z` | 308 | `df84507dcaaac50672a9647791ff07f4e2b03121dec51d52a183d8f5f221fc64` |
| `world-bank-population` | JSON | `2026-07-17T16:15:15.746Z` | 290 | `13d8e9ca3882b26e12553b213737dd92c4f300aac03299d8f5ebcad88697af1f` |

The three manual documents receive manual review; the World Bank sources receive structured review. The source IDs and document-plan paths stay in code-point order.

## Fact Assignment

- Eskom slide 17 supports FY2025 sales volumes `189.7 TWh` versus `183.3 TWh`, a `3.5%` increase. This is explicitly Eskom scope.
- Eskom slide 10 supports FY2025 Eskom-only energy sent out `195702 GWh` versus `184576 GWh`, net of pumping and excluding wheeling.
- IRP 2025 printed page 30 supports the current-base figures of wind `5344 MW` and grid-tied solar `3646 MW`, including installed, under-construction, and deemed-online capacity in 2025.
- IRP 2025 printed page 31 supports balanced-plan additions for 2026-2042: solar `28713 MW` and wind `43041 MW`. The wind indicator is cumulative planned additions, not built or procured capacity.
- The RMIPPPP announcement supports two hybrid renewable projects totalling `203 MW` using Solar PV, Onshore Wind, and Battery Storage. It supports the single registered technical tag `onshore-wind`; no battery chemistry or PV-module tag is inferred.

## Acceptance

- Generate with `pnpm candidate:basic-country -- .cache/basic-country/ZA/data-basic-za-20260717-r1/candidate-config.json` after the native writer's local `data/staging` mode precondition is met.
- Preserve exactly four staging files and their byte hashes.
- Require 20 static fact paths plus three complete indicator groups, bilingual display fields, all seven source checks passing, zero blockers, `draft`, `aiUsable = false`, and `humanDecision = null`.
- Verify the candidate validator, targeted regression, lint, typecheck, full tests, and `git diff --check`.
