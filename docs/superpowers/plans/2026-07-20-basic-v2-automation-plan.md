# BASIC v2 Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Every production behavior follows test-first RED/GREEN verification.

**Goal:** Add a backward-compatible eight-category BASIC profile, reusable source pack, three-country draft preparation, deterministic bilingual review packs, and a human-receipt-gated single-country publication CLI without changing existing six-country publications or the AI boundary.

**Architecture:** Keep the existing `basic-country-audit/v2` four-file candidate and `basic-country-publication-manifest/v2` gate as the security core. Add an optional validated `basicProfile` JSON projection to MarketOverview, then compose batch/review/publish orchestration around the existing single-country candidate writer and publication materializer. Legacy canonical publications remain byte-identical and normalize an omitted profile to `null` only at the database boundary.

**Tech Stack:** TypeScript strict mode, Node.js standard library, pnpm, Vitest, Prisma/PostgreSQL, existing Next.js/NestJS read path. No Python, LLM, new dependency, AI retrieval change, automatic approval, or destructive database operation.

## Global Constraints

- All countries use the same eight BASIC profile categories: `countryBasics`, `electricityMarket`, `energyAccess`, `renewableCapacity`, `solarResource`, `windResource`, `policyOverview`, `marketSummary`.
- Energy access contains electricity access only; clean cooking is not collected.
- Every profile field has field-level citations and checked date; `NOT_AVAILABLE` additionally has checked sources and a non-empty `{ zh, en }` reason.
- Deterministic bilingual templates may interpolate reviewed value, unit, year, and source IDs only; no LLM is called.
- Batch preparation accepts one to three unique uppercase ISO2 codes, isolates country failures, downloads each global source at most once per batch, and writes draft candidate artifacts only.
- Candidate output remains exactly four files and never writes canonical, Prisma, KnowledgeChunk, AI index, approval, or manifest data.
- Review HTML is local-only under `.cache`, outside candidate and canonical directories, and escapes all untrusted text.
- Publication accepts exactly one existing human-approved receipt, verifies bytes and state transitions, atomically writes exactly `country.json`, `market-overview.json`, and `collection-manifest.json`, and never creates an approval decision.
- Published BASIC remains `coverageLevel=BASIC`, `aiUsable=false`, has nine other modules building/empty, and has no KnowledgeChunk.
- Existing six approved publication bytes and existing coverage calculations remain unchanged.

---

### Task 1: BASIC profile contract and additive persistence

