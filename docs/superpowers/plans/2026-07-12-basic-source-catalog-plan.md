# Basic Source Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reviewed, deterministic source catalog and bind the four existing World Bank adapters to it without changing any v1 request, adapter, capture, audit, or public package behavior.

**Architecture:** A committed JSON catalog is parsed from `unknown` into an exact, recursively frozen value. A structured URL materializer creates reviewed GET requests without string substitution, and a static registry checks that existing adapter metadata and requests exactly match the catalog before any future execution. This task creates plans and bindings only; it does not execute v2 capture or create audit data.

**Tech Stack:** TypeScript strict mode, Node.js `URL`/`URLSearchParams` and `node:crypto`, Vitest, pnpm workspace.

## Global Constraints

- Read `AGENTS.md` and `docs/superpowers/specs/2026-07-12-basic-source-boundary-design.md` before editing.
- Work only on `feat/DATA-BASIC-CATALOG-1` created from the latest pushed `main`.
- Use TDD for every behavior: add one failing test, run it and confirm the expected failure, add minimal production code, then rerun the same test.
- Do not modify `BasicSourceRequest`, `captureBasicRawSource()`, `runBasicDeterministicSourceAdapters()`, either World Bank adapter, `basic-country-audit/v1`, `basic-country-raw-capture/v1`, Prisma, canonical data, AI boundaries, permissions, or billing.
- Do not add a dependency and do not make a real network request in tests.
- The initial catalog contains exactly the existing four World Bank sources. Do not add IMF, IRENA, Ember, HTML, PDF, or credentialed entries.
- Catalog source IDs, field paths, source mappings, and selected execution source IDs are exact, unique, and deterministically ordered.
- Catalog parsing and binding errors are stable and redacted; they must not echo URL values, query values, raw payloads, or external errors.
- Keep catalog/parser/materializer/registry package-private in this task; do not modify `packages/db/src/index.ts`.
- No canonical, staging, raw-cache, database, Web, KnowledgeChunk, AI-index, or environment side effects.

---

## File Structure

### Create

- `packages/db/catalog/basic-source-catalog.json` - reviewed World Bank catalog data only.
- `packages/db/src/collection/basic-source-catalog.ts` - exact contracts, parser, canonical serializer, digest, and execution-plan types.
- `packages/db/src/collection/basic-source-request-materializer.ts` - structured URL construction and country mapping.
- `packages/db/src/collection/basic-source-adapter-registry.ts` - static adapter registry and drift validation.
- `packages/db/src/basic-source-catalog.test.ts` - parser, digest, request, catalog, and registry behavior.
- `docs/basic-source-catalog.md` - normative catalog v1 contract.

### Modify

- `packages/db/src/world-bank-source-adapters.test.ts` - prove catalog bindings preserve all existing adapter requests and observations.
- `docs/basic-country-source-adapters.md` - identify catalog as the policy/request authority while preserving P1-6B v1 behavior.
- `docs/basic-country-collection.md` - link the new catalog document without changing the current v1 normal path yet.
- `docs/roadmap.md` - add and complete the `DATA-BASIC-CATALOG-1` task card.

### Must Remain Unchanged

- `packages/db/src/collection/basic-source-adapter-contracts.ts`
- `packages/db/src/collection/basic-source-adapter-runner.ts`
- `packages/db/src/collection/basic-source-metadata.ts`
- `packages/db/src/collection/basic-source-transport.ts`
- `packages/db/src/collection/basic-raw-capture.ts`
- `packages/db/src/collection/adapters/world-bank-country.ts`
- `packages/db/src/collection/adapters/world-bank-indicators.ts`
- `packages/db/src/index.ts`
- `packages/db/prisma/schema.prisma`
- `data/**`

---

### Task 1: Exact Catalog Contracts, Parser, and Digest

**Files:**
- Create: `packages/db/src/collection/basic-source-catalog.ts`
- Create: `packages/db/src/basic-source-catalog.test.ts`

