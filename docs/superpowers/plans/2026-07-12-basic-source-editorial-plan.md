# Basic Editorial Materialization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert exact, evidence-bound bilingual operator input into final v2 candidate facts, perform the one approved country-name enrichment, derive system metadata deterministically, and produce a complete materialization result without a model or draft assembler.

**Architecture:** An exact editorial parser enforces path ownership and bounded evidence. The materializer resolves every evidence tuple against either deterministic preliminary observations or reviewed document editorial evidence. A merge phase rejects deterministic/manual ownership collisions except the explicit `country.name` replacement. A derived phase computes flag, representative source, timestamps, credibility, and country code from active evidence, then updates source locators and emits one frozen final source-register/facts/receipts result plus review inputs for the next task.

**Tech Stack:** TypeScript strict mode, existing shared i18n/schema enums, audit/v2/document contracts, Node.js crypto, Vitest, pnpm workspace. No new dependencies.

## Global Constraints

- Read `AGENTS.md`, the approved source-boundary design, and completed Catalog/Formats/Documents docs before editing.
- Work only on `feat/DATA-BASIC-EDITORIAL-1` from latest pushed `main` after Documents is merged.
- Use TDD and confirm RED before each production slice.
- The operator may provide only approved editorial paths. Protected values, source metadata, normalized numeric facts, review status, and AI usability are never operator-owned.
- No automatic translation, taxonomy inference, fuzzy matching, source selection, conflict resolution, estimation, search, Hermes, llama/model, env, filesystem, network, database, or draft assembly.
- Keep APIs package-private and leave `packages/db/src/index.ts` unchanged.
- Do not modify v1 contracts/behavior or existing source adapters.
- Do not write canonical/staging/database data and do not add dependencies.
- Preserve reviewed text and scalar/array raw values verbatim after exact reconstruction; do not trim/rewrap content except when validating that it is nonblank. Reconstruct generic finite-JSON object keys in lexical order so input insertion order cannot change artifact bytes.
- Errors are stable and redacted; never echo evidence text, URL values, tokens, cookies, or external errors.

---

## File Structure

### Create

- `packages/db/src/collection/basic-editorial-input-contracts.ts`
- `packages/db/src/collection/basic-editorial-input-parser.ts`
- `packages/db/src/collection/basic-editorial-materializer.ts`
- `packages/db/src/collection/basic-derived-fact-materializer.ts`
- `packages/db/src/collection/basic-v2-materialization.ts`
- `packages/db/src/basic-editorial-input-parser.test.ts`
- `packages/db/src/basic-editorial-materializer.test.ts`
- `packages/db/src/basic-derived-fact-materializer.test.ts`
- `packages/db/src/basic-v2-materialization.test.ts`
- `docs/basic-country-editorial-input.md`

### Modify

- `packages/db/src/collection/basic-collection-v2-contracts.ts` - add final materialization/result composition types only.
- `docs/basic-country-document-evidence.md`, `docs/basic-country-audit-contract.md`, `docs/basic-country-collection.md`, and `docs/roadmap.md`.

### Must Remain Unchanged

- v1 contracts/parsers/validators/loaders/dry-run/llama bridge.
- Catalog, transport, capture, CSV, adapter implementations, and raw fixtures.
- `packages/db/src/index.ts`, Prisma, `data/**`, AI, permissions, billing, and Web.

---

### Task 1: Exact Bilingual Editorial Input

**Files:**
- Create: `packages/db/src/collection/basic-editorial-input-contracts.ts`
- Create: `packages/db/src/collection/basic-editorial-input-parser.ts`
- Create: `packages/db/src/basic-editorial-input-parser.test.ts`

**Interfaces:**

```ts
export const BASIC_COUNTRY_EDITORIAL_INPUT_SCHEMA_VERSION =
  "basic-country-editorial-input/v1" as const;

export interface BasicEditorialEvidenceInput {
  readonly sourceId: string;
  readonly locator: string;
  readonly rawValue: BasicCollectionJsonValue;
  readonly unit: null;
  readonly year: null;
}

export interface BasicEditorialItemInput {
  readonly fieldPath: string;
  readonly normalizedValue: BasicCollectionJsonValue;
  readonly evidence: readonly BasicEditorialEvidenceInput[];
  readonly uncertainty: string | null;
}

export interface BasicCountryEditorialInput {
  readonly schemaVersion: typeof BASIC_COUNTRY_EDITORIAL_INPUT_SCHEMA_VERSION;
  readonly runId: string;
  readonly countryCode: string;
  readonly catalogVersion: string;
  readonly catalogSha256: string;
  readonly primarySourceId: string;
  readonly items: readonly BasicEditorialItemInput[];
}

export function parseBasicCountryEditorialInput(
  value: unknown,
): BasicCountryEditorialInput;
```

