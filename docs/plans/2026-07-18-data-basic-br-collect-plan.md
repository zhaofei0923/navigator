# Brazil Basic Candidate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate the immutable, draft-only Brazil first-real-delivery BASIC candidate for `BR` / `brazil` / `data-basic-br-20260717-r1` with the native model-free pipeline.

**Architecture:** Use the reviewed catalog to fetch two official Brazilian HTML sources and four deterministic World Bank JSON sources into the ignored `raw-v2` cache. Bind manual document plans and source reviews to the exact fresh manifests, materialize exact bilingual editorial input, and let the native candidate writer create the only four committed staging artifacts.

**Tech Stack:** TypeScript, Vitest, pnpm/Turborepo, deterministic Basic v2 candidate CLI, Linux N-API atomic writer.

## Global Constraints

- Candidate only: `reviewStatus = draft`, `aiUsable = false`, and `humanDecision = null`; never create canonical data, an approval receipt, or a publication manifest.
- Commit exactly four files under `data/staging/brazil/data-basic-br-20260717-r1/`.
- Use only the six sorted source IDs fixed by the task and catalog `2026-07-17.2`.
- Preserve EPE and IPEA definitions and qualifiers; do not turn qualitative targets into numeric, electricity-specific, or legal claims.
- Use 2025 indicators `2.7%`, `64,793 MW`, and `34,707 MW`; exclude the conflicting renewable-share definitions and never present `20.4 TWh` as total supply.
- Keep `industryTags = ["solar", "wind"]` and `techTags = []`; make no opportunity or investment claims.
- Do not modify shared contracts, catalog, canonical data, approval/publication files, Prisma, Web/AI, dependencies, or permissions.
- Do not commit, merge, push, or publish.

---

### Task 1: Lock The Candidate Contract With TDD

**Files:**
- Create: `packages/db/src/brazil-basic-r1-candidate.test.ts`

- [x] Add a focused test for the exact run identity, six sources, 32 facts, bilingual semantics, three indicators, draft-only gate, exact four-file allowlist, and absence of canonical/approval/manifest output.
- [x] Run `pnpm --filter @navigator/db exec vitest run src/brazil-basic-r1-candidate.test.ts` and verify RED because the staging directory is absent.

### Task 2: Capture And Review Fresh Evidence

**Files:**
- Create ignored inputs beneath `.cache/basic-country/BR/data-basic-br-20260717-r1/`.

- [x] Create the exact candidate config, structured review, manual review, two capture-bound document plans, and editorial input using `apply_patch`.
- [x] Reuse the prior fresh raw-v2 captures through the candidate CLI and inspect all six `raw-v2/*/capture.json` manifests and payload hashes.
- [x] Confirm every response is at most `10,485,760` bytes and every retrieval identity is fresh for this run.

### Task 3: Generate And Bind The Candidate

**Files:**
- Generate exactly four files in `data/staging/brazil/data-basic-br-20260717-r1/`.
- Create: `docs/brazil-seed.md`
- Modify: `packages/db/src/brazil-basic-r1-candidate.test.ts`

- [x] Bind the manual review and plans to exact fresh timestamps, byte lengths, content hashes, and reviewed HTML locations, then rerun the native candidate command.
- [x] Record exact World Bank values/years, candidate artifact SHA-256 values, source bindings, facts, and semantic exclusions in the focused test and seed handoff document.
- [x] Verify the directory contains only `source-register.json`, `extracted-facts.json`, `market-overview.draft.json`, and `review-report.json`.

### Task 4: Verify Scope And Quality

- [x] Run the focused Vitest file.
- [x] Run `TURBO_FORCE=true pnpm lint`, `TURBO_FORCE=true pnpm typecheck`, and `TURBO_FORCE=true pnpm test`.
- [x] Run `git diff --check`, inspect `git status --short`, and confirm no files outside the hard scope are tracked or modified.
- [x] Report artifact hashes, fresh capture timestamps/hashes, World Bank values/years, test counts, and candidate-only caveats without committing or publishing.
