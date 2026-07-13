# Task 1 Report: Extract the Pure Draft Assembler Without v1 Drift

## Status

Completed on `feat/DATA-BASIC-DETERMINISTIC-1` from base
`1ba855beee01d95d1de26563176a3ad66e300411`.

Commit: `2ac0376 refactor: extract deterministic Basic draft assembler`.

## Implementation

- Added `assembleBasicMarketOverviewDraft()` as an internal pure assembler.
- Moved legacy deterministic reconstruction, evidence grounding, indicator grouping,
  canonical draft parsing, and recursive freezing out of the llama bridge.
- Preserved the bridge request, model invocation, response parsing, error mapping,
  and v1 snapshot/parser behavior. The bridge maps an assembler `null` result to
  its existing `DRAFT_INPUT_BLOCKED` failure.
- The assembler owns an exact descriptor-safe input boundary. It uses the legacy
  v1 snapshot/parser for v1 material and bounded snapshots plus exact v2 envelope
  parsing for v2 material.
- v1 preserves zero-indicator compatibility. v2 requires a complete indicator at
  index 0 and only complete contiguous indicator groups.
- v2 rejects legacy-only `hermes` extraction methods while retaining v1 support.
- No public root exports, dependencies, Prisma/data/Web/AI/permission changes, or
  I/O/model/network behavior were added.

## TDD Evidence

### RED

Command:

```bash
source /home/kevin/.nvm/nvm.sh && pnpm --filter @navigator/db exec vitest run src/basic-market-overview-draft-assembler.test.ts src/basic-llama-draft-bridge.test.ts
```

Result: expected failure. The new assembler test suite failed to load
`./collection/basic-market-overview-draft-assembler.js` because the module did
not yet exist; the unchanged llama bridge suite passed all 96 tests.

### GREEN

Focused command:

```bash
source /home/kevin/.nvm/nvm.sh && pnpm --filter @navigator/db exec vitest run src/basic-market-overview-draft-assembler.test.ts src/basic-llama-draft-bridge.test.ts
```

Result: 2 files passed, 116 tests passed.

Required final regression command:

```bash
source /home/kevin/.nvm/nvm.sh && pnpm --filter @navigator/db exec vitest run src/basic-market-overview-draft-assembler.test.ts src/basic-llama-draft-bridge.test.ts src/basic-offline-dry-run.test.ts src/basic-offline-dry-run-exports.test.ts
```

Result: 4 files passed, 167 tests passed.

Repository checks:

```bash
source /home/kevin/.nvm/nvm.sh && pnpm lint
source /home/kevin/.nvm/nvm.sh && pnpm typecheck
source /home/kevin/.nvm/nvm.sh && pnpm test
git diff --check
```

Results: lint and typecheck completed successfully across all six packages; full
test completed successfully, including 1,699 `@navigator/db` tests; `git diff
--check` produced no output.

## Changed Files

- `packages/db/src/collection/basic-market-overview-draft-assembler.ts`
- `packages/db/src/basic-market-overview-draft-assembler.test.ts`
- `packages/db/src/collection/basic-llama-draft-bridge.ts`

`packages/db/src/basic-llama-draft-bridge.test.ts` required no edits because its
existing 96 assertions already characterize the bridge contract.

## Self-Review

- V1 normal/missing/conflict/untrusted fixtures are characterized directly.
- V1 zero-indicator compatibility is explicitly covered.
- V2 ready material covers all static facts, two ordered indicator groups, fixed
  draft locks, and country identity.
- Rejection coverage includes duplicate/missing/conflict facts, unsafe source,
  empty/orphan/inconsistent evidence, incomplete/gapped/zero indicators, legacy
  extraction method, malformed normalized values, mixed identity, accessors,
  proxies, and cycles.
- The new module is internal-only and the bridge's public function is unchanged.

## Concerns

None. Task 2 ownership and preflight rules were intentionally not introduced.

## Fix Round: Bound Basic Draft Assembler Inputs

### RED

Command:

```bash
source /home/kevin/.nvm/nvm.sh && pnpm --filter @navigator/db exec vitest run src/basic-market-overview-draft-assembler.test.ts
```

Result: expected failure. The focused suite ran 24 tests, with 21 passing and
3 failing: oversized nested string, oversized nested array, and hostile
`schemaVersion` accessor cases all observed two calls to the legacy snapshot.

### GREEN

Command:

```bash
source /home/kevin/.nvm/nvm.sh && pnpm --filter @navigator/db exec vitest run src/basic-market-overview-draft-assembler.test.ts
```

Result: 1 file passed, 24 tests passed. The exact-v1 fixture still exercised
the compatibility snapshot/parser path; v2 regressions used only the bounded
snapshot path and the hostile accessor was not executed.

Required regression command:

```bash
source /home/kevin/.nvm/nvm.sh && pnpm --filter @navigator/db exec vitest run src/basic-market-overview-draft-assembler.test.ts src/basic-llama-draft-bridge.test.ts src/basic-offline-dry-run.test.ts src/basic-offline-dry-run-exports.test.ts
```

Result: 4 files passed, 171 tests passed. `pnpm --filter @navigator/db typecheck`
passed, and `git diff --check` was clean.

### Files

- `packages/db/src/collection/basic-market-overview-draft-assembler.ts`
- `packages/db/src/basic-market-overview-draft-assembler.test.ts`

### Commit

`4837979 fix: bound Basic draft assembler inputs`
