# DATA-BASIC-AE-COLLECT First-Delivery Candidate Plan

**Goal:** Generate the United Arab Emirates first real `BASIC` candidate with
the native model-free pipeline for `data-basic-ae-20260717-r1`, stopping at the
human-review gate.

**Scope:** Add only four staging artifacts, one focused database-package test,
`docs/uae-seed.md`, this plan, and ignored run-local cache inputs. Do not create
canonical data, approvals, publication manifests, or AI-usable content.

## Steps

- [x] Confirm the branch contains the reviewed native empty-tech helper and
  preserve all seven fresh raw-v2 captures from this run.
- [x] Manually review the three UAE government sources and structurally review
  the four World Bank sources against their exact captures.
- [x] Bind every review and observation plan to the fresh `retrievedAt` and
  `contentSha256` metadata.
- [x] Add a second wind-source `marketOverview.industryTags` observation solely
  for taxonomy mapping, while retaining the ordinary industry-tag evidence.
- [x] Materialize `marketOverview.techTags = []` from that dedicated reviewed
  observation with non-null uncertainty and no direct tech-tag ownership.
- [x] Generate exactly four immutable candidate artifacts with the repository's
  native pipeline and no publication artifacts.
- [x] Lock 7 sources, 32 facts, every evidence source/locator pair, bilingual
  qualifiers, indicators, World Bank values, helper semantics, and artifact
  hashes in the focused UAE test.
- [x] Run the targeted test, full lint/typecheck/test gates, and
  `git diff --check`; audit the final file scope without committing or pushing.

## Evidence Decisions

- Barakah contributes a reported `40 TWh/year` and up to `25%` of UAE
  electricity. The candidate does not derive national generation.
- The grid-connected UAE Wind Program has `103.5 MW` of wind capacity. The
  expected homes statement is excluded from actual-result prose.
- The strategy's `19.8 GW` figure is a 2030 installed clean-energy capacity
  target. Renewable and clean energy remain distinct because clean energy
  includes nuclear.
- Supported industry tags are exactly `grid`, `solar`, and `wind`. No source
  supports an exact registered product-level technology subtype, so tech tags
  remain empty with explicit uncertainty.

## Immutable Candidate

| Artifact | SHA-256 |
|----------|---------|
| `source-register.json` | `2430b3c80beb1d33de61aa0af82174d4c8a5d66ead95c38b4e6390e3f5cfd842` |
| `extracted-facts.json` | `f26bea5b799e2b5e3014b90783438d28f292424e4a927504992cb1f3384639e7` |
| `market-overview.draft.json` | `aa8ca2e01f0240abc7923cae991bf981a9d8982ff155c8ff9684b31db3255bfe` |
| `review-report.json` | `35da3331817a19d59b5b7c0ca01036117ff10095cff5be863171367e3f504b5c` |

The terminal state for this task is `reviewStatus = draft`, `aiUsable = false`,
`humanDecision = null`, and `publicationRecommendation = request-human-review`.
