# BASIC Country Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a country-neutral, atomic refresh path for an existing approved BASIC publication and use it to move Indonesia from `data-basic-id-20260711-r2` to the reviewed `data-basic-id-20260720-r3` publication.

**Architecture:** Keep `basic:publish` as a no-replace first-publication command. Add a native `RENAME_EXCHANGE` primitive, a v2/v3 approved-publication loader used by every production consumer, and a separate `basic:refresh` transaction that validates both active and target publications before atomically exchanging exact-three canonical directories. Preserve prior candidates and receipts; rollback is a reviewed Git revert.

**Tech Stack:** TypeScript strict mode, Node.js descriptor-relative filesystem APIs, Linux N-API C addon with `renameat2`, Vitest, Prisma validation, pnpm/Turborepo, Playwright, GitHub Actions.

## Global Constraints

- Scope exactly one country, `ID`; do not add or modify VN, SA, AE, BR, ZA, or any unrelated country data.
- Keep `basic:publish` no-replace behavior and its public result contract unchanged.
- The refresh target must be `basic-country-audit/v3`; the active publication may be canonical v2 or v3.
- Reuse `basic-country-publication-approval/v1`; the CLI reads but never creates, completes, or modifies approval receipts.
- Require `draft -> pending -> published`, `coverageLevel=BASIC`, `market-overview=COMPLETE`, the other nine modules `BUILDING` with `dataCount=0`, and `aiUsable=false`.
- Preserve every existing candidate and approval receipt byte; do not rewrite `data-basic-id-20260711-r2` history.
- Do not modify `docs/data-schema.md`, Prisma schema, permissions, membership, billing, or AI retrieval boundaries.
- Do not connect to or mutate persistent local/production PostgreSQL, Prisma records, KnowledgeChunk, or AI indexes.
- Use Linux `renameat2(RENAME_EXCHANGE)` only; no JavaScript rename, copy, ordinary rename, cross-device, or unsupported-filesystem fallback.
- A committed exchange always reports `status=refreshed`; post-commit uncertainty is expressed only through `postCommitVerified=false`.
- All display text remains `{ zh, en }`; the candidate remains immutable `draft` with `aiUsable=false` while canonical alone becomes `published`.
- Each task gets a fresh implementer, an independent spec/quality review, fixes for every Critical/Important finding, and a clean re-review before the next task.

---

### Task 1: Native atomic directory exchange

**Files:**
- Modify: `packages/db/native/basic-candidate-fs.c`
- Modify: `packages/db/src/cli/basic-candidate-native-fs.ts`
- Modify: `packages/db/src/basic-candidate-native-fs.test.ts`
- Modify: `packages/db/native/README.md`

**Interfaces:**
- Consumes: existing held parent file descriptors, safe single path components, and device/inode identities.
- Produces:

```ts
export function renameBasicCandidateDirectoryChildrenExchangeNative(
  sourceParentDirFd: unknown,
  sourceName: unknown,
  targetParentDirFd: unknown,
  targetName: unknown,
  expectedSourceDev: unknown,
  expectedSourceIno: unknown,
  expectedTargetDev: unknown,
  expectedTargetIno: unknown,
): BasicCandidateRenameNativeResult;
```

- Native export order becomes exactly `createExclusiveDirectory`, `ensureDirectory`, `closeDirectory`, `renameNoReplace`, `renameExchange`, `unlinkRegularFile`, `removeDirectory`.
- `renameExchange` returns `OK`, `COMMITTED_UNVERIFIED`, or a pre-commit `ERR_*` status; the TypeScript boundary maps the first two through the existing authenticated result objects and redacts every error.

- [ ] **Step 1: Add failing ABI and real-filesystem tests**

Add tests that require the seventh exact native export, reject malformed arguments/status values, exchange two held directories across distinct held parents, verify both file payloads and inode identities changed sides, and prove a wrong source or target identity leaves both sides byte-identical.

