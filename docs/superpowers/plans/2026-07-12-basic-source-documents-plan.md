# Basic Document Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run catalog-selected v2 sources into preliminary structured facts or verified HTML/PDF captures, then promote reviewed document observations into audit/v2 source records and manual facts without parsing document bodies or accepting bilingual editorial content.

**Architecture:** A catalog-driven v2 runner executes deterministic adapters and a generic manual-document capture path behind one execution plan. Exact structured/manual review inputs bind human checks to run and catalog identity. Exact document plans bind every claimed observation to one immutable capture manifest. A common v2 fact materializer applies existing tuple/conflict semantics with an explicit extraction method, while source ownership is reconstructed from catalog, capture, adapter, and review inputs.

**Tech Stack:** TypeScript strict mode, existing catalog/v2 capture APIs, existing World Bank adapters, Vitest, pnpm workspace. No new dependencies.

## Global Constraints

- Read `AGENTS.md`, the approved source-boundary design, and completed Catalog/Formats docs before editing.
- Work only on `feat/DATA-BASIC-DOCUMENTS-1` from latest pushed `main` after Formats is merged.
- Use TDD; show one expected RED before each implementation slice.
- Do not parse HTML/PDF DOM or text, do OCR, infer a locator, translate, summarize, or call a model/search/agent.
- Do not accept editorial paths as final facts in this task. `editorial-evidence` remains a typed, verified intermediate for the next task.
- Do not modify v1 audit/capture/runner/materializer/public exports. All v2 APIs remain package-private; `packages/db/src/index.ts` stays unchanged.
- Do not modify existing adapters. Catalog is metadata/request authority; adapter is response/extraction authority.
- Do not write canonical/staging/database data and do not add dependencies.
- A run has at most 64 active sources. Structured and manual review source sets must be non-empty, unique, sorted, disjoint, and exactly cover their corresponding execution entries.
- Generic finite-JSON object values are reconstructed with lexicographically sorted keys so object insertion order cannot change artifact bytes; contract arrays retain their required reviewed order.
- All identity mismatch and content failures are stable and redacted; do not echo URL values, raw values, document excerpts, tokens, cookies, or dependency errors.

---

## File Structure

### Create

- `packages/db/src/collection/basic-collection-v2-contracts.ts` - audit/v2 source/fact/intermediate contracts.
- `packages/db/src/collection/basic-v2-fact-materializer.ts` - deterministic/manual tuple materialization.
- `packages/db/src/collection/basic-source-review-contracts.ts` - structured/manual review types and schema constants.
- `packages/db/src/collection/basic-source-review-parser.ts` - exact review reconstruction and identity checks.
- `packages/db/src/collection/basic-source-plan-runner-v2.ts` - catalog-driven deterministic/manual capture runner.
- `packages/db/src/collection/basic-document-observation-contracts.ts` - document plan and observation unions.
- `packages/db/src/collection/basic-document-observation-parser.ts` - exact plan reconstruction.
- `packages/db/src/collection/basic-document-observation-materializer.ts` - capture/review/locator/source ownership validation.
- `packages/db/src/basic-v2-fact-materializer.test.ts`
- `packages/db/src/basic-source-review-parser.test.ts`
- `packages/db/src/basic-source-plan-runner-v2.test.ts`
- `packages/db/src/basic-document-observation.test.ts`
- `docs/basic-country-document-evidence.md`

### Modify

- `docs/basic-source-formats.md`, `docs/basic-country-audit-contract.md`, `docs/basic-country-collection.md`, and `docs/roadmap.md`.

### Must Remain Unchanged

- v1 contracts/parser/validator/loader/runner/materializer and all v1 schema constants.
- World Bank adapter implementations and fixtures.
- `packages/db/src/index.ts`, Prisma, `data/**`, AI, permissions, billing, and Web.

---

### Task 1: Audit/v2 Preliminary Contracts and Fact Materializer

**Files:**
- Create: `packages/db/src/collection/basic-collection-v2-contracts.ts`
- Create: `packages/db/src/collection/basic-v2-fact-materializer.ts`
- Create: `packages/db/src/basic-v2-fact-materializer.test.ts`

