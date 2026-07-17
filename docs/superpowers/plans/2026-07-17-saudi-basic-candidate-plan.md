# Saudi Arabia Basic Candidate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce one immutable, human-review-ready Saudi Arabia `BASIC` draft candidate without publishing canonical data or enabling AI use.

**Architecture:** Extend the exact version-controlled Basic source catalog with three Saudi official manual-document sources, bind them with the four existing World Bank deterministic sources, and run the existing v2 candidate composer. Commit only the catalog, exact four staging artifacts, lock tests, and status documentation; keep raw captures and review inputs under ignored `.cache/` paths.

**Tech Stack:** TypeScript strict mode, Vitest, pnpm workspace, existing `basic-manual-document-capture@1.0.0`, existing World Bank adapters, existing native no-replace candidate writer.

## Global Constraints

- Task card is exactly `DATA-BASIC-SA-COLLECT` on branch `feat/DATA-BASIC-SA-COLLECT-saudi-basic`.
- Country identity is exactly ISO2 `SA`, directory `saudi-arabia`, run ID `data-basic-sa-20260717-r1`.
- Candidate remains `reviewStatus: "draft"`, `aiUsable: false`, `humanDecision: null`, and `publicationRecommendation: "request-human-review"`.
- Do not create `data/saudi-arabia/`, approval receipts, manifests, Prisma rows, coverage activation, knowledge chunks, AI index content, or publication changes.
- Do not change `docs/data-schema.md`, Prisma schema, adapter implementations, dependencies, permission logic, or AI retrieval boundaries.
- The only committed candidate files are `source-register.json`, `extracted-facts.json`, `market-overview.draft.json`, and `review-report.json`.
- Every readable business field is bilingual `{ zh, en }`; every fact is source-bound; all three manual sources and all four World Bank sources must pass review with zero conflicts, blockers, or injection risks.
- All tests use pnpm, and no generated candidate file may overwrite an existing run.

---

### Task 1: Register Reviewed Saudi Official Sources

**Files:**
- Modify: `packages/db/catalog/basic-source-catalog.json`
- Modify: `packages/db/src/basic-source-catalog.test.ts`
- Modify: `docs/basic-source-catalog.md`

**Interfaces:**
- Consumes: `parseBasicSourceCatalog()`, `createBasicSourceExecutionPlan()`, and `resolveBasicSourceAdapter()` from the existing Basic source pipeline.
- Produces: catalog version `2026-07-17.1` with three sorted Saudi sources that resolve through `basic-manual-document-capture@1.0.0`.

- [ ] **Step 1: Write the failing catalog test**

Update the committed catalog test so its exact ordered source IDs are:

```ts
const sourceIds = [
  "indonesia-esdm-2025-performance",
  "indonesia-esdm-national-energy-policy-2025",
  "saudi-gastat-electrical-energy-statistics-2024",
  "saudi-gastat-renewable-energy-statistics-2024",
  "saudi-spa-energy-storage-2025",
  "vietnam-chinhphu-adjusted-pdp8-2025",
  "vietnam-evn-annual-report-2024-2025",
  "world-bank-country",
  "world-bank-gdp",
  "world-bank-gdp-growth",
  "world-bank-population",
] as const;
```

Add a focused test that creates an `SA` execution plan and asserts the exact requests below:

```ts
[
  {
    sourceId: "saudi-gastat-electrical-energy-statistics-2024",
    format: "pdf",
    url: "https://www.stats.gov.sa/documents/20117/2435281/Electrical%2BEnergy%2BStatistics%2B2024%2BEN.pdf/fe9d3d6f-809b-cdb9-7559-3f2a21f4e415?t=1765087585713",
    accept: "application/pdf",
  },
  {
    sourceId: "saudi-gastat-renewable-energy-statistics-2024",
    format: "html",
    url: "https://stats.gov.sa/en/w/news/63",
    accept: "text/html",
  },
  {
    sourceId: "saudi-spa-energy-storage-2025",
    format: "html",
    url: "https://www.spa.gov.sa/w2261911",
    accept: "text/html",
  },
]
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm --filter @navigator/db exec vitest run src/basic-source-catalog.test.ts
```

Expected: FAIL because catalog version `2026-07-17.1` and the three Saudi source IDs do not yet exist.

- [ ] **Step 3: Add the minimum catalog entries**

Insert the three source entries in lexical `sourceId` order, set `countryScope: ["SA"]`, `credibility: "OFFICIAL"`, `accessMode: "open"`, and use the existing manual-document adapter. Bind these field paths:

