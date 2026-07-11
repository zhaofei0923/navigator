# DATA-BASIC-ID Task 3 Report

## Status

Complete. The strictly read-only, country-generic Basic activation preflight and the ID-only operator CLI were implemented, verified, independently reviewed, and committed. No real datastore command was executed.

## SHAs

- Base SHA: `3650a5e90c4fad078a0c89d2db39ffa878d642f4`
- Result SHA: `7b89bcf39626b2f13045a19c0da062332c35f360`
- Commit: `feat: preflight Basic datastore activation`

## Exact Files

- Created `packages/db/src/seed/basic-country-activation-preflight.ts`
- Created `packages/db/src/seed/basic-country-activation-preflight-cli.ts`
- Created `packages/db/src/basic-country-activation-preflight.test.ts`
- Modified `packages/db/package.json`
- Modified `packages/db/src/index.ts`
- Modified `packages/db/src/index.test.ts`

No Prisma schema, migration, publication/import behavior, data, documentation, Web, AI, or dependency file changed.

## TDD RED Evidence

The complete country-generic count-port matrix and CLI/AST contract were written before production code.

Command:

```text
PATH=/home/kevin/.nvm/versions/node/v24.18.0/bin:$PATH pnpm --filter @navigator/db exec vitest run src/basic-country-activation-preflight.test.ts
```

Observed RED:

```text
FAIL src/basic-country-activation-preflight.test.ts
Error: Cannot find module './seed/basic-country-activation-preflight.js'
Test Files 1 failed (1)
exit code 1
```

The CLI separator behavior also received a separate RED/GREEN cycle after the mandated help command proved pnpm 11 forwards the literal `--`. The updated exact-argument tests initially failed 4 cases, then passed after the classifier accepted only `-- ID` and `-- --help`.

## GREEN Verification

All commands used Node `v24.18.0` through the explicit PATH prefix.

```text
pnpm --filter @navigator/db exec vitest run src/basic-country-activation-preflight.test.ts src/index.test.ts
```

- Exit 0
- 2 test files passed
- 62 tests passed: 49 preflight/CLI/architecture tests and 13 barrel tests

```text
pnpm --filter @navigator/db lint
```

- Exit 0
- `tsc --project tsconfig.json --noEmit --pretty false`

```text
pnpm --filter @navigator/db typecheck
```

- Exit 0
- `tsc --project tsconfig.json --noEmit --pretty false`

```text
pnpm --filter @navigator/db run preflight:basic-activation -- --help
```

- Exit 0
- Printed `Usage: pnpm --filter @navigator/db run preflight:basic-activation -- ID`
- Did not construct `PrismaClient`, query, or connect to a datastore
- Node emitted only expected experimental loader/transform warnings

Independent read-only review of commit `7b89bcf` exited 0 with: `No actionable defects were identified in the reviewed change.`

## Query Matrix

The core executes 28 sequential counts in a fixed deterministic order and stores aggregate keys as `<model>:<scope>`.

1. `all`, in order: `policy`, `risk`, `opportunity`, `project`, `partner`, `chineseCompany`, `entryStrategy`, `report`, `knowledgeChunk` (9)
2. `published`, in the same non-market order (9)
3. `ai-eligible`, in order: `marketOverview`, followed by the same deep/knowledge order (10)

Every positive count blocks with:

```json
{
  "activation": "blocked",
  "blockerCode": "LEGACY_COUNTRY_DATA_PRESENT",
  "cleanupRequired": true,
  "valid": true
}
```

All-zero counts return `ready`, `blockerCode: null`, `cleanupRequired: false`, and `valid: true`.

## Prisma Filters

Each model maps explicitly to its same-named Prisma delegate and invokes only `.count({ where })`.

- `all`: `{ countryCode }`
- `published`: `{ countryCode, reviewStatus: "published" }`
- `ai-eligible`: `{ countryCode, reviewStatus: "published", aiUsable: true, credibility: { not: "UNVERIFIED" } }`

The private literals are schema-exact Prisma filter values. Runtime enum imports were deliberately avoided because this checkout's ungenerated Prisma client does not expose runtime enum objects; the structural filters typecheck and match the schema values.

## Generic vs ID Output

The reusable core contains no Indonesia cleanup task mapping. A `VN` call returns only the generic blocker and aggregate counts; its serialized result contains neither `Indonesia` nor `OPS-DATA-ID-BASIC-CLEANUP`.

