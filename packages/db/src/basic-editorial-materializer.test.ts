import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import type {
  BasicInjectionRisk,
  BasicSourceCheck,
  BasicSourceRecord,
} from "./collection/basic-collection-contracts.js";
import type {
  BasicExtractedFactsV2,
  BasicSourceRegisterV2,
  BasicStructuredEditorialEvidenceObservation,
} from "./collection/basic-collection-v2-contracts.js";
import {
  materializeBasicDocumentEvidence,
  type BasicDocumentMaterializationResult,
} from "./collection/basic-document-observation-materializer.js";
import { parseBasicDocumentObservationPlan } from "./collection/basic-document-observation-parser.js";
import type { BasicCountryEditorialInput } from "./collection/basic-editorial-input-contracts.js";
import {
  materializeBasicEditorialFacts,
} from "./collection/basic-editorial-materializer.js";
import { parseBasicSourceCatalog } from "./collection/basic-source-catalog.js";
import { parseBasicManualSourceReview } from "./collection/basic-source-review-parser.js";
import { createBasicSourceExecutionPlan } from "./collection/basic-source-request-materializer.js";
import { runBasicSourceExecutionPlanV2 } from "./collection/basic-source-plan-runner-v2.js";
import type { BasicSourceTransportV2 } from "./collection/basic-source-v2-contracts.js";
import { materializeBasicSourceFactsV2 } from "./collection/basic-v2-fact-materializer.js";

const ERROR = "basic editorial materialization is invalid";
const RUN_ID = "run-20260713";
const COUNTRY_CODE = "VN";
const CATALOG_VERSION = "2026.07.13.editorial-1";
const CATALOG_SHA256 =
  "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
const CONTENT_SHA256 =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const roots = new Set<string>();

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.clear();
});

