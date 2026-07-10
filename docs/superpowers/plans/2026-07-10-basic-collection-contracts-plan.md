# Basic Collection Audit Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Define and validate the country-neutral P1-6A audit contract, with deterministic offline fixtures for ready, missing, conflict, and untrusted collection outcomes.

**Architecture:** Keep the audit contract inside `@navigator/db`, beside the existing Basic seed boundary, without changing Prisma or canonical country data. Parse unknown JSON into reconstructed allowlisted values, classify review blockers separately from structural errors, and load actual four-file staging bundles through a path-safe filesystem adapter. Hermes, SearXNG, llama.cpp, network adapters, publication, and real-country data remain outside this slice.

**Tech Stack:** TypeScript strict mode, Node.js filesystem APIs, Vitest, pnpm workspace, existing `@navigator/shared-types` enums and `@navigator/db` validation helpers. No new dependencies.

## Global Constraints

- All files are country-neutral; do not add a real `data/<country>` seed or choose a pilot country.
- Do not modify `docs/data-schema.md`, Prisma schema, migrations, AI retrieval boundaries, permissions, billing, or membership behavior.
- Do not invoke Hermes, SearXNG, llama.cpp, browser tools, or any network source in production code or tests.
- Do not introduce a CSV parser, network SDK, schema library, or any other third-party dependency.
- Raw cache remains `.cache/basic-country/<ISO2>/<runId>/raw/`, is never read by the loader, and is never committed.
- Staging audit artifacts remain non-canonical and cannot enter Prisma import operations, C-end responses, coverage counts, or AI retrieval.
- Search summaries, `UNVERIFIED` sources, restricted/unknown-access sources, and suspected/confirmed prompt injection are untrusted and block review readiness.
- Conflicting evidence is retained without an automatically selected value; unresolved conflict always requires human review.
- `sourceUrl` must be present. A canonical draft may use `null` only when `source` explains the missing link, matching the existing Basic validator rule.
- Offline fixtures never mock or call the model. Model connectivity and schema-output failures belong to P1-6C.
- All production TypeScript files should remain at or below 300 lines; split parsing, classification, validation orchestration, and loading by responsibility.
- Every behavior change follows RED -> GREEN -> REFACTOR, and each task is committed independently with Conventional Commits.

---

### Task 1: Freeze the P1-6A audit contract and subtask boundaries

**Files:**
- Create: `docs/basic-country-audit-contract.md`
- Create: `docs/superpowers/plans/2026-07-10-basic-collection-contracts-plan.md`
- Modify: `docs/basic-country-collection.md`
- Modify: `docs/roadmap.md`

**Interfaces:**
- Consumes: `docs/basic-country-collection.md` sections 3-8, `docs/data-governance.md`, and `docs/roadmap.md` P1-6.
- Produces: the exact artifact/enumeration/readiness contract implemented by Tasks 2-3 and the P1-6A/P1-6B/P1-6C/P1-6D boundaries.

- [ ] **Step 1: Document the exact bundle and artifact envelopes**

Create `docs/basic-country-audit-contract.md` with these exact constants and top-level shapes:

```text
schemaVersion = basic-country-audit/v1

BasicCollectionAuditBundle:
  countryDirectory, runId, sourceRegister, extractedFacts,
  marketOverviewDraft, reviewReport

source-register.json:
  schemaVersion, runId, countryCode, sources

extracted-facts.json:
  schemaVersion, runId, countryCode, facts

review-report.json:
  schemaVersion, runId, countryCode, status, missingFields,
  conflicts, sourceChecks, injectionRisks,
  publicationRecommendation, humanDecision
```

Document every nested field from the TypeScript interfaces in Task 2, including nullability and enum values. State that production staging stores the four artifacts as separate files while committed tests may wrap them in one bundle-shaped fixture file.

- [ ] **Step 2: Document validation and classification semantics**

The contract must distinguish:

```text
valid = all artifact shapes, identities, JSON values, hashes, URLs,
        timestamps, field paths, and references are structurally valid

readyForHumanReview = valid and blockers is empty and the report says
                      ready-for-human-review/request-human-review

blockers:
  MISSING_REQUIRED_FACT
  UNRESOLVED_CONFLICT
  UNTRUSTED_INPUT
```

