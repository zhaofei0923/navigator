# basic-country-document-evidence.md - Basic document evidence boundary

> This normative contract records the `DATA-BASIC-DOCUMENTS-1` document-evidence
> slice. It supplements [basic-source-catalog.md](./basic-source-catalog.md),
> [basic-source-formats.md](./basic-source-formats.md),
> [basic-country-audit-contract.md](./basic-country-audit-contract.md), and
> [basic-country-collection.md](./basic-country-collection.md). It does not
> change the canonical schema, Prisma, v1 contracts, release policy, or AI
> retrieval boundary.

## 1. Completion Boundary

This slice lets a reviewed v2 execution plan capture HTML/PDF bytes through a
single generic executor and materialize *reviewed manual evidence* into
preliminary source records, manual facts, source checks, injection risks, and
editorial-evidence intermediates. It also documents exact structured and
manual source-review inputs.

It is deliberately not a document parser, an OCR service, a model workflow,
a translation workflow, an editorial-final-fact workflow, a draft assembler,
a canonical-data writer, a database writer, or a publication/AI-readiness
decision. A completed `DATA-BASIC-DOCUMENTS-1` therefore does not mean that a
country is ready to publish. `DATA-BASIC-EDITORIAL-1` and
`DATA-BASIC-DETERMINISTIC-1` remain required before the model-free candidate
pipeline can assemble and preflight a complete four-file v2 candidate package.

## 2. v2 Preliminary Material

`basic-country-audit/v2` is parallel to legacy v1; it is not a v1 envelope
with optional fields. The v2 source register has this exact identity:

```text
schemaVersion = basic-country-audit/v2
runId
countryCode
catalogVersion
catalogSha256
```

The v2 extracted-facts envelope has `schemaVersion`, `runId`, `countryCode`,
and `facts`; it is returned from the same trusted plan/run as the source
register, whose catalog version and digest establish its provenance.

The preliminary runner returns, in memory only:

```text
sourceRegister = { identity, sources[] }
extractedFacts = { schemaVersion, runId, countryCode, facts[] }
structuredEditorialEvidence[]
documentCaptures[]
receipts[]
```

`sourceRegister` carries the catalog version and digest; `extractedFacts` is
bound to the same run and country. `documentCaptures` are catalog source plus
the verified `basic-country-raw-capture/v2` manifest; they also carry
runner-registered, in-memory provenance, so copying or serializing a capture
cannot transfer materialization authority. Receipts intentionally
contain only `sourceId`, content hash, byte length, and cache-reuse status;
they expose no cache path or bytes. The two review schemas and document plan
are temporary reviewed inputs, not extra committed audit artifacts.

The final v2 audit directory will retain the four legacy filenames. The three
envelopes (`source-register.json`, `extracted-facts.json`, and
`review-report.json`) must use the same v1 or v2 version in one directory;
`market-overview.draft.json` remains an unwrapped draft shape. This task does
not create a v2 review report or a v2 draft, and must not claim that it does.

## 3. Source Execution And Ownership

The catalog is the sole source-policy, request-template, allowed-field, and
source-metadata authority. A trusted execution-plan entry is provenance-bound
to one reviewed catalog snapshot; `catalogVersion` and `catalogSha256` must
match every capture, review, plan, and materialized record in a run. Mixed
digests fail closed before fact materialization.

`format = html | pdf` requires `adapterKind = manual-document` and the exact
identity `basic-manual-document-capture@1.0.0`. The generic executor checks
that identity and all plan/request policy before cache or network use, then
performs only the reviewed v2 raw capture. It has no source-specific metadata,
does not inspect document body content, and produces no preliminary fact or
source record on its own. Country and URL differences belong in reviewed
catalog data, never executor code.

| Materialized field | Sole owner in this slice |
| --- | --- |
| `sourceId`, `sourceName`, `sourceFamily`, `credibility` | reviewed catalog |
| `sourceUrl`, `retrievedAt`, `contentSha256` | verified v2 manifest; URL is the materialized request URL |
| `publishedAt`, `accessNotes`, `promptInjectionRisk` for JSON/CSV | reviewed deterministic adapter output |
| `publishedAt`, `accessNotes`, `promptInjectionRisk` for HTML/PDF | manual source review |
| `evidenceLocators` | JSON/CSV: accepted deterministic adapter observations; HTML/PDF: accepted document-plan observations; future derived locators are added only by Deterministic |
| `accessStatus` | catalog access mode; materialized v2 sources are only `open` |
| `discoveryOnly` | fixed `false` for v2 materialized sources |
| source checks and injection risks | structured/manual review, later carried into the review report |

Any absent, duplicate, conflicting, or provenance-mismatched owner fails
closed. A source URL is not a capture; a capture hash is not a locator; a
locator is not evidence that a program parsed the document.

## 4. Exact Review Inputs

Structured JSON/CSV review uses:

```text
schemaVersion = basic-structured-source-review/v1
runId, countryCode, catalogVersion, catalogSha256
sources[] = { sourceId, sourceCheck = { status: passed | failed, notes } }
injectionRisks[] = { sourceId, locator, severity: suspected | confirmed, details }
```

