# Basic Editorial Materialization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert exact, evidence-bound bilingual operator input into final v2 candidate facts, perform the one approved country-name enrichment, derive system metadata deterministically, and produce a complete materialization result without a model or draft assembler.

**Architecture:** An exact editorial parser enforces path ownership and bounded evidence. Owner-specific wrappers share one fact tuple engine while preserving the existing source-path guard, and a module-private `WeakMap` proves that document evidence came from the reviewed Documents materializer. The reviewed merge builds the complete deterministic/manual source union, resolves bilingual evidence, rejects ownership collisions except the explicit `country.name` replacement, and then derives system metadata into one frozen source-register/facts/receipts result for the next task.

**Tech Stack:** TypeScript strict mode, existing shared i18n/schema enums, audit/v2/document contracts, Node.js crypto, Vitest, pnpm workspace. No new dependencies.

## Global Constraints

- Read `AGENTS.md`, the approved source-boundary design, the approved [Editorial interface amendment](../specs/2026-07-12-basic-editorial-interface-amendment-design.md), and completed Catalog/Formats/Documents docs before editing.
- Work only on `feat/DATA-BASIC-EDITORIAL-1` from latest pushed `main` after Documents is merged.
- Use TDD and confirm RED before each production slice.
- The operator may provide only approved editorial paths. Protected values, source metadata, normalized numeric facts, review status, and AI usability are never operator-owned.
- No automatic translation, taxonomy inference, fuzzy matching, source selection, conflict resolution, estimation, search, Hermes, llama/model, env, filesystem, network, database, or draft assembly.
- Keep APIs package-private and leave `packages/db/src/index.ts` unchanged.
- Do not modify v1 contracts/behavior or existing source adapters.
- Do not write canonical/staging/database data and do not add dependencies.
- Preserve reviewed text and scalar/array raw values verbatim after exact reconstruction; do not trim/rewrap content except when validating that it is nonblank. Snapshot generic finite JSON within the approved limits, compare object keys lexically, and require insertion-order permutations to produce byte-identical in-memory output. This card does not introduce the later candidate artifact writer.
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
- `packages/db/src/collection/basic-v2-fact-materializer.ts` and `packages/db/src/basic-v2-fact-materializer.test.ts` - add an editorial-only wrapper over the shared private tuple engine without widening the existing source wrapper.
- `packages/db/src/collection/basic-document-observation-materializer.ts` and `packages/db/src/basic-document-observation.test.ts` - brand successful document results with exact run/catalog/manual-source provenance.
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

Import `REGIONS`, `INDUSTRY_TAGS`, and `TECH_TAGS` from the existing shared schema source rather than duplicating values. Use `classifyBasicV2FieldPath()` as the ownership source of truth, then apply path-specific shape validation; do not copy a second editorial allowlist. Use one stable `basic editorial input is invalid` error and reconstruct all JSON keys in schema order.

- [ ] **Step 4: Confirm GREEN and commit**

```bash
pnpm --filter @navigator/db exec vitest run src/basic-editorial-input-parser.test.ts
git add packages/db/src/collection/basic-editorial-input-contracts.ts packages/db/src/collection/basic-editorial-input-parser.ts packages/db/src/basic-editorial-input-parser.test.ts
git commit -m "feat: validate Basic editorial input"
```

---

### Task 2: Owner-Specific Editorial Fact Materialization

**Files:**
- Modify: `packages/db/src/collection/basic-v2-fact-materializer.ts`
- Modify: `packages/db/src/basic-v2-fact-materializer.test.ts`

**Interfaces:**

```ts
export function materializeBasicEditorialObservationsV2(
  observations: readonly BasicSourcedObservationV2[],
): readonly BasicExtractedFactV2[];
```

- [ ] **Step 1: Write failing owner-boundary tests**

Import the missing function and prove that an ordinary editorial observation
such as `country.summary` materializes as one `candidate` fact with
`extractionMethod = "manual"`. Cover narrative, region, tag arrays, and exact
indicator-label paths. Assert that source-backed, `country.name`, derived,
unknown, malformed indicator, and mixed-owner batches fail with the stable
redacted v2 fact-materialization error. Keep the existing test that
`materializeBasicSourceFactsV2()` rejects ordinary editorial paths.

