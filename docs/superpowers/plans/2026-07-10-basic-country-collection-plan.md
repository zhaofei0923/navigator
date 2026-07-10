# Basic Country Collection Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the repository's Basic-first country collection standard and define the independently reviewable follow-up task cards for template validation, collection tooling, and one-country-at-a-time rollout.

**Architecture:** Keep research artifacts outside the canonical country seed until validation and human review are complete. Deterministic collectors acquire structured facts, Hermes discovers and captures source evidence, the local llama.cpp model performs schema-constrained extraction and bilingual drafting, and Codex validates repository data before publication.

**Tech Stack:** Markdown specifications, Hermes Agent with SearXNG and browser tools, llama.cpp OpenAI-compatible API, Qwen local model, TypeScript/pnpm validation in later task cards.

## Global Constraints

- All countries use the fixed 10-module model from `docs/data-schema.md`; this task does not change that model.
- Every target country enters the product at `BASIC` before any selected country is upgraded to `STANDARD` or `COMPLETE`.
- `market-overview` must be `PARTIAL` or `COMPLETE`; the remaining modules may stay `BUILDING` with no fabricated placeholder records.
- All display text uses `{ zh, en }`; every publishable business record carries the required metadata.
- SearXNG is discovery-only. Search snippets are not accepted as evidence; Hermes must open the original source with browser/extraction tooling.
- Local-model output is always a draft. Agents cannot promote data to `published` or enable `aiUsable` without human review.
- Basic country data remains `aiUsable = false` and produces no AI knowledge chunks in this phase.
- The final 30-50-country list, country order, and coverage upgrades remain human decisions.
- No new dependency, data-model field, AI retrieval boundary, permission rule, or billing rule is introduced.
- One country seed is one task card, one feature branch, one review cycle, and one merge to `main`.

---

### Task 1: Document the Basic-first collection and rollout contract

**Files:**
- Create: `docs/basic-country-collection.md`
- Modify: `docs/country-rollout.md`
- Modify: `docs/roadmap.md`

**Interfaces:**
- Consumes: `docs/data-schema.md`, `docs/coverage-levels.md`, `docs/data-governance.md`, `docs/indonesia-seed.md`, and the approved Windows llama.cpp plus WSL Hermes Agent architecture.
- Produces: the normative collection workflow for `P1-5`, `P1-6`, and `DATA-BASIC-<ISO2>` task cards.

- [ ] **Step 1: Create the Basic collection standard**

Write `docs/basic-country-collection.md` with these binding sections:

1. Scope and completion definition for `country.json` and `market-overview.json`.
2. Required source families and field-to-source ownership.
3. Research architecture and strict responsibilities for deterministic collectors, Hermes, SearXNG, browser tools, the local model, Codex, review agents, and humans.
4. Staging artifacts: raw cache, source register, extracted facts, bilingual draft, and review report.
5. `draft -> pending -> published` gates, including `aiUsable = false` for Basic data.
6. Conflict, missing-data, access-control, prompt-injection, and stale-data handling.
7. Per-country acceptance checklist and six-month Basic review cadence.
8. Pilot order `VN`, `SA`, `AE`, `BR`, `ZA`, explicitly marked as a proposed order requiring human confirmation before data work begins.

- [ ] **Step 2: Align country rollout with Basic-first delivery**

Update `docs/country-rollout.md` so `VN`, `SA`, `AE`, and `BR` enter at Basic before later Standard promotion. Keep `ID` as the Complete reference, keep the 30-50-country list as a human confirmation item, and link to `docs/basic-country-collection.md` as the collection procedure.

- [ ] **Step 3: Add executable follow-up task cards**

Update `docs/roadmap.md` with:

- `P1-5 Basic 国家模板与通用校验器`: no data-model change; validates optional absent object records for `BUILDING`, empty list modules, metadata, bilingual fields, and derived coverage.
- `P1-6 Basic 数据采集管道`: deterministic source adapters, source register, llama.cpp schema-constrained draft generation, and offline fixtures; any CSV parser dependency requires separate human approval.
- `DATA-BASIC-<ISO2>`: one country per task card/branch, initially `draft`, then human-reviewed publication, with repository and representative Web checks.

- [ ] **Step 4: Check documentation consistency**

Run:

```bash
rg -n "Basic|BASIC|P1-5|P1-6|DATA-BASIC|aiUsable|SearXNG|llama.cpp|Hermes" docs/basic-country-collection.md docs/country-rollout.md docs/roadmap.md
```

Expected: the three documents consistently describe Basic-first rollout, discovery-only search, human publication, and one-country task cards.

- [ ] **Step 5: Run repository verification**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
```

Expected: all commands exit with code 0.

- [ ] **Step 6: Commit the task card**

```bash
git add docs/basic-country-collection.md docs/country-rollout.md docs/roadmap.md docs/superpowers/plans/2026-07-10-basic-country-collection-plan.md
git commit -m "docs: define Basic-first country collection"
```