- [ ] **Step 1: Write failing exact-schema tests**

Cover a complete valid input and recursive freezing. Reject extra/missing/accessor/symbol/proxy/cycle/sparse values, invalid identity/digest, empty/unsafe primary source, over 256 items, over 32 evidence per item, unsorted/duplicate field paths, unsorted/duplicate sourceId+locator evidence, empty evidence, invalid finite JSON, non-null unit/year, invalid uncertainty, non-exact indicator index, and all unsupported/protected paths.

Allow only:

```text
country.name
country.region
country.summary
marketOverview.overview
marketOverview.energyDemand
marketOverview.renewableTarget
marketOverview.industryTags
marketOverview.techTags
marketOverview.keyIndicators[i].label
```

Path-specific normalized shapes are exact: localized text `{zh,en}` with both nonblank; region is existing `Region`; industry/tech tags are existing enum arrays, unique and sorted; indicator label is localized text; country name is localized text and validated again against the preliminary English value during materialization.

- [ ] **Step 2: Confirm RED**

```bash
pnpm --filter @navigator/db exec vitest run src/basic-editorial-input-parser.test.ts
```

- [ ] **Step 3: Implement exact reconstruction**

Import `REGIONS`, `INDUSTRY_TAGS`, and `TECH_TAGS` from the existing shared schema source rather than duplicating values. Use one stable `basic editorial input is invalid` error and reconstruct all JSON keys in schema order.

- [ ] **Step 4: Confirm GREEN and commit**

```bash
pnpm --filter @navigator/db exec vitest run src/basic-editorial-input-parser.test.ts
git add packages/db/src/collection/basic-editorial-input-contracts.ts packages/db/src/collection/basic-editorial-input-parser.ts packages/db/src/basic-editorial-input-parser.test.ts
git commit -m "feat: validate Basic editorial input"
```

---

### Task 2: Evidence Resolution and Editorial Facts

**Files:**
- Create: `packages/db/src/collection/basic-editorial-materializer.ts`
- Create: `packages/db/src/basic-editorial-materializer.test.ts`

**Interfaces:**

```ts
export interface BasicEditorialMaterializationResult {
  readonly facts: readonly BasicExtractedFactV2[];
  readonly consumedEvidence: readonly {
    sourceId: string;
    fieldPath: string;
    locator: string;
  }[];
}

export function materializeBasicEditorialFacts(input: {
  readonly editorial: BasicCountryEditorialInput;
  readonly preliminarySources: BasicSourceRegisterV2;
  readonly preliminaryFacts: BasicExtractedFactsV2;
  readonly structuredEditorialEvidence:
    readonly BasicStructuredEditorialEvidenceObservation[];
  readonly documentEditorialEvidence: readonly BasicEditorialEvidenceObservation[];
  readonly passedSourceIds: readonly string[];
}): BasicEditorialMaterializationResult;
```

- [ ] **Step 1: Add failing evidence-binding tests**

For every item, require each evidence tuple to exactly match sourceId, item fieldPath, locator, and rawValue in one eligible `structuredEditorialEvidence` or reviewed document editorial observation. Structured evidence never comes from a final deterministic fact and deliberately has no inherited unit/year because editorial evidence fixes both to null. Document evidence must have `usage=editorial-evidence`. Every referenced source must be open, not UNVERIFIED, passed, and bound to the same run/catalog identity. `country.name` is the sole exception: it resolves its original English/raw evidence from the dedicated preliminary fact during the enrichment step rather than from either editorial-evidence list.

Test structured and document evidence independently and together, multi-source narrative support, stable evidence ordering, one manual fact per path, deep-equal normalized value in every fact evidence, and uncertainty preservation. Reject missing/orphan/duplicate evidence, a preliminary source-backed fact used as ordinary editorial evidence, wrong path/raw value, failed source, injection-risk source, inactive source, primary source not actually referenced, and any deterministic final fact masquerading as editorial evidence.

- [ ] **Step 2: Confirm RED**