Document that a structurally valid missing/conflict/untrusted audit bundle is allowed but is not review-ready. A report that claims readiness while blockers exist is structurally inconsistent and therefore invalid.

- [ ] **Step 3: Resolve the four known ambiguities in the normative docs**

Update `docs/basic-country-collection.md` to state:

1. P1-6A supplies the machine-readable TypeScript contract and deterministic offline fixtures.
2. Offline fixtures do not call or mock Windows llama.cpp; runtime/model failure handling belongs to P1-6C.
3. Conflict values are never selected automatically; unresolved conflicts are retained and blocked.
4. Untrusted input includes discovery-only search material, `UNVERIFIED`, restricted/unknown access, and suspected/confirmed prompt injection.
5. `sourceUrl` being "complete" means the field exists; `null` follows the existing explanatory `source` rule.

- [ ] **Step 4: Split the P1-6 roadmap card without changing its total scope**

Replace the single P1-6 implementation card with four sequential cards:

```text
P1-6A Audit contract and offline fixtures
P1-6B Deterministic source adapters and raw capture
P1-6C Hermes discovery and llama.cpp schema draft bridge
P1-6D Offline end-to-end dry run and boundary verification
```

Keep `DATA-BASIC-<ISO2>` after P1-6D. Mark every subcard as no manual confirmation unless it introduces a third-party dependency or touches an existing AGENTS.md manual gate.

- [ ] **Step 5: Verify documentation consistency**

Run:

```bash
rg -n "basic-country-audit/v1|P1-6A|P1-6B|P1-6C|P1-6D|MISSING_REQUIRED_FACT|UNRESOLVED_CONFLICT|UNTRUSTED_INPUT|sourceUrl" docs/basic-country-audit-contract.md docs/basic-country-collection.md docs/roadmap.md
```

Expected: every constant and subcard appears in the intended documents, and no section authorizes automatic publication or canonical writes.

- [ ] **Step 6: Commit the documentation contract**

```bash
git add docs/basic-country-audit-contract.md docs/basic-country-collection.md docs/roadmap.md docs/superpowers/plans/2026-07-10-basic-collection-contracts-plan.md
git commit -m "docs: define Basic collection audit contract"
```

---

### Task 2: Parse, reconstruct, and classify audit bundles

**Files:**
- Create: `packages/db/src/collection/basic-collection-contracts.ts`
- Create: `packages/db/src/collection/basic-collection-parser.ts`
- Create: `packages/db/src/collection/basic-collection-classifier.ts`
- Create: `packages/db/src/collection/basic-collection-validator.ts`
- Create: `packages/db/src/basic-collection-test-fixture.ts`
- Create: `packages/db/src/basic-collection-validator.test.ts`

**Interfaces:**
- Consumes: the exact contract from Task 1; shared `Credibility`, `IndustryTag`, `LocalizedText`, and `TechTag`; P1-5 plain-record, exact-key, timestamp, URL, enum, and numeric helpers.
- Produces:
  - `BASIC_COLLECTION_AUDIT_SCHEMA_VERSION = "basic-country-audit/v1"`
  - `validateBasicCollectionAuditBundle(value: unknown): BasicCollectionAuditValidationResult`
  - reconstructed `BasicCollectionAuditBundle` data only on a structurally valid result.

- [ ] **Step 1: Define exact TypeScript contract types**

Create `basic-collection-contracts.ts` with these enums and interfaces:

```ts
import type {
  Credibility,
  IndustryTag,
  LocalizedText,
  TechTag,
} from "@navigator/shared-types";

export const BASIC_COLLECTION_AUDIT_SCHEMA_VERSION =
  "basic-country-audit/v1" as const;

export const BASIC_COLLECTION_BLOCKER_CODES = [
  "MISSING_REQUIRED_FACT",
  "UNRESOLVED_CONFLICT",
  "UNTRUSTED_INPUT",
] as const;
export type BasicCollectionBlockerCode =
  (typeof BASIC_COLLECTION_BLOCKER_CODES)[number];

export type BasicCollectionJsonValue =
  | null
  | boolean
  | number
  | string
  | BasicCollectionJsonValue[]
  | { [key: string]: BasicCollectionJsonValue };

export type BasicSourceFamily =
  | "international-organization"
  | "official-statistics"
  | "government"
  | "energy-authority"
  | "regulator"
  | "grid-operator"
  | "industry-association"
  | "verified-research";
export type BasicSourceAccessStatus = "open" | "restricted" | "unknown";
export type BasicPromptInjectionRisk = "none" | "suspected" | "confirmed";
export type BasicFactStatus = "candidate" | "missing" | "conflict" | "untrusted";
export type BasicExtractionMethod = "deterministic" | "hermes" | "manual";

export interface BasicSourceRecord {
  sourceId: string;
  sourceName: string;
  sourceUrl: string;
  retrievedAt: string;
  publishedAt: string | null;
  contentSha256: string;
  evidenceLocators: string[];
  sourceFamily: BasicSourceFamily;
  accessStatus: BasicSourceAccessStatus;
  accessNotes: string | null;
  credibility: Credibility;
  discoveryOnly: boolean;
  promptInjectionRisk: BasicPromptInjectionRisk;
}

export interface BasicSourceRegister {
  schemaVersion: typeof BASIC_COLLECTION_AUDIT_SCHEMA_VERSION;
  runId: string;
  countryCode: string;
  sources: BasicSourceRecord[];
}

export interface BasicFactEvidence {
  sourceId: string;
  locator: string;
  rawValue: BasicCollectionJsonValue;
  normalizedValue: BasicCollectionJsonValue;
  unit: string | null;
  year: number | null;
}

export interface BasicExtractedFact {
  factId: string;
  fieldPath: string;
  status: BasicFactStatus;
  evidence: BasicFactEvidence[];
  extractionMethod: BasicExtractionMethod;
  uncertainty: string | null;
}

export interface BasicExtractedFacts {
  schemaVersion: typeof BASIC_COLLECTION_AUDIT_SCHEMA_VERSION;
  runId: string;
  countryCode: string;
  facts: BasicExtractedFact[];
}

export interface BasicDraftKeyIndicator {
  label: LocalizedText;
  value: string;
  unit: string;
  year: number;
}

export interface BasicMarketOverviewDraft {
  overview: LocalizedText;
  population: number | null;
  gdp: number | null;
  gdpGrowth: number | null;
  energyDemand: LocalizedText;
  renewableTarget: LocalizedText;
  keyIndicators: BasicDraftKeyIndicator[];
  source: string;
  sourceUrl: string | null;
  collectedAt: string;
  updatedAt: string;
  credibility: Credibility;
  reviewStatus: "draft";
  aiUsable: false;
  countryCode: string;
  industryTags: IndustryTag[];
  techTags: TechTag[];
}

export interface BasicReviewConflict {
  fieldPath: string;
  factIds: string[];
  resolution: "unresolved" | "resolved";
  notes: string;
}

export interface BasicSourceCheck {
  sourceId: string;
  status: "passed" | "failed";
  notes: string | null;
}

export interface BasicInjectionRisk {
  sourceId: string;
  locator: string;
  severity: "suspected" | "confirmed";
  details: string;
}

export interface BasicHumanDecision {
  decision: "approved" | "rejected";
  reviewerId: string;
  decidedAt: string;
  notes: string;
}

export interface BasicCollectionReviewReport {
  schemaVersion: typeof BASIC_COLLECTION_AUDIT_SCHEMA_VERSION;
  runId: string;
  countryCode: string;
  status: "ready-for-human-review" | "blocked";
  missingFields: string[];
  conflicts: BasicReviewConflict[];
  sourceChecks: BasicSourceCheck[];
  injectionRisks: BasicInjectionRisk[];
  publicationRecommendation: "request-human-review" | "do-not-publish";
  humanDecision: BasicHumanDecision | null;
}

export interface BasicCollectionAuditBundle {
  countryDirectory: string;
  runId: string;
  sourceRegister: BasicSourceRegister;
  extractedFacts: BasicExtractedFacts;
  marketOverviewDraft: BasicMarketOverviewDraft;
  reviewReport: BasicCollectionReviewReport;
}

export interface BasicCollectionAuditSummary {
  countryCode: string;
  runId: string;
  sourceCount: number;
  factCount: number;
}

export type BasicCollectionAuditValidationResult =
  | {
      valid: true;
      data: BasicCollectionAuditBundle;
      errors: [];
      readyForHumanReview: boolean;
      blockers: BasicCollectionBlockerCode[];
      summary: BasicCollectionAuditSummary;
    }
  | {
      valid: false;
      data: null;
      errors: string[];
      readyForHumanReview: false;
      blockers: BasicCollectionBlockerCode[];
      summary: BasicCollectionAuditSummary;
    };
```

