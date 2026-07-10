# Basic Country Template and Validator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reusable, country-neutral Basic seed builder, filesystem loader, validator, and Prisma import-plan builder that enforce the P1-5 contract without changing the unified data model.

**Architecture:** Keep the existing Indonesia Complete seed untouched. New Basic-only modules separate canonical product data from audit-only artifacts, derive exact Basic coverage with shared coverage helpers, and emit only country, module-coverage, and market-overview import operations. The reusable template is a typed constructor rather than fake placeholder JSON under `data/`.

**Tech Stack:** TypeScript strict mode, Node.js `fs`/`path`, existing `@navigator/shared-types` enums and coverage helpers, Vitest, pnpm.

## Global Constraints

- Do not modify `docs/data-schema.md`, Prisma schema, shared enums, AI retrieval boundaries, permissions, billing, dependencies, or the Indonesia seed implementation.
- All countries use the fixed 10-module model; no country-specific branch, field, or filename is permitted.
- A valid Basic canonical bundle has a C-end-eligible `market-overview` at `PARTIAL` or `COMPLETE`; every other nine modules is `BUILDING`, has `dataCount = 0`, and contains no canonical business records.
- The derived country coverage must be exactly `BASIC`; reject any bundle satisfying the `STANDARD` predicate.
- Basic `market-overview` must be `published`, not `UNVERIFIED`, and `aiUsable = false`.
- All ten market metadata fields are mandatory: `source`, `sourceUrl`, `collectedAt`, `updatedAt`, `credibility`, `reviewStatus`, `aiUsable`, `countryCode`, `industryTags`, `techTags`.
- Localized fields require string properties `zh` and `en`, with at least one nonblank value; a missing translation is represented by an empty string and remains a valid i18n fallback.
- `.cache/basic-country/` is never read into a bundle. `data/staging/` and `collection-manifest.json` are audit-only and must never enter import operations, C-end records, coverage inputs, or AI data.
- `collection-manifest.json` must resolve to exactly one committed `data/staging/<country>/<activeRunId>/` bundle containing the four documented JSON artifacts.
- No static pseudo-country template is created under `data/`; invalid ISO placeholders and incomplete records are forbidden.
- Unsupported current enums, including an unregistered region, produce a validation error and block the country. This task does not coerce or extend enums.
- Follow TDD: each behavior starts with a focused failing test, then minimal implementation, then a passing focused test.

---

### Task 1: Implement the Basic template, validator, and import plan

**Files:**
- Create: `packages/db/src/seed/basic-country-types.ts`
- Create: `packages/db/src/seed/basic-country-template.ts`
- Create: `packages/db/src/seed/basic-country-validator.ts`
- Create: `packages/db/src/seed/basic-country-import.ts`
- Create: `packages/db/src/basic-country-seed.test.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `packages/db/src/index.test.ts`
- Modify: `docs/basic-country-collection.md`
- Include: `docs/superpowers/plans/2026-07-10-basic-country-template-validator-plan.md`

**Interfaces:**
- Produces: `createBasicCountryBundle(input: BasicCountryTemplateInput): BasicCountryBundle`
- Produces: `loadBasicCountryBundle(repoRoot: string, countryDirectory: string): BasicCountryBundle`
- Produces: `validateBasicCountryBundle(bundle: BasicCountryBundle): BasicCountryValidationResult`
- Produces: `buildBasicCountryImportPlan(bundle: BasicCountryBundle): BasicCountryImportPlan`
- Consumes: `MODULE_KEYS`, `REGIONS`, `CREDIBILITIES`, `REVIEW_STATUSES`, `INDUSTRY_TAGS`, `TECH_TAGS`, `getObjectModuleCoverageStatus()`, and `getCountryCoverageLevel()` from `@navigator/shared-types`.

The shared Basic contract must have this shape:

```ts
export type JsonRecord = Record<string, unknown>;

export interface BasicCollectionManifest {
  activeRunId: string;
  mappingVersion: string;
  auditBundlePath: string;
}

export interface BasicAuditRun {
  runId: string;
  sourceRegister: JsonRecord;
  extractedFacts: JsonRecord;
  marketOverviewDraft: JsonRecord;
  reviewReport: JsonRecord;
}