describe("Basic editorial evidence materializer", () => {
  test("binds structured-only evidence with normalized values and uncertainty", () => {
    const source = sourceRecord("structured-source");
    const rawValue = { "10": "ten", "2": "two", section: "overview" };
    const editorial = editorialInput([
      item("country.summary", { zh: "越南市场", en: "Vietnam market" }, [
        evidence(source.sourceId, "json:/summary", rawValue),
      ], "Operator synthesis"),
    ]);

    const result = materializeBasicEditorialFacts(input({
      editorial,
      reviewedSources: register([source]),
      structuredEditorialEvidence: [structuredEvidence(
        source.sourceId,
        "country.summary",
        "json:/summary",
        { "2": "two", "10": "ten", section: "overview" },
      )],
    }));

    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]).toMatchObject({
      fieldPath: "country.summary",
      status: "candidate",
      extractionMethod: "manual",
      uncertainty: "Operator synthesis",
    });
    expect(result.facts[0]?.evidence[0]).toEqual({
      sourceId: source.sourceId,
      locator: "json:/summary",
      rawValue: { "2": "two", "10": "ten", section: "overview" },
      normalizedValue: { zh: "越南市场", en: "Vietnam market" },
      unit: null,
      year: null,
    });
    expect(result.consumedEvidence).toEqual([{
      sourceId: source.sourceId,
      fieldPath: "country.summary",
      locator: "json:/summary",
    }]);
    expectDeeplyFrozen(result);
  });

  test("binds evidence only from the exact branded document result", async () => {
    const document = await documentFixture();
    const editorial = editorialInput([
      item("country.summary", { zh: "经审阅的摘要", en: "Reviewed summary" }, [
        evidence("official-html", "html:section=overview", "Reviewed country summary"),
      ]),
    ], "official-html", document.identity);

    const result = materializeBasicEditorialFacts(input({
      editorial,
      reviewedSources: register(document.result.sources, document.identity),
      documentResult: document.result,
      structuredEditorialEvidence: [],
      sourceChecks: document.result.sourceChecks,
    }));

    expect(result.facts[0]?.evidence[0]?.normalizedValue).toEqual({
      zh: "经审阅的摘要",
      en: "Reviewed summary",
    });
    expect(result.consumedEvidence).toEqual([{
      sourceId: "official-html",
      fieldPath: "country.summary",
      locator: "html:section=overview",
    }]);

    expectInvalid(input({
      editorial,
      reviewedSources: register(document.result.sources, document.identity),
      documentResult: { ...document.result },
      structuredEditorialEvidence: [],
      sourceChecks: document.result.sourceChecks,
    }));
  });

  test("binds mixed multi-source narrative support in stable evidence order", async () => {
    const document = await documentFixture();
    const structured = sourceRecord("structured-source");
    const editorial = editorialInput([
      item("country.summary", { zh: "综合摘要", en: "Combined summary" }, [
        evidence("official-html", "html:section=overview", "Reviewed country summary"),
        evidence("structured-source", "json:/summary", "Structured summary"),
      ], "Two reviewed sources"),
    ], "official-html", document.identity);
    const reviewedSources = register(
      [document.result.sources[0]!, structured].sort(compareSource),
      document.identity,
    );

    const first = materializeBasicEditorialFacts(input({
      editorial,
      reviewedSources,
      documentResult: document.result,
      structuredEditorialEvidence: [structuredEvidence(
        "structured-source", "country.summary", "json:/summary", "Structured summary",
      )],
      sourceChecks: [
        ...document.result.sourceChecks,
        check("structured-source"),
      ].sort(compareCheck),
    }));
    const second = materializeBasicEditorialFacts(input({
      editorial: structuredClone(editorial),
      reviewedSources: structuredClone(reviewedSources),
      documentResult: document.result,
      structuredEditorialEvidence: [structuredEvidence(
        "structured-source", "country.summary", "json:/summary", "Structured summary",
      )],
      sourceChecks: [check("structured-source"), ...document.result.sourceChecks]
        .sort(compareCheck),
    }));

    expect(first.facts[0]?.evidence.map(({ sourceId }) => sourceId)).toEqual([
      "official-html",
      "structured-source",
    ]);
    expect(first.facts).toHaveLength(1);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  test("replaces the unique deterministic country name with controlled bilingual enrichment", () => {
    const source = sourceRecord("structured-source");
    const rawValue = { officialName: "Viet Nam" };
    const nameFacts = materializeBasicSourceFactsV2([{
      sourceId: source.sourceId,
      fieldPath: "country.name",
      locator: "json:/name",
      rawValue,
      normalizedValue: { zh: "Viet Nam", en: "Viet Nam" },
      unit: null,
      year: null,
      uncertainty: "Official English spelling",
    }], "deterministic");
    const editorial = editorialInput([
      item("country.name", { zh: "越南", en: "Viet Nam" }, [
        evidence(source.sourceId, "json:/name", { officialName: "Viet Nam" }),
      ], "Official English spelling"),
    ]);

    const result = materializeBasicEditorialFacts(input({
      editorial,
      reviewedSources: register([source]),
      preliminaryFacts: facts(nameFacts),
      structuredEditorialEvidence: [],
    }));

    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]).toMatchObject({
      fieldPath: "country.name",
      status: "candidate",
      extractionMethod: "manual",
      uncertainty: "Official English spelling",
    });
    expect(result.facts[0]?.evidence[0]?.normalizedValue).toEqual({
      zh: "越南",
      en: "Viet Nam",
    });
  });

  test.each([
    ["missing source check", (value: ReturnType<typeof input>) => ({
      ...value, sourceChecks: [],
    })],
    ["duplicate source check", (value: ReturnType<typeof input>) => ({
      ...value, sourceChecks: [...value.sourceChecks, value.sourceChecks[0]!],
    })],
    ["foreign source check", (value: ReturnType<typeof input>) => ({
      ...value, sourceChecks: [...value.sourceChecks, check("foreign-source")],
    })],
    ["failed referenced source", (value: ReturnType<typeof input>) => ({
      ...value,
      sourceChecks: [{
        sourceId: "structured-source",
        status: "failed",
        notes: null,
      } satisfies BasicSourceCheck],
    })],
    ["referenced injection risk", (value: ReturnType<typeof input>) => ({
      ...value, injectionRisks: [risk("structured-source")],
    })],
    ["foreign injection risk", (value: ReturnType<typeof input>) => ({
      ...value, injectionRisks: [risk("foreign-source")],
    })],
  ])("rejects %s", (_label, mutate) => {
    expectInvalid(mutate(structuredSuccessInput()));
  });

  test.each([
    ["inactive", { discoveryOnly: true }],
    ["non-open", { accessStatus: "restricted" }],
    ["UNVERIFIED", { credibility: "UNVERIFIED" }],
    ["prompt-risk", { promptInjectionRisk: "suspected" }],
  ] as const)("does not consume a %s source", (_label, overrides) => {
    const source = sourceRecord("structured-source", overrides);
    expectInvalid(structuredSuccessInput({ reviewedSources: register([source]) }));
  });

  test.each([
    ["editorial run", { runId: "other-run" }],
    ["editorial country", { countryCode: "ID" }],
    ["editorial catalog version", { catalogVersion: "other-version" }],
    ["editorial catalog digest", { catalogSha256: CONTENT_SHA256 }],
  ])("rejects cross-identity %s", (_label, overrides) => {
    expectInvalid(structuredSuccessInput({
      editorial: editorialInput(undefined, undefined, overrides),
    }));
  });

  test("rejects preliminary fact identity drift", () => {
    expectInvalid(structuredSuccessInput({
      preliminaryFacts: facts([], { runId: "other-run" }),
    }));
  });

  test.each([
    ["missing evidence", []],
    ["orphan evidence", [
      structuredEvidence("structured-source", "country.summary", "json:/summary", "Summary raw"),
      structuredEvidence("structured-source", "marketOverview.overview", "json:/orphan", "Orphan"),
    ]],
    ["duplicate evidence", [
      structuredEvidence("structured-source", "country.summary", "json:/summary", "Summary raw"),
      structuredEvidence("structured-source", "country.summary", "json:/summary", "Summary raw"),
    ]],
    ["wrong path", [
      structuredEvidence("structured-source", "marketOverview.overview", "json:/summary", "Summary raw"),
    ]],
    ["wrong raw value", [
      structuredEvidence("structured-source", "country.summary", "json:/summary", "Different raw"),
    ]],
  ])("rejects %s binding", (_label, structuredEditorialEvidence) => {
    expectInvalid(structuredSuccessInput({ structuredEditorialEvidence }));
  });

  test("rejects a preliminary source fact as ordinary editorial evidence", () => {
    const preliminary = materializeBasicSourceFactsV2([{
      sourceId: "structured-source",
      fieldPath: "marketOverview.population",
      locator: "json:/summary",
      rawValue: "Summary raw",
      normalizedValue: 100,
      unit: "people",
      year: 2025,
      uncertainty: null,
    }], "deterministic");
    expectInvalid(structuredSuccessInput({
      preliminaryFacts: facts(preliminary),
      structuredEditorialEvidence: [],
    }));
  });

  test("rejects deterministic final facts masquerading as editorial evidence", () => {
    expectInvalid(structuredSuccessInput({
      structuredEditorialEvidence: [{
        ...structuredEvidence(
          "structured-source", "country.summary", "json:/summary", "Summary raw",
        ),
        normalizedValue: { zh: "伪造", en: "Forged" },
        unit: null,
        year: null,
      } as unknown as BasicStructuredEditorialEvidenceObservation],
    }));
  });

  test("requires the primary source to be eligible and actually referenced", () => {
    const unreferenced = sourceRecord("unreferenced-source");
    expectInvalid(structuredSuccessInput({
      editorial: editorialInput(undefined, "unreferenced-source"),
      reviewedSources: register([
        sourceRecord("structured-source"),
        unreferenced,
      ]),
      sourceChecks: [check("structured-source"), check("unreferenced-source")],
    }));
  });

  test("rejects wrong, duplicate, and non-deterministic preliminary country names", () => {
    const source = sourceRecord("structured-source");
    const base = {
      sourceId: source.sourceId,
      fieldPath: "country.name",
      locator: "json:/name",
      rawValue: "Viet Nam",
      normalizedValue: { zh: "Viet Nam", en: "Viet Nam" },
      unit: null,
      year: null,
      uncertainty: null,
    } as const;
    const deterministic = materializeBasicSourceFactsV2([base], "deterministic")[0]!;
    const nameInput = input({
      editorial: editorialInput([item(
        "country.name",
        { zh: "越南", en: "Vietnam" },
        [evidence(source.sourceId, "json:/name", "Viet Nam")],
      )]),
      reviewedSources: register([source]),
    });

    expectInvalid({ ...nameInput, preliminaryFacts: facts([deterministic]) });
    expectInvalid({
      ...nameInput,
      editorial: editorialInput([item(
        "country.name",
        { zh: "越南", en: "Viet Nam" },
        [evidence(source.sourceId, "json:/wrong", "Viet Nam")],
      )]),
      preliminaryFacts: facts([deterministic]),
    });
    expectInvalid({
      ...nameInput,
      editorial: editorialInput([item(
        "country.name",
        { zh: "越南", en: "Viet Nam" },
        [evidence(source.sourceId, "json:/name", "Viet Nam")],
      )]),
      preliminaryFacts: facts([
        deterministic,
        { ...deterministic, factId: "fact-duplicate-name" },
      ]),
    });
    expectInvalid({
      ...nameInput,
      editorial: editorialInput([item(
        "country.name",
        { zh: "越南", en: "Viet Nam" },
        [evidence(source.sourceId, "json:/name", "Viet Nam")],
      )]),
      preliminaryFacts: facts([{ ...deterministic, extractionMethod: "manual" }]),
    });
  });

  test("rejects cross-run, country, catalog, and manual-source document provenance", async () => {
    const base = await documentFixture();
    const variants = [
      await documentFixture({ runId: "other-run" }),
      await documentFixture({ countryCode: "ID" }),
      await documentFixture({ catalogVersion: "other-version" }),
    ];
    const editorial = editorialInput([
      item("country.summary", { zh: "摘要", en: "Summary" }, [
        evidence("official-html", "html:section=overview", "Reviewed country summary"),
      ]),
    ], "official-html", base.identity);
    const reviewedSources = register(base.result.sources, base.identity);

    for (const variant of variants) {
      expectInvalid(input({
        editorial,
        reviewedSources,
        documentResult: variant.result,
        sourceChecks: base.result.sourceChecks,
      }));
    }

    expectInvalid(input({
      editorial,
      reviewedSources: register([
        { ...base.result.sources[0]!, sourceName: "Drifted manual owner" },
      ], base.identity),
      documentResult: base.result,
      sourceChecks: base.result.sourceChecks,
    }));
  });

  test("returns one redacted error without rejected evidence text", () => {
    const sentinel = "EDITORIAL_EVIDENCE_SECRET_MUST_NOT_LEAK";
    try {
      materializeBasicEditorialFacts(structuredSuccessInput({
        structuredEditorialEvidence: [structuredEvidence(
          "structured-source", "country.summary", "json:/summary", sentinel,
        )],
      }));
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(ERROR);
      expect((error as Error).message).not.toContain(sentinel);
    }
  });

  test("rejects accessor-backed review arrays without executing them", () => {
    const probe = { executions: 0 };
    const sourceChecks = new Array<BasicSourceCheck>(1);
    Object.defineProperty(sourceChecks, "0", {
      enumerable: true,
      get() {
        probe.executions += 1;
        return check("structured-source");
      },
    });

    expectInvalid(structuredSuccessInput({ sourceChecks }));
    expect(probe.executions).toBe(0);
  });
});

