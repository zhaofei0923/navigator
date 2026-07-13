# Indonesia Basic r2 Candidate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collect the first real Indonesia `BASIC` dataset with deterministic sources and generate an auditable four-file draft candidate for project-owner fact and translation review.

**Architecture:** Extend the approved Basic source catalog with two current Indonesian government sources, then run the existing model-free candidate CLI against four World Bank sources plus reviewed manual HTML/PDF evidence. All captured inputs remain in ignored raw cache. Only the four v2 candidate artifacts and focused tests are committed; canonical data, publication, AI ingestion, database state, and Web behavior remain unchanged.

**Tech Stack:** TypeScript strict mode, existing Basic collection catalog/capture/review/candidate modules, Node.js native capture helper, Vitest, pnpm workspace. No new dependencies.

## Global Constraints

- Read `AGENTS.md`, `docs/basic-country-collection.md`, `docs/basic-country-audit-contract.md`, `docs/data-schema.md`, and `docs/superpowers/specs/2026-07-12-basic-source-boundary-design.md` before editing.
- Work only in `/home/kevin/.codex-worktrees/navigator/DATA-BASIC-ID-r2` on `feat/DATA-BASIC-ID-r2-indonesia-basic` from commit `9b8c6be`.
- Use run ID exactly `data-basic-id-20260711-r2`; do not rewrite or reuse failed `r1` material.
- Use TDD for every tracked behavior change and preserve the RED/GREEN evidence in the implementation report.
- Use only four approved World Bank structured sources plus reviewed, current official Indonesian government HTML/PDF sources. Do not use Hermes, SearXNG, llama.cpp, a local model, prompts, completions, or generated claims.
- Keep `.cache/basic-country/ID/data-basic-id-20260711-r2/` ignored and uncommitted. Raw captures, review inputs, plans, and editorial inputs are evidence-building material, not repository artifacts.
- Commit exactly four generated candidate files under `data/staging/indonesia/data-basic-id-20260711-r2/`: `source-register.json`, `extracted-facts.json`, `market-overview.draft.json`, and `review-report.json`.
- Candidate values remain `reviewStatus: "draft"`, `aiUsable: false`, `humanDecision: null`, and ready only for human review.
- Do not modify `data/indonesia/`, create `collection-manifest.json`, write Prisma/database data, change coverage, publish data, create KnowledgeChunks, update AI indexes, or alter Web pages.
- Do not modify schemas, AI boundaries, permissions, billing, dependencies, lockfiles, or technical stack.
- Do not commit long verbatim source passages. Store concise structured facts and precise evidence locators.
- Do not merge this branch into `main` until the project owner explicitly approves the candidate's facts, bilingual wording, and sources.

## Approved Sources And Candidate Content

- Structured catalog sources: `world-bank-country`, `world-bank-gdp`, `world-bank-gdp-growth`, `world-bank-population`.
- Official market source: Ministry of Energy and Mineral Resources 2025 performance release, published 2026-01-09.
- Official policy source: Government Regulation No. 40/2025 on National Energy Policy, adopted 2025-09-15. This replaces the revoked Government Regulation No. 79/2014 and is the only policy target source used for current claims.
- Required country content: localized name and summary, `southeast-asia` region, and World Bank population/GDP/GDP-growth facts.
- Required market content: localized overview, demand statement, current renewable target, sorted industry tags, explicit empty equipment-level tech tags with uncertainty, and three complete 2025 indicators: renewable energy mix share, installed renewable capacity, and electricity consumption per capita.

---

### Task 1: Register Current Indonesia Government Sources

**Files:**
- Modify: `packages/db/catalog/basic-source-catalog.json`
- Modify: `packages/db/src/basic-source-catalog.test.ts`

- [ ] **Step 1: Add failing catalog tests**

Update committed-catalog expectations for a bumped catalog version and six sorted source IDs. Add an exact Indonesia plan test proving both manual sources resolve to fixed HTTPS requests, exact accepted media types, `ID` scope, open access, approved origins/query parameters, reviewed-document field ownership, and the generic `basic-manual-document-capture@1.0.0` adapter.

- [ ] **Step 2: Confirm RED**

```bash
PATH=/home/kevin/.nvm/versions/node/v24.18.0/bin:$PATH \
  pnpm --filter @navigator/db exec vitest run src/basic-source-catalog.test.ts
```

- [ ] **Step 3: Add the two source policies**

Register the official 2025 performance HTML page and current Regulation No. 40/2025 PDF. Keep catalog entries and every set-like array deterministically sorted. Record accurate copyright/license notes and factual-extraction attribution without claiming an open license.

- [ ] **Step 4: Confirm GREEN and commit**

```bash
PATH=/home/kevin/.nvm/versions/node/v24.18.0/bin:$PATH \
  pnpm --filter @navigator/db exec vitest run src/basic-source-catalog.test.ts
git add packages/db/catalog/basic-source-catalog.json packages/db/src/basic-source-catalog.test.ts
git commit -m "feat: register Indonesia Basic sources"
```