**Interfaces:**

```ts
export const BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION =
  "basic-country-audit/v2" as const;

export type BasicExtractionMethodV2 = "deterministic" | "manual";

export interface BasicSourceRegisterV2 {
  readonly schemaVersion: typeof BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION;
  readonly runId: string;
  readonly countryCode: string;
  readonly catalogVersion: string;
  readonly catalogSha256: string;
  readonly sources: readonly BasicSourceRecord[];
}

export interface BasicExtractedFactsV2 {
  readonly schemaVersion: typeof BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION;
  readonly runId: string;
  readonly countryCode: string;
  readonly facts: readonly BasicExtractedFactV2[];
}

export interface BasicSourcedObservationV2
  extends BasicDeterministicObservation {
  readonly sourceId: string;
}

export type BasicV2FieldOwner =
  | "source-backed"
  | "hybrid-name"
  | "editorial"
  | "derived";

export function classifyBasicV2FieldPath(
  fieldPath: string,
): BasicV2FieldOwner | null;

export function materializeBasicSourceFactsV2(
  observations: readonly BasicSourcedObservationV2[],
  extractionMethod: BasicExtractionMethodV2,
): readonly BasicExtractedFactV2[];
```

Also define frozen intermediate types `BasicDocumentCaptureV2`, `BasicEditorialEvidenceObservation`, `BasicStructuredEditorialEvidenceObservation`, `BasicPreliminarySourceRunV2`, and path-free `BasicRawCaptureReceiptV2`. Structured editorial evidence has exact keys `sourceId`, `fieldPath`, `locator`, and `rawValue`; it is not a final fact. The preliminary result exact keys are `sourceRegister`, `extractedFacts`, `structuredEditorialEvidence`, `documentCaptures`, and `receipts`.

- [ ] **Step 1: Write failing tuple tests**

Port v1 tests for stable fact IDs/order, equal normalized tuple -> candidate, different tuple across sources -> conflict, multiple tuples from one source -> structural error, evidence sorting, uncertainty merge, finite JSON, and input immutability. Run each for `deterministic` and `manual`; reject all other methods including `hermes`. Table-test every static and indicator path through `classifyBasicV2FieldPath()` so Documents, Editorial, validator, and preflight share one ownership definition.

- [ ] **Step 2: Confirm RED**

```bash
pnpm --filter @navigator/db exec vitest run src/basic-v2-fact-materializer.test.ts
```

- [ ] **Step 3: Implement explicit-method materialization**

Copy no mutable v1 values. Reuse a shared pure canonical JSON helper only if extracting it leaves v1 behavior byte-identical and v1 tests prove it. Otherwise implement a package-private v2 equivalent. Freeze returned facts/evidence recursively.

- [ ] **Step 4: Confirm GREEN and commit**

```bash
pnpm --filter @navigator/db exec vitest run src/basic-v2-fact-materializer.test.ts src/basic-source-adapter-runner.test.ts
git add packages/db/src/collection/basic-collection-v2-contracts.ts packages/db/src/collection/basic-v2-fact-materializer.ts packages/db/src/basic-v2-fact-materializer.test.ts
git commit -m "feat: define Basic audit v2 facts"
```

---

### Task 2: Exact Structured and Manual Source Reviews

**Files:**
- Create: `packages/db/src/collection/basic-source-review-contracts.ts`
- Create: `packages/db/src/collection/basic-source-review-parser.ts`
- Create: `packages/db/src/basic-source-review-parser.test.ts`

**Interfaces:**

```ts
export const BASIC_STRUCTURED_SOURCE_REVIEW_SCHEMA_VERSION =
  "basic-structured-source-review/v1" as const;
export const BASIC_MANUAL_SOURCE_REVIEW_SCHEMA_VERSION =
  "basic-manual-source-review/v1" as const;

export function parseBasicStructuredSourceReview(
  value: unknown,
  expected: BasicReviewIdentityExpectation,
): BasicStructuredSourceReview;

export function parseBasicManualSourceReview(
  value: unknown,
  expected: BasicReviewIdentityExpectation,
): BasicManualSourceReview;
```

