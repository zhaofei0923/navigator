# Repository rules

## Source of truth

- The approved V1.0 baseline under `doc/doc` is authoritative.
- Requirement, field, API, route, permission, and test identifiers come from the technical workbook.
- Do not reinterpret an unapproved status, missing signature, or missing evidence as complete.

## Current phase gate

- The repository is currently in D0 data-standard freeze.
- Until `uv run navigator-data gate --stage D0` passes and D1-D4 are formally completed,
  work is limited to data preparation, source onboarding, collection, normalization, quality,
  evidence, and acceptance tooling.
- Do not create user-facing V0.1 functionality before the D4 review is signed. A change to this
  rule requires a formal project-baseline decision, not a code-only workaround.

## Engineering

- Target Python 3.13 for D0-D4 tooling.
- Treat the source workbooks as read-only. Generated contracts belong in
  `data/contracts/current`; machine-generated D0 candidates belong in `data/d0/candidates`.
- P0 baseline-change verification must target a separate candidate workbook, compare formula
  contracts as well as displayed values, bind every proposed new contract ID to its complete
  reviewed row definition, reject unreviewed deltas, and never activate the candidate or
  overwrite the authoritative workbook.
- Generated P0 delivery templates belong in `data/p0/candidates`; completed delivery packets must
  be tracked under `data/p0/delivery`, match their exact Git `HEAD` blob, replay the full D4 chain,
  reference only hashed non-restricted evidence, and prove every P0 requirement, route, API, test,
  acceptance item, release metric, and recovery capability.
  Evidence hashes must match both the current file and its declared committed Git blob; every
  implementation and evidence commit must be an ancestor of the final release commit.
- Generated reviewer templates belong in `data/d0/review`; only actual authorized reviewers may
  fill a review copy, and completed copies must not contain private contact details or secrets.
- Generated D1 source-onboarding templates belong in `data/d1/candidates`; no source may become
  `active` before D0 passes and all access, license, usage-boundary, evidence, and owner fields pass.
- Generated D2 collection templates belong in `data/d2/candidates`; L0 objects are append-only,
  failed runs never advance committed watermarks, and access-control stop signals are not retryable.
- Generated D3 processing templates belong in `data/d3/candidates`; source text and original values
  are immutable, every candidate must be replayable through all three run manifests, and fuzzy
  entity matches or conflicts require review. D3 outputs are never publishable or AI-indexable.
- Generated D4 acceptance templates belong in `data/d4/candidates`; score totals must be
  recalculated from evidence, P0/traceability/license/permission gates cannot be waived by an
  average score, the current P0 traceability report and hash must be recomputed independently,
  and only actual authorized people may sign the final approval.
- Candidate reports and machine checks never authorize changing workbook task, acceptance, or
  signature states. Only actual named reviewers may do that.
- Any new behavior must include tests and update the implementation plan or operating
  documentation when its contract changes.
- Run `uv run ruff format --check .`, `uv run ruff check .`, `uv run mypy`,
  `uv run navigator-data validate`, `uv run navigator-data snapshot`,
  `uv run navigator-data prepare-d0`,
  `uv run navigator-data prepare-d0-review`, `uv run navigator-data prepare-d1`,
  `uv run navigator-data prepare-d2`, `uv run navigator-data prepare-d3`,
  `uv run navigator-data prepare-d4`, `uv run navigator-data prepare-p0-traceability`,
  `uv run navigator-data prepare-p0-resolution`, `uv run navigator-data prepare-p0-delivery`,
  and `uv run pytest --cov` before committing.
- Never commit secrets, private contact details, restricted source material, or unredacted
  evidence.