---

### Task 2: Generate And Lock The Indonesia r2 Candidate

**Files:**
- Create: `packages/db/src/indonesia-basic-r2-candidate.test.ts`
- Create: `data/staging/indonesia/data-basic-id-20260711-r2/source-register.json`
- Create: `data/staging/indonesia/data-basic-id-20260711-r2/extracted-facts.json`
- Create: `data/staging/indonesia/data-basic-id-20260711-r2/market-overview.draft.json`
- Create: `data/staging/indonesia/data-basic-id-20260711-r2/review-report.json`
- Ignored only: `.cache/basic-country/ID/data-basic-id-20260711-r2/**`

- [ ] **Step 1: Add a failing candidate regression test**

Load the exact candidate through `loadBasicCollectionAuditBundleVersioned()` and assert: v2 identities and catalog digest align; source IDs are exact and sorted; every required Basic path is present with valid evidence; the three indicator groups are complete; all sources passed checks; recommendation is ready for human review; `humanDecision` is null; draft is not published or AI-usable; no `collection-manifest.json` exists; and canonical `data/indonesia/` remains unchanged by the task.

- [ ] **Step 2: Confirm RED**

```bash
PATH=/home/kevin/.nvm/versions/node/v24.18.0/bin:$PATH \
  pnpm --filter @navigator/db exec vitest run src/indonesia-basic-r2-candidate.test.ts
```

- [ ] **Step 3: Capture immutable source material**

Create the exact ignored candidate config and placeholder reviews/plans/editorial inputs. Build the approved native helper, run the candidate CLI once to capture all sources, and expect it to stop before assembly. Read the resulting raw-v2 manifests to bind every review and observation to the exact catalog version, catalog SHA-256, content SHA-256, final URL, media type, byte length, and capture timestamp.

```bash
rm -f packages/db/.cache/native/basic-candidate-fs.node
PATH=/home/kevin/.nvm/versions/node/v24.18.0/bin:$PATH \
  pnpm --filter @navigator/db run build:basic-candidate-native
PATH=/home/kevin/.nvm/versions/node/v24.18.0/bin:$PATH \
  pnpm candidate:basic-country -- .cache/basic-country/ID/data-basic-id-20260711-r2/candidate-config.json
```

- [ ] **Step 4: Complete deterministic reviews and editorial facts**

Populate structured-source reviews for the four World Bank captures and reviewed-document plans/reviews for the official HTML/PDF captures. Use precise paragraph/page locators and compact numeric/object raw values. Add only bilingual claims supported by those captured sources; classify unsupported equipment-level technology tags as an explicit empty list with uncertainty.

- [ ] **Step 5: Generate exactly four candidate artifacts**

Rerun the candidate CLI. It must reuse the bound captures, validate the full v2 audit bundle, and report `basic candidate written`. Verify that staging contains exactly the four permitted files and raw cache remains ignored.

- [ ] **Step 6: Confirm GREEN, run focused validation, and commit**

```bash
PATH=/home/kevin/.nvm/versions/node/v24.18.0/bin:$PATH \
  pnpm --filter @navigator/db exec vitest run \
  src/indonesia-basic-r2-candidate.test.ts \
  src/basic-candidate-composition-integration.test.ts \
  src/basic-collection-versioned-loader.test.ts \
  src/basic-source-catalog.test.ts
git status --ignored --short
git add packages/db/src/indonesia-basic-r2-candidate.test.ts \
  data/staging/indonesia/data-basic-id-20260711-r2
git commit -m "data: collect Indonesia Basic r2 candidate"
```

---

### Task 3: Independent Review And Human-Review Handoff

- [ ] **Step 1: Run an independent specification review**

The reviewer checks the complete diff against `AGENTS.md`, the source-boundary design, this plan, source license/recency, exact metadata, bilingual claim/evidence alignment, deterministic ordering, candidate status, and forbidden-surface non-changes. Critical and Important findings must be fixed by a separate fix agent and re-reviewed.

- [ ] **Step 2: Run repository gates**

```bash
PATH=/home/kevin/.nvm/versions/node/v24.18.0/bin:$PATH pnpm lint
PATH=/home/kevin/.nvm/versions/node/v24.18.0/bin:$PATH pnpm typecheck
PATH=/home/kevin/.nvm/versions/node/v24.18.0/bin:$PATH pnpm test
```

No E2E run is required because this task changes no Web behavior. Confirm clean tracked state, exact commit scope, no untracked raw inputs, and no forbidden canonical/database/AI/Web diff.

- [ ] **Step 3: Stop at the project-owner gate**

Present the four-file candidate and a concise review checklist to the project owner. Do not merge or push `main`. After explicit approval in a later turn, re-run all gates, merge with `--no-ff`, re-run `pnpm lint`, `pnpm typecheck`, and `pnpm test` on `main`, push `origin/main`, and wait for GitHub Actions.