```ts
expect(renameBasicCandidateDirectoryChildrenExchangeNative(
  sourceParent.fd,
  "canonical",
  targetParent.fd,
  "example-land",
  sourceIdentity.dev,
  sourceIdentity.ino,
  targetIdentity.dev,
  targetIdentity.ino,
)).toEqual({ committed: true, verified: true });
```

- [ ] **Step 2: Run the native test and observe RED**

Run:

```bash
source "$HOME/.nvm/nvm.sh"
rm -f packages/db/.cache/native/basic-candidate-fs.node
pnpm --filter @navigator/db run build:basic-candidate-native
pnpm --filter @navigator/db exec vitest run src/basic-candidate-native-fs.test.ts
```

Expected: failure because `renameExchange` and its TypeScript wrapper do not exist.

- [ ] **Step 3: Implement the minimal native exchange**

Add a C callback that accepts eight arguments, validates both parents and both directory identities with `fstat`/`fstatat(..., AT_SYMLINK_NOFOLLOW)`, invokes:

```c
syscall(
  SYS_renameat2,
  source_parent_fd,
  source_name.bytes,
  target_parent_fd,
  target_name.bytes,
  RENAME_EXCHANGE
)
```

After a successful syscall, verify the old target identity at the source path and the old source identity at the target path. Return `COMMITTED_UNVERIFIED` if either post-check fails. Return `ERR_UNSUPPORTED` when `SYS_renameat2` or `RENAME_EXCHANGE` is unavailable.

Update the TypeScript exact-binding parser to seven exports and expose the typed wrapper above. Do not weaken `renameNoReplace`.

- [ ] **Step 4: Run focused native verification and observe GREEN**

Run the Step 2 command again, then:

```bash
pnpm --filter @navigator/db exec vitest run \
  src/basic-candidate-native-fs.test.ts \
  src/basic-candidate-artifact-writer.test.ts \
  src/publish-basic-country.test.ts
```

Expected: all tests pass; existing no-replace behavior remains green.

- [ ] **Step 5: Update native documentation and commit**

Document `renameExchange`, its two committed statuses, cross-parent same-filesystem requirement, and lack of fallback. Run `git diff --check`, then commit:

```bash
git add packages/db/native/basic-candidate-fs.c \
  packages/db/src/cli/basic-candidate-native-fs.ts \
  packages/db/src/basic-candidate-native-fs.test.ts \
  packages/db/native/README.md
git commit -m "feat(db): add atomic BASIC publication exchange"
```

### Task 2: Versioned approved-publication loader and consumer migration

**Files:**
- Create: `packages/db/src/collection/basic-publication-loader-v3.ts`
- Create: `packages/db/src/collection/basic-publication-versioned-loader.ts`
- Create: `packages/db/src/basic-publication-versioned-loader.test.ts`
- Modify: `packages/db/src/collection/basic-publication-contracts.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `packages/db/src/index.test.ts`
- Modify: `packages/db/src/seed/approved-basic-publications-validation.ts`
- Modify: `packages/db/src/seed/approved-basic-country-import.ts`
- Modify: `packages/db/src/seed/approved-basic-countries-prisma-import.ts`
- Modify: `packages/db/src/read/approved-publication-country-read-repository.ts`
- Modify: `packages/db/src/review/basic-approved-publication-profile.ts`
- Modify tests covering validation, import, read repository, and previous profile.

**Interfaces:**
- Consumes: existing v2 loader/validator and existing v3 parser/materializer/validator contracts.
- Produces:

```ts
export type BasicApprovedCountryPublicationVersioned =
  | BasicApprovedCountryPublicationV2
  | BasicApprovedCountryPublicationV3;

export type BasicCountryPublicationVersionedValidationResult =
  | Readonly<{
      valid: true;
      blockerCode: null;
      data: BasicApprovedCountryPublicationVersioned;
    }>
  | Readonly<{
      valid: false;
      blockerCode: BasicCountryPublicationBlockerCode;
      data: null;
    }>;

export function loadApprovedBasicCountryPublicationV3(
  repoRoot: string,
  countryDirectory: string,
): BasicCountryPublicationValidationResultV3;

