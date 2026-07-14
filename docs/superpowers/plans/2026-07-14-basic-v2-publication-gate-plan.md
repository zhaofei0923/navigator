# Basic v2 Publication Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reusable, read-only, fail-closed gate that proves a Basic v2 canonical bundle is mapped from one immutable candidate and one separately recorded project-owner approval.

**Architecture:** Strict receipt and manifest parsers establish the publication identity. A shared stable JSON reader snapshots exact repository files without following symlinks, while a deterministic validator checks hashes, ordered review-state transitions, candidate readiness, canonical mapping, Basic coverage, and AI exclusion. A repository loader performs a two-phase manifest read and returns only the validator's stable result.

**Tech Stack:** TypeScript strict mode, Node.js built-ins (`node:crypto`, `node:fs`, `node:path`), Vitest, pnpm workspace, Turborepo.

## Global Constraints

- Follow `/home/kevin/navigator/AGENTS.md` and `/home/kevin/navigator/docs/superpowers/specs/2026-07-14-basic-v2-publication-gate-design.md`.
- Do not modify any file under `data/staging/indonesia/data-basic-id-20260711-r2/` or `data/indonesia/`.
- Do not create a real approval receipt or canonical manifest in this task.
- Keep v1 loader behavior and public errors unchanged.
- Accept only `basic-country-audit/v2` candidates at the new publication gate.
- Preserve `review-report.json.humanDecision = null`, candidate `reviewStatus = draft`, and `aiUsable = false`.
- The approval receipt must prove `draft -> pending -> published`; Basic canonical data remains `aiUsable = false` and produces no KnowledgeChunk.
- Every publication JSON file is limited to `2 * 1024 * 1024` bytes and each JSON string to `65_536` UTF-8 bytes.
- Do not add dependencies, modify Prisma, change shared business-data fields/enums, change AI prompts/retrieval, or touch permissions/billing.
- Do not use `any`; parse external values from `unknown` and freeze validated output.
- Each task receives an implementation-agent pass followed by independent specification and quality reviews. Critical and Important findings are fixed and re-reviewed before the next task.

---

### Task 1: Publication Contracts, Strict Parsers, and Digest Helpers

**Files:**
- Create: `packages/db/src/collection/basic-publication-contracts.ts`
- Create: `packages/db/src/collection/basic-publication-parser.ts`
- Create: `packages/db/src/collection/basic-publication-digests.ts`
- Create: `packages/db/src/basic-publication-test-fixture.ts`
- Create: `packages/db/src/basic-publication-parser.test.ts`
- Create: `packages/db/src/basic-publication-digests.test.ts`

**Interfaces:**
- Consumes: `BasicCollectionAuditArtifactName`, `BasicCollectionAuditBundleV2`, `BasicCollectionAuditSerializedArtifactsV2`, `BasicCanonicalData`, and existing safe country/run validators.
- Produces: `parseBasicCountryPublicationApproval()`, `parseBasicCountryPublicationManifestV2()`, `sha256Hex()`, `equalSha256Hex()`, and all publication input/result types used by Tasks 3-5.

- [ ] **Step 1: Write exact parser and digest tests that fail before the modules exist**

Create tests with these positive assertions:

```ts
const fixture = createBasicCountryPublicationFixture();

const approval = parseBasicCountryPublicationApproval(fixture.approvalReceipt);
expect(approval.errors).toEqual([]);
expect(approval.data).toEqual(fixture.approvalReceipt);
expect(Object.isFrozen(approval.data)).toBe(true);
expect(Object.isFrozen(approval.data?.artifactSha256)).toBe(true);

const manifest = parseBasicCountryPublicationManifestV2(fixture.manifest);
expect(manifest.errors).toEqual([]);
expect(manifest.data).toEqual(fixture.manifest);
expect(Object.isFrozen(manifest.data)).toBe(true);

const digest = sha256Hex(new TextEncoder().encode("approved\n"));
expect(digest).toMatch(/^[a-f0-9]{64}$/);
expect(equalSha256Hex(digest, digest)).toBe(true);
const changedDigest = `${digest[0] === "0" ? "1" : "0"}${digest.slice(1)}`;
expect(equalSha256Hex(digest, changedDigest)).toBe(false);
```

