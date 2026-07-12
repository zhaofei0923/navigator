# Whole-branch Important final fix

Status: GREEN

Commit target: `fix: bind Basic document captures to runner provenance`

## RED

Command:

```text
pnpm --filter @navigator/db exec vitest run src/basic-document-observation.test.ts -t "rejects self-consistent handmade document captures"
```

Observed on the pre-fix implementation: 1 failed, 96 skipped. The regression
failed with `expected [Function] to throw an error`, proving that a handmade,
self-consistent manifest/capture could materialize successfully.

## GREEN

- Focused runner/document/catalog/raw-v2/review/v2-fact matrix: 6 files,
  489 tests passed.
- Full `@navigator/db` test suite: 35 files, 1,457 tests passed.
- `@navigator/db` typecheck: passed under Node 24.18.0 / pnpm 11.10.0.
- `git diff --check`: passed.

The successful document-materialization fixtures use the real v2 plan runner,
fake transport, and raw-v2 cache. Handmade, spread, JSON-cloned, cross-plan,
cross-catalog, and cross-run captures fail closed.

Concerns: none identified.
