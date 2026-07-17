# Saudi Arabia Basic Atomic Publication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the explicitly approved `SA` / `saudi-arabia` / `data-basic-sa-20260717-r2` candidate as the repository's canonical `BASIC` Saudi Arabia dataset without modifying either Saudi candidate or enabling AI.

**Architecture:** Reuse the country-generic Basic v2 publication gate already used by Indonesia and Vietnam. Bind the immutable r2 candidate to an external approval receipt, derive the two canonical product records plus the six-field manifest, register the canonical records in the existing Web seed registry, and verify DB, API, bilingual UI, and E2E boundaries. The superseded r1 run remains immutable audit history and must have no approval receipt or publication role.

**Tech Stack:** TypeScript strict mode, Vitest, Next.js App Router, Playwright, pnpm workspace, existing Basic v2 publication loader/validator.

## Global Constraints

- The approved identity is exactly `saudi-arabia` / `SA` / `data-basic-sa-20260717-r2`.
- The user approved publication as `BASIC` with `aiUsable = false`; this does not authorize `STANDARD`, `COMPLETE`, AI retrieval, schema changes, or dependency changes.
- `data-basic-sa-20260717-r1` is superseded immutable audit history and must never receive an approval receipt, become active, or be used as publication input.
- The r2 candidate directory must remain byte-identical and contain exactly four files.
- Canonical `market-overview.json` must equal the approved draft except for `reviewStatus: "published"`.
- Canonical `country.json` must have one `COMPLETE` `market-overview` module and nine `BUILDING` modules with zero data, deriving exactly `BASIC`.
- No KnowledgeChunk, deeper-module record, AI index, Prisma schema change, new dependency, permission change, or datastore mutation is allowed.
- Approval identity is `reviewerId = "github:zhaofei0923"`; `submittedAt` and `decidedAt` are both `2026-07-17T13:21:53.000Z`.
- All UI-facing content remains bilingual and existing UI strings continue to use i18n keys.

---

### Task 1: Bind the Approved r2 Candidate and Publish Canonical Basic Data

**Files:**
- Create: `packages/db/src/saudi-arabia-basic-publication.test.ts`
- Create: `data/approvals/saudi-arabia/data-basic-sa-20260717-r2.json`
- Create: `data/saudi-arabia/country.json`
- Create: `data/saudi-arabia/market-overview.json`
- Create: `data/saudi-arabia/collection-manifest.json`
- Modify: `packages/db/src/approved-basic-publications-validation.test.ts`

**Interfaces:**
- Consumes: `loadApprovedBasicCountryPublicationV2(repositoryRoot, countryDirectory)` and the immutable r2 four-file candidate.
- Produces: one valid approved canonical publication at `data/saudi-arabia/` and one external receipt at `data/approvals/saudi-arabia/data-basic-sa-20260717-r2.json`.

- [ ] **Step 1: Write the failing publication lock test**

Create `saudi-arabia-basic-publication.test.ts` following the existing loader-level publication contract. Lock these exact candidate hashes:

```ts
const CANDIDATE_HASHES = {
  "source-register.json": "b242dc902b7002dc3a2cec1bd87703760d776ada2b5c301329543b1f5945353d",
  "extracted-facts.json": "bd0df36ba29453e0d337ad8401310c443ff26686cc8efc06994902b017814072",
  "market-overview.draft.json": "2a297d007279afb80baeb316581aca874738ce614443a2a7944ad576e32c6285",
  "review-report.json": "c8677f1bac448aa87ec79e35f3ffb9fc5b15c615f2b47ab3072ed588e09e6f9d",
} as const;
```

The test must assert:

```ts
expect(existsSync(join(REPO_ROOT, "data", "approvals", "saudi-arabia", "data-basic-sa-20260717-r1.json"))).toBe(false);
expect(manifest.activeRunId).toBe("data-basic-sa-20260717-r2");
expect(receipt).toMatchObject({
  countryDirectory: "saudi-arabia",
  countryCode: "SA",
  runId: "data-basic-sa-20260717-r2",
  reviewerId: "github:zhaofei0923",
  submission: { submittedAt: "2026-07-17T13:21:53.000Z" },
  decidedAt: "2026-07-17T13:21:53.000Z",
  artifactSha256: CANDIDATE_HASHES,
});
```

It must also require the canonical directory allowlist `collection-manifest.json`, `country.json`, `market-overview.json`; loader validity; `coverageLevel: "BASIC"`; bilingual Saudi name and summary; `middle-east`; `reviewStatus: "published"`; `aiUsable: false`; one complete market overview; nine building modules; and empty deep/knowledge data.

- [ ] **Step 2: Run the test and confirm RED**

Run:

```bash
pnpm --filter @navigator/db exec vitest run src/saudi-arabia-basic-publication.test.ts
```

Expected: FAIL because the approval receipt and canonical Saudi directory do not exist.

- [ ] **Step 3: Create the external approval receipt**

Create the strict receipt with exactly the Basic publication contract keys:

```json
{
  "schemaVersion": "basic-country-publication-approval/v1",
  "countryDirectory": "saudi-arabia",
  "countryCode": "SA",
  "runId": "data-basic-sa-20260717-r2",
  "submission": {
    "fromReviewStatus": "draft",
    "toReviewStatus": "pending",
    "submittedAt": "2026-07-17T13:21:53.000Z"
  },
  "decision": "approved",
  "reviewerId": "github:zhaofei0923",
  "decidedAt": "2026-07-17T13:21:53.000Z",
  "authorizedPublication": {
    "coverageLevel": "BASIC",
    "fromReviewStatus": "pending",
    "toReviewStatus": "published",
    "aiUsable": false
  },
  "artifactSha256": {
    "source-register.json": "b242dc902b7002dc3a2cec1bd87703760d776ada2b5c301329543b1f5945353d",
    "extracted-facts.json": "bd0df36ba29453e0d337ad8401310c443ff26686cc8efc06994902b017814072",
    "market-overview.draft.json": "2a297d007279afb80baeb316581aca874738ce614443a2a7944ad576e32c6285",
    "review-report.json": "c8677f1bac448aa87ec79e35f3ffb9fc5b15c615f2b47ab3072ed588e09e6f9d"
  }
}
```

- [ ] **Step 4: Create deterministic canonical records**

Create `country.json` from the six approved country facts:

```json
{
  "code": "SA",
  "name": { "en": "Saudi Arabia", "zh": "沙特阿拉伯" },
  "summary": {
    "en": "Saudi Arabia had approximately 92.5 GW of total licensed generation capacity, 6,551 MW of operational renewable project capacity, and 402,628 GWh of electrical energy sent to the network in 2024. Official sources state renewable generation and storage capacity targets for 2030.",
    "zh": "沙特阿拉伯2024年许可发电总装机容量约为92.5吉瓦，可再生能源项目投运容量为6,551兆瓦，电网受电量为402,628吉瓦时。官方资料列明了2030年可再生能源发电占比和储能容量目标。"
  },
  "region": "middle-east",
  "flagEmoji": "🇸🇦",
  "updatedAt": "2025-07-14T00:00:00.000Z",
  "coverageLevel": "BASIC",
  "moduleCoverage": []
}
```

Populate `moduleCoverage` in the fixed ten-module order: `market-overview` is `COMPLETE`, `dataCount: 1`; the remaining nine modules are `BUILDING`, `dataCount: 0`; every entry uses `updatedAt: "2025-07-14T00:00:00.000Z"`.

Create `market-overview.json` by copying every r2 draft field exactly and changing only:

```json
"reviewStatus": "published"
```

Keep `aiUsable: false`, the approximate qualifiers, source metadata, tags, and key indicators byte-semantically unchanged.

- [ ] **Step 5: Bind the receipt in manifest v2**

Compute SHA-256 over the exact receipt bytes and create:

```json
{
  "schemaVersion": "basic-country-publication-manifest/v2",
  "activeRunId": "data-basic-sa-20260717-r2",
  "mappingVersion": "basic-country-canonical/v2",
  "auditBundlePath": "data/staging/saudi-arabia/data-basic-sa-20260717-r2",
  "approvalReceiptPath": "data/approvals/saudi-arabia/data-basic-sa-20260717-r2.json",
  "approvalReceiptSha256": "b09aca2ea28e507977ab977246acdf0fc61c17337ddd7646e6b17b516b2ee5bc"
}
```

This digest assumes the exact two-space-indented receipt key order shown in Step 3 and one trailing LF. Recompute it from the committed receipt bytes and fail the task if it differs.

- [ ] **Step 6: Extend all-publication validation and verify GREEN**

Update `approved-basic-publications-validation.test.ts` to expect:

```ts
{
  countryDirectories: ["indonesia", "saudi-arabia", "vietnam"],
  countryCodes: ["ID", "SA", "VN"],
}
```

Run:

```bash
pnpm --filter @navigator/db exec vitest run src/saudi-arabia-basic-publication.test.ts src/approved-basic-publications-validation.test.ts src/saudi-arabia-basic-r2-candidate.test.ts
pnpm --filter @navigator/db validate:approved-basic-publications
```

Expected: all tests pass and validation prints the three exact directories/codes.

- [ ] **Step 7: Commit Task 1**

```bash
git add data/saudi-arabia data/approvals/saudi-arabia packages/db/src/saudi-arabia-basic-publication.test.ts packages/db/src/approved-basic-publications-validation.test.ts
git commit -m "feat: publish Saudi Arabia Basic data"
```

---

### Task 2: Register Saudi Arabia in Web, API, Import, and E2E Flows

**Files:**
- Modify: `apps/web/src/features/countries/country-seed-registry.ts`
- Modify: `apps/web/src/features/countries/country-service.test.ts`
- Modify: `apps/web/src/app/api/v1/countries/route.test.ts`
- Modify: `tests/node-ts-source-commands.test.ts`
- Modify: `tests/e2e/country-explorer.e2e.ts`

**Interfaces:**
- Consumes: the canonical Saudi `country.json` and `market-overview.json` from Task 1.
- Produces: a third published Web country, API/import coverage, and bilingual Saudi browser verification.

- [ ] **Step 1: Write failing registry/API expectations**