Use semantically equal `rawValue` / `normalizedValue` objects containing
integer-style keys `"2"` and `"10"` in different insertion orders and assert
identical fact IDs, evidence order, and `JSON.stringify()` output. Preserve
the existing conflict, finite-JSON, resource-limit, and input-immutability
coverage.

- [ ] **Step 2: Confirm RED**

```bash
pnpm --filter @navigator/db exec vitest run src/basic-v2-fact-materializer.test.ts
```

Expected failure: the editorial-only function is not exported or defined.

- [ ] **Step 3: Refactor one private fact engine**

Keep tuple grouping, canonical finite-JSON comparison, fact ID generation,
evidence sorting, uncertainty rules, resource limits, deep freezing, and the
stable error boundary in one private implementation. The existing
`materializeBasicSourceFactsV2(observations, extractionMethod)` wrapper must
continue to admit only `source-backed` and `hybrid-name` owners. The new
wrapper fixes `extractionMethod = "manual"` and admits only `editorial` owners
from `classifyBasicV2FieldPath()`; it must not accept a caller-provided owner
set or extraction method.

- [ ] **Step 4: Confirm GREEN and commit**

```bash
pnpm --filter @navigator/db exec vitest run src/basic-v2-fact-materializer.test.ts src/basic-document-observation.test.ts src/basic-source-plan-runner-v2.test.ts
git add packages/db/src/collection/basic-v2-fact-materializer.ts packages/db/src/basic-v2-fact-materializer.test.ts
git commit -m "feat: materialize Basic editorial observations"
```

---

### Task 3: Trusted Document Materialization Result

**Files:**
- Modify: `packages/db/src/collection/basic-document-observation-materializer.ts`
- Modify: `packages/db/src/basic-document-observation.test.ts`

**Interfaces:**

```ts
export interface BasicDocumentMaterializationProvenanceV2 {
  readonly runId: string;
  readonly countryCode: string;
  readonly catalogVersion: string;
  readonly catalogSha256: string;
  readonly manualSourceIds: readonly string[];
  readonly captureBindings: readonly Readonly<{
    sourceId: string;
    requestUrl: string;
    finalUrl: string;
    retrievedAt: string;
    contentSha256: string;
  }>[];
}

export function snapshotBasicDocumentMaterializationProvenanceV2(
  value: unknown,
): BasicDocumentMaterializationProvenanceV2 | null;
```

- [ ] **Step 1: Write failing provenance tests**

Use the existing real plan-runner/fake-transport/raw-v2-cache fixture to obtain
a successful document materialization result. Assert that the missing snapshot
function returns exact run, country, catalog version, catalog digest, and a
unique source-ID-sorted manual source list for that exact result object. Assert
`null` for handmade, spread, JSON-cloned, proxied, and unrelated objects.

Produce separately branded results for a different run, country, and catalog
identity so later Editorial tests can prove cross-identity rejection. Retain
all existing capture-provenance, review, locator, and redacted-error tests.

- [ ] **Step 2: Confirm RED**

```bash
pnpm --filter @navigator/db exec vitest run src/basic-document-observation.test.ts
```

Expected failure: the result-provenance snapshot is not exported or defined.

- [ ] **Step 3: Brand only successful reviewed results**

Create one module-private `WeakMap<object,
BasicDocumentMaterializationProvenanceV2>`. Register a recursively frozen
provenance object only after `materializeReviewedSources()` succeeds, using the
already validated plan/capture/review identity, sorted manual source IDs, and
source-ID-sorted exact capture bindings (`sourceId`, `requestUrl`, `finalUrl`,
`retrievedAt`, `contentSha256`).
The snapshot performs no parsing or fallback and returns `null` unless its key
is the exact result object. Do not add `usage` to
`BasicEditorialEvidenceObservation` and do not change document result data
shape.

- [ ] **Step 4: Confirm GREEN and commit**

```bash
pnpm --filter @navigator/db exec vitest run src/basic-document-observation.test.ts src/basic-source-plan-runner-v2.test.ts
git add packages/db/src/collection/basic-document-observation-materializer.ts packages/db/src/basic-document-observation.test.ts
git commit -m "feat: bind Basic document results"
```