type Identity = Readonly<{
  runId: string;
  countryCode: string;
  catalogVersion: string;
  catalogSha256: string;
}>;

function identity(overrides: Partial<Identity> = {}): Identity {
  return {
    runId: RUN_ID,
    countryCode: COUNTRY_CODE,
    catalogVersion: CATALOG_VERSION,
    catalogSha256: CATALOG_SHA256,
    ...overrides,
  };
}

function editorialInput(
  items = [item("country.summary", { zh: "越南摘要", en: "Vietnam summary" }, [
    evidence("structured-source", "json:/summary", "Summary raw"),
  ])],
  primarySourceId = "structured-source",
  overrides: Partial<Identity> = {},
): BasicCountryEditorialInput {
  return {
    schemaVersion: "basic-country-editorial-input/v1",
    ...identity(overrides),
    primarySourceId,
    items,
  };
}

function item(
  fieldPath: string,
  normalizedValue: BasicCountryEditorialInput["items"][number]["normalizedValue"],
  evidenceValue: BasicCountryEditorialInput["items"][number]["evidence"],
  uncertainty: string | null = null,
): BasicCountryEditorialInput["items"][number] {
  return { fieldPath, normalizedValue, evidence: evidenceValue, uncertainty };
}

function evidence(sourceId: string, locator: string, rawValue: BasicCountryEditorialInput["items"][number]["normalizedValue"]) {
  return { sourceId, locator, rawValue, unit: null, year: null } as const;
}