Run `src/basic-editorial-materializer.test.ts`; expect missing implementation.

- [ ] **Step 3: Implement exact resolution**

Build keyed lookup tables from frozen inputs and never scan external content. Facts use `extractionMethod: "manual"`; fact ID and tuple semantics come from `materializeBasicSourceFactsV2`. Return only consumed identifiers, not raw text, in the auxiliary list.

- [ ] **Step 4: Confirm GREEN and commit**

```bash
pnpm --filter @navigator/db exec vitest run src/basic-editorial-materializer.test.ts src/basic-v2-fact-materializer.test.ts
git add packages/db/src/collection/basic-editorial-materializer.ts packages/db/src/basic-editorial-materializer.test.ts
git commit -m "feat: bind Basic editorial evidence"
```

---

### Task 3: Controlled `country.name` Enrichment and Ownership Merge

**Files:**
- Create: `packages/db/src/collection/basic-v2-materialization.ts`
- Create: `packages/db/src/basic-v2-materialization.test.ts`
- Modify: `packages/db/src/collection/basic-collection-v2-contracts.ts`

**Interfaces:**

```ts
export interface BasicDeterministicMaterializationResultV2 {
  readonly sourceRegister: BasicSourceRegisterV2;
  readonly extractedFacts: BasicExtractedFactsV2;
  readonly receipts: readonly BasicRawCaptureReceiptV2[];
}

export interface BasicReviewedMaterializationV2 {
  readonly materialization: BasicDeterministicMaterializationResultV2;
  readonly sourceChecks: readonly BasicSourceCheck[];
  readonly injectionRisks: readonly BasicInjectionRisk[];
}

export function materializeBasicReviewedRunV2(input: {
  readonly preliminary: BasicPreliminarySourceRunV2;
  readonly structuredReview: BasicStructuredSourceReview | null;
  readonly manualReview: BasicManualSourceReview | null;
  readonly documentResult: BasicDocumentMaterializationResult | null;
  readonly editorial: BasicCountryEditorialInput;
}): BasicReviewedMaterializationV2;
```

- [ ] **Step 1: Write failing merge/enrichment tests**

Assert identity equality across every input; exact source-check coverage; structured/manual disjointness; source union and receipt coverage; and stable source/fact order. `structuredReview` is null exactly when the plan had no deterministic source; `manualReview` and `documentResult` are both null exactly when it had no manual-document source. Reject every partial or contradictory null combination.

For `country.name`, require exactly one deterministic preliminary candidate with localized normalized value whose English text exactly equals its raw source English value. Editorial name must preserve that exact English and add a nonblank Chinese value. Replace the preliminary fact with exactly one manual final fact that preserves original sourceId/locator/rawValue; never emit both.

For all other paths, reject deterministic+manual coexistence even when normalized tuples match. Merge same-method observations through existing tuple semantics; preserve conflicts rather than choosing a winner. Reject missing editorial evidence, duplicate final paths, unsupported ownership, and any editorial attempt to replace a protected path.

- [ ] **Step 2: Confirm RED**

Run `src/basic-v2-materialization.test.ts`; expect missing implementation.

- [ ] **Step 3: Implement source/fact terminal merge**

Combine preliminary deterministic sources/facts and reviewed document sources/facts, pass `preliminary.structuredEditorialEvidence` into editorial resolution, then apply editorial facts and the name replacement. Merge source locators from accepted facts/evidence, unique-sort them, and preserve all owner fields. Carry path-free receipts exactly once per active source. Aggregate source checks/risks from structured and manual reviews without changing their content.

- [ ] **Step 4: Confirm GREEN and commit**

```bash
pnpm --filter @navigator/db exec vitest run src/basic-v2-materialization.test.ts src/basic-editorial-materializer.test.ts src/basic-document-observation.test.ts
git add packages/db/src/collection/basic-v2-materialization.ts packages/db/src/collection/basic-collection-v2-contracts.ts packages/db/src/basic-v2-materialization.test.ts
git commit -m "feat: merge reviewed Basic facts"
```

---

### Task 4: Deterministic Derived Facts

**Files:**
- Create: `packages/db/src/collection/basic-derived-fact-materializer.ts`
- Create: `packages/db/src/basic-derived-fact-materializer.test.ts`
- Modify: `packages/db/src/collection/basic-v2-materialization.ts`
- Modify: `packages/db/src/basic-v2-materialization.test.ts`