Extend tests to require the published catalog order `["ID", "VN", "SA"]`, localized names `["Indonesia", "Viet Nam", "Saudi Arabia"]`, raw Saudi name `{ zh: "沙特阿拉伯", en: "Saudi Arabia" }`, total `3`, and filter regions `["southeast-asia", "middle-east"]`. Add a service test that loads `SA` in English and Chinese, preserves `BASIC`, renders the approximate `92.5 GW` summary, and returns `BUILDING`/empty AI advisor data.

Update the root command test to import `indonesia`, `vietnam`, and `saudi-arabia`, while expecting the build validation's sorted identity:

```text
{"countryDirectories":["indonesia","saudi-arabia","vietnam"],"countryCodes":["ID","SA","VN"]}
```

- [ ] **Step 2: Run focused tests and confirm RED**

Run:

```bash
pnpm --filter @navigator/web exec vitest run src/features/countries/country-service.test.ts src/app/api/v1/countries/route.test.ts
pnpm exec vitest run tests/node-ts-source-commands.test.ts
```

Expected: FAIL because the Web registry does not yet include Saudi Arabia.

- [ ] **Step 3: Register canonical Saudi seed data**

Import `data/saudi-arabia/country.json` and `data/saudi-arabia/market-overview.json` in `country-seed-registry.ts`. Create the same ten-module data registry shape used by existing Basic countries: one market-overview object, empty list modules, and `entry-strategy: null`. Append the Saudi bundle after Vietnam so existing country order remains stable.

- [ ] **Step 4: Add bilingual Saudi Playwright coverage**

Update the explorer count to `3 countries`, assert the Saudi card is visible under `coverageLevel=BASIC`, and add a Saudi detail test that verifies:

```text
/en/countries/SA -> Saudi Arabia -> approximately 92.5 GW -> 9 x Data Building
/zh-CN/countries/SA -> 沙特阿拉伯 -> 约为92.5吉瓦 -> 9 x 数据建设中
```

- [ ] **Step 5: Verify Web and E2E GREEN**

Run:

```bash
pnpm --filter @navigator/web test
pnpm exec vitest run tests/node-ts-source-commands.test.ts
pnpm test:e2e -- tests/e2e/country-explorer.e2e.ts
```

Expected: all unit, command, and Playwright tests pass; Saudi renders bilingually and no AI/deeper records are exposed.

- [ ] **Step 6: Commit Task 2**

```bash
git add apps/web/src/features/countries/country-seed-registry.ts apps/web/src/features/countries/country-service.test.ts apps/web/src/app/api/v1/countries/route.test.ts tests/node-ts-source-commands.test.ts tests/e2e/country-explorer.e2e.ts
git commit -m "feat: expose Saudi Arabia Basic publication"
```

---

### Task 3: Record the Approved Publication and Run Repository Gates

**Files:**
- Create: `docs/saudi-arabia-seed.md`
- Modify: `docs/country-rollout.md`
- Modify: `docs/roadmap.md`
- Modify: `docs/superpowers/plans/2026-07-17-saudi-basic-publication-plan.md`

**Interfaces:**
- Consumes: exact candidate, receipt, and canonical hashes from Tasks 1-2.
- Produces: an auditable documentation record that distinguishes r1 history from the active r2 Basic publication.

- [ ] **Step 1: Record exact publication identity and hashes**

Create `saudi-arabia-seed.md` with the exact country/run/reviewer/timestamps, all four immutable candidate hashes, receipt hash, and all three canonical file hashes. State that r1 remains prohibited, r2 is the only active run, coverage is exactly `BASIC`, and AI/deeper modules remain disabled.

- [ ] **Step 2: Update rollout and roadmap status**

Change Saudi Arabia from `r2 candidate awaiting review` to `published Basic`. Add a `DATA-BASIC-SA-PUBLISH` task card documenting the exact approved r2 identity, receipt/canonical hashes, tests, no schema change, and explicit owner confirmation. Do not rewrite r1 history or imply authorization for deeper coverage.

- [ ] **Step 3: Run scope and repository verification**

Run:

```bash
git diff --check 6af4b3be6769503e0949fbc56c54b3c9ed52ddeb..HEAD
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e -- tests/e2e/country-explorer.e2e.ts
```

Expected: all commands exit zero. Confirm the r2 candidate hashes are unchanged, no r1 approval exists, canonical Saudi has exactly three files, and no schema/dependency/AI/permission file changed.

- [ ] **Step 4: Commit Task 3**

```bash
git add docs/saudi-arabia-seed.md docs/country-rollout.md docs/roadmap.md docs/superpowers/plans/2026-07-17-saudi-basic-publication-plan.md
git commit -m "docs: record Saudi Arabia Basic publication"
```

- [ ] **Step 5: Independent review and integration**

Require an independent reviewer to check the complete diff against AGENTS.md and the publication contract. Fix and re-review every Critical or Important finding. The controller then reruns lint, typecheck, unit tests, and Saudi E2E; merges with `--no-ff` into the latest `main`; repeats the three repository gates on merged `main`; pushes once; and waits for the exact GitHub Actions run to complete.
