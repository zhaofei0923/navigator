import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import type {
  BasicInjectionRisk,
  BasicSourceRecord,
} from "./collection/basic-collection-contracts.js";
import type {
  BasicExtractedFactsV2,
  BasicPreliminarySourceRunV2,
} from "./collection/basic-collection-v2-contracts.js";
import { materializeBasicReviewedRunV2 } from "./collection/basic-v2-materialization.js";
import { parseBasicDocumentObservationPlan } from "./collection/basic-document-observation-parser.js";
import {
  materializeBasicDocumentEvidence,
  type BasicDocumentMaterializationResult,
} from "./collection/basic-document-observation-materializer.js";
import type { BasicCountryEditorialInput } from "./collection/basic-editorial-input-contracts.js";
import { parseBasicSourceCatalog } from "./collection/basic-source-catalog.js";
import {
  createBasicSourceExecutionPlan,
  type BasicSourceExecutionPlan,
} from "./collection/basic-source-request-materializer.js";
import { runBasicSourceExecutionPlanV2 } from "./collection/basic-source-plan-runner-v2.js";
import type { BasicStructuredSourceReview } from "./collection/basic-source-review-contracts.js";
import {
  parseBasicManualSourceReview,
  parseBasicStructuredSourceReview,
} from "./collection/basic-source-review-parser.js";
import type { BasicSourceTransportV2 } from "./collection/basic-source-v2-contracts.js";
import { materializeBasicSourceFactsV2 } from "./collection/basic-v2-fact-materializer.js";

const ERROR = "basic reviewed materialization is invalid";
const RUN_ID = "run-20260713";
const COUNTRY_CODE = "ID";
const CATALOG_VERSION = "2026.07.13.editorial-1";
const CATALOG_SHA256 =
  "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
const DETERMINISTIC_SHA256 =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const roots = new Set<string>();

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.clear();
});