function structuredEvidence(
  sourceId: string,
  fieldPath: string,
  locator: string,
  rawValue: BasicStructuredEditorialEvidenceObservation["rawValue"],
): BasicStructuredEditorialEvidenceObservation {
  return { sourceId, fieldPath, locator, rawValue };
}

function sourceRecord(
  sourceId: string,
  overrides: Partial<BasicSourceRecord> = {},
): BasicSourceRecord {
  return {
    sourceId,
    sourceName: `Source ${sourceId}`,
    sourceUrl: `https://sources.example/${sourceId}`,
    retrievedAt: "2026-07-13T00:00:00.000Z",
    publishedAt: "2026-07-01T00:00:00.000Z",
    contentSha256: CONTENT_SHA256,
    evidenceLocators: ["json:/summary"],
    sourceFamily: "government",
    accessStatus: "open",
    accessNotes: null,
    credibility: "OFFICIAL",
    discoveryOnly: false,
    promptInjectionRisk: "none",
    ...overrides,
  };
}

function register(
  sources: readonly BasicSourceRecord[],
  overrides: Partial<Identity> = {},
): BasicSourceRegisterV2 {
  return {
    schemaVersion: "basic-country-audit/v2",
    ...identity(overrides),
    sources,
  };
}

function facts(
  factValues: BasicExtractedFactsV2["facts"],
  overrides: Partial<Pick<Identity, "runId" | "countryCode">> = {},
): BasicExtractedFactsV2 {
  return {
    schemaVersion: "basic-country-audit/v2",
    runId: overrides.runId ?? RUN_ID,
    countryCode: overrides.countryCode ?? COUNTRY_CODE,
    facts: factValues,
  };
}