export interface BasicCanonicalData {
  country: JsonRecord;
  marketOverview: JsonRecord;
  policy: JsonRecord[];
  risk: JsonRecord[];
  opportunities: JsonRecord[];
  projects: JsonRecord[];
  partners: JsonRecord[];
  chineseCompanies: JsonRecord[];
  entryStrategy: JsonRecord | null;
  reports: JsonRecord[];
  knowledge: JsonRecord[];
}

export interface BasicCountryBundle {
  countryDirectory: string;
  canonical: BasicCanonicalData;
  audit: {
    manifest: BasicCollectionManifest;
    run: BasicAuditRun;
  };
}

export interface BasicCountryTemplateInput {
  countryDirectory: string;
  country: Omit<JsonRecord, "coverageLevel" | "moduleCoverage">;
  marketOverview: JsonRecord;
  manifest: BasicCollectionManifest;
  auditRun: BasicAuditRun;
}

export interface BasicCountryValidationResult {
  valid: boolean;
  errors: string[];
  summary: {
    countryCode: string;
    coverageLevel: string;
    moduleStatuses: Record<string, string>;
  };
}
```

- [ ] **Step 1: Write the failing template test**

Add a test that calls `createBasicCountryBundle()` with a reviewed `VN` market overview and asserts:

```ts
expect(bundle.canonical.country.coverageLevel).toBe("BASIC");
expect(bundle.canonical.country.moduleCoverage).toHaveLength(10);
expect(bundle.canonical.country.moduleCoverage).toContainEqual(
  expect.objectContaining({
    moduleKey: "market-overview",
    status: expect.stringMatching(/PARTIAL|COMPLETE/),
    dataCount: 1,
  }),
);
expect(bundle.canonical.entryStrategy).toBeNull();
expect(bundle.canonical.policy).toEqual([]);
expect(bundle.canonical.knowledge).toEqual([]);
```

Run:

```bash
pnpm --filter @navigator/db exec vitest run src/basic-country-seed.test.ts
```

Expected: FAIL because `basic-country-template.js` does not exist.

- [ ] **Step 2: Implement the minimal typed template**

Implement `basic-country-types.ts` and `basic-country-template.ts`. Use these market core fields verbatim:

```ts
const MARKET_OVERVIEW_CORE_FIELDS = [
  "overview",
  "population",
  "gdp",
  "gdpGrowth",
  "energyDemand",
  "renewableTarget",
  "keyIndicators",
] as const;
```

`createBasicCountryBundle()` must reject non-`published`, `UNVERIFIED`, or `aiUsable !== false` market input; derive the market status with `getObjectModuleCoverageStatus()`; create the other nine rows as `BUILDING`/`0`; derive coverage with `getCountryCoverageLevel()`; and return empty canonical non-market modules plus the unchanged audit inputs.

Run the focused test again. Expected: PASS.

- [ ] **Step 3: Write failing validator and loader tests**

Add focused tests covering all of these behaviors:

```ts
expect(validateBasicCountryBundle(validBundle)).toMatchObject({
  valid: true,
  errors: [],
  summary: { countryCode: "VN", coverageLevel: "BASIC" },
});
```

- exactly 10 unique module keys and exact derived status/dataCount;
- uppercase two-letter country code, registered region, nonblank flag, valid timestamps;
- localized country/market/indicator fields accept one-language fallback but reject both blank;
- market fields and nonempty indicators are structurally valid;
- all ten metadata keys exist, `countryCode` matches, tags contain only registered enums, `sourceUrl` is an HTTP(S) URL or null with `source` containing `sourceUrl null`, `reviewStatus` is `published`, credibility is not `UNVERIFIED`, and `aiUsable` is false;
- all non-market canonical arrays are empty and `entryStrategy` is null;
- any non-market record, non-BUILDING row, nonzero count, duplicate/missing module key, manual non-BASIC level, or STANDARD-qualifying coverage is rejected;
- manifest `activeRunId` and `audit.run.runId` match;
- `bundle.countryDirectory` is a safe slug and `auditBundlePath` equals `data/staging/<countryDirectory>/<activeRunId>` exactly, with path traversal and cross-country paths rejected;
- all four audit artifacts are records; `marketOverviewDraft.reviewStatus === "draft"` and `aiUsable === false`;
- `loadBasicCountryBundle()` reads canonical and exact audit files, defaults absent list modules to `[]` and absent `entry-strategy.json` to null, rejects a missing artifact, and reports malformed JSON with the file path.

Run the focused test. Expected: FAIL because validator and loader exports do not exist.

- [ ] **Step 4: Implement validation and filesystem loading**

Implement `basic-country-validator.ts` without `any`. Use `unknown` plus record/array guards. The loader accepts a repository root containing `data/`; it must reject `countryDirectory` unless it matches `^[a-z0-9]+(?:-[a-z0-9]+)*$` and reject `activeRunId` unless it matches `^[A-Za-z0-9][A-Za-z0-9_-]*$`.

The loader reads:

```text
data/<country>/country.json
data/<country>/market-overview.json
data/<country>/collection-manifest.json
data/staging/<country>/<activeRunId>/source-register.json
data/staging/<country>/<activeRunId>/extracted-facts.json
data/staging/<country>/<activeRunId>/market-overview.draft.json
data/staging/<country>/<activeRunId>/review-report.json
```

Optional list-module files are parsed when present and otherwise become `[]`; optional `entry-strategy.json` becomes null; optional `knowledge/chunks.json` becomes `[]`. The validator must reject any nonempty non-market canonical module so optional files cannot hide product data.

Run the focused test again. Expected: PASS.

- [ ] **Step 5: Write the failing import-plan isolation test**

Add tests asserting `buildBasicCountryImportPlan()`:

```ts
const plan = buildBasicCountryImportPlan(validBundle);
expect(plan.operations).toHaveLength(12);
expect(plan.operations.map(({ model }) => model)).toEqual([
  "country",
  ...Array.from({ length: 10 }, () => "moduleCoverage"),
  "marketOverview",
]);
expect(plan.aiEligibleKnowledgeIds).toEqual([]);
expect(JSON.stringify(plan)).not.toContain("AUDIT_SENTINEL");
expect(plan.operations).not.toEqual(
  expect.arrayContaining([
    expect.objectContaining({ model: "knowledgeChunk" }),
  ]),
);
```

Also assert each module-coverage upsert uses the Prisma composite key `countryCode_moduleKey`, IDs are not hardcoded, enum/tag values are transformed to their Prisma enum names, and an invalid bundle causes `buildBasicCountryImportPlan()` to throw the joined validation errors.

Run the focused test. Expected: FAIL because the import builder does not exist.

- [ ] **Step 6: Implement the minimal import plan**

Implement `basic-country-import.ts` with:

```ts
export interface BasicSeedImportOperation {
  model: "country" | "moduleCoverage" | "marketOverview";
  action: "upsert";
  args: JsonRecord;
}

