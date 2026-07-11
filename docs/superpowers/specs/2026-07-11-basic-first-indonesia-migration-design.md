# Basic-first Indonesia Atomic Migration Design

**Status:** Approved product/data strategy; pending written-spec review.

## Goal

Make Basic the mandatory first published coverage level for every country, including Indonesia (`ID`). Remove Indonesia's current Complete-sample exception and atomically replace the version-controlled canonical seed and static Web data with an audit-backed Basic country so that living documentation, repository data, import plans, Web APIs and tests describe the same product state.

This migration keeps the fixed `BASIC` / `STANDARD` / `COMPLETE` data-model enums and generic coverage rules. It removes the current Complete country, not the future ability to deepen a separately approved country from Basic to Standard or Complete.

## Confirmed Decisions

- Every country starts at exactly `BASIC`; later deepening requires a separate task and human approval.
- No country is initially designated `STANDARD` or `COMPLETE`.
- Indonesia's existing deep module files and knowledge chunks are removed from the active repository tree. Git history is the only retained copy; no repository archive is added.
- Indonesia is replaced through one atomic `DATA-BASIC-ID` branch and merge. Main must not contain an intermediate state with mismatched documentation, seed data and Web behavior.
- The atomic guarantee applies to the repository and its current static Web runtime. The migration does not execute destructive database operations and must not be activated against an external database containing the legacy Complete seed.
- Cleanup of an already populated external database is the separately approved follow-up task `OPS-DATA-ID-BASIC-CLEANUP`; database-backed deployment remains blocked until that task proves the legacy rows and knowledge chunks are gone.

## Options Considered

### 1. Atomic Basic replacement (chosen)

Update living strategy documents, replace the Indonesia canonical data, retire the Complete-specific import path, switch Web fixtures to the Basic representation and update all affected tests in one task. The branch is merged only after the Basic audit package and canonical data pass human review and the full verification suite.

This keeps `main` internally consistent and leaves no repository or static-Web path that can re-import or expose the old Complete data. External datastores are governed by the separate activation gate below.

### 2. Remove Complete first, add Basic later

This creates a simpler deletion step but leaves the product with no active country between merges. It also requires two review and rollback windows for one strategy decision.

### 3. Soft downgrade while retaining deep files in place

Changing coverage flags and review states would hide most data, but the Complete importer, Web build inputs and knowledge files would remain available for accidental reactivation. This does not adequately implement the decision to remove the Complete sample.

## Product Invariants

The following rules remain unchanged:

1. All countries share the fixed ten-module model and the same page/API structure.
2. A Basic country has a qualifying `market-overview`; the other nine modules are `BUILDING` with `dataCount = 0` and no published records.
3. Basic records always have `aiUsable = false` and never create or import `KnowledgeChunk` records.
4. AI eligibility remains `reviewStatus = published`, `aiUsable = true` and `credibility != UNVERIFIED`. This migration does not modify the AI system prompt or retrieval boundary.
5. UI copy remains key-based bilingual i18n, and country data display text remains `{ zh, en }` with the existing fallback behavior.
6. Coverage is derived by the existing generic rules. No country-specific coverage override is introduced.

## Atomic Migration Scope

### Living documentation

Update the following living files so they state that all countries are Basic-first and that no Complete sample currently exists:

```text
AGENTS.md
docs/product-brief.md
docs/data-schema.md
docs/basic-country-collection.md
docs/coverage-levels.md
docs/country-rollout.md
docs/roadmap.md
docs/testing.md
```

Only the stale country-specific description changes in `docs/data-schema.md`; its enums, fields and model contract remain unchanged. `docs/roadmap.md` records P1-2 as delivered historical work that is explicitly superseded by `DATA-BASIC-ID`, and its current P1 summary/dependencies point to the generic Basic contract. `docs/indonesia-seed.md` is deleted as a living Complete contract, with Git history retaining it. Dated files under `docs/superpowers/plans/` and `docs/superpowers/specs/` remain historical records and are not rewritten.

