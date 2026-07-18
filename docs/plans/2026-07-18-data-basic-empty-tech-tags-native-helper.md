# DATA-BASIC-EMPTY-TECH-TAGS Native Helper Implementation Plan

**Goal:** Allow only a reviewed empty `marketOverview.techTags` editorial fact
to be backed by separately reviewed, source-owned `marketOverview.industryTags`
evidence when no registered product-level subtype is supported.

**Scope:** Keep the editorial input schema, catalog ownership, canonical data
model, candidate data, and publication/AI boundaries unchanged. Do not edit
`docs/roadmap.md`.

## Steps

- [x] Add materializer tests for the accepted empty-tag bridge and its ordinary
  manual fact output.
- [x] Add fail-closed tests for non-empty tags, missing uncertainty, a
  non-industry evidence path, source-fact-only support, unsafe or unreviewed
  sources, evidence reuse, and unconsumed evidence.
- [x] Implement the minimal editorial-only lookup that consumes the actual
  `marketOverview.industryTags` observation key only for the approved case.
- [x] Update the editorial and document-evidence contracts to state that the
  bridge is not catalog ownership and cannot affect document materialization.
- [x] Run focused tests, repository lint/typecheck/test gates, and
  `git diff --check` without committing, merging, or pushing.

## Independent Review Follow-Up

- [x] Correct the formal ownership wording to describe the output as a manual
  editorial fact backed by reviewed source evidence.
- [x] Add structured and branded-document production-path tests whose catalog
  owns `marketOverview.industryTags` but not `marketOverview.techTags`.
- [x] Prove direct unowned observations and cloned document provenance still
  fail closed, and mutation-check both positive production paths.
- [x] Rerun focused and full repository gates after the review fixes.
