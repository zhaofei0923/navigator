# BASIC Country Refresh Design

**Date:** 2026-07-20  
**Status:** Approved
**Scope:** One-country canonical BASIC refresh; first application is Indonesia `ID`, from `data-basic-id-20260711-r2` to `data-basic-id-20260720-r3`

## 1. Context

Navigator already has an immutable, approved Indonesia BASIC publication at
`data-basic-id-20260711-r2`. The reviewed v3 candidate
`data-basic-id-20260720-r3` contains an updated eight-category BASIC profile,
but the existing `basic:publish` command deliberately supports first
publication only and refuses to replace `data/{countryDirectory}/`.

Deleting the current canonical directory and reusing `basic:publish` would
bypass the approved no-replace boundary. This design adds a separate,
country-neutral refresh path with an explicit existing-publication precondition,
strict old/new validation, an atomic directory exchange, and Git-based rollback.

## 2. Goals

- Refresh exactly one existing approved BASIC canonical publication to one new,
  independently approved v3 run.
- Keep `basic:publish` unchanged as the only first-publication command.
- Validate the current active publication before accepting it as the refresh
  source state.
- Bind the target candidate's exact four bytes to a new external human approval
  receipt.
- Atomically exchange the current canonical directory with a fully materialized
  and validated target directory.
- Preserve all prior candidates and approval receipts as immutable audit
  history.
- Keep coverage exactly `BASIC`, keep `aiUsable=false`, and keep the other nine
  modules, KnowledgeChunk, Prisma, and AI indexes untouched.
- Make the publication commit reversible through reviewed `git revert`.

## 3. Non-goals

- No runtime version-selection service or active-publication pointer.
- No one-click runtime rollback command.
- No database import, migration, reset, truncation, or production mutation.
- No change to `docs/data-schema.md`, Prisma schema, AI retrieval boundaries,
  permissions, membership, or billing.
- No batch refresh and no country-specific code path.
- No refresh of a draft, pending, rejected, unverified, STANDARD, or COMPLETE
  publication.
- No JavaScript rename, copy-based replacement, ordinary rename fallback, or
  cross-filesystem fallback.

## 4. Considered approaches

### 4.1 Separate `basic:refresh` command — selected

First publication and refresh remain different capabilities. The refresh command
requires a valid existing canonical publication and a distinct approved target
run. This makes accidental replacement through the first-publication command
impossible and keeps each command's authority narrow.

### 4.2 Add `--replace-existing` to `basic:publish` — rejected

This would combine two different trust boundaries in one command. A flag parsing
or operator mistake could turn a first-publication command into a replacement
capability, weakening the current no-replace guarantee.

### 4.3 Manually edit canonical JSON — rejected

Manual edits cannot prove old-publication validity, target receipt binding,
exact-three output, atomicity, or AI/deep-module isolation. They also make the
reviewed candidate cease to be the deterministic source of canonical data.

## 5. Command contract

The root workspace exposes:

```bash
pnpm basic:refresh \
  --country=ID \
  --run-id=data-basic-id-20260720-r3 \
  --approval-file=data/approvals/indonesia/data-basic-id-20260720-r3.json
```

The command accepts exactly one `--country`, one `--run-id`, and one
`--approval-file`. It rejects duplicate arguments, positional values, unknown
arguments, batch country syntax, absolute paths, aliases, path traversal,
backslashes, NUL, symlinks, hard-linked authorization inputs, and a receipt path
that is not the exact repository-relative path derived from country/run
identity.

The target must be a `basic-country-audit/v3` candidate. The existing active
publication may be manifest/canonical v2 or v3 so the first refresh can safely
move the six-country legacy baseline forward without rewriting old artifacts.

On successful commit the command returns one JSON object:

```json
{
  "status": "refreshed",
  "countryCode": "ID",
  "countryDirectory": "indonesia",
  "previousRunId": "data-basic-id-20260711-r2",
  "activeRunId": "data-basic-id-20260720-r3",
  "postCommitVerified": true
}
```

If the atomic exchange committed but a post-commit verification, close, fsync,
or owned-cache cleanup step fails, `status` remains `refreshed` and
`postCommitVerified` is `false`. The command must never report a committed
exchange as an uncommitted failure.

## 6. Human approval receipt

The refresh reuses the strict
`basic-country-publication-approval/v1` receipt without adding fields. For the
Indonesia r3 refresh the receipt path is:

```text
data/approvals/indonesia/data-basic-id-20260720-r3.json
```

The receipt records:

- `countryDirectory=indonesia`
- `countryCode=ID`
- `runId=data-basic-id-20260720-r3`
- `draft -> pending -> published`
- `decision=approved`
- `reviewerId=github:zhaofei0923`
- `coverageLevel=BASIC`
- `aiUsable=false`
- the lowercase SHA-256 of each of the candidate's exact four file bytes

`submittedAt` is no earlier than every target source `retrievedAt` and the
target draft `collectedAt`; `decidedAt` is no earlier than `submittedAt` and is
strictly later than the current active receipt's `decidedAt`. The CLI reads but
never creates, modifies, or completes this receipt.

## 7. Validation sequence

The refresh command fails closed in this order:

1. Parse and normalize the three CLI arguments without reading arbitrary paths.
2. Resolve the country directory through the existing country-neutral ISO2
   mapping.
3. Require an existing exact-three canonical directory and reject a missing
   target with guidance to use `basic:publish`.
4. Stable-read the active manifest, active canonical files, current approval
   receipt, and current candidate through held regular-file descriptors.