**Interfaces:**

```ts
export function materializeBasicDerivedFacts(input: {
  readonly countryCode: string;
  readonly primarySourceId: string;
  readonly sourceRegister: BasicSourceRegisterV2;
  readonly candidateFacts: readonly BasicExtractedFactV2[];
}): {
  readonly sourceRegister: BasicSourceRegisterV2;
  readonly facts: readonly BasicExtractedFactV2[];
};
```

- [ ] **Step 1: Add failing derivation tests**

Test all approved derivations exactly:

- flag emoji from the unique candidate `country.code` ISO2.
- `marketOverview.countryCode` from the same fact.
- source/sourceUrl from the active primary source.
- collectedAt as max active `retrievedAt`.
- updatedAt and country.updatedAt as max non-null active `publishedAt`, else max `retrievedAt` with nonblank fallback uncertainty.
- credibility as the lowest active credibility using `OFFICIAL > VERIFIED > ESTIMATED > UNVERIFIED`.

Assert exact evidence locators and owners: original ISO2 locator; `metadata:/sourceName`; `metadata:/sourceUrl`; `capture:/retrievedAt`; `metadata:/publishedAt`; `metadata:/credibility`. Every evidence normalized value equals the final aggregate. Add derived locators to the matching source records, unique/sorted. Never create a synthetic source.

Reject no active source, noncandidate/ambiguous country code, mismatched ISO2, inactive primary source, invalid/uncomparable timestamps, missing source records, duplicate derived paths, and operator-supplied derived facts.

- [ ] **Step 2: Confirm RED, implement, and confirm GREEN**

The function is pure, snapshots its inputs, and produces deterministic facts only.

```bash
pnpm --filter @navigator/db exec vitest run src/basic-derived-fact-materializer.test.ts src/basic-v2-materialization.test.ts
git add packages/db/src/collection/basic-derived-fact-materializer.ts packages/db/src/collection/basic-v2-materialization.ts packages/db/src/basic-derived-fact-materializer.test.ts packages/db/src/basic-v2-materialization.test.ts
git commit -m "feat: derive Basic audit metadata"
```

---

### Task 5: Documentation, Determinism Gates, Review, and Integration

**Files:**
- Create: `docs/basic-country-editorial-input.md`
- Modify: `docs/basic-country-document-evidence.md`
- Modify: `docs/basic-country-audit-contract.md`
- Modify: `docs/basic-country-collection.md`
- Modify: `docs/roadmap.md`

- [ ] **Step 1: Document operator and system ownership**

Document exact schema, allowlist, path-specific shapes, evidence matching, primary-source semantics, country-name exception, deterministic/manual collision rule, tag/region enums, derived formulas/locators/time fallback, final materialization result, and no-model/no-draft boundary.

- [ ] **Step 2: Add determinism/security regressions**

In the materialization test, permute semantically equivalent object-key insertion order while retaining contract-required sorted arrays and assert byte-identical `JSON.stringify` output. Install throwing sentinels for global fetch, env access proxy where injectable, model/Hermes/search/socket/child process ports, and assert none are accessed. Assert inputs are unchanged; separately assert unsorted arrays fail closed.

- [ ] **Step 3: Run scans and branch gates**

```bash
rg -n "basic-country-editorial-input/v1|country.name|metadata:/sourceName|capture:/retrievedAt|DATA-BASIC-EDITORIAL-1" docs packages/db/src
rg -n "Hermes|llama|SearXNG|fetch\(|child_process|KnowledgeChunk|Prisma" packages/db/src/collection/basic-editorial-*.ts packages/db/src/collection/basic-derived-*.ts packages/db/src/collection/basic-v2-materialization.ts
git diff --check
pnpm lint
pnpm typecheck
pnpm test
pnpm turbo run lint typecheck test --force
```

No E2E is required.

- [ ] **Step 4: Commit docs, independently review, merge, and push**

```bash
git add docs/basic-country-editorial-input.md docs/basic-country-document-evidence.md docs/basic-country-audit-contract.md docs/basic-country-collection.md docs/roadmap.md
git commit -m "docs: define Basic editorial materialization"
```

Review against design/plan/base diff; fix every Critical/Important finding with a fresh fix agent and rerun all gates. Merge `--no-ff` into latest `main`, rerun all four gates, push, and verify local/remote equality before Deterministic begins.