```json
{
  "saudi-gastat-electrical-energy-statistics-2024": [
    "country.summary",
    "marketOverview.energyDemand",
    "marketOverview.keyIndicators[0].label",
    "marketOverview.keyIndicators[0].unit",
    "marketOverview.keyIndicators[0].value",
    "marketOverview.keyIndicators[0].year",
    "marketOverview.keyIndicators[2].label",
    "marketOverview.keyIndicators[2].unit",
    "marketOverview.keyIndicators[2].value",
    "marketOverview.keyIndicators[2].year",
    "marketOverview.overview"
  ],
  "saudi-gastat-renewable-energy-statistics-2024": [
    "country.region",
    "country.summary",
    "marketOverview.industryTags",
    "marketOverview.keyIndicators[1].label",
    "marketOverview.keyIndicators[1].unit",
    "marketOverview.keyIndicators[1].value",
    "marketOverview.keyIndicators[1].year",
    "marketOverview.overview",
    "marketOverview.techTags"
  ],
  "saudi-spa-energy-storage-2025": [
    "country.summary",
    "marketOverview.industryTags",
    "marketOverview.overview",
    "marketOverview.renewableTarget",
    "marketOverview.techTags"
  ]
}
```

Use `allowedQueryParameters: ["t"]` only for the GASTAT PDF, empty query allowlists for the HTML sources, annual refresh for GASTAT sources, and event-driven refresh for SPA. Record that these are official publications with no asserted open-content license and factual extraction is attributed to the named authority.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the focused test, replace its temporary digest expectation with the exact SHA-256 returned by `parseBasicSourceCatalog()`, then run it again.

Expected: the catalog test passes with 11 source IDs, exact requests, version `2026-07-17.1`, and a locked digest.

- [ ] **Step 5: Update the catalog documentation**

Document the three Saudi sources, their formats, official publishers, field ownership, and the rule that HTML/PDF evidence is captured but never parsed into candidate facts without hash-bound human observation plans and reviews.

### Task 2: Materialize the Immutable Saudi Draft Candidate

**Files:**
- Create locally, do not commit: `.cache/basic-country/SA/data-basic-sa-20260717-r1/candidate-config.json`
- Create locally, do not commit: `.cache/basic-country/SA/data-basic-sa-20260717-r1/reviews/structured.json`
- Create locally, do not commit: `.cache/basic-country/SA/data-basic-sa-20260717-r1/reviews/manual.json`
- Create locally, do not commit: `.cache/basic-country/SA/data-basic-sa-20260717-r1/plans/*.json`
- Create locally, do not commit: `.cache/basic-country/SA/data-basic-sa-20260717-r1/editorial.json`
- Create: `data/staging/saudi-arabia/data-basic-sa-20260717-r1/source-register.json`
- Create: `data/staging/saudi-arabia/data-basic-sa-20260717-r1/extracted-facts.json`
- Create: `data/staging/saudi-arabia/data-basic-sa-20260717-r1/market-overview.draft.json`
- Create: `data/staging/saudi-arabia/data-basic-sa-20260717-r1/review-report.json`
- Create: `packages/db/src/saudi-arabia-basic-r1-candidate.test.ts`

**Interfaces:**
- Consumes: catalog version/digest from Task 1, real network captures in `raw-v2`, exact manual reviews, observation plans, and bilingual editorial input.
- Produces: a v2 audit bundle accepted by `validateBasicCollectionAuditBundleV2()` and stopped at the human-review gate.

- [ ] **Step 1: Write the failing candidate lock test**

Create the Saudi test using the Vietnam r3 lock-test structure. Before any candidate artifacts exist, assert loading `saudi-arabia/data-basic-sa-20260717-r1` succeeds and validates as ready for human review.

Also lock these intended business values:

```ts
const INDICATORS = [
  { label: { zh: "许可发电总装机容量", en: "Total licensed generation capacity" }, value: "92.5", unit: "GW", year: 2024 },
  { label: { zh: "可再生能源项目投运容量", en: "Operational renewable project capacity" }, value: "6551", unit: "MW", year: 2024 },
  { label: { zh: "电网受电量", en: "Electrical energy sent to the network" }, value: "402628", unit: "GWh", year: 2024 },
] as const;
```

The test must also require `coverageLevel: "BASIC"`, `reviewStatus: "draft"`, `aiUsable: false`, exact four files only, all seven source checks passed, zero injection risks/conflicts/blockers, `humanDecision: null`, no `data/saudi-arabia/`, no approval receipt, and no manifest.

- [ ] **Step 2: Run the Saudi lock test and verify RED**

Run:

```bash
pnpm --filter @navigator/db exec vitest run src/saudi-arabia-basic-r1-candidate.test.ts
```

Expected: FAIL because the Saudi staging run does not exist.

- [ ] **Step 3: Capture all seven exact sources**

Create the config with source IDs in this order:

```json
[
  "saudi-gastat-electrical-energy-statistics-2024",
  "saudi-gastat-renewable-energy-statistics-2024",
  "saudi-spa-energy-storage-2025",
  "world-bank-country",
  "world-bank-gdp",
  "world-bank-gdp-growth",
  "world-bank-population"
]
```

Run the candidate command once before reviews exist so the existing pipeline creates immutable `raw-v2` captures and stops without staging output:

```bash
NO_PROXY=localhost,127.0.0.1,::1 no_proxy=localhost,127.0.0.1,::1 NODE_USE_ENV_PROXY=1 NODE_OPTIONS=--use-env-proxy pnpm candidate:basic-country -- .cache/basic-country/SA/data-basic-sa-20260717-r1/candidate-config.json
```