describe("Basic reviewed v2 materialization", () => {
  test("materializes a structured-only run and replaces country.name exactly once", () => {
    const preliminary = structuredPreliminary();
    const result = materializeBasicReviewedRunV2({
      preliminary,
      structuredReview: structuredReview(preliminary),
      documentResult: null,
      editorial: editorial(preliminary, [{
        fieldPath: "country.name",
        normalizedValue: { zh: "印度尼西亚", en: "Indonesia" },
        evidence: [editorialEvidence(
          "structured-source", "json:/country/name", "Indonesia",
        )],
        uncertainty: null,
      }]),
    });

    expect(result.materialization.sourceRegister).toEqual(preliminary.sourceRegister);
    expect(result.materialization.extractedFacts.facts).toHaveLength(1);
    expect(result.materialization.extractedFacts.facts[0]).toMatchObject({
      fieldPath: "country.name",
      status: "candidate",
      extractionMethod: "manual",
    });
    expect(result.materialization.receipts).toEqual(preliminary.receipts);
    expect(result.sourceChecks).toEqual([
      { sourceId: "structured-source", status: "passed", notes: null },
    ]);
    expect(result.injectionRisks).toEqual([]);
    expectDeeplyFrozen(result);
  });

  test("materializes a document-only reviewed source and merges editorial locators", async () => {
    const fixture = await documentFixture();
    const result = materializeBasicReviewedRunV2({
      preliminary: fixture.preliminary,
      structuredReview: null,
      documentResult: fixture.result,
      editorial: documentEditorial(fixture),
    });

    expect(result.materialization.sourceRegister.sources).toEqual([{
      ...fixture.result.sources[0],
      evidenceLocators: ["html:section=overview"],
    }]);
    expect(result.materialization.extractedFacts.facts).toMatchObject([{
      fieldPath: "country.summary",
      extractionMethod: "manual",
      status: "candidate",
    }]);
    expect(result.materialization.receipts).toEqual(fixture.preliminary.receipts);
    expect(result.sourceChecks).toEqual(fixture.result.sourceChecks);
    expectDeeplyFrozen(result);
  });

  test("builds a source-ID-sorted mixed union with complete review ownership", async () => {
    const fixture = await documentFixture();
    const preliminary = withStructuredSource(fixture.preliminary);
    const result = materializeBasicReviewedRunV2({
      preliminary,
      structuredReview: structuredReview(preliminary),
      documentResult: fixture.result,
      editorial: editorial(preliminary, [
        {
          fieldPath: "country.name",
          normalizedValue: { zh: "印度尼西亚", en: "Indonesia" },
          evidence: [editorialEvidence(
            "structured-source", "json:/country/name", "Indonesia",
          )],
          uncertainty: null,
        },
        documentSummaryItem(),
      ]),
    });

    expect(result.materialization.sourceRegister.sources.map(({ sourceId }) => sourceId))
      .toEqual(["official-html", "structured-source"]);
    expect(result.sourceChecks.map(({ sourceId }) => sourceId))
      .toEqual(["official-html", "structured-source"]);
    expect(result.materialization.extractedFacts.facts.map(({ fieldPath }) => fieldPath))
      .toEqual(["country.name", "country.summary"]);
  });

  test.each([
    ["missing structured review", (value: ReviewedInput) => ({
      ...value, structuredReview: null,
    })],
    ["foreign structured review", (value: ReviewedInput) => ({
      ...value,
      structuredReview: { ...value.structuredReview, runId: "other-run" },
    })],
    ["document result without captures", (value: ReviewedInput) => ({
      ...value, documentResult: value.documentResult,
      preliminary: { ...value.preliminary, documentCaptures: [] },
    })],
    ["missing receipt", (value: ReviewedInput) => ({
      ...value,
      preliminary: { ...value.preliminary, receipts: value.preliminary.receipts.slice(1) },
    })],
    ["duplicate receipt", (value: ReviewedInput) => ({
      ...value,
      preliminary: {
        ...value.preliminary,
        receipts: [...value.preliminary.receipts, value.preliminary.receipts[0]!],
      },
    })],
    ["foreign source", (value: ReviewedInput) => ({
      ...value,
      preliminary: {
        ...value.preliminary,
        sourceRegister: {
          ...value.preliminary.sourceRegister,
          sources: [...value.preliminary.sourceRegister.sources, sourceRecord("foreign-source")],
        },
      },
    })],
  ])("rejects %s", async (_label, mutate) => {
    expectInvalid(mutate(await mixedInput()));
  });

  test("rejects a separately branded document result from different captured bytes", async () => {
    const first = await documentFixture("reviewed fixture one");
    const second = await documentFixture("reviewed fixture two");

    expectInvalid({
      preliminary: first.preliminary,
      structuredReview: null,
      documentResult: second.result,
      editorial: documentEditorial(first),
    });
  });

  test("rejects deterministic/manual coexistence and protected editorial replacement", async () => {
    const fixture = await documentFixture("reviewed fixture", false, true);
    const deterministic = structuredPreliminary("marketOverview.population", 100, {
      runId: fixture.preliminary.sourceRegister.runId,
      countryCode: fixture.preliminary.sourceRegister.countryCode,
      catalogVersion: fixture.preliminary.sourceRegister.catalogVersion,
      catalogSha256: fixture.preliminary.sourceRegister.catalogSha256,
    });
    const preliminary = {
      ...fixture.preliminary,
      sourceRegister: deterministic.sourceRegister,
      extractedFacts: deterministic.extractedFacts,
      structuredEditorialEvidence: deterministic.structuredEditorialEvidence,
      receipts: [...fixture.preliminary.receipts, ...deterministic.receipts]
        .sort((left, right) => left.sourceId.localeCompare(right.sourceId)),
    };

    expectInvalid({
      preliminary,
      structuredReview: structuredReview(preliminary),
      documentResult: fixture.result,
      editorial: documentEditorial(fixture),
    });
    expectInvalid({
      preliminary: structuredPreliminary(),
      structuredReview: structuredReview(structuredPreliminary()),
      documentResult: null,
      editorial: editorial(structuredPreliminary(), [{
        ...documentSummaryItem(),
        fieldPath: "marketOverview.population",
        normalizedValue: 100,
      }]),
    });
  });

  test("preserves complete injection risks instead of filtering them before Editorial", async () => {
    const fixture = await documentFixture("reviewed fixture", true);
    const risk: BasicInjectionRisk = fixture.result.injectionRisks[0]!;

    expect(risk).toMatchObject({ sourceId: "official-html", severity: "suspected" });
    expectInvalid({
      preliminary: fixture.preliminary,
      structuredReview: null,
      documentResult: fixture.result,
      editorial: documentEditorial(fixture),
    });
  });

  test("returns one redacted error and does not execute accessor inputs", async () => {
    const value = await mixedInput();
    const probe = { executions: 0 };
    const input = { ...value };
    Object.defineProperty(input, "editorial", {
      enumerable: true,
      get() {
        probe.executions += 1;
        return value.editorial;
      },
    });

    expectInvalid(input);
    expect(probe.executions).toBe(0);
    const sentinel = "REVIEWED_MATERIALIZATION_SECRET_MUST_NOT_LEAK";
    try {
      materializeBasicReviewedRunV2({
        ...value,
        editorial: { ...value.editorial, runId: sentinel },
      });
    } catch (error) {
      expect((error as Error).message).toBe(ERROR);
      expect((error as Error).message).not.toContain(sentinel);
    }
  });
});