There is no automatic `publish` recommendation value. Runtime validation must ensure an invalid result contains at least one error even though TypeScript represents the collection as `string[]`.

- [ ] **Step 2: Write RED parser and reconstruction tests**

In `basic-collection-test-fixture.ts`, create `createBasicCollectionAuditFixture()` returning a fully valid synthetic `XZ` bundle. In `basic-collection-validator.test.ts`, write tests that initially fail because the validator does not exist:

```ts
test("reconstructs an exact valid audit bundle", () => {
  const result = validateBasicCollectionAuditBundle(
    createBasicCollectionAuditFixture(),
  );
  expect(result).toMatchObject({
    valid: true,
    readyForHumanReview: true,
    blockers: [],
  });
  expect(result.data).not.toBeNull();
});
```

Add five separately named tests: an extra key on a source record, an inherited evidence record, a cyclic `rawValue`, a bigint `normalizedValue`, and mismatched `runId`/`countryCode`. Each test must assert that validation does not throw, returns `valid: false`, returns `data: null`, and includes a path-specific error.

Run:

```bash
pnpm --filter @navigator/db exec vitest run src/basic-collection-validator.test.ts
```

Expected: FAIL because `validateBasicCollectionAuditBundle` is missing.

- [ ] **Step 3: Implement allowlisted parsing and safe JSON reconstruction**

`basic-collection-parser.ts` must:

1. Accept only standard plain objects with exact own string keys for every envelope and nested record.
2. Reconstruct each output object and array instead of forwarding input references.
3. Recursively reconstruct finite JSON values; reject `undefined`, non-finite numbers, bigint, symbol, function, cycles, custom prototypes, inherited keys, and symbol keys.
4. Validate strict UTC RFC3339 timestamps (`YYYY-MM-DDTHH:mm:ssZ` or 1 to 3 fractional digits before uppercase `Z`, with a valid calendar date and no offset), lowercase 64-character SHA-256, HTTP(S) URLs, uppercase two-letter country codes, safe run IDs/slugs, registered shared enums, and evidence locators that are non-empty after `trim()`.
5. Accept only the exact `country.*` and `marketOverview.*` fieldPath allowlist in `docs/basic-country-audit-contract.md`, with `marketOverview.keyIndicators[non-negative-index].{label,value,unit,year}` using decimal non-negative indexes. Reject `workflow`, coverage paths, `reviewStatus`, `aiUsable`, `audit`, `knowledge`, manifest, staging, raw-cache, and every other path.
6. Enforce evidence cardinality: candidate >= 1, missing = 0, conflict >= 2 distinct source IDs, untrusted >= 1.
7. Validate the complete market-overview draft shape, exact LocalizedText and indicator keys, `reviewStatus = draft`, and `aiUsable = false`.
8. Treat `sourceUrl = null` as structurally valid only when `source` contains the existing `sourceUrl null` explanation marker.

- [ ] **Step 4: Write RED blocker-classification tests**

Add four independent tests:

```ts
test.each([
  ["normal", [], true],
  ["missing", ["MISSING_REQUIRED_FACT"], false],
  ["conflict", ["UNRESOLVED_CONFLICT"], false],
  ["untrusted", ["UNTRUSTED_INPUT"], false],
])("classifies %s audit input", (_name, blockers, ready) => {
  const result = validateBasicCollectionAuditBundle(
    createBasicCollectionAuditFixture(_name),
  );
  expect(result.valid).toBe(true);
  expect(result.blockers).toEqual(blockers);
  expect(result.readyForHumanReview).toBe(ready);
});
```

The fixture helper must create internally consistent reports: normal uses ready/request-human-review; blocked cases use blocked/do-not-publish and list the corresponding missing field, unresolved conflict, or injection/source failure.