export function loadApprovedBasicCountryPublicationVersioned(
  repoRoot: string,
  countryDirectory: string,
): BasicCountryPublicationVersionedValidationResult;
```

- Preserve `loadApprovedBasicCountryPublicationV2` unchanged and exported for legacy-specific tests.
- Production validation, import, canonical read repository, and approved-profile loading default to the versioned loader.

- [ ] **Step 1: Add failing v2/v3 version-dispatch tests**

Use synthetic exact-three v2 and v3 repositories. Assert both return a valid common result, unknown/mixed manifest-candidate versions fail closed, and changing phase-one manifest bytes before phase two yields `PUBLICATION_READ_FAILED`.

```ts
expect(loadApprovedBasicCountryPublicationVersioned(v2Root, "example-land"))
  .toMatchObject({ valid: true, data: { manifest: { schemaVersion: "basic-country-publication-manifest/v2" } } });
expect(loadApprovedBasicCountryPublicationVersioned(v3Root, "example-land"))
  .toMatchObject({ valid: true, data: { manifest: { schemaVersion: "basic-country-publication-manifest/v3" } } });
```

- [ ] **Step 2: Run focused tests and observe RED**

```bash
source "$HOME/.nvm/nvm.sh"
pnpm --filter @navigator/db exec vitest run \
  src/basic-publication-versioned-loader.test.ts \
  src/approved-basic-publications-validation.test.ts \
  src/approved-basic-country-import.test.ts \
  src/country-read-repository.contract.test.ts
```

Expected: failure because the versioned loader and v3 filesystem loader do not exist.

- [ ] **Step 3: Implement v3 loading and strict version dispatch**

Implement the v3 loader with the same stable two-phase byte reads and exact directory allowlists as v2, but require v3 manifest/candidate literals and call `validateApprovedBasicCountryPublicationV3`. Implement a small dispatcher that strict-reads only the manifest under an exact-three canonical directory, selects v2 or v3, and returns the stable failure result for unsupported values.

Add the common union types without widening any literal. Do not modify the v2 loader.

- [ ] **Step 4: Migrate production consumers**

Change default loader dependencies in approved-publication validation/import, Prisma import preparation, canonical read repository, and approved previous profile loading to `loadApprovedBasicCountryPublicationVersioned`. Keep injectable loader parameters typed to the common result so existing unit tests can still inject failures.

Export the versioned loader from `packages/db/src/index.ts` and lock the export in `index.test.ts`.

- [ ] **Step 5: Run focused loader and consumer tests**

Run:

```bash
pnpm --filter @navigator/db exec vitest run \
  src/basic-publication-loader.test.ts \
  src/basic-publication-v3-validator.test.ts \
  src/basic-publication-versioned-loader.test.ts \
  src/approved-basic-publications-validation.test.ts \
  src/approved-basic-country-import.test.ts \
  src/approved-basic-countries-prisma-import.test.ts \
  src/country-read-repository.contract.test.ts \
  src/review/basic-approved-publication-profile.test.ts \
  src/index.test.ts
```

Expected: v2 legacy tests and new v3 consumer tests all pass.

- [ ] **Step 6: Commit**

Run `git diff --check` and commit only the versioned-loader slice:

```bash
git add packages/db/src/collection packages/db/src/seed \
  packages/db/src/read packages/db/src/review \
  packages/db/src/basic-publication-versioned-loader.test.ts \
  packages/db/src/index.ts packages/db/src/index.test.ts
git commit -m "feat(db): load approved BASIC publications by version"
```

### Task 3: Authenticated refresh snapshot and atomic writer

**Files:**
- Create: `packages/db/src/cli/basic-active-publication-snapshot.ts`
- Create: `packages/db/src/cli/basic-refresh-writer.ts`
- Create: `packages/db/src/cli/basic-refresh-cache-cleanup.ts`
- Create: `packages/db/src/basic-refresh-writer.test.ts`
- Modify: `packages/db/src/cli/basic-publication-snapshot.ts`
- Modify: `packages/db/src/cli/basic-review-previous-profile-snapshot.ts`
- Modify: `packages/db/src/cli/write-basic-review-pack.test.ts`

**Interfaces:**
- Consumes: Task 1 native exchange, Task 2 versioned publication validation, and the existing authenticated target v3 publication snapshot.
- Produces:

```ts
export interface ActiveBasicPublicationSnapshot {
  readonly countryDirectory: string;
  readonly countryCode: string;
  readonly runId: string;
  readonly decidedAt: string;
  readonly close: () => Promise<void>;
}