type ReviewedInput = Parameters<typeof materializeBasicReviewedRunV2>[0];

function sourceRecord(
  sourceId = "structured-source",
  evidenceLocators = ["json:/country/name"],
): BasicSourceRecord {
  return {
    sourceId,
    sourceName: "Structured official source",
    sourceUrl: `https://data.example/${sourceId}`,
    retrievedAt: "2026-07-13T01:00:00.000Z",
    publishedAt: "2026-07-01T00:00:00.000Z",
    contentSha256: DETERMINISTIC_SHA256,
    evidenceLocators,
    sourceFamily: "official-statistics",
    accessStatus: "open",
    accessNotes: null,
    credibility: "OFFICIAL",
    discoveryOnly: false,
    promptInjectionRisk: "none",
  };
}

function structuredPreliminary(
  fieldPath = "country.name",
  normalizedValue: BasicExtractedFactsV2["facts"][number]["evidence"][number]["normalizedValue"] = {
    zh: "Indonesia",
    en: "Indonesia",
  },
  identity: Readonly<{
    runId: string;
    countryCode: string;
    catalogVersion: string;
    catalogSha256: string;
  }> = {
    runId: RUN_ID,
    countryCode: COUNTRY_CODE,
    catalogVersion: CATALOG_VERSION,
    catalogSha256: CATALOG_SHA256,
  },
): BasicPreliminarySourceRunV2 {
  const locator = fieldPath === "country.name" ? "json:/country/name" : "json:/population";
  const rawValue = fieldPath === "country.name" ? "Indonesia" : "100";
  const sources = [sourceRecord("structured-source", [locator])];
  return {
    sourceRegister: {
      schemaVersion: "basic-country-audit/v2",
      ...identity,
      sources,
    },
    extractedFacts: {
      schemaVersion: "basic-country-audit/v2",
      runId: identity.runId,
      countryCode: identity.countryCode,
      facts: materializeBasicSourceFactsV2([{
        sourceId: "structured-source",
        fieldPath,
        locator,
        rawValue,
        normalizedValue,
        unit: fieldPath === "country.name" ? null : "people",
        year: fieldPath === "country.name" ? null : 2025,
        uncertainty: null,
      }], "deterministic"),
    },
    structuredEditorialEvidence: [],
    documentCaptures: [],
    receipts: [{
      sourceId: "structured-source",
      contentSha256: DETERMINISTIC_SHA256,
      byteLength: 100,
      reused: false,
    }],
  };
}