---

### Task 4: Evidence Resolution and Editorial Facts

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
  readonly reviewedSources: BasicSourceRegisterV2;
  readonly preliminaryFacts: BasicExtractedFactsV2;
  readonly structuredEditorialEvidence:
    readonly BasicStructuredEditorialEvidenceObservation[];
  readonly documentResult: BasicDocumentMaterializationResult | null;
  readonly sourceChecks: readonly BasicSourceCheck[];
  readonly injectionRisks: readonly BasicInjectionRisk[];
}): BasicEditorialMaterializationResult;
```

- [ ] **Step 1: Add failing evidence-binding tests**

For every item, require each evidence tuple to exactly match sourceId, item
fieldPath, locator, and canonical rawValue in one eligible
`structuredEditorialEvidence` or in `editorialEvidence` owned by the exact
branded `documentResult`. Never accept an independent document evidence array.
Structured evidence never comes from a final deterministic fact and
deliberately has no inherited unit/year because editorial evidence fixes both
to null.

Require editorial, reviewed source register, preliminary facts, and document
provenance to share exact run/country/catalog identity. `sourceChecks` must
contain exactly one unique check for every reviewed source with no foreign
source; every referenced source must have a passed check and no failed check,
no injection-risk entry, `promptInjectionRisk = "none"`, open access, and
credibility other than `UNVERIFIED`. Reject missing/duplicate/foreign checks,
unknown risk sources, and any document result whose branded manual source set
does not equal the manual portion of reviewed sources.

`country.name` is the sole exception to ordinary evidence lookup: require one
unique deterministic preliminary candidate, then match the operator evidence
to its sourceId/locator/rawValue. Its English normalized text must equal the
source English value exactly; preserve it and require a nonblank Chinese text.

Test structured-only, document-only, and mixed evidence; multi-source narrative
support; stable evidence ordering; one manual fact per editorial path; the
manual `country.name` fact; deep-equal normalized value in every fact evidence;
and uncertainty preservation. Reject missing/orphan/duplicate evidence, a
preliminary source-backed fact used as ordinary editorial evidence, wrong
path/raw value, cross-run/country/catalog branded document results, inactive or
unreviewed sources, primary source not actually referenced, and deterministic
final facts masquerading as editorial evidence.

- [ ] **Step 2: Confirm RED**

Run `src/basic-editorial-materializer.test.ts`; expect missing implementation.

- [ ] **Step 3: Implement exact resolution**

Reparse the exact editorial input, reconstruct and freeze all other inputs, and
build bounded keyed lookups without scanning external content. Ordinary facts
come from `materializeBasicEditorialObservationsV2()`; `country.name` uses the
existing source wrapper with `extractionMethod = "manual"` after the controlled
English-preserving enrichment check. Return only consumed identifiers, never
raw text, in the auxiliary list. Use one stable
`basic editorial materialization is invalid` error.

- [ ] **Step 4: Confirm GREEN and commit**

```bash
pnpm --filter @navigator/db exec vitest run src/basic-editorial-materializer.test.ts src/basic-v2-fact-materializer.test.ts src/basic-document-observation.test.ts
git add packages/db/src/collection/basic-editorial-materializer.ts packages/db/src/basic-editorial-materializer.test.ts
git commit -m "feat: bind Basic editorial evidence"
```

---

### Task 5: Reviewed Source Union and Ownership Merge

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
  readonly documentResult: BasicDocumentMaterializationResult | null;
  readonly editorial: BasicCountryEditorialInput;
}): BasicReviewedMaterializationV2;
```

- [ ] **Step 1: Write failing merge/enrichment tests**

Assert exact identity equality across preliminary facts/register, editorial,
structured review, and branded document provenance. `structuredReview` is null
exactly when the preliminary run has no deterministic source. `documentResult`
is null exactly when `preliminary.documentCaptures` is empty; otherwise its
branded manual source set must equal the capture source set. Reject every
partial, duplicate, overlapping, foreign, or contradictory source combination.
For every manual source, require the document result record to match the
corresponding preliminary capture manifest and catalog source on source ID,
content hash, retrieval time, final/source URL, source name, access mode,
credibility, and source family; a separately branded result with the same IDs
but different captured bytes must fail closed.