A documentation consistency test scans `AGENTS.md` and living `docs/*.md`, excluding `docs/superpowers/**`, and fails when it finds a current claim that Indonesia/`ID` is Complete, a Complete sample, or exempt from Basic-first. The test also rejects a living link to the deleted `docs/indonesia-seed.md`.

### Canonical and audit data

Create one approved Indonesia Basic run under:

```text
data/staging/indonesia/<runId>/
  source-register.json
  extracted-facts.json
  market-overview.draft.json
  review-report.json
```

`data/indonesia/collection-manifest.json` points to that immutable four-file audit package. Canonical `country.json` and `market-overview.json` must be grounded in the same approved run.

The collection sequence is:

```text
Hermes/SearXNG discovery-only candidates
  -> open and capture approved original sources
  -> source register and extracted facts
  -> schema-constrained local-model bilingual draft
  -> deterministic audit validation
  -> human fact/source/translation review
  -> Basic canonical publication
```

Search summaries and model output are never evidence. The existing P1-6 JSON promotion boundary remains authoritative; non-JSON pages and PDFs may be discovered but cannot be promoted through that bridge. Missing facts remain explicit and are never inferred. Any source conflict, failed source check, untrusted input or prompt-injection risk blocks publication and requires a new run.

The published Indonesia canonical directory contains exactly `country.json`, `market-overview.json` and `collection-manifest.json`. The generic Basic loader maps the absent list modules and knowledge file to empty arrays and the absent entry-strategy file to `null`. The old policy, risk, opportunity, project, partner, Chinese-company, entry-strategy, report and knowledge content is deleted from the active tree.

The final committed `review-report.json` contains the project owner's decision for that exact run. A pre-decision working bundle is not an approved immutable bundle and is not placed behind the canonical manifest. Once the approved four-file package is committed, later corrections create a new run instead of modifying it.

### Canonical promotion mapping

The manifest `mappingVersion` is fixed to `basic-country-canonical/v1`. Publication uses a new fail-closed `validateApprovedBasicCountryPublication()` boundary rather than treating the generic structural validator as approval.

The publication boundary performs all of these checks:

1. Run the existing generic Basic canonical validation.
2. Reconstruct the exact `BasicCollectionAuditBundle` from the manifest and four audit files, then run `validateBasicCollectionAuditBundle()`.
3. Require `valid = true`, `blockers = []`, `readyForHumanReview = true`, `status = ready-for-human-review`, `publicationRecommendation = request-human-review` and `humanDecision.decision = approved`.
4. Keep the reusable gate country-generic. Derive the expected ISO2 code from canonical `country.code` and the expected directory from `bundle.countryDirectory`; require canonical market overview, source register, extracted facts, draft and review report to use that code. Require `manifest.activeRunId` and the loader's audit-run ID to equal the `runId` in source register, extracted facts and review report. The draft intentionally has no `runId`; it is bound to the run only because the loader reads it from the exact manifest-resolved `data/staging/<countryDirectory>/<activeRunId>/` path. Require that manifest path and directory identity to match exactly.
5. Require every canonical country field (`code`, `name`, `summary`, `region`, `flagEmoji`, `updatedAt`) to deep-equal the unique candidate normalized evidence for its documented country fact path.
6. Require every canonical market-overview field to deep-equal `market-overview.draft.json`, except for the only permitted transition `reviewStatus: draft -> published`; `aiUsable` remains exactly `false`.
7. Derive `coverageLevel` and the ten `moduleCoverage` rows through the existing generic Basic rules; these are not reviewer-authored overrides.

The gate permits no post-approval fact or translation edit. If a reviewer requests a correction, collection creates a new run containing corrected facts and a corrected draft, then repeats validation and human approval. Mutation tests change each mapped canonical field in turn and prove the publication gate rejects drift. `DATA-BASIC-ID` acceptance, rather than the reusable validator, separately asserts `countryDirectory = indonesia` and ISO2 code `ID`.

### Database package

Retire the Complete-specific Indonesia loader, threshold validator, AI-positive fixture and seed command. Keep `validateBasicCountryBundle()` as the reusable draft/structure check, add `validateApprovedBasicCountryPublication()` as the publication check, and require `buildBasicCountryImportPlan()` to pass the publication check before it returns operations.

