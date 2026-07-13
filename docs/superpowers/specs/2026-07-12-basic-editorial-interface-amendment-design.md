# Basic Editorial Interface Amendment Design

**Status:** Approved by the project owner on 2026-07-13.

**Task card:** `DATA-BASIC-EDITORIAL-1`

**Base:** `8c51a6142b4f53cd3e5f4ee05cc0c085c47a8b3e`

## 1. Purpose

This amendment resolves three interface mismatches discovered after
`DATA-BASIC-DOCUMENTS-1` was merged:

1. `materializeBasicSourceFactsV2()` intentionally rejects ordinary editorial
   paths, while the Editorial plan expected to reuse its tuple and fact-ID
   implementation.
2. `BasicEditorialEvidenceObservation` intentionally omits the document-plan
   `usage` discriminator, so a downstream plain object cannot by itself prove
   that it came from reviewed `editorial-evidence` materialization.
3. `BasicPreliminarySourceRunV2.sourceRegister` contains deterministic sources
   only, while editorial evidence may also reference reviewed manual-document
   sources.

The approved resolution is a narrow package-private extension. It does not
change the canonical country model, public package exports, AI boundaries,
permissions, dependencies, or persisted data.

## 2. Decisions

### 2.1 Owner-specific fact materialization

`basic-v2-fact-materializer.ts` will retain one private tuple/fact-building
core and expose two package-private owner-specific entry points:

```ts
materializeBasicSourceFactsV2(
  observations: readonly BasicSourcedObservationV2[],
  extractionMethod: BasicExtractionMethodV2,
): readonly BasicExtractedFactV2[];

materializeBasicEditorialObservationsV2(
  observations: readonly BasicSourcedObservationV2[],
): readonly BasicExtractedFactV2[];
```

The existing source entry point continues to accept only `source-backed` and
`hybrid-name` paths. The new editorial entry point fixes
`extractionMethod = "manual"` and accepts only paths classified as
`editorial` by `classifyBasicV2FieldPath()`. Neither entry point accepts
`derived` or unknown paths.

The new entry point is not a generic caller-selected owner bypass. Existing
Documents behavior and its rejection tests remain unchanged. Both entry
points share the same canonical finite-JSON tuple comparison, conflict rules,
fact IDs, evidence ordering, uncertainty handling, and redacted error
boundary.

### 2.2 Trusted document materialization result

`materializeBasicDocumentEvidence()` will brand each successful, recursively
frozen result in a module-private `WeakMap`. The associated immutable
provenance contains:

```ts
interface BasicDocumentMaterializationProvenanceV2 {
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
```

A package-private snapshot function returns that provenance only for the exact
result object created by `materializeBasicDocumentEvidence()`:

```ts
snapshotBasicDocumentMaterializationProvenanceV2(
  value: unknown,
): BasicDocumentMaterializationProvenanceV2 | null;
```

`captureBindings` are source-ID sorted, recursively frozen, and bind every
manual source to its request URL, final response URL, retrieval time, and
content hash. Downstream reviewed materialization compares them to preliminary
captures exactly.

Handmade, spread, JSON-cloned, cross-run, cross-country, and cross-catalog
results fail closed. The brand is registered only after capture, plan, review,
locator, source ownership, and exact materialization checks have succeeded.
The downstream Editorial layer therefore does not reintroduce a `usage` field:
membership in the branded result proves that every value in its
`editorialEvidence` array originated from a reviewed document observation
whose plan usage was `editorial-evidence`.

### 2.3 Reviewed source union

The reviewed merge stage constructs one exact `BasicSourceRegisterV2` for
Editorial by combining:

- deterministic records from `BasicPreliminarySourceRunV2.sourceRegister`;
- manual records from the trusted `BasicDocumentMaterializationResult` when
  manual sources exist.

The union preserves the preliminary run identity, requires unique source IDs,
sorts records by source ID, and rejects identity or source-set drift. It is
called `reviewedSources`; it must not be described or passed as
`preliminarySources`.

Editorial evidence validation receives the complete review material rather
than a caller-asserted list of passed IDs:

```ts
materializeBasicEditorialFacts(input: {
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

For every referenced evidence source, the materializer requires an active
record in `reviewedSources`, at least one passed check, no failed check, no
listed injection risk, `promptInjectionRisk = "none"`, `accessStatus = "open"`,
and credibility other than `UNVERIFIED`. Review arrays are reconstructed,
bounded, and matched by exact source ID; the caller cannot substitute a
pre-filtered trust assertion.

`sourceChecks` must contain exactly one check for every source in
`reviewedSources`, with no duplicate or foreign source ID. `injectionRisks`
may contain only reviewed source IDs and retains every reviewed risk; it is
never converted into a passed source assertion.

All top-level run, country, catalog version, and catalog digest identities must
match. If `documentResult` is non-null, its `WeakMap` provenance and manual
source set must match the same identity and the manual portion of
`reviewedSources`.

## 3. Editorial data flow

1. Parse exact bilingual operator input. The parser uses
   `classifyBasicV2FieldPath()` and path-specific shape validators; it does not
   duplicate the editorial allowlist.
2. Build the reviewed source union and exact review arrays in the reviewed
   merge stage.
3. Resolve ordinary editorial evidence against structured intermediates or
   the trusted document result using exact `sourceId`, `fieldPath`, `locator`,
   and canonical `rawValue` equality.
4. Materialize ordinary editorial paths through
   `materializeBasicEditorialObservationsV2()`.
5. Resolve `country.name` only against the unique preliminary name fact. Its
   English text, source ID, locator, and raw value are preserved exactly; only
   a nonblank Chinese value may be added. Materialize the replacement through
   the existing source entry point with `extractionMethod = "manual"`.
6. Replace the preliminary `country.name` fact exactly once. Reject all other
   deterministic/manual ownership collisions.
7. Derive system-owned metadata only after source-backed and editorial facts
   have been merged.

No step reads external content, performs translation or fuzzy matching,
selects a source automatically, resolves a conflict, or assembles the final
Basic draft.

## 4. File-scope amendment

In addition to the original Editorial plan, the evidence-resolution slice may
modify:

- `packages/db/src/collection/basic-v2-fact-materializer.ts`
- `packages/db/src/basic-v2-fact-materializer.test.ts`
- `packages/db/src/collection/basic-document-observation-materializer.ts`
- `packages/db/src/basic-document-observation.test.ts`

These changes are limited to the owner-specific editorial fact entry point,
the trusted document-result brand, and their regression tests. Catalog,
transport, raw capture, source-plan provenance, adapters, v1 behavior,
`packages/db/src/index.ts`, Prisma, `data/**`, Web, AI, permissions, billing,
and lockfiles remain unchanged.

## 5. Required tests

### Fact ownership

- Existing source fact materialization still rejects ordinary editorial paths.
- Editorial fact materialization accepts only editorial paths and always emits
  `extractionMethod = "manual"`.
- Hybrid name, source-backed, derived, and unknown paths are rejected by the
  editorial entry point.
- Both entry points retain identical tuple, conflict, ordering, canonical JSON,
  and fact-ID behavior.

### Document-result provenance

- Only a real result from `materializeBasicDocumentEvidence()` is trusted.
- Spread, JSON clone, handmade, cross-run, cross-country, and cross-catalog
  substitutions are rejected.
- Provenance records the exact manual source set and identity.
- Existing document materialization and capture-provenance tests remain green.

### Reviewed source and evidence binding

- Structured-only, document-only, and mixed reviewed source unions work.
- Missing, duplicate, inactive, failed, injection-risk, non-open, or
  `UNVERIFIED` evidence sources fail closed.
- Document evidence cannot be supplied as an independent plain array.
- Review/source/manual provenance drift fails closed.
- Primary source must be active, eligible, and actually referenced.
- Input object insertion-order permutations produce byte-identical output;
  contract-required unsorted arrays remain invalid.

## 6. Alternatives rejected

### Duplicate the fact builder in Editorial

Rejected because fact IDs, canonical JSON, conflict behavior, and evidence
ordering would drift between source and editorial paths.

### Trust a plain document evidence array

Rejected because a self-consistent handmade object could bypass the reviewed
capture/document boundary.

### Restore `usage` as a downstream field and redesign Documents payloads

Rejected because the discriminator alone is forgeable and would expand the
contract without proving provenance. The trusted-result brand preserves the
existing lean observation shape.

## 7. Completion boundary

This amendment finishes only the in-memory Editorial materialization boundary.
The result remains package-private and is not a publishable country package.
`DATA-BASIC-DETERMINISTIC-1` remains responsible for complete candidate
assembly, model-free completeness/trust preflight, draft generation, and the
four-file candidate audit package. Human review remains required before any
canonical country data is published.
