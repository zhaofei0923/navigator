# Basic v2 Publication Gate Design

**Task card:** `DATA-BASIC-PUBLISH-V2-1`

**Status:** Approach approved by the project owner; written specification ready for review.

## Goal

Create a country-generic, fail-closed publication boundary for deterministic Basic v2 candidates. The boundary must preserve the immutable four-file candidate contract, record human approval in a separate immutable receipt, bind that receipt to the exact candidate bytes, and prove that canonical Basic data is an approved mapping before it can be imported or exposed by Web.

This task delivers the reusable publication contract and validator only. It does not publish Indonesia, change canonical country data, modify Prisma data, activate a datastore, or change the AI retrieval boundary. Indonesia publication remains the next atomic task card, `DATA-BASIC-ID-PUBLISH`.

## Approved Decision

The project owner selected **Approach A: independent approval receipt**.

The v2 candidate remains exactly four files under:

```text
data/staging/<countryDirectory>/<runId>/
  source-register.json
  extracted-facts.json
  market-overview.draft.json
  review-report.json
```

No file in that directory is changed after candidate creation. In particular:

- `review-report.json.humanDecision` remains `null`;
- `market-overview.draft.json.reviewStatus` remains `draft`;
- `market-overview.draft.json.aiUsable` remains `false`;
- the directory may not contain a fifth file.

Human approval is stored separately at:

```text
data/approvals/<countryDirectory>/<runId>.json
```

The canonical manifest points to both the candidate directory and the approval receipt. Hashes bind the manifest, approval receipt, and candidate into one publication identity.

## Approval Context

The explicit approval that triggered this design applies only to this candidate identity:

```text
countryDirectory: indonesia
countryCode: ID
runId: data-basic-id-20260711-r2
reviewerId: project-owner
submissionRecordedAt: 2026-07-13T15:13:40Z
approvalAcknowledgedAt: 2026-07-14T01:15:34Z
```

The candidate artifact SHA-256 values observed at approval acknowledgement are:

| Artifact | SHA-256 |
|---|---|
| `source-register.json` | `842f5675cc2ce3f5e18bb05b4b1dc016ec5e838e059cdfaf5b9025bc785f2799` |
| `extracted-facts.json` | `953d200e586582cc21a74cc1837e5fa72ed83b2f532d4a264a205d6e7ae4b038` |
| `market-overview.draft.json` | `dd6172f7a8047b8f2701b9eb57b56681f6b7543da18dfed84055d1c3cf17adb7` |
| `review-report.json` | `a644f07748f39870e57beb0915091d002acee2aab4d41401968f59e40f157409` |

These values are an approval-scope record, not an approval receipt and not authority to publish from this task. `DATA-BASIC-ID-PUBLISH` must create the receipt, recompute all hashes from held regular-file reads, and reject any difference from this approved identity.

## Options Considered

### A. Independent approval receipt (selected)

Keep the candidate immutable and store a separate receipt whose exact schema binds the human decision to the country, run, authorized Basic-only transition, and four candidate hashes. The canonical manifest binds the receipt by path and hash.

This cleanly separates machine-generated readiness from human authorization, preserves the v2 parser invariant, and leaves an auditable record that can be reused for all countries.

### B. Embed approval in `collection-manifest.json`

This uses fewer files but mixes a mutable active-run pointer with the human decision. It weakens approval history, makes manifest replacement carry two responsibilities, and makes later run activation harder to audit independently.

### C. Create a derived approved four-file package

This would copy or modify `review-report.json` to add a decision. It creates two competing versions of the candidate, violates the v2 exact parser contract, and creates drift risk. This approach is rejected.

## Approval Receipt Contract

The receipt is strict JSON with exact keys and no extension fields:

```json
{
  "schemaVersion": "basic-country-publication-approval/v1",
  "countryDirectory": "indonesia",
  "countryCode": "ID",
  "runId": "data-basic-id-20260711-r2",
  "submission": {
    "fromReviewStatus": "draft",
    "toReviewStatus": "pending",
    "submittedAt": "2026-07-13T15:13:40Z"
  },
  "decision": "approved",
  "reviewerId": "project-owner",
  "decidedAt": "2026-07-14T01:15:34Z",
  "authorizedPublication": {
    "coverageLevel": "BASIC",
    "fromReviewStatus": "pending",
    "toReviewStatus": "published",
    "aiUsable": false
  },
  "artifactSha256": {
    "source-register.json": "<sha256>",
    "extracted-facts.json": "<sha256>",
    "market-overview.draft.json": "<sha256>",
    "review-report.json": "<sha256>"
  }
}
```

Rules:

1. `schemaVersion`, `decision`, all `submission` status values, and all `authorizedPublication` values are fixed literals.
2. `countryDirectory`, `countryCode`, and `runId` use the existing safe slug, ISO2, and safe run-ID rules.
3. `reviewerId` is a bounded, non-blank identifier. For the approved Indonesia run it is exactly `project-owner`.
4. `submittedAt` and `decidedAt` are canonical UTC RFC 3339 timestamps. `submittedAt` cannot precede the latest candidate source retrieval time or the draft `collectedAt`; `decidedAt` cannot precede `submittedAt`.
5. `artifactSha256` has exactly the four candidate filenames and lowercase 64-character SHA-256 values.
6. The receipt records the required `draft -> pending -> published` lifecycle without mutating the candidate. Candidate readiness and submission establish `pending`; the project-owner decision authorizes only the subsequent `pending -> published` canonical transition.
7. A receipt authorizes only canonical Basic publication. It cannot authorize Standard/Complete coverage, `aiUsable = true`, KnowledgeChunk creation, AI indexing, external datastore cleanup, or a different run.
8. Rejected or correction-requested candidates do not receive an approval receipt. Corrections create a new candidate run and require a new explicit approval.

The receipt is not a cryptographic signature of the reviewer. Git history, protected review, and the explicit project-owner checkpoint remain the authorization trust boundary. The hashes prevent accidental substitution and mapping drift; they do not claim to defend against a malicious repository administrator who can rewrite both code and history.

## Publication Manifest v2

The existing three-field manifest cannot carry the independent receipt binding. The publication sidecar becomes a strict v2 contract:

```json
{
  "schemaVersion": "basic-country-publication-manifest/v2",
  "activeRunId": "<runId>",
  "mappingVersion": "basic-country-canonical/v2",
  "auditBundlePath": "data/staging/<countryDirectory>/<runId>",
  "approvalReceiptPath": "data/approvals/<countryDirectory>/<runId>.json",
  "approvalReceiptSha256": "<sha256>"
}
```

The manifest is canonical audit metadata only. It is never imported into Prisma, returned by APIs, counted toward coverage, or made available to AI retrieval.

Paths in the manifest are assertions, not arbitrary filesystem capabilities. The loader derives both expected paths from the already validated `countryDirectory` and `activeRunId`, requires literal equality, and reads only the derived repository paths. Absolute paths, traversal, backslashes, NUL, symlinks, special files, path aliases, mixed-case hash values, and unsupported versions fail closed.

## Components

### Contract and parser

Add focused TypeScript contracts for the receipt and manifest. Exact parsers accept `unknown`, enforce bounded strings and arrays/objects, reject extra keys, and return frozen values. No `any` is introduced.

Every publication JSON artifact is limited to `2 * 1024 * 1024` bytes, matching the existing v2 audit-artifact ceiling. Individual JSON strings retain the existing `65_536` UTF-8 byte ceiling. Empty files, malformed Unicode, duplicate semantic identities, and non-standard array/object shapes are rejected.

### Hardened artifact reader

Reuse the safety properties of the existing versioned audit loader: repository-root containment, regular-file checks, no symlinks, bounded reads, `O_NOFOLLOW`, and before/after identity checks. The shared reader returns both bytes and parsed JSON so hashes are calculated over the exact bytes that were validated.

Refactoring is limited to extracting the reader capability needed by both the existing v2 candidate loader and the new publication loader. Existing loader behavior and public errors remain unchanged.

### Publication loader

The loader receives only an absolute repository root and a validated country directory. It loads:

1. canonical `country.json`;
2. canonical `market-overview.json`;
3. canonical `collection-manifest.json`;
4. the derived approval receipt;
5. the exact four-file v2 candidate through the existing versioned loader boundary.

It also snapshots the canonical country directory and requires the Basic publication allowlist to contain exactly `country.json`, `market-overview.json`, and `collection-manifest.json`. It rejects v1 candidates for this publication path. It does not write files, call Prisma, execute child processes, access the network, read environment variables, or import Web code.

### Publication validator

`validateApprovedBasicCountryPublicationV2()` is country-generic and deterministic. It validates an in-memory publication bundle and returns either frozen validated data or stable blocker codes. It never promotes or mutates input records.

## Validation Sequence

The boundary performs checks in this order:

1. Parse the strict manifest and receipt contracts.
2. Require literal supported schema and mapping versions.
3. Require exact country-directory, ISO2, run-ID, manifest-path, receipt-path, and envelope identity agreement.
4. Hash the receipt bytes and compare them with `approvalReceiptSha256` using constant-time byte comparison after strict hex decoding.
5. Hash all four candidate artifacts and compare them with the receipt using the same constant-time digest comparison.
6. Run the existing Basic v2 candidate validation and require:
   - `valid = true`;
   - `readyForHumanReview = true`;
   - no blockers;
   - `status = ready-for-human-review`;
   - `publicationRecommendation = request-human-review`;
   - `humanDecision = null`;
   - draft `reviewStatus = draft`;
   - draft `aiUsable = false`.
7. Require the exact `draft -> pending -> published` receipt lifecycle, require `decision = approved`, and verify both timestamp-ordering rules.
8. Reconstruct canonical country fields from unique approved candidate facts and require deep equality.
9. Require canonical market overview to deep-equal the candidate draft except that canonical `reviewStatus` is `published`. This field-level difference is accepted only after the receipt proves the intermediate `pending` state and authorized `pending -> published` decision; `aiUsable` remains `false`.
10. Derive coverage with existing generic rules and require exactly `BASIC`: market overview is qualifying, all other nine modules are `BUILDING` with `dataCount = 0`.
11. Require no deep-module records, knowledge chunks, AI-eligible IDs, or unexpected canonical artifacts in the supplied publication bundle.