`BasicReviewIdentityExpectation` contains exact run/country/catalog identity and sorted deterministic/manual source ID lists. Structured source entries contain exact `sourceId` and `sourceCheck`. Top-level risks use existing exact `{sourceId, locator, severity, details}`. Manual source entries contain exact `sourceId`, `publishedAt`, `accessNotes`, `promptInjectionRisk`, `sourceCheck`, and local risks `{locator,severity,details}`.

- [ ] **Step 1: Add failing exact-review tests**

Test full valid structured/manual inputs and recursive freezing. Reject extra/missing/accessor/symbol/proxy/cycle/sparse values, identity/digest mismatch, unsorted/duplicate/wrong/empty source coverage, overlap between review kinds, unknown risk sources, blank or malformed risk locators, invalid status/notes, invalid UTC RFC3339, empty strings, and every resource limit. Exact risk-locator membership is checked later against source facts or document plans, where that evidence exists.

Manual-specific rules:

- `publishedAt = null` requires non-empty `sourceCheck.notes` explaining absence.
- `promptInjectionRisk` must be explicitly present and one of `none|suspected|confirmed`.
- `none` requires no local risks.
- `suspected|confirmed` requires at least one same-severity risk; additional reviewed risk rows may retain their own supported severity.
- Failed checks remain valid review input but will block candidate preflight later.

- [ ] **Step 2: Confirm RED**

Run `src/basic-source-review-parser.test.ts`; expect missing parser.

- [ ] **Step 3: Implement exact reconstruction**

Use schema-specific stable errors `structured source review is invalid` and `manual source review is invalid`. Do not normalize notes beyond validating nonblank where required; preserve reviewed text verbatim.

- [ ] **Step 4: Confirm GREEN and commit**

```bash
pnpm --filter @navigator/db exec vitest run src/basic-source-review-parser.test.ts
git add packages/db/src/collection/basic-source-review-contracts.ts packages/db/src/collection/basic-source-review-parser.ts packages/db/src/basic-source-review-parser.test.ts
git commit -m "feat: validate Basic source reviews"
```

---

### Task 3: Catalog-Driven v2 Source Plan Runner

**Files:**
- Create: `packages/db/src/collection/basic-source-plan-runner-v2.ts`
- Create: `packages/db/src/basic-source-plan-runner-v2.test.ts`

**Interfaces:**

```ts
export interface BasicSourcePlanRunnerInputV2 {
  readonly repoRoot: string;
  readonly countryCode: string;
  readonly runId: string;
  readonly plan: BasicSourceExecutionPlan;
  readonly transport: BasicSourceTransportV2;
}

export async function runBasicSourceExecutionPlanV2(
  value: BasicSourcePlanRunnerInputV2,
): Promise<BasicPreliminarySourceRunV2>;
```

- [ ] **Step 1: Write failing runner tests**

For deterministic entries, assert order-independent input produces source-ID order; adapter binding occurs before cache/network; v2 capture is called; adapter extraction receives immutable body metadata; output observations are a non-empty subset of catalog `fieldPaths`; source record fields use exact catalog/capture/adapter owners; receipts contain no paths. Split observations by the centralized ownership sets: source-backed paths become deterministic facts, `country.name` becomes its deterministic preliminary fact, editorial-owned paths become sorted `structuredEditorialEvidence`, and derived paths fail before returning material. Source evidence locators include both fact and structured-editorial locators.

For manual-document entries, assert the single generic executor captures bytes but does not parse body, create source records, or create preliminary facts; it returns a `BasicDocumentCaptureV2` containing catalog entry and verified v2 manifest/capture identity for later review. Revalidate `basic-manual-document-capture@1.0.0` immediately before capture; an unknown/drifted ID or version must leave fake transport call count and cache directory count at zero.

Reject over 64 entries, optional credentials, mixed digest, non-plan entries, metadata/request drift, adapter throw, invalid adapter output, output path escape, HTML/PDF marked deterministic, JSON/CSV marked manual, and all global fetch/model/Hermes/search/socket/child-process sentinels.

