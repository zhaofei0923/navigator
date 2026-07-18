# Brazil Basic r2 Correction Plan

**Goal:** Preserve rejected `data-basic-br-20260717-r1` byte-for-byte and create
the sole current Brazil candidate `data-basic-br-20260718-r2` from six new live
captures with completed, capture-bound source-check language.

**Boundary:** Candidate only. The run remains `draft`, `aiUsable = false`, and
`humanDecision = null`; no canonical country data, approval receipt, collection
manifest, Prisma, Web, AI, dependency, or shared-contract change is allowed.

## Task 1: Freeze rejected r1 and establish RED

- [x] Record the exact r1 staging, cache-input, and r1-test SHA-256 baseline.
- [x] Add an r2 candidate test that locks r1 history and initially fails because
  the r2 staging directory is absent.
- [x] Confirm the test has no `.cache` dependency.

## Task 2: Capture six sources into a new r2 namespace

- [x] Create only r2 config, reviews, capture-bound document plans, and editorial
  input under `.cache/basic-country/BR/data-basic-br-20260718-r2/`.
- [x] Run the production candidate CLI with an empty r2 `raw-v2` namespace so
  EPE, IPEA, and four World Bank sources are retrieved live.
- [x] Verify all six r2 capture timestamps are newer than r1 and compare raw-file
  identities/hashes to prove there was no r1 cache reuse.

## Task 3: Bind completed reviews and generate the immutable candidate

- [x] Bind both document plans to exact r2 timestamps, content types, byte
  lengths, and hashes.
- [x] Replace every future-tense source-check placeholder with completed audit
  language containing that source's exact r2 timestamp and hash.
- [x] State in the EPE check that `86.8` and `86.6` are non-comparable and both
  excluded from facts/copy/indicators, and that `20.4 TWh` is only the internal
  supply increase and is not used as a total.
- [x] Preserve all approved narratives, indicators, IPEA qualifiers,
  `industryTags = ["solar", "wind"]`, and helper-derived `techTags = []` with
  only actual broad EPE solar/wind values in the dedicated evidence raw value.
- [x] Generate exactly four r2 staging artifacts through the native no-replace
  writer.

## Task 4: Lock and verify the correction

- [x] Lock exact r2 source bindings, source-check notes, 6/32 validator summary,
  evidence semantics, four artifact SHA-256 values, and candidate-only boundary.
- [x] Update `docs/brazil-seed.md` so r1 is rejected and never publishable, while
  r2 is the sole current candidate.
- [ ] Run focused r1+r2 tests, `TURBO_FORCE=true pnpm lint`,
  `TURBO_FORCE=true pnpm typecheck`, and `TURBO_FORCE=true pnpm test`.
- [ ] Run JSON, raw identity, artifact allowlist, r1 byte-preservation, status,
  and `git diff --check` reviews without staging, committing, merging, or pushing.