The first failed stage returns a stable blocker code and no validated publication data. Error output never includes raw source content, absolute paths, reviewer notes, or underlying filesystem messages.

## Stable Blocker Categories

The public result distinguishes only actionable categories:

- `MANIFEST_INVALID`
- `APPROVAL_RECEIPT_INVALID`
- `APPROVAL_RECEIPT_HASH_MISMATCH`
- `CANDIDATE_ARTIFACT_HASH_MISMATCH`
- `PUBLICATION_IDENTITY_MISMATCH`
- `CANDIDATE_NOT_READY`
- `APPROVAL_TIMESTAMP_INVALID`
- `CANONICAL_MAPPING_DRIFT`
- `BASIC_COVERAGE_VIOLATION`
- `AI_BOUNDARY_VIOLATION`
- `PUBLICATION_READ_FAILED`

Detailed internal parser errors may be used in unit tests, but production callers receive only these categories and a boolean validity result.

## State and Data Flow

```text
immutable v2 candidate (draft, humanDecision null)
  -> receipt submission record (draft -> pending)
  + explicit project-owner approval (pending -> published)
  -> immutable external approval receipt
  -> canonical country + published market overview + manifest v2
  -> publication loader
  -> fail-closed publication validator
  -> import/Web eligibility
```

The receipt proves both lifecycle transitions and authorization; it does not itself mutate product data. Only canonical `market-overview.json` carries `reviewStatus = published`. The staging draft remains unchanged for audit comparison, while the receipt is the durable evidence that it passed through `pending` before approval.

## Task Boundary

`DATA-BASIC-PUBLISH-V2-1` includes:

- the generic receipt and manifest v2 contracts;
- strict parsers and deterministic validation;
- hardened read/hash support required by the loader;
- synthetic fixtures and comprehensive unit/integration tests;
- normative publication documentation and roadmap status;
- package exports needed by the next country publication task.

It explicitly excludes:

- creating the Indonesia approval receipt;
- changing or deleting anything under `data/indonesia/`;
- changing the approved Indonesia candidate directory;
- wiring the new gate into Indonesia import or Web builds;
- deleting legacy Complete rows from any database;
- changing Prisma schema, migrations, shared country fields, coverage enums, AI prompts, retrieval rules, permissions, membership, or billing;
- adding third-party dependencies.

## Testing

Tests use synthetic fixtures and mutation cases. No test may treat synthetic values as real Indonesia data.

Required positive coverage:

- exact v2 receipt and manifest parse successfully;
- exact bytes produce expected hashes;
- a ready v2 candidate plus approved receipt and exact canonical mapping validates;
- Basic coverage remains exactly `BASIC`, with `aiUsable = false` and no knowledge IDs;
- parser and validator outputs are frozen and do not mutate inputs.

Required negative coverage:

- extra, missing, malformed, unknown-version, oversized, or non-canonical fields;
- each receipt and candidate hash changed independently;
- cross-country, cross-directory, cross-run, and path-identity mismatches;
- symlink, special file, traversal, replacement-during-read, and unsupported path forms;
- receipt time before candidate evidence/draft collection;
- decision time before pending submission;
- blocked, malformed, mixed-version, or merely structural candidate;
- canonical drift for every mapped country and market-overview field;
- Standard/Complete coverage, deep-module data, `aiUsable = true`, or KnowledgeChunk presence;
- v1 candidate presented to the v2 publication gate.

Branch verification requires:

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm turbo run lint typecheck test --force
```

This task has no Web behavior, so Playwright is not required. `DATA-BASIC-ID-PUBLISH` must add and run Web E2E coverage when it activates Indonesia canonical data.

## Acceptance Criteria

1. The four-file v2 candidate contract remains byte-for-byte unchanged.
2. Approval in the Basic v2 publication path can be represented only by the separate strict receipt.
3. Receipt and manifest hashes bind one exact country/run/candidate identity.
4. The receipt proves the ordered `draft -> pending -> published` lifecycle without modifying candidate bytes.
5. No unapproved, mismatched, changed, non-Basic, or AI-eligible bundle can produce validated publication data.
6. No production side effect occurs in this task.
7. Existing v1 compatibility and v2 candidate generation tests remain green.
8. No unified business-data model, Prisma schema, or AI retrieval boundary changes.

## Follow-up

After this generic gate is merged and CI is green, `DATA-BASIC-ID-PUBLISH` will:

1. create the Indonesia receipt for the exact approved hashes above;
2. generate and validate canonical Basic country and market overview files;
3. replace the legacy Complete repository data atomically;
4. wire DB import and Web publication to the generic gate;
5. run the read-only activation preflight without modifying an external datastore;
6. run full unit, integration, Web, i18n, and Playwright acceptance tests.

Any external datastore containing legacy Indonesia Complete rows remains blocked for the separately approved destructive cleanup task `OPS-DATA-ID-BASIC-CLEANUP`.