The resulting import plan must contain only Country, ten ModuleCoverage rows and one MarketOverview operation. It must contain no deep-module operation and no KnowledgeChunk operation, with `aiEligibleKnowledgeIds = []`.

Publication validation has negative tests for malformed audit envelopes, every blocker, a conservative blocked/no-blocker report, null or rejected human decisions, cross-country identity, cross-run identity, unsupported mapping versions and canonical-to-audit drift. An exact filesystem allowlist test recursively proves `data/indonesia/` contains only the three canonical files and contains no archive, empty legacy JSON, nested knowledge directory, generated copy or symlink. A production dependency scan proves no package imports a deleted Indonesia deep-data path.

No Prisma schema, migration, enum or shared data-model change is part of this task.

### External datastore activation gate

The repository currently builds import operations but does not execute them. Therefore this task does not claim to migrate a previously populated database.

Add a read-only `preflight:basic-activation -- ID` command backed by Prisma count queries. It fails closed unless policy, risk, opportunity, project, partner, Chinese-company, entry-strategy, report and KnowledgeChunk counts are all zero. It also rejects any published non-market record or AI-eligible record and emits counts only, never row content. The preflight never changes a row; package tests exercise its query port with deterministic in-memory results, while each target datastore must run the real command before activation.

`OPS-DATA-ID-BASIC-CLEANUP` owns backup, transactional revocation/deletion, vector cleanup, rollback rehearsal and post-cleanup verification for any environment that contains the legacy Complete seed. Such an environment may not execute the new Basic import plan, switch a database-backed country API, enable RAG or declare the migration active until the read-only preflight reports all required zero counts. This follow-up requires separate human approval because it is destructive database work.

### Web data registry and APIs

Remove imports of Indonesia's deep module and knowledge JSON from the Web production dependency graph. Register only the Basic canonical data in the existing country registry boundary.

The Web package does not import Node-only DB validation code into its client or route bundles. Instead, a repository data-publication command loads the exact committed Indonesia bundle and runs `validateApprovedBasicCountryPublication()` before `next build`; the same command is a mandatory CI/test gate. A blocked, rejected, mismatched or unapproved active run therefore prevents both the import plan and the static Web build. Web responses consume only canonical files and never include manifest, source-register, extracted-fact, draft, review-report or human-decision fields.

The public behavior after migration is:

- country list and detail return Indonesia with `coverageLevel = BASIC`;
- market overview renders in both supported locales;
- each of the other nine module routes returns HTTP 200 and `success = true`; in both raw and localized modes `data.status = BUILDING`, `data.items = []`, `meta.total = 0`, and no `data.item` is present; localized mode includes the existing empty `_i18nFallback` list;
- list signals, source counts and tags cannot be derived from removed deep records;
- the AI module does not claim readiness and exposes no knowledge-derived content.

No Indonesia-specific route, page field or UI exception is added.

## Human Review Gates

The strategy decision and removal of the active Complete sample are approved by the project owner. That approval does not pre-approve collected facts.

Before canonical publication and merge, the project owner must review the Indonesia Basic source register, extracted facts, bilingual draft, conflicts/risks and review report. The final human decision must be represented using the existing audit contract; automation cannot promote `draft` or `pending` material by itself.

Implementation stops after producing a validated candidate four-file package and presents that exact run to the project owner. Only an explicit approval of its facts, sources and translations permits the implementation to record `humanDecision.decision = approved`, generate the mapped canonical files and continue to DB/Web migration. Rejection or requested edits create a new run. Strategy approval and agent code review never substitute for this checkpoint.

If an external database already contains the old Indonesia Complete seed, the activation preflight blocks deployment and points to `OPS-DATA-ID-BASIC-CLEANUP`. This branch does not issue delete, truncate, reset, vector cleanup or status-rewrite commands.

## Failure and Rollback Behavior