Add table-driven negative cases for every missing and extra top-level key; malformed `submission` and `authorizedPublication`; unsafe country/run identity; non-ISO2 codes; blank/oversized reviewer IDs; non-canonical timestamps; uppercase, short, and non-hex digests; unsupported schema/mapping versions; and absolute/traversal/backslash/NUL paths. Assert parser errors contain field labels but never input values.

- [ ] **Step 2: Run the new tests and verify the expected import failure**

Run:

```bash
pnpm --filter @navigator/db exec vitest run src/basic-publication-parser.test.ts src/basic-publication-digests.test.ts
```

Expected: FAIL because `basic-publication-contracts.ts`, `basic-publication-parser.ts`, and `basic-publication-digests.ts` do not exist.

- [ ] **Step 3: Implement the exact contracts**

Define these literals and public result shape:

```ts
export const BASIC_COUNTRY_PUBLICATION_APPROVAL_SCHEMA_VERSION =
  "basic-country-publication-approval/v1" as const;
export const BASIC_COUNTRY_PUBLICATION_MANIFEST_SCHEMA_VERSION =
  "basic-country-publication-manifest/v2" as const;
export const BASIC_COUNTRY_CANONICAL_MAPPING_VERSION =
  "basic-country-canonical/v2" as const;
export const BASIC_COUNTRY_PUBLICATION_JSON_MAX_BYTES = 2 * 1024 * 1024;

export const BASIC_COUNTRY_PUBLICATION_BLOCKER_CODES = Object.freeze([
  "MANIFEST_INVALID",
  "APPROVAL_RECEIPT_INVALID",
  "APPROVAL_RECEIPT_HASH_MISMATCH",
  "CANDIDATE_ARTIFACT_HASH_MISMATCH",
  "PUBLICATION_IDENTITY_MISMATCH",
  "CANDIDATE_NOT_READY",
  "APPROVAL_TIMESTAMP_INVALID",
  "CANONICAL_MAPPING_DRIFT",
  "BASIC_COVERAGE_VIOLATION",
  "AI_BOUNDARY_VIOLATION",
  "PUBLICATION_READ_FAILED",
] as const);

export type BasicCountryPublicationBlockerCode =
  typeof BASIC_COUNTRY_PUBLICATION_BLOCKER_CODES[number];

export interface BasicCountryPublicationApprovalReceipt {
  readonly schemaVersion: typeof BASIC_COUNTRY_PUBLICATION_APPROVAL_SCHEMA_VERSION;
  readonly countryDirectory: string;
  readonly countryCode: string;
  readonly runId: string;
  readonly submission: Readonly<{
    fromReviewStatus: "draft";
    toReviewStatus: "pending";
    submittedAt: string;
  }>;
  readonly decision: "approved";
  readonly reviewerId: string;
  readonly decidedAt: string;
  readonly authorizedPublication: Readonly<{
    coverageLevel: "BASIC";
    fromReviewStatus: "pending";
    toReviewStatus: "published";
    aiUsable: false;
  }>;
  readonly artifactSha256: Readonly<Record<BasicCollectionAuditArtifactName, string>>;
}

export interface BasicCountryPublicationManifestV2 {
  readonly schemaVersion: typeof BASIC_COUNTRY_PUBLICATION_MANIFEST_SCHEMA_VERSION;
  readonly activeRunId: string;
  readonly mappingVersion: typeof BASIC_COUNTRY_CANONICAL_MAPPING_VERSION;
  readonly auditBundlePath: string;
  readonly approvalReceiptPath: string;
  readonly approvalReceiptSha256: string;
}

export interface BasicCountryPublicationValidationInput {
  readonly countryDirectory: unknown;
  readonly manifest: unknown;
  readonly approvalReceipt: unknown;
  readonly approvalReceiptBytes: unknown;
  readonly candidate: unknown;
  readonly candidateArtifactBytes: unknown;
  readonly canonical: unknown;
  readonly canonicalArtifactNames: unknown;
}

export interface BasicApprovedCountryPublicationV2 {
  readonly countryDirectory: string;
  readonly manifest: BasicCountryPublicationManifestV2;
  readonly approvalReceipt: BasicCountryPublicationApprovalReceipt;
  readonly candidate: BasicCollectionAuditBundleV2;
  readonly canonical: BasicCanonicalData;
}

export type BasicCountryPublicationValidationResult =
  | Readonly<{
      valid: true;
      blockerCode: null;
      data: BasicApprovedCountryPublicationV2;
    }>
  | Readonly<{
      valid: false;
      blockerCode: BasicCountryPublicationBlockerCode;
      data: null;
    }>;
```