The ID-only CLI adds:

```json
{ "nextTask": "OPS-DATA-ID-BASIC-CLEANUP" }
```

only when `countryCode` is `ID` and the generic blocker is `LEGACY_COUNTRY_DATA_PRESENT`. It does not add the task for `PREFLIGHT_QUERY_FAILED`.

## Failure and Redaction

- Country input must be exactly two uppercase letters; malformed input performs zero queries and returns `PREFLIGHT_QUERY_FAILED`, `cleanupRequired: false`, `valid: false`, `errors: ["INVALID_COUNTRY_CODE"]`, and `counts: null`.
- A rejected count call is caught and redacted to `errors: ["COUNT_QUERY_FAILED"]`; partial counts and the original error are discarded.
- Successful aggregate results, `errors`, and `counts` are runtime-frozen.
- Result own keys are limited to `countryCode`, `activation`, `blockerCode`, `cleanupRequired`, `valid`, `errors`, and `counts`. Tests reject records, source URLs, and evidence in serialized output.

## AST Read-Only Proof

The architecture test parses the CLI source with the installed TypeScript compiler API. It discovers the variable initialized by `new PrismaClient()`, collects only call expressions whose member-access path is rooted at that client name, and permits exactly:

- `<prismaClient>.<known-model-delegate>.count` for all 10 delegates
- `<prismaClient>.$disconnect` as the sole direct lifecycle call

Every other rooted member fails the assertion, so `find*`, writes, `aggregate`, `groupBy`, `$transaction`, raw query calls, and raw execute calls are rejected generically. Unrelated calls are outside the allowlist and are positively demonstrated by `JSON.stringify` and `process.stdout.write`. The assertion operates on AST call expressions, so `finally` text cannot produce a false match.

A direct source scan also found no forbidden datastore methods.

## CLI Lifecycle

- Package command exactly matches the brief's Node transform/loader invocation.
- The CLI accepts only pnpm-forwarded argv `-- ID` for execution and `-- --help` for help.
- Argument classification runs before `new PrismaClient()`.
- Help prints usage and returns 0 before client construction.
- Invalid arguments print one JSON error summary and return 2 before client construction.
- A real preflight would construct one client, emit one aggregate JSON summary, return 0 only for a valid ready result, and return nonzero for blockers/errors.
- `$disconnect()` is awaited in `finally`.

## Self-Review

- Scope is limited to the six owned package files.
- Query ordering and all 28 positive-count cases are explicit and tested.
- Market total/published counts are intentionally absent because a Basic country may have a published market overview; market is checked for AI eligibility.
- The core is country-generic and the ID cleanup task exists only at the CLI presentation boundary.
- No row content can cross the count port.
- No real datastore, Prisma generation, schema operation, migration, import, publication, or cleanup command ran.
- `git diff --check` passed before commit.
- Independent read-only review found no actionable defects.

## Concerns

- The real `preflight:basic-activation -- ID` path was intentionally not executed because no target datastore was authorized. It remains a deployment gate for Task 8 / `OPS-DATA-ID-BASIC-CLEANUP` as specified.
- The help path emits Node 24 experimental loader/transform warnings from the required package command; behavior and exit status are correct.

---

## Critical/Important Review Fix Wave

### Fix SHA

- Code and test fix: `6e007bb30f82e6d9f44cd1640654ef7d1e2dc99e`
- Commit: `fix: harden Basic activation preflight`

### TDD RED Evidence

All RED and GREEN commands used Node `v24.18.0` through the explicit PATH prefix.

The first focused RED added the invalid-count table, injectable CLI lifecycle contract, and mutation-style analyzer fixtures before production edits:

```text
pnpm --filter @navigator/db exec vitest run src/basic-country-activation-preflight.test.ts
```

- Exit 1
- 75 tests: 58 passed, 17 failed
- Eight invalid count cases (`NaN`, negative, fractional, both infinities, unsafe integer, runtime string, runtime object) incorrectly completed all 28 queries instead of failing at call four.
- Seven CLI lifecycle cases failed because `runBasicCountryActivationPreflightCli` was not yet injectable/exported.
- Two analyzer fixtures initially exposed a defect in the new test-local destructuring harness; the harness was corrected without changing production.

The repaired contract-only RED isolated the production gaps:

- Exit 1
- 75 tests: 60 passed, 15 failed
- All eight invalid count cases still failed because unchecked values were stored.
- All seven CLI lifecycle cases still failed because the injectable runner boundary did not exist.
- Every analyzer alias, destructuring, bracket, raw, read, write, aggregate, groupBy, and find fixture passed.

A later self-review mutation added `client.unknown.count()` before tightening delegate ownership:

```text
pnpm --filter @navigator/db exec vitest run src/basic-country-activation-preflight.test.ts -t "unknown delegate count"
```

- Exit 1
- One selected test failed because path depth alone incorrectly accepted an unknown delegate.

### GREEN Evidence

```text
pnpm --filter @navigator/db exec vitest run src/basic-country-activation-preflight.test.ts src/index.test.ts
```

- Exit 0
- 2 files passed
- 89 tests passed: 76 Task 3 tests and 13 index/barrel tests

```text
pnpm --filter @navigator/db lint
pnpm --filter @navigator/db typecheck
```

- Both exited 0 with strict TypeScript checks.

```text
pnpm --filter @navigator/db run preflight:basic-activation -- --help
```

- Exit 0
- Printed the usage line without invoking the client factory or a datastore.
- Only the expected Node 24 experimental loader/transform warnings were emitted.

```text
pnpm --filter @navigator/db test
```

- Exit 0
- 29 files passed
- 946 tests passed

```text
git diff --check
```

- Exit 0

No real datastore command was executed.

### Revised Count Contract

Every resolved port value is validated before insertion into the partial count map. It must have runtime type `number`, be finite, be a safe integer, and be greater than or equal to zero. Any invalid value immediately returns the frozen, redacted `PREFLIGHT_QUERY_FAILED` result with `errors: ["COUNT_QUERY_FAILED"]` and `counts: null`; earlier valid counts are discarded and later queries are not issued.

### Revised AST Contract

The TypeScript-compiler assertion now uses a test-local binding analyzer. It propagates Prisma roots through explicit `PrismaClient` types, client aliases, delegate aliases, variable assignments, object destructuring, static dot access, and static string/template element access. Dynamic element access is always a violation. `count` is allowed only when its immediate resolved owner is one of the ten known delegates, and `$disconnect` only when its immediate owner is the client. Mutation fixtures reject aliased/destructured find, write, raw, aggregate, groupBy, dynamic bracket, static bracket write, and unknown-delegate calls while unrelated `JSON.stringify` and process output calls remain ignored. Production contains no analyzer or test-only logic.

### Revised CLI Contract

The CLI runner is exported only from its package-private CLI module and accepts a Prisma client factory plus stdout/stderr sinks; no public package barrel changed. Help and argument validation return before factory invocation. Construction failure emits one lifecycle-failure JSON summary and performs no disconnect. Once construction succeeds, exactly one `$disconnect` is awaited in `finally`, including query failure. All operator output is buffered until disconnect completes, so disconnect failure suppresses a pending ready/legacy-blocker summary and emits exactly one redacted lifecycle-failure summary. Query rejection emits exactly one redacted `COUNT_QUERY_FAILED` summary after the single successful disconnect. All three failure modes return exit code 1 and expose no original error or secret.

### Self-Review

- Changes are limited to the two Task 3 production files, the Task 3 test, and this append-only report.
- No schema, model, package command, dependency, public barrel, data, migration, publication, import, permission, AI boundary, or unrelated file changed.
- Count validation happens before storage and fails closed without partial aggregate disclosure.
- The AST allowlist is based on resolved owner kind and known delegate identity, not textual path depth.
- CLI tests assert exact constructor, disconnect, stdout, and stderr counts for help, invalid arguments, ready, blocker, construction failure, query failure, and disconnect failure.
- The actual entrypoint still constructs `PrismaClient`, writes to process stdout/stderr, performs only delegate `count` calls, and awaits direct `$disconnect`.

### Concerns

- The authorized verification intentionally covered only `--help`; the real `-- ID` datastore path remains an external deployment gate.
- The required Node 24 loader/transform flags continue to emit experimental warnings on the help path.

### Fix SHA Correction

- The authoritative full code/test fix SHA is `6e007bbe173d3d3a4994b1a10a7edc12903072f8`; this supersedes the incorrectly expanded SHA earlier in this appended fix-wave section.