Expected: non-zero review-input error after successful raw capture; `data/staging/saudi-arabia/data-basic-sa-20260717-r1/` must still be absent.

- [ ] **Step 4: Review the captured evidence and create exact inputs**

Bind every manual observation plan to the captured request URL, retrieval timestamp, content type, byte length, and SHA-256. Review these official facts without inference beyond the stated taxonomy mapping:

```json
{
  "electricalStatistics2024": {
    "licensedGenerationCapacityGW": 92.5,
    "energySentToNetworkGWh": 402628,
    "electricityConsumptionGWh": 340430,
    "energySentGrowthPercent": 5.7,
    "consumptionGrowthPercent": 4.1
  },
  "renewableStatistics2024": {
    "operationalRenewableCapacityMW": 6551,
    "solarCapacityMW": 6151,
    "windCapacityMW": 400,
    "operationalProjects": 10
  },
  "targets2030": {
    "renewableElectricitySharePercent": 50,
    "storageCapacityTargetGWh": 48,
    "storageProjectsTenderedGWh": 26
  }
}
```

Use `country.name = { "zh": "沙特阿拉伯", "en": "Saudi Arabia" }`, map the official country evidence to region `middle-east` with an explicit taxonomy-mapping uncertainty, use industry tags `["grid", "solar", "storage", "wind"]`, and tech tags `[]` because the reviewed sources do not support product-level technology taxonomy. Write concise bilingual summary, energy demand, overview, renewable target, and indicator labels that reproduce the numbers above without market-opportunity recommendations.

Set the GASTAT renewable source publication date to `2025-07-14T00:00:00.000Z` from the official dated news page and the SPA source publication date to `2025-02-14T00:00:00.000Z`; leave the GASTAT electrical PDF publication time `null` unless the captured document itself provides an exact publication timestamp. Every manual and structured source check must be `passed`, with `promptInjectionRisk: "none"` and no injection-risk entries.

- [ ] **Step 5: Compose the candidate exactly once**

Run the same command after all reviews/plans/editorial inputs are complete.

Expected: exit 0; exactly four staging files are written; the review report is ready for human review and no canonical/publication side effect exists.

- [ ] **Step 6: Lock generated identities and verify GREEN**

Replace the Saudi test's temporary catalog digest, retrieval timestamps, content hashes, source bindings, deterministic World Bank values, and four artifact hashes with the exact generated values. Run the focused Saudi test until it passes without changing generated artifacts.

### Task 3: Record Status and Verify the Task Card

**Files:**
- Modify: `docs/country-rollout.md`
- Modify: `docs/roadmap.md`
- Modify: `docs/basic-source-catalog.md`
- Test: all repository tests

**Interfaces:**
- Consumes: the immutable candidate and passing lock tests from Tasks 1-2.
- Produces: documentation that identifies Saudi Arabia as a draft candidate awaiting separate human publication approval.

- [ ] **Step 1: Update status documentation**

Record `DATA-BASIC-SA-COLLECT`, run `data-basic-sa-20260717-r1`, catalog version/digest, exact four staging artifacts, official-source split, and the explicit state: candidate ready for human review, not canonical, not published, not AI-usable. Preserve the rollout rule that the next action is a separate human decision followed by a separate `DATA-BASIC-SA-PUBLISH` task only if approved.

- [ ] **Step 2: Run focused validation**

```bash
pnpm --filter @navigator/db exec vitest run src/basic-source-catalog.test.ts src/saudi-arabia-basic-r1-candidate.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run repository gates**

```bash
pnpm lint
pnpm typecheck
pnpm test
```

Expected: all commands exit 0. Playwright is not required because this draft-only task changes no C-end behavior.

- [ ] **Step 4: Inspect the final scope**

```bash
git status --short
git diff --check
git diff --stat
git ls-files data/staging/saudi-arabia/data-basic-sa-20260717-r1
```

Expected: no raw cache is tracked; the staging path contains exactly four files; no canonical Saudi path, approval receipt, manifest, schema, AI, permission, or dependency file changed.

- [ ] **Step 5: Commit the reviewed task card**

```bash
git add docs/basic-source-catalog.md docs/country-rollout.md docs/roadmap.md docs/superpowers/plans/2026-07-17-saudi-basic-candidate-plan.md packages/db/catalog/basic-source-catalog.json packages/db/src/basic-source-catalog.test.ts packages/db/src/saudi-arabia-basic-r1-candidate.test.ts data/staging/saudi-arabia/data-basic-sa-20260717-r1/source-register.json data/staging/saudi-arabia/data-basic-sa-20260717-r1/extracted-facts.json data/staging/saudi-arabia/data-basic-sa-20260717-r1/market-overview.draft.json data/staging/saudi-arabia/data-basic-sa-20260717-r1/review-report.json
git commit -m "feat: collect Saudi Arabia Basic candidate"
```

Expected: one Conventional Commit containing only this task card.