- [ ] **Step 2: Confirm RED**

```bash
pnpm --filter @navigator/db exec vitest run src/basic-source-plan-runner-v2.test.ts
```

- [ ] **Step 3: Implement the runner**

Snapshot input; validate plan identity against country and each entry. Resolve deterministic adapters through the static registry, convert the planned request to `BasicSourceRequestV2`, capture, extract, validate field subset, classify each observation by path ownership, then create preliminary source/facts/evidence. For `manual-document`, first enforce the fixed generic identity, then call only `captureBasicRawSourceV2`; never inspect `body` beyond capture verification and do not expose raw bytes in the returned document descriptor.

The preliminary source register and every document capture carry the one plan `catalogVersion/catalogSha256`; extracted facts carry the same run/country identity and can only be produced inside that execution. Freeze the complete result.

- [ ] **Step 4: Confirm GREEN and commit**

```bash
pnpm --filter @navigator/db exec vitest run src/basic-source-plan-runner-v2.test.ts src/basic-source-catalog.test.ts src/world-bank-source-adapters.test.ts src/basic-raw-capture-v2.test.ts
git add packages/db/src/collection/basic-source-plan-runner-v2.ts packages/db/src/basic-source-plan-runner-v2.test.ts
git commit -m "feat: run reviewed Basic source plans"
```

---

### Task 4: Exact Document Observation Plans

**Files:**
- Create: `packages/db/src/collection/basic-document-observation-contracts.ts`
- Create: `packages/db/src/collection/basic-document-observation-parser.ts`
- Create: `packages/db/src/basic-document-observation.test.ts`

**Interfaces:**

```ts
export const BASIC_DOCUMENT_OBSERVATION_PLAN_SCHEMA_VERSION =
  "basic-document-observation-plan/v1" as const;

export type BasicDocumentObservation =
  | {
      readonly usage: "source-fact";
      readonly fieldPath: string;
      readonly locator: string;
      readonly rawValue: BasicCollectionJsonValue;
      readonly normalizedValue: BasicCollectionJsonValue;
      readonly unit: string | null;
      readonly year: number | null;
      readonly uncertainty: string | null;
    }
  | {
      readonly usage: "editorial-evidence";
      readonly fieldPath: string;
      readonly locator: string;
      readonly rawValue: BasicCollectionJsonValue;
    };

export function parseBasicDocumentObservationPlan(
  value: unknown,
): BasicDocumentObservationPlan;
```

- [ ] **Step 1: Add failing plan/locator tests**

Test exact identity/capture keys and both union variants. Reject extra keys on either variant, empty observations, duplicate observation identity, invalid finite JSON, wrong source-backed/editorial path ownership, bad numeric/unit/year/uncertainty contract, oversized input, and unsorted observations.

HTML locators match `html:<nonblank-reviewed-location>`. PDF locators match `pdf:page=<positive-integer>#<nonblank-anchor>`. Reject cross-format locator, page 0, whitespace-only anchors, URL/search locators, and metadata/capture locators supplied by operator.

- [ ] **Step 2: Confirm RED, implement, and confirm GREEN**

Use one stable `document observation plan is invalid` error. Preserve `rawValue` exactly as reconstructed finite JSON; do not inspect raw captured bytes.

```bash
pnpm --filter @navigator/db exec vitest run src/basic-document-observation.test.ts
git add packages/db/src/collection/basic-document-observation-contracts.ts packages/db/src/collection/basic-document-observation-parser.ts packages/db/src/basic-document-observation.test.ts
git commit -m "feat: validate Basic document plans"
```

---

### Task 5: Document Evidence Materialization and Source Ownership

**Files:**
- Create: `packages/db/src/collection/basic-document-observation-materializer.ts`
- Modify: `packages/db/src/basic-document-observation.test.ts`

**Interfaces:**