function check(sourceId: string): BasicSourceCheck {
  return { sourceId, status: "passed", notes: null };
}

function risk(sourceId: string): BasicInjectionRisk {
  return {
    sourceId,
    locator: "json:/summary",
    severity: "suspected",
    details: "Reviewed risk",
  };
}

function input(overrides: Partial<{
  editorial: BasicCountryEditorialInput;
  reviewedSources: BasicSourceRegisterV2;
  preliminaryFacts: BasicExtractedFactsV2;
  structuredEditorialEvidence: readonly BasicStructuredEditorialEvidenceObservation[];
  documentResult: BasicDocumentMaterializationResult | null;
  sourceChecks: readonly BasicSourceCheck[];
  injectionRisks: readonly BasicInjectionRisk[];
}> = {}) {
  const source = sourceRecord("structured-source");
  return {
    editorial: editorialInput(),
    reviewedSources: register([source]),
    preliminaryFacts: facts([]),
    structuredEditorialEvidence: [structuredEvidence(
      source.sourceId, "country.summary", "json:/summary", "Summary raw",
    )],
    documentResult: null,
    sourceChecks: [check(source.sourceId)],
    injectionRisks: [],
    ...overrides,
  };
}

function structuredSuccessInput(overrides: Parameters<typeof input>[0] = {}) {
  return input(overrides);
}

function expectInvalid(value: ReturnType<typeof input>): void {
  expect(() => materializeBasicEditorialFacts(value)).toThrow(ERROR);
}

function compareSource(left: BasicSourceRecord, right: BasicSourceRecord): number {
  return left.sourceId.localeCompare(right.sourceId);
}

function compareCheck(left: BasicSourceCheck, right: BasicSourceCheck): number {
  return left.sourceId.localeCompare(right.sourceId);
}

