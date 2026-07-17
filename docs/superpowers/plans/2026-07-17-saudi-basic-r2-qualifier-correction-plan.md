# Saudi Arabia Basic R2 Qualifier Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a new immutable Saudi Arabia `r2` draft candidate that preserves the official approximate qualifiers omitted by `r1`, without modifying or publishing `r1`.

**Architecture:** Treat `data-basic-sa-20260717-r1` as an immutable superseded audit bundle, perform fresh seven-source `raw-v2` capture for `data-basic-sa-20260717-r2`, and compose a new exact four-file candidate through the existing native no-replace writer. A new lock test protects both the unchanged `r1` hashes and the corrected `r2` evidence, wording, uncertainty, identities, and hashes.

**Tech Stack:** TypeScript strict mode, Vitest, pnpm workspace, existing Basic v2 candidate pipeline, existing manual-document and World Bank adapters, existing native no-replace writer.

## Global Constraints

- This is a corrective slice inside `DATA-BASIC-SA-COLLECT` on `feat/DATA-BASIC-SA-COLLECT-saudi-basic`.
- Corrected identity is exactly ISO2 `SA`, directory `saudi-arabia`, run ID `data-basic-sa-20260717-r2`.
- Never edit, delete, regenerate, approve, or publish `data-basic-sa-20260717-r1`; its four hashes remain locked.
- `r2` remains `reviewStatus: "draft"`, `aiUsable: false`, `humanDecision: null`, and `publicationRecommendation: "request-human-review"`.
- Do not create canonical `data/saudi-arabia/`, approval receipts, manifests, Prisma rows, coverage activation, knowledge chunks, AI index content, or publication changes.
- Do not change the source catalog, data schema, Prisma schema, adapters, dependencies, permissions, or AI boundaries.
- The `r2` staging directory contains exactly `source-register.json`, `extracted-facts.json`, `market-overview.draft.json`, and `review-report.json`.
- Fresh `r2` captures and reviews are required; do not bind `r2` plans to `r1` capture timestamps or hashes.
- Every readable field remains bilingual and every fact source-bound, with seven passed source checks and zero blockers, conflicts, missing fields, or injection risks.
- The GASTAT `≈92.5 GW` and `≈340,430 GWh` qualifiers must be visible in C-end bilingual wording and recorded in extracted-fact uncertainty; `up to 48 GWh` and `approximately 5.7%` remain preserved.

---

### Task 1: Compose the Immutable R2 Correction

**Files:**
- Create locally, do not commit: `.cache/basic-country/SA/data-basic-sa-20260717-r2/candidate-config.json`
- Create locally, do not commit: `.cache/basic-country/SA/data-basic-sa-20260717-r2/reviews/structured.json`
- Create locally, do not commit: `.cache/basic-country/SA/data-basic-sa-20260717-r2/reviews/manual.json`
- Create locally, do not commit: `.cache/basic-country/SA/data-basic-sa-20260717-r2/plans/*.json`
- Create locally, do not commit: `.cache/basic-country/SA/data-basic-sa-20260717-r2/editorial.json`
- Create: `data/staging/saudi-arabia/data-basic-sa-20260717-r2/source-register.json`
- Create: `data/staging/saudi-arabia/data-basic-sa-20260717-r2/extracted-facts.json`
- Create: `data/staging/saudi-arabia/data-basic-sa-20260717-r2/market-overview.draft.json`
- Create: `data/staging/saudi-arabia/data-basic-sa-20260717-r2/review-report.json`
- Create: `packages/db/src/saudi-arabia-basic-r2-candidate.test.ts`
- Create: `docs/superpowers/plans/2026-07-17-saudi-basic-r2-qualifier-correction-plan.md`

**Interfaces:**
- Consumes: catalog `2026-07-17.1` with SHA-256 `3c174b76efe8c637436c52f473911d6409d79ac2e057eb251bb860dba4c417e7`, the same seven approved source IDs, and fresh r2 captures.
- Produces: a new valid v2 bundle at the human-review gate while proving the r1 bundle remains byte-identical.

- [ ] **Step 1: Write and run the failing r2 lock test**

Create the r2 test from the established r1/Vietnam pattern. Before capture or staging, require loading `saudi-arabia/data-basic-sa-20260717-r2`; lock these unchanged r1 artifact hashes:

```ts
const R1_ARTIFACT_HASHES = {
  "extracted-facts.json": "7a423661d5b7bd2d43c7f81b39131eeea47fb82cf62624343d976128eb4d36d1",
  "market-overview.draft.json": "567821ee55b5fd04cf4db198ee8a25629ec459a8f4542ae57185d478b800c92a",
  "review-report.json": "a375cc5b759f3e1b619a3c1826adb0eaad48c5779a44a816a387fd021e301ee9",
  "source-register.json": "fcc3de285225f2e26a04f82b72e53caf69df605971fd2eb10b0eacbe2e884711",
} as const;
```

Require the corrected bilingual values:

```ts
const SUMMARY = {
  zh: "沙特阿拉伯2024年许可发电总装机容量约为92.5吉瓦，可再生能源项目投运容量为6,551兆瓦，电网受电量为402,628吉瓦时。官方资料列明了2030年可再生能源发电占比和储能容量目标。",
  en: "Saudi Arabia had approximately 92.5 GW of total licensed generation capacity, 6,551 MW of operational renewable project capacity, and 402,628 GWh of electrical energy sent to the network in 2024. Official sources state renewable generation and storage capacity targets for 2030.",
} as const;

const ENERGY_DEMAND = {
  zh: "2024年电网受电量为402,628吉瓦时，较2023年约增长5.7%；用电量约为340,430吉瓦时，同比增长4.1%。",
  en: "Electrical energy sent to the network was 402,628 GWh in 2024, approximately 5.7% higher than in 2023; electricity consumption was approximately 340,430 GWh, an annual increase of 4.1%.",
} as const;
```