```ts
export interface BasicDocumentMaterializationResult {
  readonly sources: readonly BasicSourceRecord[];
  readonly facts: readonly BasicExtractedFactV2[];
  readonly editorialEvidence: readonly BasicEditorialEvidenceObservation[];
  readonly sourceChecks: readonly BasicSourceCheck[];
  readonly injectionRisks: readonly BasicInjectionRisk[];
}

export function materializeBasicDocumentEvidence(input: {
  readonly plan: BasicSourceExecutionPlan;
  readonly captures: readonly BasicDocumentCaptureV2[];
  readonly review: BasicManualSourceReview;
  readonly documentPlans: readonly BasicDocumentObservationPlan[];
}): BasicDocumentMaterializationResult;
```

- [ ] **Step 1: Add failing ownership/binding tests**

Assert exact matching of run/country/catalog digest, source ID, adapter ID/version, request URL, content type, retrieval timestamp, byte length, hash, and one plan per manual source. Require review coverage and every plan observation reviewed against that exact hash. Verify source-field ownership table from the approved design and sorted locator union.

Reject missing/duplicate/orphan plan or capture, structured/manual source overlap, catalog mismatch, non-open execution, review/plan risk locator mismatch, conflicting owner values, unaccepted locator, source-fact on editorial path, editorial-evidence on source path, and mixed MIME/locator. Preserve `UNVERIFIED`, failed checks, and declared prompt-injection risk in the reviewed material; the deterministic preflight task must block them rather than silently dropping the source.

`source-fact` observations become `manual` facts via `materializeBasicSourceFactsV2`. `editorial-evidence` remains only the frozen intermediate; no final fact is produced. A failed source check is preserved in output and produces no silent downgrade.

- [ ] **Step 2: Confirm RED**

Run `src/basic-document-observation.test.ts`; expect materializer missing.

- [ ] **Step 3: Implement exact field ownership**

Construct each source record using catalog metadata, capture metadata, and manual review fields exactly as specified. `accessStatus` is `open`, `discoveryOnly` is false. Evidence locators include only accepted document observations in this task; derived locators are added later.

- [ ] **Step 4: Confirm GREEN and commit**

```bash
pnpm --filter @navigator/db exec vitest run src/basic-document-observation.test.ts src/basic-source-review-parser.test.ts src/basic-v2-fact-materializer.test.ts
git add packages/db/src/collection/basic-document-observation-materializer.ts packages/db/src/basic-document-observation.test.ts
git commit -m "feat: materialize reviewed Basic documents"
```

---

### Task 6: Documentation, Gates, Review, and Integration

**Files:**
- Create: `docs/basic-country-document-evidence.md`
- Modify: `docs/basic-source-formats.md`
- Modify: `docs/basic-country-audit-contract.md`
- Modify: `docs/basic-country-collection.md`
- Modify: `docs/roadmap.md`

- [ ] **Step 1: Document contracts and explicit exclusions**

Document audit/v2 preliminary envelopes, review schemas, source ownership table, document-plan union, locator grammar, capture-hash binding, tuple/conflict rules, generic executor, review semantics, and the no parsing/OCR/model/editorial/draft boundary.

- [ ] **Step 2: Run scans and all gates**

```bash
rg -n "basic-structured-source-review/v1|basic-manual-source-review/v1|basic-document-observation-plan/v1|basic-country-audit/v2|DATA-BASIC-DOCUMENTS-1" docs packages/db/src
rg -n "pdfjs|pdf-parse|cheerio|jsdom|ocr|tesseract|Hermes|llama" packages/db/src/collection/basic-*v2*.ts packages/db/src/collection/basic-document-*.ts
git diff --check
pnpm lint
pnpm typecheck
pnpm test
pnpm turbo run lint typecheck test --force
```

The second scan must find no runtime import/call. No E2E is required.

- [ ] **Step 3: Commit docs, review, merge, and push**

```bash
git add docs/basic-country-document-evidence.md docs/basic-source-formats.md docs/basic-country-audit-contract.md docs/basic-country-collection.md docs/roadmap.md
git commit -m "docs: define Basic document evidence"
```

Dispatch an independent reviewer against the design/plan/diff. Fix every Critical/Important issue with a fresh fix agent, rerun focused/full gates, merge `--no-ff` into latest `main`, rerun all four gates, push, and confirm `main == origin/main` before Editorial begins.