Keep parser result types package-private. Use `snapshotBasicBoundedJsonValue()` first, exact own-key lists second, and existing strict timestamp/safe path validation third. Return recursively frozen reconstructed values, not caller-owned objects.

- [ ] **Step 4: Implement constant-time digest comparison**

Use only Node built-ins and strict lowercase hex decoding:

```ts
import { createHash, timingSafeEqual } from "node:crypto";

const SHA256 = /^[a-f0-9]{64}$/;

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function equalSha256Hex(left: string, right: string): boolean {
  if (!SHA256.test(left) || !SHA256.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}
```

The fixture serializes each synthetic candidate artifact as `${JSON.stringify(value)}\n`, hashes those exact bytes, serializes the exact approval receipt, and builds the manifest from the receipt hash. Use `example-land`, `EX`, `run-001`, `reviewer-001`, submission `2026-07-10T00:00:00Z`, and decision `2026-07-11T00:00:00Z`; never use real Indonesia facts.

- [ ] **Step 5: Run focused tests and commit Task 1**

Run:

```bash
pnpm --filter @navigator/db exec vitest run src/basic-publication-parser.test.ts src/basic-publication-digests.test.ts
pnpm --filter @navigator/db run typecheck
```

Expected: both Vitest files PASS and TypeScript exits `0`.

Commit:

```bash
git add packages/db/src/collection/basic-publication-contracts.ts packages/db/src/collection/basic-publication-parser.ts packages/db/src/collection/basic-publication-digests.ts packages/db/src/basic-publication-test-fixture.ts packages/db/src/basic-publication-parser.test.ts packages/db/src/basic-publication-digests.test.ts
git commit -m "feat: add Basic publication approval contracts"
```

---

### Task 2: Stable Multi-Directory JSON Snapshot Reader

**Files:**
- Create: `packages/db/src/collection/basic-stable-json-file-set.ts`
- Create: `packages/db/src/basic-stable-json-file-set.test.ts`
- Modify: `packages/db/src/collection/basic-collection-versioned-loader.ts:1-314`
- Modify: `packages/db/src/basic-collection-versioned-loader.test.ts:1-324`

**Interfaces:**
- Consumes: absolute normalized paths and the existing `2 * 1024 * 1024` v2 maximum.
- Produces: `readBasicStableJsonFileSet()` and package-private `validateBasicCollectionAuditArtifactValuesVersioned()`; preserves `loadBasicCollectionAuditBundleVersioned()` exactly.

- [ ] **Step 1: Write stable-reader failure and regression tests**

Define the reader request and assert exact frozen output:

```ts
const result = readBasicStableJsonFileSet({
  files: {
    first: join(directory, "first.json"),
    second: join(directory, "second.json"),
  },
  exactDirectories: [{
    pathname: directory,
    entries: ["first.json", "second.json"],
  }],
  maximumBytes: 2 * 1024 * 1024,
});

expect(result.first.value).toEqual({ value: 1 });
expect(new TextDecoder().decode(result.first.bytes)).toBe('{"value":1}\n');
expect(Object.isFrozen(result)).toBe(true);
expect(Object.isFrozen(result.first)).toBe(true);
```