**Files:**
- Modify: `docs/data-schema.md`
- Modify: `docs/api-contract.md`
- Create: `packages/shared-types/src/basic-profile.ts`
- Create: `packages/shared-types/src/basic-profile.test.ts`
- Modify: `packages/shared-types/src/index.ts`
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/0002_basic_profile/migration.sql`

**Interfaces:**
- Produces `BASIC_PROFILE_SCHEMA_VERSION`, `BASIC_PROFILE_CATEGORY_KEYS`, `BasicProfile`, and `parseBasicProfile(value: unknown): BasicProfile | null`.
- `basicProfile` is nullable and omitted legacy input is accepted as `null`; coverage core fields are unchanged.
- `BasicProfile` has exact keys `{ schemaVersion: "basic-market-profile/v2", categories, sources, updatedAt }`; `categories` is an exact object keyed by the eight fixed category keys and each value has exact keys `{ fields }`.
- Each field has exact keys `{ key, label, status, value, unit, year, sourceIds, checkedAt, reason, note }`. `key` is a lower camel token unique within its category; `label`, `reason`, and `note` are `LocalizedText` when non-null; `value` is a finite number, non-empty string, `LocalizedText`, or `null`; `checkedAt` is `YYYY-MM-DD`.
- `AVAILABLE` requires non-null `value`, at least one unique `sourceId`, `reason=null`; `NOT_AVAILABLE` requires `value=null`, `unit=null`, `year=null`, at least one unique checked `sourceId`, and non-empty bilingual `reason`.
- Each source has exact keys `{ id, publisher, title, url, publishedAt, retrievedAt, credibility }`; `title` is `LocalizedText`, URL is HTTP(S), `publishedAt` is RFC3339 or `null`, `retrievedAt` is RFC3339, and each referenced source ID must exist exactly once.

- [ ] Write focused parser tests for all eight exact categories, AVAILABLE citations, NOT_AVAILABLE evidence, bilingual reasons, unknown/missing keys, unsafe URLs, dates, and legacy null.
- [ ] Run the focused test and observe failure because the contract does not exist.
- [ ] Document the contract first, add the shared parser/types, then add nullable Prisma `basicProfile Json? @map("basic_profile")` plus additive migration.
- [ ] Run focused shared-types tests, Prisma validate, and shared/db typecheck.
- [ ] Commit as `feat(data): add BASIC v2 profile contract`.

### Task 2: Canonical, import, database read, and API compatibility

**Files:**
- Modify: `packages/db/src/seed/basic-country-types.ts`
- Modify: `packages/db/src/seed/basic-country-validator.ts`
- Modify: `packages/db/src/seed/basic-country-import.ts`
- Modify: `packages/db/src/runtime/prisma-basic-country-import-port.ts`
- Modify: `packages/db/src/read/prisma-country-read-repository.ts`
- Modify: `packages/shared-types/src/country-formatter.ts`
- Modify matching tests in `packages/db/src/*basic-country*test.ts`, `packages/db/src/prisma-basic-country-*.test.ts`, and `packages/shared-types/src/country-formatter.test.ts`

**Interfaces:**
- Consumes `parseBasicProfile()` from Task 1.
- Legacy canonical omission normalizes to database `null`; a present profile round-trips through import/read/API without affecting existing fields or coverage.

- [ ] Add failing legacy omission and v2 round-trip tests, including localized NOT_AVAILABLE reason fallback.
- [ ] Observe focused RED failures at validator/import/read boundaries.
- [ ] Implement minimal normalization and read formatting while preserving existing canonical file allowlists and coverage fields.
- [ ] Run focused DB/shared/API contract tests and typechecks.
- [ ] Commit as `feat(data): persist and serve BASIC profiles`.

### Task 3: Immutable audit v3 profile candidate contract

**Files:**
- Modify: `docs/basic-country-audit-contract.md`
- Modify: `docs/basic-deterministic-candidate.md`
- Create: `packages/db/src/collection/basic-collection-v3-contracts.ts`
- Create: `packages/db/src/collection/basic-collection-v3-parser.ts`
- Create: `packages/db/src/collection/basic-collection-v3-validator.ts`
- Create: `packages/db/src/collection/basic-market-overview-draft-v3-parser.ts`
- Modify: `packages/db/src/collection/basic-collection-versioned-loader.ts`
- Create matching focused tests and strict synthetic fixtures.

**Interfaces:**
- Adds `basic-country-audit/v3` to the three envelope files while keeping exactly the four existing candidate filenames; `market-overview.draft.json` adds one required validated `basicProfile` property.
- Audit v1 and v2 public functions, exact-key parsers, fixtures, source catalog identities, and committed candidate bytes remain unchanged; only the versioned loader dispatches v3.
- Each profile field has one semantic fact path `marketOverview.basicProfile.categories.<category>.fields.<fieldKey>` where category is one of the exact eight keys and `fieldKey` is the field's lower-camel key. Its `normalizedValue` is the complete field object from the draft.
- For every profile fact, the set of evidence `sourceId` values must equal the field's unique `sourceIds`; `checkedAt` must be no earlier than the calendar date of every referenced source `retrievedAt`. Every draft field has exactly one fact and every profile fact resolves to exactly one draft field.
- `NOT_AVAILABLE` remains a structurally valid candidate field, not an audit blocker, when the profile parser, source checks, evidence/source binding, checked date, and bilingual reason all pass.

- [ ] Add failing v3 parser/validator/versioned-loader tests for exact four-file identity, required profile, field-path bijection, evidence/source binding, checked dates, NOT_AVAILABLE acceptance, mixed-version rejection, and unchanged v1/v2 loading.
- [ ] Observe focused RED failures because audit v3 is absent.
- [ ] Implement separate v3 contracts/parsers/validator and dispatch without editing v1/v2 constants or accepted shapes.
- [ ] Run v1/v2/v3 parser/validator/loader tests, existing committed candidate tests, and DB typecheck.
- [ ] Commit as `feat(data): add immutable BASIC audit v3 contract`.

### Task 4: Reusable source pack and isolated three-country preparation

**Files:**
- Modify: `packages/db/catalog/basic-source-catalog.json`
- Modify: `docs/basic-source-catalog.md`
- Create deterministic adapters under `packages/db/src/collection/adapters/` for the approved World Bank indicators and fixture-backed tabular electricity/capacity/resource inputs.
- Modify: `packages/db/src/collection/basic-source-adapter-registry.ts`
- Create: `packages/db/src/collection/basic-profile-fact-materializer.ts`
- Create: `packages/db/src/collection/basic-audit-v3-assembler.ts`
- Create: `packages/db/src/cli/basic-v3-candidate-composition.ts`
- Extend the existing constrained four-file writer with a separate trusted v3 result guard; do not weaken its v2 guard.
- Create: `packages/db/src/cli/prepare-basic-batch.ts`
- Create: `packages/db/src/cli/basic-batch-config.ts`
- Create: `packages/db/src/prepare-basic-batch.test.ts`
- Modify: `packages/db/package.json`
- Modify: `package.json`

**Interfaces:**
- Adds root command `pnpm basic:prepare-batch --countries=ID,VN,SA --batch-id=basic-v2-202607`.
- The runner delegates each country to the v3 profile composition and existing constrained four-file filesystem boundary, uses a shared per-batch content-addressed cache for global source captures, limits concurrency to three, and returns a deterministic per-country result summary.
- World Bank deterministic sources cover population, GDP, GDP per capita, GDP growth, and electricity access with open keyless requests. Ember may be fetched only through an approved credential mechanism that never persists or logs the key; without a configured key it becomes an explicit checked `NOT_AVAILABLE`, not a failed or fabricated value. IRENASTAT, Global Solar Atlas, Global Wind Atlas, IEA, and RISE use reviewed immutable global snapshot/manual-document inputs until a separately approved stable API contract exists.
- Source observations and reviewed manual inputs are merged into one validated `BasicProfile`; the profile fact materializer emits one v3 fact per draft profile field with exact evidence/source/date binding. Country-specific policy and market-summary text remain human editorial inputs.

- [ ] Add failing tests for CLI parsing, duplicate/invalid/over-three country rejection, max-three concurrency, global fetch de-duplication, warm-cache zero fetch, independent failure, and four-file-only output.
- [ ] Observe focused RED failures.
- [ ] Register official source policies without credentials in URLs; model Ember credential use through headers/environment only and keep policy/source documents manual-review inputs.
- [ ] Implement the batch runner around injected single-country preparation dependencies; never weaken the existing constrained writer.
- [ ] Run adapter, catalog, transport, batch, candidate-composition, and boundary tests.
- [ ] Commit as `feat(data): add reusable BASIC batch preparation`.

### Task 5: Deterministic bilingual templates and local review pack

**Files:**
- Create: `packages/db/src/review/basic-bilingual-template.ts`
- Create: `packages/db/src/review/basic-review-model.ts`
- Create: `packages/db/src/review/basic-review-html.ts`
- Create: `packages/db/src/cli/write-basic-review-pack.ts`
- Create matching Vitest files.
- Modify package scripts in `packages/db/package.json` and `package.json`.

**Interfaces:**
- Numeric template input is `{ value, unit, year, sourceIds }`; output is exact `{ zh, en }` with unchanged tokens.
- Review model contains eight ordered sections, side-by-side bilingual text, field citations, NOT_AVAILABLE checks, conflicts, previous-publication diff, and checklist.
- Adds local command `pnpm basic:review-pack --country=<ISO2> --run-id=<runId>`.

- [ ] Add failing template identity, eight-section, escaping, missing/conflict/diff, deterministic byte, and no-candidate-write tests.
- [ ] Observe RED failures.
- [ ] Implement deterministic templates and a dependency-free escaped HTML renderer under `.cache/basic-country/.../review/`.
- [ ] Run focused review tests and the existing candidate boundary suite.
- [ ] Commit as `feat(data): generate BASIC review packs`.

### Task 6: Human-receipt-gated single-country publication CLI

**Files:**
- Extend publication contracts with `basic-country-publication-manifest/v3` and `basic-country-canonical/v3` while leaving v2 exports unchanged.
- Create v3 publication parser/materializer/validator functions beside the existing v2 functions.
- Create: `packages/db/src/cli/publish-basic-country.ts`
- Create: `packages/db/src/cli/basic-publication-writer.ts`
- Create: `packages/db/src/publish-basic-country.test.ts`
- Modify: `packages/db/package.json`
- Modify: `package.json`
- Modify: `docs/basic-country-publication.md`

**Interfaces:**
- Adds `pnpm basic:publish --country=ID --run-id=<runId> --approval-file=<path>`.
- Reads the immutable four-file audit/v3 candidate and supplied receipt, constructs manifest v3 paths/hash, materializes expected canonical including `basicProfile`, validates through a separate `validateApprovedBasicCountryPublicationV3`, then performs a no-replace atomic single-country write. Existing v2 publication validation and six publications remain unchanged.
- The existing approval receipt schema may be reused because it already binds the exact four artifact names, lifecycle, BASIC coverage, and `aiUsable=false`; the CLI never edits or creates it.

- [ ] Add failing tests for help/arguments, receipt identity/hash/state, pre-existing target refusal, BASIC/AI/deep-module gates, exact three-file output, atomic cleanup, and inability to create or batch approvals.
- [ ] Observe focused RED failures.
- [ ] Implement the constrained writer using Node filesystem primitives and existing parser/materializer/validator; errors remain stable and redacted.
- [ ] Run publication parser/validator/loader, CLI, canonical validator, import, and AI-boundary tests.
- [ ] Commit as `feat(data): add approved BASIC publication CLI`.

### Task 7: Strict fixture flow and draft first-batch preparation

**Files:**
- Create fixture inputs under `packages/db/fixtures/basic-v2-automation/`.
- Create: `packages/db/src/basic-v2-automation.integration.test.ts`
- Create reviewed first-batch configuration/input files under `.cache/basic-country/{ID,VN,SA}/...` only when source preflight succeeds.
- Update: `docs/roadmap.md` with automation completion and draft-only first-batch status.

**Interfaces:**
- Fixture test exercises source capture/cache, batch isolation, four-file candidate, review pack, supplied approval receipt, publication writer, canonical validation, and confirms zero Prisma/AI side effects.
- Real first-batch output stops at `draft`; no receipt, canonical, database, or publication is created without later per-country human approval.

- [ ] Write the failing full-flow fixture test and observe the missing integration behavior.
- [ ] Add strict synthetic inputs and make the production components pass the flow without special country code paths.
- [ ] Run `ID,VN,SA` source preflight/batch preparation; preserve successful candidates and report any country blocked by missing manual editorial facts.
- [ ] Run focused integration and boundary tests, then commit as `test(data): verify BASIC v2 automation flow`.

### Task 8: Independent review and delivery gates

- [ ] Generate a full branch review package from the original `main` merge base and obtain independent spec and code-quality approval.
- [ ] Resolve every Critical/Important finding and re-review.
- [ ] Run fresh `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, Prisma validate, native candidate integration, `git diff --check`, and approved-publication validation.
- [ ] Confirm legacy six-country canonical and approval bytes are unchanged and no draft data entered canonical/Prisma/AI.
- [ ] Merge to `main`, rerun required gates on merged main, push once, and confirm GitHub CI SHA matches `origin/main`.