export async function locateActiveBasicPublicationSnapshot(
  root: BasicCandidateHeldDirectory,
  countryDirectory: string,
): Promise<ActiveBasicPublicationSnapshot>;

export async function writeRefreshedBasicPublication(
  active: ActiveBasicPublicationSnapshot,
  target: ApprovedBasicPublicationSnapshot,
): Promise<Readonly<{ committed: true; postCommitVerified: boolean }>>;
```

- Extend `ApprovedBasicPublicationSnapshot` with readonly `decidedAt` so the writer can require `target.decidedAt > active.decidedAt` without exposing receipt bytes.
- Authenticated WeakMap states expose held root/data/canonical capabilities, exact bytes/identities, and `verify()` only to writer modules.

- [ ] **Step 1: Add failing active-snapshot tests**

Test valid active v2 and v3 snapshots, exact-three enforcement, invalid current receipt/candidate/canonical rejection, fixed redacted errors, country mismatch, absent active publication, post-open byte replacement, and idempotent close.

- [ ] **Step 2: Add failing writer state-machine tests**

Construct an active v2 publication and approved v3 target. Assert:

```ts
await expect(writeRefreshedBasicPublication(active, target)).resolves.toEqual({
  committed: true,
  postCommitVerified: true,
});
```

Then assert active exact-three bytes equal target canonical, target candidate/receipt bytes are unchanged, and no other country or product directory changed. Add injections for native pre-commit failure, native `COMMITTED_UNVERIFIED`, post-exchange verify/fsync/close failure, and old-cache cleanup failure.

- [ ] **Step 3: Run focused tests and observe RED**

```bash
source "$HOME/.nvm/nvm.sh"
pnpm --filter @navigator/db exec vitest run \
  src/basic-refresh-writer.test.ts \
  src/cli/basic-review-candidate-binding.test.ts \
  src/cli/write-basic-review-pack.test.ts
```

Expected: failure because the active snapshot and refresh writer do not exist.

- [ ] **Step 4: Implement descriptor-held active snapshot**

Extract the version-aware held-file validation currently embedded in the previous-profile snapshot into `basic-active-publication-snapshot.ts`. It must hold active canonical, receipt, and candidate descriptors; require exact-three/exact-four entries; validate v2 or v3; expose only identity fields publicly; and re-check hierarchy plus exact bytes in `verify()`.

Keep `basic-review-previous-profile-snapshot.ts` as a small adapter that returns `basicProfile` or `null` without weakening its absent-country behavior.

- [ ] **Step 5: Implement cache transaction and exchange**

Under held root, require `.cache` mode `0700`, ensure `basic-country-refresh` mode `0700`, create a UUID transaction directory and exclusive `canonical` child, then write/fsync/validate the target exact-three bytes.

Immediately before commit call both authenticated `verify()` functions and require same country, different run, and strictly newer target decision time. Call Task 1 exchange between transaction `canonical` and `data/{countryDirectory}`. After commit, verify new active bytes through the held target inode and old bytes through the held active inode now at the cache path.

Cleanup only registered old files/directories by device/inode. Before commit, any failure removes the owned target transaction and leaves active bytes unchanged. After commit, any failure returns `{ committed: true, postCommitVerified: false }` and never attempts automatic rollback.

- [ ] **Step 6: Run focused tests and observe GREEN**

Run the Step 3 command plus:

```bash
pnpm --filter @navigator/db exec vitest run \
  src/basic-candidate-native-fs.test.ts \
  src/basic-refresh-writer.test.ts \
  src/publish-basic-country.test.ts