- The branch does not merge when the audit bundle is malformed, blocked or not approved.
- No partial canonical package is accepted: manifest, the three run-ID envelopes, the manifest-bound draft, country data and market overview must satisfy the exact country/run identity matrix above.
- No old deep file may remain anywhere under `data/indonesia/` or be imported by production code after the switch.
- A Web build and Basic import-plan generation both fail unless the same active run passes the full publication gate.
- A database-backed deployment fails its activation preflight when any legacy deep or knowledge row remains; repository acceptance alone is not represented as datastore cleanup.
- If post-migration verification fails, the feature branch remains unmerged. After merge, normal Git revert restores the previous repository state; force push and destructive reset are prohibited.
- A later data correction creates a new immutable run and updates the manifest only after another human review. An approved audit package is never rewritten.

## Test Strategy

### Database and shared coverage

- Indonesia loads through the generic Basic path and derives exactly `BASIC`.
- Market overview is `PARTIAL` or `COMPLETE`; the remaining nine module statuses are `BUILDING/0`.
- Import operations contain no deep module and no KnowledgeChunk records.
- Basic data has `aiUsable = false`, and AI-eligible knowledge IDs are empty.
- The manifest resolves to the approved four-file audit package; malformed, blocked, unapproved, rejected, identity-mismatched and canonical-drift variants cannot produce an import plan or pass the publication command.
- The recursive `data/indonesia/` allowlist contains exactly three canonical files, while staging and manifest data remain outside import, coverage and AI inputs.
- The read-only activation preflight passes only for all-zero legacy counts and fails for every individual deep module, published non-market record, KnowledgeChunk and AI-eligible-record case.
- Generic Standard/Complete threshold tests remain unchanged to preserve future deepening capability.
- The living-document guard finds no current Indonesia Complete/sample/exemption claim and no link to `docs/indonesia-seed.md`, while ignoring dated historical records.

### Web and i18n

- Country list, country detail and module APIs return the Basic representation without exposing removed data.
- Both `zh-CN` and `en` render the market overview and the same nine building states.
- Language-pack key parity and localized data fallback tests remain green.
- Production dependency tests reject old deep/knowledge imports and audit/staging imports.
- Playwright covers `/zh-CN/countries` and `/en/countries`, opens Indonesia detail in each locale, verifies the Basic badge and localized market overview, opens one list module and the object `entry-strategy` module, verifies the Building placeholder, and verifies the AI module does not claim readiness.

### Required final commands

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm turbo run lint typecheck test --force
```

All five commands are mandatory on the feature branch. After the `--no-ff` merge, all five run again on `main`; the forced Turbo command is unconditional. Before push, `main` must contain the merge commit, have a clean worktree and be ahead of `origin/main` only by the reviewed task. After `git push origin main`, local `main` and `origin/main` must resolve to that same merge commit.

## Delivery Workflow

The implementation remains one task card, `DATA-BASIC-ID`, one feature branch, one review cycle, one merge and one push. Within the branch, work is divided into reviewed slices:

1. Living strategy-document updates and migration guards.
2. Indonesia Basic collection and four-file audit package.
3. Blocking project-owner review of the exact candidate run; a rejection loops back to step 2 with a new run ID.
4. Approved canonical data replacement and generic DB publication/import wiring.
5. Web publication guard, registry/API/UI fixture migration.
6. Cross-package review, forced verification, merge and final acceptance.

Each implementation slice receives implementation-agent tests and an independent review-agent pass. Critical and Important findings are fixed and re-reviewed before the next slice. Agents cannot mark step 3 approved. The main agent owns the final diff review, full test suite, merge to `main` and GitHub push only after the project-owner checkpoint is recorded in the approved audit run.

## Out of Scope

- Selecting the full 30-50 country list or starting another country.
- Upgrading any country to Standard or Complete.
- Removing the `STANDARD` or `COMPLETE` enum or changing coverage thresholds.
- Changing Prisma, the ten-module data model, AI prompts/retrieval, permissions, membership or billing.
- Destructive cleanup of any local, staging or production database; `OPS-DATA-ID-BASIC-CLEANUP` owns that separately approved work and blocks database-backed activation where required.
- Adding third-party dependencies or changing the approved technology stack.