Manual HTML/PDF review uses:

```text
schemaVersion = basic-manual-source-review/v1
runId, countryCode, catalogVersion, catalogSha256
sources[] = {
  sourceId,
  publishedAt: UTC RFC3339 | null,
  accessNotes: string | null,
  promptInjectionRisk: none | suspected | confirmed,
  sourceCheck: { status: passed | failed, notes },
  injectionRisks[]: { locator, severity: suspected | confirmed, details }
}
```

Each schema reconstructs an exact plain, finite, recursively frozen value.
Its source IDs are non-empty, unique, sorted, and exactly cover the relevant
non-empty deterministic or manual source set; the sets are disjoint. All four
identity values must exactly match the execution plan. A structured risk names
its source; a manual risk is local to its source. Review ordering is retained
where it is reviewed content rather than normalized as a new fact order.

For manual review, `publishedAt = null` requires nonblank source-check notes
explaining the absence. `promptInjectionRisk` is always an explicit reviewer
decision: `none` permits no local risk; `suspected` or `confirmed` requires
at least one same-severity reviewed risk. A `passed` manual check means the
reviewer checked every plan observation's locator and raw value against the
exact captured bytes identified by that plan's content hash, and confirmed
source identity, access/licence treatment, and injection-risk conclusion. It
does not cause publication or replace programmatic validation.

## 5. Document Observation Plans

Each manual source has exactly one non-empty plan:

```text
schemaVersion = basic-document-observation-plan/v1
runId, countryCode, catalogVersion, catalogSha256, sourceId
capture = {
  adapterId, adapterVersion, requestUrl, retrievedAt,
  contentType, byteLength, contentSha256
}
observations[] =
  { usage: source-fact, fieldPath, locator, rawValue, normalizedValue,
    unit, year, uncertainty }
  | { usage: editorial-evidence, fieldPath, locator, rawValue }
```

The plan identity, source ID, adapter identity, request URL, content type,
retrieval time, byte length, and hash must exactly equal the planned source and
verified v2 manifest. The materializer also rechecks the v2 response policy:
approved HTTPS final URL, redirect, MIME, and capture identity remain bound.
One missing, duplicate, orphan, or mixed-format plan/capture fails closed.

`source-fact` may name only a source-backed path and has the full tuple fields.
It becomes a `manual` preliminary fact. `country.name` remains hybrid-name for
later Editorial controlled enrichment. `editorial-evidence`
may name only an editorial path and has no normalized value, unit, year, or
uncertainty; it remains a frozen intermediate for Editorial. Derived paths are
not accepted from either variant. Each observation must be in the source's
catalog `fieldPaths`, be finite JSON, be uniquely identified by `fieldPath` +
NUL + `locator`, and be in strict ascending order by that identity.

Locators are manually reviewed positions, never inferred from URLs or raw
bytes:

```text
HTML: html:<nonblank reviewed location>
PDF:  pdf:page=<positive integer>#<nonblank anchor>
```

HTML accepts only the HTML form and PDF only the PDF form. The HTML location
and PDF anchor must be non-empty, unchanged after `trim()`, and contain no C0
control character or DEL. Page zero, URLs/search snippets, capture metadata,
and cross-format locators are invalid. Every declared manual risk locator must be
one of that source plan's accepted locators.

## 6. Facts, Conflicts, And Risk Retention

For a source-backed field, the fact tuple is
`(normalizedValue, unit, year)`. Equal tuples across one or more source IDs
produce a deterministic fact ID and one `candidate` fact with sorted evidence.
Different tuples from at least two source IDs produce one `conflict` fact with
all evidence. Different tuples from the same source are malformed input and
fail closed; the system neither chooses a value nor invents another source.
`uncertainty` is retained as a stable, deduplicated textual union. JSON object
keys are canonicalized for tuple comparison; finite JSON remains otherwise
exactly reconstructed.

Materialization does not silently discard bad trust signals. It preserves
manual `sourceChecks`, `UNVERIFIED` credibility, declared prompt-injection
risk, and the resulting injection-risk records beside the facts and editorial
evidence. A failed check is valid reviewed input, not a downgrade or a pass.
The later deterministic preflight, not this task, blocks such material from a
ready candidate package.

## 7. Explicit Exclusions

This slice must not parse HTML DOM or PDF text, run OCR, infer a locator,
translate or summarize with a model, call Hermes/llama/SearXNG/search, make
editorial evidence a final fact, construct a bilingual draft, materialize a
canonical record, write Prisma/database data, change coverage, publish,
create knowledge chunks, or make anything AI-usable. It also must not relax
v1 compatibility or introduce country-specific executor logic.

`reviewStatus = draft` and `aiUsable = false` remain requirements of a future
candidate draft. Only the later Editorial and Deterministic tasks can combine
the retained intermediates into that draft and a complete v2 audit package;
project-owner review and existing publication gates remain separate after
those tasks.