Add tests that reject an unnormalized/non-absolute/NUL path, duplicate target path, missing/extra directory entry, symlinked root/ancestor/file, directory-as-file, oversized file before `readSync`, malformed UTF-8/JSON, pathname replacement during read, directory replacement during the set read, and changed directory entries. Preserve all existing versioned-loader tests and add a direct test for the extracted in-memory version dispatch.

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```bash
pnpm --filter @navigator/db exec vitest run src/basic-stable-json-file-set.test.ts src/basic-collection-versioned-loader.test.ts
```

Expected: FAIL because the stable reader and extracted version-dispatch function do not exist.

- [ ] **Step 3: Extract the hardened file-set reader**

Implement this interface:

```ts
export interface BasicStableJsonArtifact {
  readonly bytes: Uint8Array;
  readonly value: unknown;
}

export interface BasicStableJsonFileSetRequest<Key extends string> {
  readonly files: Readonly<Record<Key, string>>;
  readonly exactDirectories: readonly Readonly<{
    pathname: string;
    entries: readonly string[];
  }>[];
  readonly maximumBytes: number;
}

export function readBasicStableJsonFileSet<Key extends string>(
  request: BasicStableJsonFileSetRequest<Key>,
): Readonly<Record<Key, BasicStableJsonArtifact>>;
```

Implementation order is fixed: validate request shape and normalized absolute paths; snapshot every unique directory chain; snapshot exact directory entries; snapshot every regular file; open each file with `O_RDONLY | O_NOFOLLOW | O_NONBLOCK`; read exactly the snapshotted byte count; fatal-decode UTF-8; parse JSON; recheck every file, directory identity, and exact entry list after all reads; then recursively freeze parsed JSON values and return detached byte copies inside frozen wrappers. Do not call `Object.freeze()` on non-empty typed arrays because Node rejects that operation. Catch all internals and throw only `Stable JSON artifacts could not be read`.

- [ ] **Step 4: Refactor the versioned loader through the shared reader**

Extract the current schema dispatch into:

```ts
export function validateBasicCollectionAuditArtifactValuesVersioned(
  countryDirectory: string,
  runId: string,
  artifacts: Readonly<Record<BasicCollectionAuditArtifactName, unknown>>,
): BasicCollectionAuditBundle | BasicCollectionAuditBundleV2;
```

`loadBasicCollectionAuditBundleVersioned()` constructs the four derived staging paths, calls the shared reader with the exact four-file allowlist, passes the returned `.value` map to the extracted function, and preserves these public messages exactly:

```text
Basic collection audit artifacts could not be read
Basic collection audit artifact versions must not be mixed
Basic collection audit bundle is invalid
```

The extracted function remains package-private by omission from `packages/db/src/index.ts`.

- [ ] **Step 5: Run focused tests and commit Task 2**

Run:

```bash
pnpm --filter @navigator/db exec vitest run src/basic-stable-json-file-set.test.ts src/basic-collection-versioned-loader.test.ts
pnpm --filter @navigator/db run typecheck
```

Expected: both test files PASS, all prior loader security cases remain green, and TypeScript exits `0`.

Commit:

```bash
git add packages/db/src/collection/basic-stable-json-file-set.ts packages/db/src/basic-stable-json-file-set.test.ts packages/db/src/collection/basic-collection-versioned-loader.ts packages/db/src/basic-collection-versioned-loader.test.ts
git commit -m "refactor: share stable Basic artifact reads"
```

---

### Task 3: Deterministic Canonical Materializer and Publication Validator

**Files:**
- Create: `packages/db/src/collection/basic-publication-materializer.ts`
- Create: `packages/db/src/collection/basic-publication-validator.ts`
- Create: `packages/db/src/basic-publication-validator.test.ts`
- Modify: `packages/db/src/basic-publication-test-fixture.ts`

