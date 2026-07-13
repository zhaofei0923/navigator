# Basic-first Documentation Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every current project document state that all countries, including Indonesia (`ID`), must complete a first real `BASIC` delivery before any separately approved `STANDARD` or `COMPLETE` upgrade.

**Architecture:** Keep the three coverage-level definitions intact, but separate current rollout policy from the existing synthetic Indonesia regression fixture. Put the binding Basic-first rule in the highest-level and operational documents, mark conflicting old plans as superseded, and add a focused Vitest guard against reintroducing the retired country-specific claims.

**Tech Stack:** Markdown, TypeScript, Vitest, pnpm workspace.

## Global Constraints

- All countries, including `ID`, have a first real delivery whose derived country coverage is exactly `BASIC`.
- A first Basic delivery has a qualifying `market-overview`; the other nine modules are `BUILDING`, have no published records, and Basic records remain `aiUsable = false` with no knowledge chunks.
- `STANDARD` and `COMPLETE` remain valid generic coverage levels, but may start only after that country's Basic acceptance in a separate, human-approved upgrade task.
- The existing `data/indonesia` files are an inherited synthetic regression fixture. This task must not describe them as current real country data, a rollout target, or a template to copy, and must not modify them.
- Do not change Prisma, shared types, coverage algorithms, application behavior, canonical/staging data, AI boundaries, permissions, dependencies, or the lockfile.
- Preserve historical implementation facts only when the containing plan is explicitly marked historical or superseded.

---

### Task 1: Align active documentation and add a regression guard

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/roadmap.md`
- Modify: `docs/country-rollout.md`
- Modify: `docs/indonesia-seed.md`
- Modify: `docs/product-brief.md`
- Modify: `docs/coverage-levels.md`
- Modify: `docs/data-schema.md`
- Modify: `docs/basic-country-collection.md`
- Modify: `docs/testing.md`
- Modify: `docs/superpowers/specs/2026-07-12-basic-source-boundary-design.md`
- Modify: `docs/superpowers/plans/2026-07-10-basic-country-collection-plan.md`
- Modify: `docs/superpowers/plans/2026-07-10-basic-country-template-validator-plan.md`
- Create: `tests/docs-basic-first-consistency.test.ts`

**Interfaces:**
- Consumes: the fixed `CoverageLevel` enum and existing Basic validator/candidate contracts.
- Produces: one unambiguous Basic-first documentation policy and a root test that protects it.

- [ ] **Step 1: Add the failing documentation consistency test**

Create `tests/docs-basic-first-consistency.test.ts`. Read repository files from `process.cwd()`. Require the active policy documents to contain the shared sentence `所有国家（包括 \`ID\`）的首次真实数据交付必须恰好为 \`BASIC\`。`, reject the retired country-specific claims listed below, and verify the operational collection documents retain the nine-module, `aiUsable = false`, no-knowledge, independent-human-approved-upgrade requirements.

```ts
const RETIRED_CLAIMS = [
  "印尼是首个完整样板国家",
  "印尼是首个 Complete 样板国家",
  "除既有 Complete 参考国家 `ID` 外",
  "`ID` 保持 Complete 参考样板",
  "印尼判定为 COMPLETE",
  "完整覆盖（印尼为样板）",
] as const;
```

The guard must not reject generic `COMPLETE` enum/threshold text or explicitly marked synthetic/historical fixture descriptions.

- [ ] **Step 2: Prove the guard detects the current contradiction**

Run:

```bash
pnpm exec vitest run tests/docs-basic-first-consistency.test.ts
```

Expected: FAIL because current active documents still contain retired Indonesia-Complete claims and do not all contain the Basic-first rule.

- [ ] **Step 3: Align the active policy documents**

Apply these exact semantics without changing model fields or algorithms:

- `AGENTS.md`: replace the Indonesia Complete product premise and copy-from-Indonesia rule with the country-neutral template and Basic-first rule; label `data/indonesia` as a legacy synthetic regression fixture.
- `docs/roadmap.md`: make P1 and `DATA-BASIC-<ISO2>` current work Basic-first; describe old Indonesia seed behavior only as historical regression coverage; make P2 country-detail acceptance exercise a Basic ten-module skeleton with nine `BUILDING` placeholders.
- `docs/country-rollout.md`: set the current rollout target to approved countries at Basic, include `ID` as the first real Basic validation country, and defer all Standard/Complete targets to separate approved upgrades.
- `docs/indonesia-seed.md`: distinguish the future real `DATA-BASIC-ID` delivery from the inherited synthetic fixture; forbid copying the fixture into another country or treating it as published real data; state the exact Basic acceptance shape.
- `docs/product-brief.md`, `docs/coverage-levels.md`, and `docs/basic-country-collection.md`: state the shared Basic-first sentence and upgrade gate; remove the `ID` exception while preserving generic coverage-level definitions.
- `docs/data-schema.md`: remove only the country-specific annotation from `COMPLETE`; do not alter the enum.
- `docs/testing.md`: call the existing Indonesia seed a legacy synthetic regression fixture rather than a rollout sample.
- `docs/superpowers/specs/2026-07-12-basic-source-boundary-design.md`: make the `DATA-BASIC-ID` r2 run explicitly Basic.

- [ ] **Step 4: Mark conflicting old plans as superseded**

Add a prominent status block near the top of both 2026-07-10 plans. State that their Indonesia-Complete assumptions are historical, are superseded by `DOCS-BASIC-FIRST-1`, and must not be used as current country rollout requirements. Do not rewrite the historical step-by-step record.

- [ ] **Step 5: Run focused documentation verification**

Run:

```bash
pnpm exec vitest run tests/docs-basic-first-consistency.test.ts tests/ci-gates.test.ts
rg -n "印尼是首个完整样板国家|印尼是首个 Complete 样板国家|除既有 Complete 参考国家 `ID` 外|`ID` 保持 Complete 参考样板|印尼判定为 COMPLETE|完整覆盖（印尼为样板）" AGENTS.md docs --glob '!docs/superpowers/plans/2026-07-10-basic-country-collection-plan.md' --glob '!docs/superpowers/plans/2026-07-10-basic-country-template-validator-plan.md'
```

Expected: both test files PASS; `rg` returns no matches in current policy documents.

- [ ] **Step 6: Run repository gates**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
```

Expected: all commands exit 0.

- [ ] **Step 7: Self-review and commit**

Confirm `git diff --check` passes, only the listed documentation/test/plan files changed, no real data or lockfile changed, and commit:

```bash
git add AGENTS.md docs tests/docs-basic-first-consistency.test.ts
git commit -m "docs: align country rollout to Basic first"
```