```

Expected: refresh state-machine tests pass and first-publication tests remain unchanged.

- [ ] **Step 7: Commit**

Run `git diff --check`, then:

```bash
git add packages/db/src/cli/basic-active-publication-snapshot.ts \
  packages/db/src/cli/basic-refresh-writer.ts \
  packages/db/src/cli/basic-refresh-cache-cleanup.ts \
  packages/db/src/cli/basic-publication-snapshot.ts \
  packages/db/src/cli/basic-review-previous-profile-snapshot.ts \
  packages/db/src/basic-refresh-writer.test.ts \
  packages/db/src/cli/write-basic-review-pack.test.ts
git commit -m "feat(db): refresh approved BASIC canonical atomically"
```

### Task 4: Refresh CLI, public scripts, and operational documentation

**Files:**
- Create: `packages/db/src/cli/refresh-basic-country.ts`
- Create: `packages/db/src/refresh-basic-country.test.ts`
- Modify: `packages/db/package.json`
- Modify: `package.json`
- Modify: `docs/basic-country-publication.md`
- Modify: `docs/testing.md`

**Interfaces:**
- Consumes: Task 3 active snapshot and writer plus the existing target `locateApprovedBasicPublicationSnapshot`.
- Produces:

```ts
export interface RefreshBasicCountryResult {
  readonly status: "refreshed";
  readonly countryCode: string;
  readonly countryDirectory: string;
  readonly previousRunId: string;
  readonly activeRunId: string;
  readonly postCommitVerified: boolean;
}

export function parseBasicRefreshArguments(
  args: readonly string[],
): BasicPublicationArguments;

export async function refreshBasicCountry(
  input: PublishBasicCountryInput,
): Promise<RefreshBasicCountryResult>;
```

- Add root/package scripts named exactly `basic:refresh`; do not add dependencies.

- [ ] **Step 1: Add failing CLI contract tests**

Cover exact help text, argument uniqueness, ISO2/run/receipt path, duplicate and batch rejection, missing active canonical, same run, country mismatch, absent target receipt, stale target decision, target hash drift, success JSON, and committed-but-unverified output.

```ts
expect(await runBasicRefreshCli([
  "--country=XZ",
  "--run-id=run-002",
  "--approval-file=data/approvals/example-land/run-002.json",
], output)).toBe(0);
```

- [ ] **Step 2: Run CLI tests and observe RED**

```bash
source "$HOME/.nvm/nvm.sh"
pnpm --filter @navigator/db exec vitest run \
  src/refresh-basic-country.test.ts \
  src/publish-basic-country.test.ts
```

Expected: refresh entry point and scripts are absent.

- [ ] **Step 3: Implement CLI orchestration**

Open one trusted workspace, locate the active snapshot and target snapshot, enforce identity agreement, call `writeRefreshedBasicPublication`, and close every capability in `finally`. If any close fails after commit, preserve `status=refreshed` and set `postCommitVerified=false`; before commit expose only fixed `basic refresh failed` / `basic refresh error` messages.

- [ ] **Step 4: Document the refresh boundary**

Add a new section to `docs/basic-country-publication.md` with the exact command, validation sequence, exchange commit point, Git-revert rollback, and DB/AI non-side-effects. Add the focused native/refresh test commands and final gate to `docs/testing.md`.

- [ ] **Step 5: Run CLI and publication regression tests**

```bash
pnpm --filter @navigator/db exec vitest run \
  src/refresh-basic-country.test.ts \
  src/basic-refresh-writer.test.ts \
  src/publish-basic-country.test.ts \
  src/basic-publication-versioned-loader.test.ts
pnpm basic:refresh --help
pnpm basic:publish --help
```

Expected: both commands print their separate contracts; all tests pass.

- [ ] **Step 6: Commit**

```bash
git diff --check
git add packages/db/src/cli/refresh-basic-country.ts \
  packages/db/src/refresh-basic-country.test.ts \
  packages/db/package.json package.json \
  docs/basic-country-publication.md docs/testing.md