async function documentFixture(overrides: Partial<Identity> = {}) {
  const expected = identity(overrides);
  const catalog = parseBasicSourceCatalog({
    schemaVersion: "basic-source-catalog/v1",
    catalogVersion: expected.catalogVersion,
    sources: [{
      sourceId: "official-html",
      sourceName: "Official HTML publication",
      sourceFamily: "government",
      credibility: "OFFICIAL",
      format: "html",
      countryScope: [expected.countryCode],
      requestTemplate: {
        origin: "https://documents.example",
        pathSegments: [
          { kind: "literal", value: "sources" },
          { kind: "placeholder", value: "countryCode" },
          { kind: "literal", value: "official.html" },
        ],
        query: [],
      },
      accept: "text/html",
      approvedOrigins: ["https://documents.example"],
      allowedQueryParameters: [],
      accessMode: "open",
      licenseName: "Official public information",
      licenseUrl: "https://documents.example/license",
      attribution: "Official authority",
      refreshCadence: "event-driven",
      adapterId: "basic-manual-document-capture",
      adapterVersion: "1.0.0",
      adapterKind: "manual-document",
      fieldPaths: ["country.summary"],
    }],
    countryMappings: [],
  });
  const plan = createBasicSourceExecutionPlan({
    catalog,
    countryCode: expected.countryCode,
    sourceIds: ["official-html"],
  });
  const root = mkdtempSync(join(tmpdir(), "navigator-editorial-materializer-"));
  roots.add(root);
  const transport: BasicSourceTransportV2 = {
    async execute(request) {
      const body = new TextEncoder().encode("<html>reviewed fixture</html>");
      return {
        status: 200,
        finalUrl: request.url,
        redirectChain: [],
        contentType: "text/html",
        retrievedAt: "2026-07-13T01:00:00.000Z",
        body: documentBytes(body),
      };
    },
  };
  const run = await runBasicSourceExecutionPlanV2({
    repoRoot: root,
    countryCode: expected.countryCode,
    runId: expected.runId,
    plan,
    transport,
  });
  const capture = run.documentCaptures[0]!;
  const documentPlan = parseBasicDocumentObservationPlan({
    schemaVersion: "basic-document-observation-plan/v1",
    ...expected,
    catalogSha256: plan.catalogSha256,
    sourceId: "official-html",
    capture: {
      adapterId: capture.manifest.adapterId,
      adapterVersion: capture.manifest.adapterVersion,
      requestUrl: capture.manifest.request.url,
      retrievedAt: capture.manifest.response.retrievedAt,
      contentType: capture.manifest.response.contentType,
      byteLength: capture.manifest.response.byteLength,
      contentSha256: capture.manifest.response.contentSha256,
    },
    observations: [{
      usage: "editorial-evidence",
      fieldPath: "country.summary",
      locator: "html:section=overview",
      rawValue: "Reviewed country summary",
    }],
  });
  const review = parseBasicManualSourceReview({
    schemaVersion: "basic-manual-source-review/v1",
    runId: expected.runId,
    countryCode: expected.countryCode,
    catalogVersion: plan.catalogVersion,
    catalogSha256: plan.catalogSha256,
    sources: [{
      sourceId: "official-html",
      publishedAt: "2026-07-01T00:00:00.000Z",
      accessNotes: null,
      promptInjectionRisk: "none",
      sourceCheck: { status: "passed", notes: null },
      injectionRisks: [],
    }],
  }, {
    runId: expected.runId,
    countryCode: expected.countryCode,
    catalogVersion: plan.catalogVersion,
    catalogSha256: plan.catalogSha256,
    deterministicSourceIds: [],
    manualSourceIds: ["official-html"],
  });
  return {
    identity: {
      ...expected,
      catalogSha256: plan.catalogSha256,
    },
    result: materializeBasicDocumentEvidence({
      plan,
      captures: run.documentCaptures,
      review,
      documentPlans: [documentPlan],
    }),
  };
}

async function* documentBytes(value: Uint8Array): AsyncIterable<Uint8Array> {
  yield new Uint8Array(value);
}

function expectDeeplyFrozen(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeeplyFrozen(child);
}