**Interfaces:**
- Consumes: `BasicSourceFamily`, `Credibility`, and the existing audit field-path allowlist.
- Produces:

```ts
export const BASIC_SOURCE_CATALOG_SCHEMA_VERSION =
  "basic-source-catalog/v1" as const;
export const BASIC_MANUAL_DOCUMENT_ADAPTER_ID =
  "basic-manual-document-capture" as const;
export const BASIC_MANUAL_DOCUMENT_ADAPTER_VERSION = "1.0.0" as const;

export interface BasicSourceCatalogSnapshot {
  readonly catalog: BasicSourceCatalog;
  readonly catalogSha256: string;
}

export function parseBasicSourceCatalog(value: unknown): BasicSourceCatalogSnapshot;
export function canonicalizeBasicSourceCatalog(catalog: BasicSourceCatalog): string;
```

- [ ] **Step 1: Write the failing parser and digest tests**

Add a local `validCatalog()` factory whose source has every exact key from the approved design. Test all of the following separately:

```ts
function validCatalog() {
  return {
    schemaVersion: "basic-source-catalog/v1",
    catalogVersion: "2026-07-12.1",
    sources: [{
      sourceId: "world-bank-country",
      sourceName: "World Bank",
      sourceFamily: "international-organization",
      credibility: "OFFICIAL",
      format: "json",
      countryScope: "all",
      requestTemplate: {
        origin: "https://api.worldbank.org",
        pathSegments: [
          { kind: "literal", value: "v2" },
          { kind: "literal", value: "country" },
          { kind: "placeholder", value: "countryCode" },
        ],
        query: [{
          name: "format",
          value: { kind: "literal", value: "json" },
        }],
      },
      accept: "application/json",
      approvedOrigins: ["https://api.worldbank.org"],
      allowedQueryParameters: ["format"],
      accessMode: "open",
      licenseName:
        "Creative Commons Attribution 4.0 International (CC BY 4.0)",
      licenseUrl: "https://datacatalog.worldbank.org/public-licenses",
      attribution:
        "World Bank, World Development Indicators; licensed under CC BY 4.0; changes and translations must be indicated.",
      refreshCadence: "annual",
      adapterId: "world-bank-country",
      adapterVersion: "1.0.0",
      adapterKind: "deterministic",
      fieldPaths: ["country.code", "country.name"],
    }],
    countryMappings: [],
  };
}

test("parses and recursively freezes an exact catalog", () => {
  const result = parseBasicSourceCatalog(validCatalog());
  expect(result.catalog.schemaVersion).toBe("basic-source-catalog/v1");
  expect(result.catalog.sources[0]?.sourceId).toBe("world-bank-country");
  expect(result.catalogSha256).toMatch(/^[0-9a-f]{64}$/);
  expect(Object.isFrozen(result.catalog)).toBe(true);
  expect(Object.isFrozen(result.catalog.sources)).toBe(true);
  expect(Object.isFrozen(result.catalog.sources[0])).toBe(true);
});

test("canonicalizes object key order before hashing", () => {
  const left = validCatalog();
  const right = {
    countryMappings: left.countryMappings,
    sources: left.sources,
    catalogVersion: left.catalogVersion,
    schemaVersion: left.schemaVersion,
  };
  expect(parseBasicSourceCatalog(left).catalogSha256)
    .toBe(parseBasicSourceCatalog(right).catalogSha256);
});

test("changes the digest when catalog semantics change", () => {
  const left = validCatalog();
  const right = structuredClone(left);
  right.catalogVersion = "2026-07-12.2";
  expect(parseBasicSourceCatalog(left).catalogSha256)
    .not.toBe(parseBasicSourceCatalog(right).catalogSha256);
});
```