git commit -m "feat(data): add approved BASIC refresh CLI"
```

### Task 5: Approve and refresh Indonesia r3

**Files:**
- Create: `data/approvals/indonesia/data-basic-id-20260720-r3.json`
- Modify through CLI only: `data/indonesia/collection-manifest.json`
- Modify through CLI only: `data/indonesia/country.json`
- Modify through CLI only: `data/indonesia/market-overview.json`
- Create: `packages/db/src/indonesia-basic-r3-publication.test.ts`
- Modify: `packages/db/src/indonesia-basic-publication.test.ts`
- Modify: `docs/country-rollout.md`
- Modify: `docs/roadmap.md`

**Interfaces:**
- Consumes: immutable reviewed candidate `data/staging/indonesia/data-basic-id-20260720-r3`, the explicit project-owner approval in this task, and Task 4 `basic:refresh`.
- Produces: active Indonesia canonical v3, still exactly BASIC and non-AI, with r2 candidate/receipt and parent Git commit retained for rollback.

- [ ] **Step 1: Compute and independently record exact candidate hashes**

Run:

```bash
sha256sum \
  data/staging/indonesia/data-basic-id-20260720-r3/source-register.json \
  data/staging/indonesia/data-basic-id-20260720-r3/extracted-facts.json \
  data/staging/indonesia/data-basic-id-20260720-r3/market-overview.draft.json \
  data/staging/indonesia/data-basic-id-20260720-r3/review-report.json
```

Require four lowercase 64-character values and no candidate-byte changes relative to commit `8738970`.

- [ ] **Step 2: Create the strict human approval receipt**

Create exactly:

```json
{
  "schemaVersion": "basic-country-publication-approval/v1",
  "countryDirectory": "indonesia",
  "countryCode": "ID",
  "runId": "data-basic-id-20260720-r3",
  "submission": {
    "fromReviewStatus": "draft",
    "toReviewStatus": "pending",
    "submittedAt": "2026-07-20T13:12:37.000Z"
  },
  "decision": "approved",
  "reviewerId": "github:zhaofei0923",
  "decidedAt": "2026-07-20T13:12:37.000Z",
  "authorizedPublication": {
    "coverageLevel": "BASIC",
    "fromReviewStatus": "pending",
    "toReviewStatus": "published",
    "aiUsable": false
  },
  "artifactSha256": {
    "source-register.json": "0ae67bd15962eea524a1ea2479a6cbaba7dafbaf3c8967b9595cf9c0c3eada94",
    "extracted-facts.json": "b08fa0ba5c58a7f33074aef3de57cdb6c753a825a3c6acdb7611d654baf326ad",
    "market-overview.draft.json": "3804d0349cc611f492bbb74a0aa680ca490dc9c2cf5d18dd2b046bba149f3db3",
    "review-report.json": "416b537c6ecb4247050657250cf3148b3877afdada2a94fb739d4eeb54c753b9"
  }
}
```

The four hashes above were computed from commit `8738970` candidate bytes. The timestamp is after the target's latest `retrievedAt`/`collectedAt` and after the active r2 receipt decision. The implementer must independently recompute and require exact equality before writing the file. No other keys are allowed.

- [ ] **Step 3: Add the failing Indonesia r3 publication test**

Assert active manifest v3/run r3, exact receipt/candidate hashes, `coverageLevel=BASIC`, market overview `published`, `aiUsable=false`, eight BASIC profile categories, nine `BUILDING` modules, zero knowledge/deep records, exact bilingual market summary, and all source-bound `NOT_AVAILABLE` fields. Assert r2 candidate and r2 receipt bytes still exist unchanged.

- [ ] **Step 4: Run the country test and observe RED**

```bash
source "$HOME/.nvm/nvm.sh"
pnpm --filter @navigator/db exec vitest run \
  src/indonesia-basic-r3-publication.test.ts \
  src/indonesia-basic-publication.test.ts
```

Expected: r3 publication test fails while active manifest remains r2.

- [ ] **Step 5: Execute the real one-country refresh**

```bash
pnpm basic:refresh \
  --country=ID \
  --run-id=data-basic-id-20260720-r3 \
  --approval-file=data/approvals/indonesia/data-basic-id-20260720-r3.json