**Interfaces:**
- Consumes: Task 1 parsers/digests/contracts, `validateBasicCollectionAuditBundleV2()`, `createBasicCountryBundle()`, `validateBasicCountryBundle()`, and existing deep equality/freezing helpers.
- Produces: `materializeBasicCanonicalFromApprovedCandidateV2()`, `validateApprovedBasicCountryPublicationV2()`, and package-private `createBasicCountryPublicationFailure()`.

- [ ] **Step 1: Write validator success and blocker tests**

The positive test is exact:

```ts
const fixture = createBasicCountryPublicationFixture();
const result = validateApprovedBasicCountryPublicationV2(fixture.validationInput);

expect(result).toMatchObject({ valid: true, blockerCode: null });
expect(result.data?.canonical).toEqual(fixture.canonical);
expect(result.data?.canonical.marketOverview.reviewStatus).toBe("published");
expect(result.data?.canonical.marketOverview.aiUsable).toBe(false);
expect(result.data?.canonical.knowledge).toEqual([]);
expect(Object.isFrozen(result)).toBe(true);
expect(Object.isFrozen(result.data)).toBe(true);
```

Create one mutation test per blocker category. Mutate one field at a time and assert the first blocker code: manifest shape/version; receipt shape; receipt bytes; each of four candidate bytes; country/directory/run/path identity; blocked/mixed/malformed candidate; submission before latest `retrievedAt`/`collectedAt`; decision before submission; every country fact mapping; every market-overview field; coverage/module rows; non-empty deep module; `aiUsable = true`; non-empty knowledge; and canonical filenames outside the three-file allowlist. Also assert caller inputs remain unchanged.

- [ ] **Step 2: Run the validator test and verify failure**

Run:

```bash
pnpm --filter @navigator/db exec vitest run src/basic-publication-validator.test.ts
```

Expected: FAIL because the materializer and validator modules do not exist.

- [ ] **Step 3: Implement canonical materialization from unique candidate facts**

Use these exact country paths:

```ts
const COUNTRY_FACT_PATHS = Object.freeze([
  "country.code",
  "country.name",
  "country.summary",
  "country.region",
  "country.flagEmoji",
  "country.updatedAt",
] as const);
```

For each path, require exactly one `status = candidate` fact, at least one evidence item, and deeply equal normalized values across all evidence. Build the country object from those six values. Copy the validated draft and change only `reviewStatus` to `published`; keep `aiUsable = false`. Call `createBasicCountryBundle()` with a projected audit manifest containing the same active run, mapping version, and audit path. Return only `.canonical`, recursively frozen. Any impossible post-validation condition throws one private fixed message and is converted by the validator to `CANONICAL_MAPPING_DRIFT`.

- [ ] **Step 4: Implement the ordered fail-closed validator**

Implement the spec's exact order and result constructor:

```ts
export function createBasicCountryPublicationFailure(
  blockerCode: BasicCountryPublicationBlockerCode,
): BasicCountryPublicationValidationResult {
  return Object.freeze({ valid: false, blockerCode, data: null });
}

export function validateApprovedBasicCountryPublicationV2(
  input: BasicCountryPublicationValidationInput,
): BasicCountryPublicationValidationResult;
```

The validator must:

1. parse manifest and approval;
2. validate country/run/path identity;
3. snapshot exact receipt/candidate byte maps and compare all SHA-256 values;
4. call `validateBasicCollectionAuditBundleV2()` and require valid, ready, zero blockers, ready/request state, null human decision, draft review status, and false AI flag;
5. require `submittedAt >= max(source.retrievedAt, draft.collectedAt)` and `decidedAt >= submittedAt`;
6. reconstruct expected canonical data;
7. project the candidate into `validateBasicCountryBundle()` and require exactly Basic;
8. require deep equality between actual and expected canonical data;
9. require sorted canonical names exactly `collection-manifest.json`, `country.json`, `market-overview.json`;
10. return a recursively frozen data object with no byte arrays or parser errors.

