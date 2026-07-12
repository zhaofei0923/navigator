# basic-country-editorial-input.md - Basic editorial materialization boundary

> This normative contract defines the package-private `DATA-BASIC-EDITORIAL-1`
> boundary. It supplements [basic-country-document-evidence.md](./basic-country-document-evidence.md),
> [basic-country-audit-contract.md](./basic-country-audit-contract.md), and
> [basic-country-collection.md](./basic-country-collection.md). It changes no
> canonical schema, Prisma model, publication rule, or AI retrieval boundary.

## 1. Exact Operator Input

The only operator input is a plain finite JSON object with these exact keys:

```text
schemaVersion = basic-country-editorial-input/v1
runId
countryCode
catalogVersion
catalogSha256
primarySourceId
items[]
```

All four identity values must exactly match the preliminary run, reviewed
source register, structured review, and any branded document result. Unknown,
missing, inherited, accessor, proxy, sparse, cyclic, non-finite, or oversized
values fail closed. The input has at most 256 `items`; an item has at most 32
evidence entries. Parsed values are reconstructed in schema order and
recursively frozen; caller mutation cannot affect a result.

Each item has exactly:

```text
fieldPath
normalizedValue
evidence[] = { sourceId, locator, rawValue, unit, year }
uncertainty
```

Items are unique and lexically sorted by `fieldPath`. Evidence is non-empty,
unique, and lexically sorted by `sourceId` then `locator`. Every editorial
evidence entry fixes `unit = null` and `year = null`, including an indicator
label; publication time remains only on the source record. `uncertainty` is a
nonblank string or `null`.

## 2. Allowlist And Shapes

Only these paths are editorial-owned:

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

`i` is a non-negative exact decimal index. Other paths, including country
code, flag, dates, source metadata, credibility, indicator value/unit/year,
`reviewStatus`, and `aiUsable`, are protected and fail closed.

| Path class | Exact normalized shape |
|---|---|
| `country.name` and narrative paths | `{ zh: string, en: string }`; both values are nonblank after trim |
| `country.region` | One `Region`: `southeast-asia`, `south-asia`, `middle-east`, `africa`, `latin-america`, `europe`, or `central-asia` |
| `industryTags` | Unique, sorted subset of `solar`, `wind`, `storage`, `ev`, `hydrogen`, `grid`, `bess-mfg`, `epc` |
| `techTags` | Unique, sorted subset of `pv-module`, `inverter`, `onshore-wind`, `offshore-wind`, `lfp`, `ncm`, `electrolyzer` |
| indicator label | `{ zh: string, en: string }`; both values are nonblank after trim |

The region is an operator-reviewed classification, not a string conversion
from an external region taxonomy. Editorial text is not model-translated.

## 3. Evidence And Source Eligibility

Every item evidence must exactly match `sourceId`, item `fieldPath`, locator,
and canonical finite-JSON `rawValue` in one of two reviewed intermediates:

1. structured editorial evidence from the deterministic preliminary run; or
2. editorial evidence owned by the exact branded document materialization
   result.

An independent document-evidence array is never trusted. The reviewed source
union is source-ID sorted and consists exactly of deterministic preliminary
records plus the manual records of the branded result. Deterministic and
manual IDs are disjoint. Each reviewed source has exactly one source check;
every consumed source must be `open`, not `UNVERIFIED`, have
`promptInjectionRisk = none`, a passed check, no failed check, and no recorded
injection risk. Missing, foreign, duplicate, unreviewed, inactive, risky, or
identity/catalog/capture-provenance drift fails closed.

The branded document provenance is not transferable by spread or JSON clone.
Its frozen `captureBindings` are unique and source-ID sorted:

```text
{ sourceId, requestUrl, finalUrl, retrievedAt, contentSha256 }[]
```

Each binding must exactly equal its preliminary manual capture. This binds the
reviewed source to both the original materialized request URL and the final
approved response URL.

`primarySourceId` must be an eligible, active, actually referenced source. It
chooses only the representative derived `marketOverview.source` and
`marketOverview.sourceUrl`; it neither hides other evidence nor chooses a fact
value.

## 4. Country Name And Method Ownership

`country.name` is the sole controlled enrichment exception. It requires one
unique deterministic preliminary candidate name. The operator must preserve
that fact's source ID, locator, raw value, and English normalized text exactly,
then add a nonblank Chinese value. The final result contains one `manual`
candidate name fact and replaces the preliminary deterministic name fact.

All other same-path deterministic/manual coexistence is rejected, even when
normalized tuples match. Equal tuples within one method use the shared tuple
rules; differing tuples remain conflicts. Editorial paths always materialize
as `manual`; source-backed paths remain deterministic or reviewed-document
manual; derived paths always materialize as `deterministic`.

## 5. Derived Facts And Final Result

After reviewed source and editorial material merge, the system derives, never
accepts from an operator:

| Derived path | Formula | Evidence locator |
|---|---|---|
| `country.flagEmoji` | ISO2 regional-indicator symbols | original `country.code` locator |
| `marketOverview.countryCode` | validated run ISO2 | original `country.code` locator |
| `marketOverview.source` / `sourceUrl` | eligible active primary source name / request URL | `metadata:/sourceName` / `metadata:/sourceUrl` |
| `marketOverview.collectedAt` | maximum active `retrievedAt` | `capture:/retrievedAt` |
| `marketOverview.updatedAt`, `country.updatedAt` | maximum non-null active `publishedAt` | `metadata:/publishedAt` |
| same update paths when all publications are null | maximum active `retrievedAt`, with fixed nonblank fallback uncertainty | `capture:/retrievedAt` |
| `marketOverview.credibility` | lowest active credibility (`OFFICIAL > VERIFIED > ESTIMATED > UNVERIFIED`) | `metadata:/credibility` |

Derived evidence is attached to the existing source record, whose locators are
deduplicated and sorted. It never creates a synthetic source. Every evidence
normalized value equals the derived aggregate; inactive primary sources,
ambiguous country codes, absent active sources, or incomparable timestamps
block materialization.

`materializeBasicReviewedRunV2()` returns a recursively frozen fresh result:
the reviewed v2 source register, final extracted facts, path-free receipts,
complete source checks, and complete injection risks. It performs no network,
model, Hermes, llama, search, socket, child-process, environment, database,
canonical-write, draft-assembly, or publication action.

The result is not a candidate audit package. `DATA-BASIC-DETERMINISTIC-1`
remains responsible for model-free trust/completeness preflight, draft
assembly, four-file candidate artifacts, and its own deterministic boundary.
Any resulting draft remains `reviewStatus = draft` and `aiUsable = false`;
human review and existing publication gates remain required.