Run the focused test and confirm RED because classification is not implemented.

- [ ] **Step 5: Implement cross-artifact classification**

`basic-collection-classifier.ts` must:

1. Resolve every evidence `sourceId` and every review-report `sourceId`/`factId` against the reconstructed registers.
2. Emit `MISSING_REQUIRED_FACT` for missing facts or listed missing fields.
3. Emit `UNRESOLVED_CONFLICT` for `status = conflict` facts or unresolved report conflicts; never add a selected conflict value.
4. Emit `UNTRUSTED_INPUT` for untrusted facts, discovery-only sources, non-open access, `UNVERIFIED`, prompt-injection risk, failed source checks, or injection-risk records.
5. Deduplicate blocker codes in the constant order.
6. Reject report/readiness inconsistencies as structural errors.

`basic-collection-validator.ts` must orchestrate parse + classify and return the discriminated result without throwing for unknown input.

- [ ] **Step 6: Run focused and DB-package verification**

```bash
pnpm --filter @navigator/db exec vitest run src/basic-collection-validator.test.ts
pnpm --filter @navigator/db typecheck
pnpm --filter @navigator/db test
git diff --check
```

Expected: focused tests pass; existing P1-5 and Indonesia tests remain green.

- [ ] **Step 7: Commit the contract parser and classifier**

```bash
git add packages/db/src/collection packages/db/src/basic-collection-test-fixture.ts packages/db/src/basic-collection-validator.test.ts
git commit -m "feat: validate Basic collection audit bundles"
```

---

### Task 3: Add path-safe loading, committed fixtures, exports, and seed isolation

**Files:**
- Create: `packages/db/src/collection/basic-collection-loader.ts`
- Create: `packages/db/src/basic-collection-loader.test.ts`
- Create: `packages/db/fixtures/basic-collection/normal.json`
- Create: `packages/db/fixtures/basic-collection/missing.json`
- Create: `packages/db/fixtures/basic-collection/conflict.json`
- Create: `packages/db/fixtures/basic-collection/untrusted.json`
- Modify: `packages/db/src/index.ts`
- Modify: `packages/db/src/index.test.ts`
- Modify: `packages/db/src/basic-collection-test-fixture.ts`
- Test: `packages/db/src/basic-country-import.test.ts`
- Modify: `docs/basic-country-audit-contract.md`

**Interfaces:**
- Consumes: `validateBasicCollectionAuditBundle()` and the reconstructed contract from Task 2.
- Produces:
  - `loadBasicCollectionAuditBundle(repoRoot: string, countryDirectory: string, runId: string): BasicCollectionAuditBundle`
  - committed deterministic bundle fixtures for all four classifications
  - public `@navigator/db` exports for the loader, validator, schema version, blocker constants, and contract types.

- [ ] **Step 1: Commit four deterministic offline fixture bundles**

Each fixture JSON is a test-only bundle envelope with exact keys from Task 2 and uses synthetic country code `XZ`, `.test` URLs, strict timestamps, lowercase 64-character hashes, and an `AUDIT_SENTINEL_<SCENARIO>` value in evidence.

Scenario requirements:

| Fixture | Fact/report state | Expected result |
|---|---|---|
| `normal.json` | candidate evidence from open, original, non-UNVERIFIED sources; passed checks; draft/false | valid, ready, no blockers |
| `missing.json` | nullable `marketOverview.gdp` is null with a missing fact and listed missing field | valid, not ready, `MISSING_REQUIRED_FACT` |
| `conflict.json` | two distinct source values for population, unresolved conflict, draft population null | valid, not ready, `UNRESOLVED_CONFLICT` |
| `untrusted.json` | discovery-only or UNVERIFIED evidence plus confirmed injection risk, draft value null | valid, not ready, `UNTRUSTED_INPUT` |

Run the validator tests against the committed files and compare two reads with `toEqual()` to prove deterministic offline behavior.

- [ ] **Step 2: Write RED path-safe loader tests**

`basic-collection-loader.test.ts` must write each fixture envelope into a temporary production-shaped directory:

```text
data/staging/<countryDirectory>/<runId>/
  source-register.json
  extracted-facts.json
  market-overview.draft.json
  review-report.json
```

Test successful loading plus rejection of:

```text
countryDirectory = ../fixture-country
runId = ../run-normal
missing source-register.json
malformed JSON
artifact identity mismatch
```

Run the focused test and confirm RED because the loader is missing.

- [ ] **Step 3: Implement the loader**

`loadBasicCollectionAuditBundle()` must:

1. Validate `countryDirectory` and `runId` before any path join.
2. Read exactly the four documented files under `data/staging`; never inspect `.cache`, `collection-manifest.json`, canonical `data/<country>`, or any optional module.
3. Parse JSON as `unknown`, pass the assembled envelope through `validateBasicCollectionAuditBundle()`, throw joined structural errors when invalid, and return only reconstructed data.
4. Return blocked-but-valid fixtures without throwing so callers can inspect blockers separately with the validator.

- [ ] **Step 4: Add public exports and export tests**

Export:

```ts
export {
  BASIC_COLLECTION_AUDIT_SCHEMA_VERSION,
  BASIC_COLLECTION_BLOCKER_CODES,
} from "./collection/basic-collection-contracts.js";
export { loadBasicCollectionAuditBundle } from "./collection/basic-collection-loader.js";
export { validateBasicCollectionAuditBundle } from "./collection/basic-collection-validator.js";
export type {
  BasicCollectionAuditBundle,
  BasicCollectionAuditSummary,
  BasicCollectionAuditValidationResult,
  BasicCollectionBlockerCode,
  BasicCollectionJsonValue,
  BasicCollectionReviewReport,
  BasicDraftKeyIndicator,
  BasicExtractedFact,
  BasicExtractedFacts,
  BasicExtractionMethod,
  BasicFactEvidence,
  BasicFactStatus,
  BasicHumanDecision,
  BasicInjectionRisk,
  BasicMarketOverviewDraft,
  BasicPromptInjectionRisk,
  BasicReviewConflict,
  BasicSourceAccessStatus,
  BasicSourceCheck,
  BasicSourceFamily,
  BasicSourceRecord,
  BasicSourceRegister,
} from "./collection/basic-collection-contracts.js";
```

Extend `index.test.ts` to assert both functions are exported and the two constants have their exact values.

- [ ] **Step 5: Prove audit artifacts cannot enter the seed import plan**

Extend `basic-country-import.test.ts` with one fixture-backed assertion:

1. Put the normal fixture artifacts, including `AUDIT_SENTINEL_NORMAL`, into the existing valid bundle's `audit.run` fields.
2. Build the Basic import plan.
3. Assert `JSON.stringify(plan)` contains none of `AUDIT_SENTINEL`, `sourceRegister`, `extractedFacts`, `reviewReport`, `collection-manifest`, `data/staging`, or `.cache/basic-country`.
4. Assert the operation list remains exactly country + 10 module coverage + market overview.

- [ ] **Step 6: Run task and repository verification**

```bash
pnpm --filter @navigator/db exec vitest run src/basic-collection-validator.test.ts src/basic-collection-loader.test.ts src/basic-country-import.test.ts src/index.test.ts
pnpm lint
pnpm typecheck
pnpm test
git diff --check
```

Expected: all commands exit 0; no test performs network access or calls Hermes/llama.cpp.

- [ ] **Step 7: Commit loader, fixtures, exports, and isolation proof**

```bash
git add packages/db/src packages/db/fixtures/basic-collection docs/basic-country-audit-contract.md
git commit -m "test: add Basic collection audit fixtures"
```

---

## Final Review Checklist

- [ ] No dependency, lockfile, Prisma, migration, real-country data, Web, AI-advisor, permission, or billing changes.
- [ ] All unknown JSON is parsed from allowlisted own keys and reconstructed; no audit input object is forwarded by reference.
- [ ] Structural validity and review readiness remain separate concepts.
- [ ] Search-only, restricted/unknown, UNVERIFIED, and injection-risk inputs cannot become review-ready.
- [ ] Conflict evidence is retained with no automatically selected value.
- [ ] Draft output cannot be `published` and cannot set `aiUsable = true`.
- [ ] The loader reads only the four staging artifacts and rejects path traversal.
- [ ] Audit sentinels cannot enter the 12-operation Basic import plan.
- [ ] Focused, package, and repository checks are green before merge.