Digest mismatches use `equalSha256Hex()`. Do not compare secret-dependent strings with ordinary equality after decoding. Catch proxy/getter/cycle/type exceptions and map them to the earliest applicable blocker without exposing values.

- [ ] **Step 5: Run focused tests and commit Task 3**

Run:

```bash
pnpm --filter @navigator/db exec vitest run src/basic-publication-parser.test.ts src/basic-publication-digests.test.ts src/basic-publication-validator.test.ts
pnpm --filter @navigator/db run typecheck
```

Expected: all three files PASS and TypeScript exits `0`.

Commit:

```bash
git add packages/db/src/collection/basic-publication-materializer.ts packages/db/src/collection/basic-publication-validator.ts packages/db/src/basic-publication-validator.test.ts packages/db/src/basic-publication-test-fixture.ts
git commit -m "feat: validate approved Basic v2 publications"
```

---

### Task 4: Read-Only Repository Publication Loader

**Files:**
- Create: `packages/db/src/collection/basic-publication-loader.ts`
- Create: `packages/db/src/basic-publication-loader.test.ts`

**Interfaces:**
- Consumes: Task 1 manifest parser, Task 2 stable reader/version dispatch, and Task 3 validator.
- Produces: `loadApprovedBasicCountryPublicationV2(repoRoot: string, countryDirectory: string): BasicCountryPublicationValidationResult`.

- [ ] **Step 1: Write repository-loader integration and race tests**

Write the synthetic fixture to a temporary repository in this exact layout:

```text
data/example-land/country.json
data/example-land/market-overview.json
data/example-land/collection-manifest.json
data/approvals/example-land/run-001.json
data/staging/example-land/run-001/source-register.json
data/staging/example-land/run-001/extracted-facts.json
data/staging/example-land/run-001/market-overview.draft.json
data/staging/example-land/run-001/review-report.json
```

Assert the positive load returns the same validated result as the in-memory validator. Add negative tests for unsafe repo root/country slug; missing/malformed/oversized manifest; unsupported v1 candidate; literal path mismatch; receipt/candidate hash drift; extra canonical file; fifth candidate file; symlink at root/canonical/staging/approval/file; special file; phase-one manifest replacement before phase two; any phase-two pathname replacement; changed directory entries; and redaction of absolute paths, source values, URL queries, and filesystem errors.

- [ ] **Step 2: Run the loader test and verify failure**

Run:

```bash
pnpm --filter @navigator/db exec vitest run src/basic-publication-loader.test.ts
```

Expected: FAIL because `basic-publication-loader.ts` does not exist.

- [ ] **Step 3: Implement the two-phase manifest-bound load**

Implement this exported function:

```ts
export function loadApprovedBasicCountryPublicationV2(
  repoRoot: string,
  countryDirectory: string,
): BasicCountryPublicationValidationResult;
```

The loader validates an absolute normalized repo root and safe country slug before I/O. Phase one reads only `data/<country>/collection-manifest.json` through the stable reader while asserting the canonical directory's exact three-file allowlist, then strictly parses it. It derives the expected audit and approval paths from the validated country/run identity and requires literal equality with manifest paths.

Phase two reads all eight JSON files in one `readBasicStableJsonFileSet()` call, with exact canonical and candidate directory entry lists. It requires phase-two manifest bytes to equal phase-one bytes, dispatches the four candidate values through `validateBasicCollectionAuditArtifactValuesVersioned()`, rejects a non-v2 result, builds canonical data from the two canonical JSON values plus fixed empty Basic module collections, and calls `validateApprovedBasicCountryPublicationV2()`.

All reads, parses, and unexpected runtime failures are caught and returned as `PUBLICATION_READ_FAILED`. A structurally read manifest that fails its strict contract returns `MANIFEST_INVALID`. No exception, path, raw value, or parser detail crosses the public boundary.