5. Dispatch by active manifest version and require the current v2 or v3
   publication to pass its existing approved-publication loader and validator.
6. Derive the target receipt and four candidate paths from the requested
   country/run; require regular, single-link, non-symlink inputs.
7. Stable-read and validate the target v3 candidate and approval receipt,
   including exact byte hashes and `draft -> pending -> published` timestamps.
8. Require the target run to differ from the active run and require target
   `decidedAt` to be strictly later than the active receipt's `decidedAt`.
9. Materialize target canonical v3 deterministically and validate it before any
   filesystem commit.
10. Require `coverageLevel=BASIC`, `market-overview=COMPLETE`, the other nine
    modules `BUILDING` with `dataCount=0`, `aiUsable=false`, no deep-module
    records, no KnowledgeChunk, and no unexpected canonical artifacts.
11. Revalidate the held authorization input identities and exact bytes
    immediately before the atomic exchange.

Errors use stable, redacted categories and never expose raw source content,
absolute paths, reviewer notes, filesystem internals, database URLs, or secrets.

## 8. Atomic filesystem transaction

The writer creates a mode-`0700` transaction directory under
`.cache/basic-country-refresh/<uuid>/` on the same repository filesystem. Its
`canonical` child is created exclusively, contains exactly the three target
files, and is fully written, fsynced, parsed, and validated before commit.

The native filesystem helper adds one synchronous `renameExchange` operation.
It accepts held parent descriptors, the two child names, and the expected
device/inode identities for both directories. It performs:

1. pre-commit `fstatat(..., AT_SYMLINK_NOFOLLOW)` identity and directory checks;
2. Linux `renameat2(..., RENAME_EXCHANGE)` with no fallback;
3. post-commit identity checks proving the target directory is active and the
   previous active directory is now the private cache child.

The native result distinguishes:

- `OK`: exchange committed and native post-check succeeded;
- `COMMITTED_UNVERIFIED`: exchange committed but a native post-check failed;
- pre-commit error: no exchange committed.

After a verified exchange, JavaScript performs held-child, hierarchy,
exact-three, byte, parser, validator, resource-close, and parent-fsync checks.
It then removes only the old canonical cache child whose device/inode identities
were registered by this transaction. A cleanup failure preserves the private
mode-`0700` cache artifact for inspection and returns
`postCommitVerified=false`; it never rolls the active directory back
automatically and never deletes an unowned path.

Filesystems without `RENAME_EXCHANGE`, cross-device layouts, DrvFS behavior that
rejects the operation, and any unsupported native ABI fail closed before the
commit point.

## 9. Git rollback

The refresh changes the tracked bytes at `data/{countryDirectory}/` and adds the
new approval receipt in one country-only publication commit. Prior candidate and
receipt files remain unchanged. The parent Git commit therefore retains the
exact previous canonical bytes.

Rollback is not performed by the refresh CLI. It requires a separately reviewed
`git revert <publication-commit>`, followed by approved-publication validation,
lint, typecheck, tests, E2E, merge/push policy, and CI-SHA confirmation. Direct
file restoration, force push, hard reset, and deletion of old candidates or
receipts remain forbidden.

## 10. Database and runtime behavior

The command changes repository canonical files only. It does not invoke Prisma,
connect to PostgreSQL, import seed data, modify a running local showcase
database, call API/Web services, or touch AI indexes. Database parity is proven
through disposable test import and E2E gates. Updating any persistent local or
production database is a separate explicitly authorized operation.

## 11. Testing strategy

Implementation follows TDD and adds focused tests for:

- CLI help, exact argument shape, and single-country enforcement;
- refresh refusing a missing active publication while `basic:publish` continues
  to refuse an existing active publication;
- valid current v2 to target v3 and current v3 to target v3 refreshes;
- invalid current manifest, receipt, candidate, canonical mapping, coverage, AI
  boundary, and unexpected canonical files;
- same-run refresh, country/run mismatch, stale target decision timestamp,
  target artifact hash mismatch, symlink, hard link, path traversal, and changed
  held input bytes;
- complete target construction before the commit point;
- native pre-commit failure leaving the current active directory byte-identical;
- atomic exchange success, `COMMITTED_UNVERIFIED`, post-commit verification
  failure, and owned-cache cleanup failure semantics;
- exact-three active canonical output and isolation from every other country,
  candidate, approval receipt, Prisma, KnowledgeChunk, and AI index;
- deterministic canonical byte output and strict JSON duplicate-member
  rejection;
- Indonesia r3 publication identity, bilingual content, BASIC coverage, and
  source-bound `NOT_AVAILABLE` fields.

The final country slice gate includes focused refresh/publication tests,
approved-publication validation, `pnpm lint`, `pnpm typecheck`, `pnpm test`,
`pnpm turbo run lint typecheck test --force`, `pnpm test:e2e`, Prisma validation,
native clean-build integration, `git diff --check`, independent task review,
whole-branch review, merged-main verification, push, and GitHub CI head-SHA
alignment.

## 12. Delivery boundaries

The work is delivered as three reviewable stages:

1. Generic refresh contract, native exchange, CLI, tests, and documentation.
2. Indonesia r3 approval receipt and canonical refresh only after stage 1 is
   independently approved.
3. Whole-branch verification, merge to `main`, push, and GitHub CI confirmation.

No Vietnam, Saudi Arabia, unrelated country data, schema refactor, UI change,
database mutation, AI change, membership work, or admin work is included.