Use table tests to reject extra/missing/accessor/symbol keys, proxy/cyclic/sparse values, unsafe IDs, invalid enums, non-HTTPS origins/license URLs, unknown field paths, wildcard indicator paths, unsorted/duplicate sources, country scopes, field paths, and mappings, plus every resource limit from the design.

Also test the format/adapter matrix exactly: JSON/CSV require `deterministic`; HTML/PDF require `manual-document`; every manual-document entry must use `basic-manual-document-capture@1.0.0`. Reject any unknown or drifted generic identity during catalog parsing.

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```bash
pnpm --filter @navigator/db exec vitest run src/basic-source-catalog.test.ts
```

Expected: FAIL because `basic-source-catalog.ts` and its exports do not exist.

- [ ] **Step 3: Add exact catalog types and minimal parsing**

Define the approved discriminated types verbatim:

```ts
export type BasicSourceCatalogToken =
  | { readonly kind: "literal"; readonly value: string }
  | {
      readonly kind: "placeholder";
      readonly value: "countryCode" | "sourceCountryId";
    };

export interface BasicSourceCatalogSource {
  readonly sourceId: string;
  readonly sourceName: string;
  readonly sourceFamily: BasicSourceFamily;
  readonly credibility: Credibility;
  readonly format: "json" | "csv" | "html" | "pdf";
  readonly countryScope: "all" | readonly string[];
  readonly requestTemplate: {
    readonly origin: string;
    readonly pathSegments: readonly BasicSourceCatalogToken[];
    readonly query: readonly {
      readonly name: string;
      readonly value: BasicSourceCatalogToken;
    }[];
  };
  readonly accept:
    | "application/json"
    | "text/csv"
    | "text/html"
    | "application/pdf";
  readonly approvedOrigins: readonly string[];
  readonly allowedQueryParameters: readonly string[];
  readonly accessMode: "open" | "optional-credentialed";
  readonly licenseName: string;
  readonly licenseUrl: string;
  readonly attribution: string;
  readonly refreshCadence:
    | "monthly"
    | "quarterly"
    | "annual"
    | "event-driven"
    | "manual";
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly adapterKind: "deterministic" | "manual-document";
  readonly fieldPaths: readonly string[];
}

export interface BasicSourceCountryMapping {
  readonly countryCode: string;
  readonly sourceId: string;
  readonly sourceCountryId: string;
}

export interface BasicSourceCatalog {
  readonly schemaVersion: typeof BASIC_SOURCE_CATALOG_SCHEMA_VERSION;
  readonly catalogVersion: string;
  readonly sources: readonly BasicSourceCatalogSource[];
  readonly countryMappings: readonly BasicSourceCountryMapping[];
}
```

Reconstruct objects in schema key order, cap sources at 2,048, mappings at 10,000, field paths at 128, query entries at 64, depth at 64, strings at 65,536 UTF-8 bytes, and URLs at 8,192 bytes. Require `catalogVersion` to match `/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/`. Compute the digest exactly as:

```ts
export function canonicalizeBasicSourceCatalog(
  catalog: BasicSourceCatalog,
): string {
  return JSON.stringify(catalog);
}

function digest(catalog: BasicSourceCatalog): string {
  return createHash("sha256")
    .update(canonicalizeBasicSourceCatalog(catalog), "utf8")
    .digest("hex");
}
```

Return recursively frozen reconstructed data, never the caller's objects.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run the same Vitest command. Expected: all parser/digest tests PASS.

- [ ] **Step 5: Commit the parser slice**

```bash
git add packages/db/src/collection/basic-source-catalog.ts packages/db/src/basic-source-catalog.test.ts
git commit -m "feat: add Basic source catalog contract"
```

---

### Task 2: Structured Request Materializer and Country Mapping

**Files:**
- Create: `packages/db/src/collection/basic-source-request-materializer.ts`
- Modify: `packages/db/src/basic-source-catalog.test.ts`

**Interfaces:**
- Consumes: parsed `BasicSourceCatalogSource`, mappings, ISO2, and selected source IDs.
- Produces:

```ts
export interface BasicSourceExecutionPlanEntry {
  readonly source: BasicSourceCatalogSource;
  readonly request: BasicSourcePlannedRequest;
}

export interface BasicSourcePlannedRequest {
  readonly method: "GET";
  readonly url: string;
  readonly accept:
    | "application/json"
    | "text/csv"
    | "text/html"
    | "application/pdf";
  readonly allowedOrigins: readonly string[];
  readonly allowedQueryParameters: readonly string[];
}

export interface BasicSourceExecutionPlan {
  readonly catalogVersion: string;
  readonly catalogSha256: string;
  readonly countryCode: string;
  readonly sources: readonly BasicSourceExecutionPlanEntry[];
}

export function createBasicSourceExecutionPlan(input: {
  readonly catalog: BasicSourceCatalogSnapshot;
  readonly countryCode: string;
  readonly sourceIds: readonly string[];
}): BasicSourceExecutionPlan;
```

- [ ] **Step 1: Add failing materialization tests**

Cover one literal-only URL, `{countryCode}`, and `{sourceCountryId}` in both a full path segment and a full query value. Assert exact URL and query order. Add rejection tests for placeholder use in authority/query name/substrings, credentials, fragment, duplicate query name, pre-encoded `%2F`, missing/orphan mapping, out-of-scope country, unknown source ID, unsorted/duplicate selected IDs, and selected `optional-credentialed` source.

```ts
expect(plan.sources[0]?.request).toEqual({
  method: "GET",
  url: "https://api.worldbank.org/v2/country/VN?format=json",
  accept: "application/json",
  allowedOrigins: ["https://api.worldbank.org"],
  allowedQueryParameters: ["format"],
});
```

- [ ] **Step 2: Run the test and confirm RED**

Run the catalog test. Expected: FAIL because the materializer is missing.

- [ ] **Step 3: Implement component-safe construction**

Validate ISO2 before lookup. Resolve a placeholder only as an entire token. Reject values containing a pre-encoded `%HH` sequence. Build with `URL` and `URLSearchParams`; do not use template-string replacement for external IDs.

```ts
function tokenValue(
  token: BasicSourceCatalogToken,
  countryCode: string,
  sourceCountryId: string | null,
): string {
  if (token.kind === "literal") return rejectPreEncoded(token.value);
  if (token.value === "countryCode") return countryCode;
  if (sourceCountryId === null) throw new Error("source catalog mapping is invalid");
  return rejectPreEncoded(sourceCountryId);
}
```

After construction, reparse the URL and verify HTTPS, no credentials/fragment, exact approved origin, unique query names, and exact query-name sequence. Reconstruct and freeze the plan.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run the catalog test. Expected: all request/mapping tests PASS.

- [ ] **Step 5: Commit the materializer**

```bash
git add packages/db/src/collection/basic-source-request-materializer.ts packages/db/src/basic-source-catalog.test.ts
git commit -m "feat: materialize reviewed source requests"
```

---

### Task 3: Static Adapter Registry and Drift Rejection

**Files:**
- Create: `packages/db/src/collection/basic-source-adapter-registry.ts`
- Modify: `packages/db/src/basic-source-catalog.test.ts`

**Interfaces:**
- Consumes: deterministic plan entries and existing World Bank adapters.
- Produces:

```ts
export function resolveBasicSourceAdapter(
  entry: BasicSourceExecutionPlanEntry,
  countryCode: string,
): BasicDeterministicSourceAdapter;
```

- [ ] **Step 1: Add failing registry and drift tests**

Assert all four `adapterId@adapterVersion` keys resolve. Mutate each duplicated property independently: sourceId, sourceName, sourceFamily, credibility, adapter ID/version, request URL, Accept, origin list, query-name list, adapter kind, format, and access mode. Every mutation must fail before adapter extraction.