- [ ] **Step 4: Prove the loader has no side-effect capability**

Add a static test that reads `basic-publication-loader.ts` and its direct production dependency closure and rejects imports or calls matching:

```text
@prisma/client
child_process
fetch(
writeFile
appendFile
rename
unlink
rm
mkdir
process.env
```

Allow `node:fs` only inside `basic-stable-json-file-set.ts`, and assert that module imports only read/stat/open/close/readdir primitives.

- [ ] **Step 5: Run focused tests and commit Task 4**

Run:

```bash
pnpm --filter @navigator/db exec vitest run src/basic-publication-loader.test.ts src/basic-publication-validator.test.ts src/basic-collection-versioned-loader.test.ts
pnpm --filter @navigator/db run typecheck
```

Expected: all three files PASS and TypeScript exits `0`.

Commit:

```bash
git add packages/db/src/collection/basic-publication-loader.ts packages/db/src/basic-publication-loader.test.ts
git commit -m "feat: load approved Basic publications read-only"
```

---

### Task 5: Public Surface, Normative Documentation, and Full Verification

**Files:**
- Create: `docs/basic-country-publication.md`
- Modify: `docs/basic-country-collection.md:56-94,108-121`
- Modify: `docs/basic-deterministic-candidate.md:108-130`
- Modify: `docs/roadmap.md:147-156`
- Modify: `packages/db/src/index.ts:8-24,141-151`
- Modify: `packages/db/src/index.test.ts:1-253`

**Interfaces:**
- Consumes: completed Task 1-4 public constants, loader, validator, approval/manifest/result types.
- Produces: the approved `@navigator/db` publication surface and the normative operator contract used by `DATA-BASIC-ID-PUBLISH`.

- [ ] **Step 1: Write the root-export test first**

Add runtime assertions:

```ts
expect(BASIC_COUNTRY_PUBLICATION_APPROVAL_SCHEMA_VERSION)
  .toBe("basic-country-publication-approval/v1");
expect(BASIC_COUNTRY_PUBLICATION_MANIFEST_SCHEMA_VERSION)
  .toBe("basic-country-publication-manifest/v2");
expect(BASIC_COUNTRY_CANONICAL_MAPPING_VERSION)
  .toBe("basic-country-canonical/v2");
expect(BASIC_COUNTRY_PUBLICATION_BLOCKER_CODES).toHaveLength(11);
expect(validateApprovedBasicCountryPublicationV2).toBeTypeOf("function");
expect(loadApprovedBasicCountryPublicationV2).toBeTypeOf("function");
```

Add compile-time witnesses for `BasicCountryPublicationApprovalReceipt`, `BasicCountryPublicationManifestV2`, `BasicCountryPublicationBlockerCode`, `BasicApprovedCountryPublicationV2`, and `BasicCountryPublicationValidationResult`. Add `@ts-expect-error` checks proving parsers, digest helpers, stable reader, materializer, failure constructor, and version dispatch remain package-private.

- [ ] **Step 2: Run the root-export test and verify failure**

Run:

```bash
pnpm --filter @navigator/db exec vitest run src/index.test.ts
```

Expected: FAIL because the new approved runtime surface is not exported yet.

- [ ] **Step 3: Export only the approved publication API**

Export these runtime names from `packages/db/src/index.ts`:

```text
BASIC_COUNTRY_PUBLICATION_APPROVAL_SCHEMA_VERSION
BASIC_COUNTRY_PUBLICATION_MANIFEST_SCHEMA_VERSION
BASIC_COUNTRY_CANONICAL_MAPPING_VERSION
BASIC_COUNTRY_PUBLICATION_BLOCKER_CODES
validateApprovedBasicCountryPublicationV2
loadApprovedBasicCountryPublicationV2
```

Export these types:

```text
BasicCountryPublicationApprovalReceipt
BasicCountryPublicationManifestV2
BasicCountryPublicationBlockerCode
BasicApprovedCountryPublicationV2
BasicCountryPublicationValidationResult
```

Do not export parser, digest, reader, materializer, fixture, failure-constructor, or version-dispatch internals.

- [ ] **Step 4: Write the normative publication documentation**

`docs/basic-country-publication.md` must state the exact receipt/manifest JSON schemas, path derivation, byte hashing, `draft -> pending -> published` lifecycle, validator order, stable blocker list, Basic/AI constraints, trust limitation of unsigned receipts, immutable correction/new-run rule, and the read-only/no-Prisma boundary.

Update `docs/basic-country-collection.md` so the v2 manifest has six exact fields and points to the separate receipt; explicitly retain the four-file candidate allowlist. Update `docs/basic-deterministic-candidate.md` so its publication follow-up references the external receipt and ordered lifecycle without changing `humanDecision = null`. Add `DATA-BASIC-PUBLISH-V2-1（已完成）` to `docs/roadmap.md`, followed by `DATA-BASIC-ID-PUBLISH` as the next human-approved atomic publication task. State that neither task changes `docs/data-schema.md` or Prisma because receipt/manifest are non-product sidecars.

- [ ] **Step 5: Run focused tests and documentation consistency checks**

Run:

```bash
pnpm --filter @navigator/db exec vitest run src/basic-publication-parser.test.ts src/basic-publication-digests.test.ts src/basic-stable-json-file-set.test.ts src/basic-publication-validator.test.ts src/basic-publication-loader.test.ts src/basic-collection-versioned-loader.test.ts src/index.test.ts
! rg -n "humanDecision.*approved|review-report.*approved|draft -> published" docs/basic-country-publication.md docs/basic-country-collection.md docs/basic-deterministic-candidate.md docs/roadmap.md
git diff --check
```

Expected: Vitest PASS; `rg` finds no claim that a v2 review report stores approval and no direct lifecycle that omits `pending`; `git diff --check` exits `0`.

- [ ] **Step 6: Commit Task 5**

```bash
git add docs/basic-country-publication.md docs/basic-country-collection.md docs/basic-deterministic-candidate.md docs/roadmap.md packages/db/src/index.ts packages/db/src/index.test.ts
git commit -m "docs: define Basic v2 publication operations"
```

- [ ] **Step 7: Run the complete branch verification gate**

Run in order:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm turbo run lint typecheck test --force
```

Expected: every command exits `0`. Playwright is intentionally omitted because this task does not change Web behavior or canonical data.

- [ ] **Step 8: Perform final independent reviews and branch audit**

Dispatch one specification-compliance reviewer and one code-quality/security reviewer. Both inspect the complete branch diff against the approved design, with special attention to v1 regression, candidate immutability, exact path/hash binding, timestamp ordering, read races, side-effect imports, public surface, and blocker ordering. Fix every Critical or Important finding with a focused test and conventional commit, re-run the complete branch gate, and obtain clean re-reviews.

Finish with:

```bash
git status --short --branch
git diff main...HEAD --check
git diff --name-status main...HEAD
```

Expected: clean feature worktree; only task-scoped source/tests/docs changed; no `data/`, Prisma, Web, AI, auth, membership, or dependency files changed.

---

## Merge and Delivery

After all task checkboxes and reviews pass, the main agent follows the repository delivery flow:

```bash
git checkout main
git pull --ff-only origin main
git merge --no-ff feat/DATA-BASIC-PUBLISH-V2-1-v2-publication-gate
pnpm lint
pnpm typecheck
pnpm test
pnpm turbo run lint typecheck test --force
git push origin main
```

Wait for GitHub Actions to finish successfully, then delete the merged feature branch and any associated worktree as already authorized by the project owner. Verify local `main`, `origin/main`, and GitHub `main` resolve to the same merge commit before starting `DATA-BASIC-ID-PUBLISH`.