export interface BasicCountryImportPlan {
  summary: BasicCountryValidationResult["summary"];
  operations: BasicSeedImportOperation[];
  aiEligibleKnowledgeIds: [];
}
```

The plan contains only the canonical country, ten module rows, and canonical market overview. Never spread `bundle.audit`, `collection-manifest`, staging paths, or non-market arrays into operations.

Run the focused test again. Expected: PASS.

- [ ] **Step 7: Export the P1-5 API and record the enum gate**

Re-export the four public functions and their public types from `packages/db/src/index.ts`, and extend `packages/db/src/index.test.ts` to assert the functions are defined.

Update `docs/basic-country-collection.md` so `collection-manifest.json` explicitly contains `activeRunId`, `mappingVersion`, and `auditBundlePath`, with the path fixed to `data/staging/<country>/<activeRunId>`. Add a short paragraph stating that an unregistered region/tag blocks validation and requires a separately approved data-model change; values must never be coerced into a nearby enum. State that P1-5 enforces uppercase two-letter country-code format while real ISO membership remains a source/human review obligation because the current model has no complete ISO registry. Do not add or name a new enum value.

- [ ] **Step 8: Run focused and full verification**

Run:

```bash
pnpm --filter @navigator/db exec vitest run src/basic-country-seed.test.ts
pnpm --filter @navigator/db test
pnpm lint
pnpm typecheck
pnpm test
git diff --check
```

Expected: every command exits 0; the existing Indonesia tests remain unchanged and pass.

- [ ] **Step 9: Commit the task card**

```bash
git add packages/db/src/seed/basic-country-types.ts packages/db/src/seed/basic-country-template.ts packages/db/src/seed/basic-country-validator.ts packages/db/src/seed/basic-country-import.ts packages/db/src/basic-country-seed.test.ts packages/db/src/index.ts packages/db/src/index.test.ts docs/basic-country-collection.md docs/superpowers/plans/2026-07-10-basic-country-template-validator-plan.md
git commit -m "feat: add Basic country seed validation"
```