```

Require `status=refreshed`, `previousRunId=data-basic-id-20260711-r2`, `activeRunId=data-basic-id-20260720-r3`, and `postCommitVerified=true`. If the status is committed with `postCommitVerified=false`, stop mutations and perform read-only recovery verification before any commit.

- [ ] **Step 6: Run focused publication/import/API/Web tests**

```bash
pnpm --filter @navigator/db exec vitest run \
  src/indonesia-basic-r3-publication.test.ts \
  src/indonesia-basic-publication.test.ts \
  src/approved-basic-publications-validation.test.ts \
  src/approved-basic-country-import.test.ts \
  src/approved-basic-countries-prisma-import.test.ts \
  src/country-read-repository.contract.test.ts
pnpm --filter @navigator/db validate:approved-basic-publications
```

Expected: the exact six approved country codes remain valid, with Indonesia active r3. No database connection occurs in these focused tests.

- [ ] **Step 7: Update rollout records and commit one country**

Update only Indonesia's active-run/status references and the refresh verification record. Run `git diff --check`, verify no other country bytes changed, then:

```bash
git add data/approvals/indonesia/data-basic-id-20260720-r3.json \
  data/indonesia \
  packages/db/src/indonesia-basic-r3-publication.test.ts \
  packages/db/src/indonesia-basic-publication.test.ts \
  docs/country-rollout.md docs/roadmap.md
git commit -m "feat(data): refresh Indonesia BASIC publication"
```

### Task 6: Independent final review, full gates, merge, push, and CI

**Files:**
- Update only if required by verified review findings.
- Record scratch evidence in `.superpowers/sdd/`; do not commit review packages.

**Interfaces:**
- Consumes: all Task 1–5 commits.
- Produces: independently approved branch, merged and reverified `main`, pushed GitHub state, and CI head-SHA alignment.

- [ ] **Step 1: Generate a whole-branch review package**

Use the original base `756cb36` and current head:

```bash
/mnt/c/Users/12157/.codex/plugins/cache/openai-curated-remote/superpowers/6.1.1/skills/subagent-driven-development/scripts/review-package \
  756cb36 HEAD
```

Dispatch the final reviewer with the design, this plan, per-task reports, and package. Resolve every Critical/Important finding through one fix agent and re-review.

- [ ] **Step 2: Run clean native and full repository gates**

```bash
source "$HOME/.nvm/nvm.sh"
rm -f packages/db/.cache/native/basic-candidate-fs.node
pnpm --filter @navigator/db run build:basic-candidate-native
pnpm lint
pnpm typecheck
pnpm test
pnpm turbo run lint typecheck test --force
pnpm --filter @navigator/db prisma:validate
pnpm --filter @navigator/db validate:approved-basic-publications
pnpm test:e2e
git diff --check
```

Require every command exit `0`. If Playwright rewrites only the known generated `apps/web/next-env.d.ts` route type path, restore that generated difference only after confirming it is the known mechanical change; otherwise treat any dirty file as a finding.

- [ ] **Step 3: Verify publication and isolation bytes**

Assert:

- active Indonesia run is r3 manifest/canonical v3;
- r3 receipt hashes equal the exact four candidate bytes;
- r2 candidate and receipt equal base/history bytes;
- other five canonical directories and receipts equal `756cb36` bytes;
- canonical Indonesia is BASIC, non-AI, exact-three, with nine BUILDING modules;
- no Prisma/KnowledgeChunk/AI artifact appears in the diff;
- branch status is clean.

- [ ] **Step 4: Merge and reverify main**

Follow the already approved project workflow: update local `main` without force, merge the feature branch, rerun the required merged-main gates, and never delete the branch without separate authorization.

- [ ] **Step 5: Push and confirm CI SHA**

Push `main` normally. Confirm local `main`, `origin/main`, GitHub remote `main`, and the completed successful GitHub Actions run all reference the same SHA. Record the run URL and conclusion. Never force-push.