function withStructuredSource(
  preliminary: BasicPreliminarySourceRunV2,
): BasicPreliminarySourceRunV2 {
  const structured = structuredPreliminary("country.name", {
    zh: "Indonesia",
    en: "Indonesia",
  }, {
    runId: preliminary.sourceRegister.runId,
    countryCode: preliminary.sourceRegister.countryCode,
    catalogVersion: preliminary.sourceRegister.catalogVersion,
    catalogSha256: preliminary.sourceRegister.catalogSha256,
  });
  return {
    ...preliminary,
    sourceRegister: structured.sourceRegister,
    extractedFacts: structured.extractedFacts,
    structuredEditorialEvidence: structured.structuredEditorialEvidence,
    documentCaptures: preliminary.documentCaptures,
    receipts: [...preliminary.receipts, ...structured.receipts]
      .sort((left, right) => left.sourceId.localeCompare(right.sourceId)),
  };
}

function structuredReview(preliminary: BasicPreliminarySourceRunV2): BasicStructuredSourceReview {
  const ids = preliminary.sourceRegister.sources.map(({ sourceId }) => sourceId);
  return parseBasicStructuredSourceReview({
    schemaVersion: "basic-structured-source-review/v1",
    runId: preliminary.sourceRegister.runId,
    countryCode: preliminary.sourceRegister.countryCode,
    catalogVersion: preliminary.sourceRegister.catalogVersion,
    catalogSha256: preliminary.sourceRegister.catalogSha256,
    sources: ids.map((sourceId) => ({
      sourceId,
      sourceCheck: { status: "passed", notes: null },
    })),
    injectionRisks: [],
  }, {
    runId: preliminary.sourceRegister.runId,
    countryCode: preliminary.sourceRegister.countryCode,
    catalogVersion: preliminary.sourceRegister.catalogVersion,
    catalogSha256: preliminary.sourceRegister.catalogSha256,
    deterministicSourceIds: ids,
    manualSourceIds: [],
  });
}

function editorial(
  preliminary: BasicPreliminarySourceRunV2,
  items: BasicCountryEditorialInput["items"],
): BasicCountryEditorialInput {
  return {
    schemaVersion: "basic-country-editorial-input/v1",
    runId: preliminary.sourceRegister.runId,
    countryCode: preliminary.sourceRegister.countryCode,
    catalogVersion: preliminary.sourceRegister.catalogVersion,
    catalogSha256: preliminary.sourceRegister.catalogSha256,
    primarySourceId: items[0]!.evidence[0]!.sourceId,
    items: [...items].sort((left, right) => left.fieldPath.localeCompare(right.fieldPath)),
  };
}

function editorialEvidence(sourceId: string, locator: string, rawValue: string) {
  return { sourceId, locator, rawValue, unit: null, year: null } as const;
}

function documentSummaryItem(): BasicCountryEditorialInput["items"][number] {
  return {
    fieldPath: "country.summary",
    normalizedValue: { zh: "审阅后的国家摘要", en: "Reviewed country summary" },
    evidence: [editorialEvidence(
      "official-html", "html:section=overview", "Reviewed country summary",
    )],
    uncertainty: null,
  };
}

interface DocumentFixture {
  readonly plan: BasicSourceExecutionPlan;
  readonly preliminary: BasicPreliminarySourceRunV2;
  readonly result: BasicDocumentMaterializationResult;
}