Build `reviewedSources` as the unique source-ID-sorted union of preliminary
deterministic records and trusted document records. Require exact receipt
coverage for that union. Reparse the structured review against deterministic
IDs and use document-result checks/risks for manual IDs. Aggregate exactly one
source check per reviewed source and preserve every injection risk without
downgrading or filtering it before editorial validation.

Call `materializeBasicEditorialFacts()` with the reviewed source union, complete
checks/risks, preliminary facts and structured evidence, and the exact branded
document result. Replace the preliminary `country.name` fact with the one
manual enriched name fact returned by Editorial; never emit both.

For all other paths, reject deterministic/manual coexistence even when
normalized tuples match. Merge same-method observations through existing tuple
semantics and preserve conflicts rather than selecting a winner. Reject missing
required editorial paths, duplicate final paths, unsupported ownership,
operator-supplied derived facts, and any editorial attempt to replace a
protected source-backed path.

- [ ] **Step 2: Confirm RED**

Run `src/basic-v2-materialization.test.ts`; expect missing implementation.

- [ ] **Step 3: Implement source/fact terminal merge**

Snapshot exact inputs before use. Combine preliminary and trusted document
sources/facts, construct complete review arrays, and invoke Editorial once.
Bind each manual result record back to its preliminary capture and catalog
source before constructing the reviewed union.
Merge source locators from accepted source/document/editorial evidence,
unique-sort them, and preserve every source owner field. Carry path-free
receipts exactly once per active source. Return recursively frozen v2
register/facts/receipts plus unchanged checks/risks under one stable
`basic reviewed materialization is invalid` error.

- [ ] **Step 4: Confirm GREEN and commit**

```bash
pnpm --filter @navigator/db exec vitest run src/basic-v2-materialization.test.ts src/basic-editorial-materializer.test.ts src/basic-document-observation.test.ts
git add packages/db/src/collection/basic-v2-materialization.ts packages/db/src/collection/basic-collection-v2-contracts.ts packages/db/src/basic-v2-materialization.test.ts
git commit -m "feat: merge reviewed Basic facts"
```

---

### Task 6: Deterministic Derived Facts

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

### Task 7: Documentation, Determinism Gates, Review, and Integration

**Files:**
- Create: `docs/basic-country-editorial-input.md`
- Modify: `docs/basic-country-document-evidence.md`
- Modify: `docs/basic-country-audit-contract.md`
- Modify: `docs/basic-country-collection.md`
- Modify: `docs/roadmap.md`
- Modify: `packages/db/src/basic-editorial-materializer.test.ts`
- Modify: `packages/db/src/basic-v2-materialization.test.ts`
- Modify: `packages/db/src/basic-derived-fact-materializer.test.ts`

- [ ] **Step 1: Document operator and system ownership**

Document exact schema, allowlist, path-specific shapes, evidence matching, primary-source semantics, country-name exception, deterministic/manual collision rule, tag/region enums, derived formulas/locators/time fallback, final materialization result, and no-model/no-draft boundary.

- [ ] **Step 2: Add determinism/security regressions**

In the materialization tests, permute semantically equivalent object-key
insertion order, including integer-style keys, while retaining
contract-required sorted arrays and assert byte-identical `JSON.stringify`
output. Install throwing sentinels for global fetch, env access where safely
injectable, and every model/Hermes/search/socket/child-process port; assert none
are accessed. Assert inputs are unchanged and recursively frozen outputs are
fresh. Separately assert unsorted arrays, plain cloned document results, and
reviewed-source/provenance drift fail closed.

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
git add docs/basic-country-editorial-input.md docs/basic-country-document-evidence.md docs/basic-country-audit-contract.md docs/basic-country-collection.md docs/roadmap.md packages/db/src/basic-editorial-materializer.test.ts packages/db/src/basic-v2-materialization.test.ts packages/db/src/basic-derived-fact-materializer.test.ts
git commit -m "docs: define Basic editorial materialization"
```

Review against design/plan/base diff; fix every Critical/Important finding with a fresh fix agent and rerun all gates. Merge `--no-ff` into latest `main`, rerun all four gates, push, and verify local/remote equality before Deterministic begins.