The overview must begin with `2024年许可发电总装机容量约为92.5吉瓦。` / `Total licensed generation capacity was approximately 92.5 GW in 2024.` The first indicator label is `{ zh: "许可发电总装机容量（约）", en: "Total licensed generation capacity (approx.)" }` with value `"92.5"`, unit `GW`, and year `2024`.

Run:

```bash
pnpm --filter @navigator/db exec vitest run src/saudi-arabia-basic-r2-candidate.test.ts
```

Expected: FAIL because the r2 staging bundle does not exist, while the r1 hash assertion passes.

- [ ] **Step 2: Capture fresh r2 raw evidence**

Create an r2 config with the same seven source IDs in deterministic order. Before the post-review composition attempt, verify `data/staging` and `data/staging/saudi-arabia` are mode `0700`; adjust only those local directory modes if needed, before any post-input invocation.

Run once with review inputs intentionally absent:

```bash
NO_PROXY=localhost,127.0.0.1,::1 no_proxy=localhost,127.0.0.1,::1 NODE_USE_ENV_PROXY=1 NODE_OPTIONS=--use-env-proxy pnpm candidate:basic-country -- .cache/basic-country/SA/data-basic-sa-20260717-r2/candidate-config.json
```

Expected: seven fresh content-addressed captures and a non-zero missing-review error; r2 staging remains absent and r1 hashes remain unchanged.

- [ ] **Step 3: Create hash-bound corrected reviews, plans, and editorial input**

Bind all plans to the fresh r2 request URL, retrieval time, content type, byte length, and SHA-256. In the electrical observation plan, record:

```json
{
  "licensedGenerationCapacityGW": 92.5,
  "licensedGenerationCapacityQualifier": "approximately",
  "electricityConsumptionGWh": 340430,
  "electricityConsumptionQualifier": "approximately",
  "energySentToNetworkGWh": 402628,
  "energySentGrowthPercent": 5.7,
  "energySentGrowthQualifier": "approximately",
  "consumptionGrowthPercent": 4.1
}
```

Use these exact uncertainty strings on the affected editorial/source facts:

```ts
const CAPACITY_UNCERTAINTY =
  "The source reports total licensed generation capacity as approximately 92.5 GW.";
const CONSUMPTION_UNCERTAINTY =
  "The source reports electricity consumption as approximately 340,430 GWh.";
```

Apply `CAPACITY_UNCERTAINTY` to `country.summary`, `marketOverview.overview`, and `marketOverview.keyIndicators[0].label/value`. Apply `CONSUMPTION_UNCERTAINTY` to `marketOverview.energyDemand`. Preserve the r1 renewable, target, taxonomy, dates, bilingual language, and non-recommendation decisions only where fresh raw evidence still supports them.

- [ ] **Step 4: Compose r2 exactly once after inputs are complete**

Run the same candidate command once. Expected: exit 0 and exactly four r2 staging files. Do not rerun or modify the generated r2 bundle.

- [ ] **Step 5: Lock identities, qualifiers, uncertainties, and verify**

Replace temporary r2 test values with actual fresh source bindings, current World Bank values, artifact hashes, and collection timestamps. Assert:

- r1 file list and hashes remain exactly `R1_ARTIFACT_HASHES`;
- r2 validates as ready for human review with 7 sources and 32 facts;
- all corrected bilingual text equals the constants above;
- the four affected fact uncertainties equal the required uncertainty strings;
- `reviewStatus` is draft, `aiUsable` is false, and `humanDecision` is null;
- r2 has exactly four files and no canonical/approval/manifest path.

Run focused r1/r2/catalog tests, DB typecheck, and `git diff --check`. Commit only the r2 plan, four r2 artifacts, and r2 test with:

```bash
git commit -m "fix: preserve Saudi source qualifiers"
```

### Task 2: Mark R1 Superseded and R2 Review-Ready

**Files:**
- Modify: `docs/basic-source-catalog.md`
- Modify: `docs/country-rollout.md`
- Modify: `docs/roadmap.md`
- Modify: `docs/superpowers/plans/2026-07-17-saudi-basic-candidate-plan.md`

**Interfaces:**
- Consumes: immutable r1 and validated r2 from Task 1.
- Produces: status documentation that permits later human review of r2 only.

- [ ] **Step 1: Update status without rewriting history**

Document r1 as immutable and superseded before approval because two official approximate qualifiers were omitted. Record r2 catalog identity, fresh source identities, exact four artifact hashes, valid/ready-for-human-review state, and draft/AI/human-decision boundaries. Add a correction record to the original r1 plan pointing to this r2 plan. State that only a separate human decision may authorize a future `DATA-BASIC-SA-PUBLISH` task for r2; r1 must never be published.

- [ ] **Step 2: Run all gates and inspect scope**

```bash
pnpm --filter @navigator/db exec vitest run src/basic-source-catalog.test.ts src/saudi-arabia-basic-r1-candidate.test.ts src/saudi-arabia-basic-r2-candidate.test.ts src/vietnam-basic-r3-candidate.test.ts
pnpm lint
pnpm typecheck
pnpm test
git diff --check
```

Expected: all pass. Verify both r1 and r2 have exactly four tracked files, raw cache is ignored, and no prohibited path changed.

- [ ] **Step 3: Commit status correction**

```bash
git add docs/basic-source-catalog.md docs/country-rollout.md docs/roadmap.md docs/superpowers/plans/2026-07-17-saudi-basic-candidate-plan.md
git commit -m "docs: mark Saudi r2 ready for review"
```

Expected: one docs-only commit; r1 and r2 artifacts remain unchanged from Task 1.