- [ ] **Step 2: Run focused tests and confirm RED**

Run the catalog and World Bank tests. Expected: FAIL because no registry exists.

- [ ] **Step 3: Implement the static registry**

Create a frozen map from the existing adapters only:

```ts
const ADAPTERS = Object.freeze([
  worldBankCountryAdapter,
  ...WORLD_BANK_CORE_INDICATOR_ADAPTERS,
]);

const REGISTRY = new Map(
  ADAPTERS.map((adapter) => [
    `${adapter.adapterId}@${adapter.adapterVersion}`,
    adapter,
  ] as const),
);
```

Require deterministic/json/open entries in this task. Manual-document entries never enter this static implementation registry; their fixed constants were already validated by the parser and will be revalidated by the generic executor task. Call `adapter.request(countryCode)`, snapshot it through the existing v1 request validator, and compare all request fields in order. Return the adapter only after every comparison succeeds. Use one stable failure message: `source catalog adapter binding is invalid`.

- [ ] **Step 4: Run tests and confirm GREEN**

Run:

```bash
pnpm --filter @navigator/db exec vitest run src/basic-source-catalog.test.ts src/world-bank-source-adapters.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the registry**

```bash
git add packages/db/src/collection/basic-source-adapter-registry.ts packages/db/src/basic-source-catalog.test.ts
git commit -m "feat: bind catalog sources to adapters"
```

---

### Task 4: Commit the Reviewed World Bank Catalog

**Files:**
- Create: `packages/db/catalog/basic-source-catalog.json`
- Modify: `packages/db/src/basic-source-catalog.test.ts`
- Modify: `packages/db/src/world-bank-source-adapters.test.ts`

**Interfaces:**
- Consumes: parser, materializer, and registry from Tasks 1-3.
- Produces: four reviewed open World Bank plan entries and no country mappings.

- [ ] **Step 1: Add a failing static-catalog test**

Read the committed JSON through `JSON.parse`, parse it through the catalog parser, create a `VN` plan using these exact sorted source IDs, and bind every entry:

```ts
const WORLD_BANK_SOURCE_IDS = [
  "world-bank-country",
  "world-bank-gdp",
  "world-bank-gdp-growth",
  "world-bank-population",
] as const;
```

Assert `countryMappings` is empty and each catalog request deeply equals the existing adapter request. Decode the existing recorded fixtures and assert each extracted observation path is a subset of its catalog field paths.

- [ ] **Step 2: Run tests and confirm RED**

Expected: FAIL because the catalog file does not exist.

- [ ] **Step 3: Add the exact catalog JSON**

Use `catalogVersion: "2026-07-12.1"`, `countryMappings: []`, and these exact per-source values:

| sourceId | path after origin | ordered query | allowedQueryParameters | fieldPaths |
| --- | --- | --- | --- | --- |
| `world-bank-country` | `v2/country/{countryCode}` | `format=json` | `format` | `country.code`, `country.name` |
| `world-bank-gdp` | `v2/country/{countryCode}/indicator/NY.GDP.MKTP.CD` | `source=2&format=json&mrv=1&per_page=1` | `source`, `format`, `mrv`, `per_page` | `marketOverview.gdp` |
| `world-bank-gdp-growth` | `v2/country/{countryCode}/indicator/NY.GDP.MKTP.KD.ZG` | `source=2&format=json&mrv=1&per_page=1` | `source`, `format`, `mrv`, `per_page` | `marketOverview.gdpGrowth` |
| `world-bank-population` | `v2/country/{countryCode}/indicator/SP.POP.TOTL` | `source=2&format=json&mrv=1&per_page=1` | `source`, `format`, `mrv`, `per_page` | `marketOverview.population` |

Encode each slash-delimited path component as a separate token. `{countryCode}` is the sole placeholder token. Encode each query row as `{ "name": <literal name>, "value": { "kind": "literal", "value": <literal value> } }` in the order shown; braces never appear inside literal strings.

Every entry also uses:

```json
{
  "sourceName": "World Bank",
  "sourceFamily": "international-organization",
  "credibility": "OFFICIAL",
  "format": "json",
  "countryScope": "all",
  "accept": "application/json",
  "approvedOrigins": ["https://api.worldbank.org"],
  "accessMode": "open",
  "licenseName": "Creative Commons Attribution 4.0 International (CC BY 4.0)",
  "licenseUrl": "https://datacatalog.worldbank.org/public-licenses",
  "attribution": "World Bank, World Development Indicators; licensed under CC BY 4.0; changes and translations must be indicated.",
  "refreshCadence": "annual",
  "adapterVersion": "1.0.0",
  "adapterKind": "deterministic"
}
```

Set `adapterId` equal to each existing source ID. Represent every path/query component with the approved token objects; do not embed braces in strings.

- [ ] **Step 4: Run static and regression tests**

Run:

```bash
pnpm --filter @navigator/db exec vitest run src/basic-source-catalog.test.ts src/world-bank-source-adapters.test.ts src/basic-source-adapter-runner.test.ts
```

Expected: PASS with unchanged existing World Bank snapshots and fixture hashes.

- [ ] **Step 5: Commit catalog data**

```bash
git add packages/db/catalog/basic-source-catalog.json packages/db/src/basic-source-catalog.test.ts packages/db/src/world-bank-source-adapters.test.ts
git commit -m "feat: register World Bank Basic sources"
```

---

### Task 5: Normative Documentation and Task-Card Verification

**Files:**
- Create: `docs/basic-source-catalog.md`
- Modify: `docs/basic-country-source-adapters.md`
- Modify: `docs/basic-country-collection.md`
- Modify: `docs/roadmap.md`

- [ ] **Step 1: Write the catalog contract document**

Document the exact JSON shape, digest algorithm, structured request grammar, mapping rules, catalog/adapter ownership, fixed `basic-manual-document-capture@1.0.0` identity, initial World Bank sources, open-only execution rule, limits, errors, and the explicit v1 non-change boundary. Link the approved design and official World Bank API/license pages.

- [ ] **Step 2: Update existing docs without rewriting v1 history**

Add `DATA-BASIC-CATALOG-1` to the roadmap with the branch goal and tests. In source-adapters and collection docs, state that the catalog is the new policy/request control plane while P1-6B's existing runner/capture remains v1 and unchanged in this task.

- [ ] **Step 3: Run documentation and source scans**

Run:

```bash
rg -n "basic-source-catalog/v1|DATA-BASIC-CATALOG-1|catalogSha256|World Bank" docs packages/db/catalog packages/db/src/collection/basic-source-catalog.ts
rg -n "IMF|IRENA|Ember|optional-credentialed" packages/db/catalog/basic-source-catalog.json
git diff --check
```

Expected: the first command finds the new contract and task; the second command exits 1 with no output; diff check exits 0.

- [ ] **Step 4: Run all branch gates**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm turbo run lint typecheck test --force
```

Expected: every command exits 0. No E2E run is required because this task has no Web behavior.

- [ ] **Step 5: Commit documentation**

```bash
git add docs/basic-source-catalog.md docs/basic-country-source-adapters.md docs/basic-country-collection.md docs/roadmap.md
git commit -m "docs: define Basic source catalog workflow"
```

---

## Task-Card Review and Integration

1. Generate a review package from the branch base to HEAD.
2. Dispatch an independent reviewer against this plan, the approved design, `AGENTS.md`, and the review package.
3. Fix every Critical/Important finding with a fresh fix agent and rerun focused tests.
4. Rerun all four branch gates.
5. Merge with `--no-ff` into the latest `main`, rerun all four gates on merged `main`, then `git push origin main`.
6. Confirm local `main` and `origin/main` point to the same merge commit before starting `DATA-BASIC-FORMATS-1`.