async function documentFixture(
  bodyText = "reviewed fixture",
  withRisk = false,
  withPopulation = false,
): Promise<DocumentFixture> {
  const catalog = parseBasicSourceCatalog({
    schemaVersion: "basic-source-catalog/v1",
    catalogVersion: CATALOG_VERSION,
    sources: [{
      sourceId: "official-html",
      sourceName: "Official HTML publication",
      sourceFamily: "government",
      credibility: "OFFICIAL",
      format: "html",
      countryScope: [COUNTRY_CODE],
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
      fieldPaths: withPopulation
        ? ["country.summary", "marketOverview.population"]
        : ["country.summary"],
    }],
    countryMappings: [],
  });
  const plan = createBasicSourceExecutionPlan({
    catalog,
    countryCode: COUNTRY_CODE,
    sourceIds: ["official-html"],
  });
  const root = mkdtempSync(join(tmpdir(), "navigator-v2-materialization-"));
  roots.add(root);
  const transport: BasicSourceTransportV2 = {
    async execute(request) {
      const body = new TextEncoder().encode(`<html>${bodyText}</html>`);
      return {
        status: 200,
        finalUrl: request.url,
        redirectChain: [],
        contentType: "text/html",
        retrievedAt: "2026-07-13T01:00:00.000Z",
        body: bytes(body),
      };
    },
  };
  const preliminary = await runBasicSourceExecutionPlanV2({
    repoRoot: root,
    countryCode: COUNTRY_CODE,
    runId: RUN_ID,
    plan,
    transport,
  });
  const capture = preliminary.documentCaptures[0]!;
  const documentPlan = parseBasicDocumentObservationPlan({
    schemaVersion: "basic-document-observation-plan/v1",
    runId: RUN_ID,
    countryCode: COUNTRY_CODE,
    catalogVersion: plan.catalogVersion,
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
    observations: [
      {
        usage: "editorial-evidence",
        fieldPath: "country.summary",
        locator: "html:section=overview",
        rawValue: "Reviewed country summary",
      },
      ...(withPopulation ? [{
        usage: "source-fact" as const,
        fieldPath: "marketOverview.population",
        locator: "html:section=population",
        rawValue: "100",
        normalizedValue: 100,
        unit: "people",
        year: 2025,
        uncertainty: null,
      }] : []),
    ],
  });
  const review = parseBasicManualSourceReview({
    schemaVersion: "basic-manual-source-review/v1",
    runId: RUN_ID,
    countryCode: COUNTRY_CODE,
    catalogVersion: plan.catalogVersion,
    catalogSha256: plan.catalogSha256,
    sources: [{
      sourceId: "official-html",
      publishedAt: "2026-07-01T00:00:00.000Z",
      accessNotes: null,
      promptInjectionRisk: withRisk ? "suspected" : "none",
      sourceCheck: { status: "passed", notes: null },
      injectionRisks: withRisk ? [{
        locator: "html:section=overview",
        severity: "suspected",
        details: "Instruction-like content was reviewed",
      }] : [],
    }],
  }, {
    runId: RUN_ID,
    countryCode: COUNTRY_CODE,
    catalogVersion: plan.catalogVersion,
    catalogSha256: plan.catalogSha256,
    deterministicSourceIds: [],
    manualSourceIds: ["official-html"],
  });
  return {
    plan,
    preliminary,
    result: materializeBasicDocumentEvidence({
      plan,
      captures: preliminary.documentCaptures,
      review,
      documentPlans: [documentPlan],
    }),
  };
}

function documentEditorial(fixture: DocumentFixture): BasicCountryEditorialInput {
  return editorial(fixture.preliminary, [documentSummaryItem()]);
}

async function mixedInput(): Promise<ReviewedInput> {
  const fixture = await documentFixture();
  const preliminary = withStructuredSource(fixture.preliminary);
  return {
    preliminary,
    structuredReview: structuredReview(preliminary),
    documentResult: fixture.result,
    editorial: editorial(preliminary, [
      {
        fieldPath: "country.name",
        normalizedValue: { zh: "印度尼西亚", en: "Indonesia" },
        evidence: [editorialEvidence(
          "structured-source", "json:/country/name", "Indonesia",
        )],
        uncertainty: null,
      },
      documentSummaryItem(),
    ]),
  };
}

async function* bytes(value: Uint8Array): AsyncIterable<Uint8Array> {
  yield new Uint8Array(value);
}

function expectInvalid(value: unknown): void {
  expect(() => materializeBasicReviewedRunV2(value as ReviewedInput)).toThrow(ERROR);
}

function expectDeeplyFrozen(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeeplyFrozen(child);
}
