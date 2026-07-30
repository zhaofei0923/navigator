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
- Generated reviewer templates belong in `data/d0/review`; only actual authorized reviewers may
  fill a review copy, and completed copies must not contain private contact details or secrets.
- Candidate reports and machine checks never authorize changing workbook task, acceptance, or
  signature states. Only actual named reviewers may do that.
- Any new behavior must include tests and update the implementation plan or operating
  documentation when its contract changes.
- Run `uv run ruff format --check .`, `uv run ruff check .`, `uv run mypy`,
  `uv run navigator-data validate`, `uv run navigator-data prepare-d0`,
  `uv run navigator-data prepare-d0-review`, and `uv run pytest --cov` before committing.
- Never commit secrets, private contact details, restricted source material, or unredacted
  evidence.
