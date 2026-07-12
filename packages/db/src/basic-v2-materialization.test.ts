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
const DERIVED_PATHS = [
  "country.flagEmoji",
  "country.updatedAt",
  "marketOverview.collectedAt",
  "marketOverview.countryCode",
  "marketOverview.credibility",
  "marketOverview.source",
  "marketOverview.sourceUrl",
  "marketOverview.updatedAt",
] as const;
const roots = new Set<string>();

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.clear();
});

describe("Basic reviewed v2 materialization", () => {
  test("materializes a structured-only run without runtime access and replaces country.name exactly once", () => {
    const preliminary = structuredPreliminary();
    const result = withForbiddenRuntimeSentinels(() => materializeBasicReviewedRunV2({
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
    }));

    expect(result.materialization.sourceRegister.sources[0]?.evidenceLocators).toEqual([
      "capture:/retrievedAt",
      "json:/country/id",
      "json:/country/name",
      "metadata:/credibility",
      "metadata:/publishedAt",
      "metadata:/sourceName",
      "metadata:/sourceUrl",
    ]);
    expect(result.materialization.extractedFacts.facts).toHaveLength(10);
    expect(result.materialization.extractedFacts.facts.find(
      ({ fieldPath }) => fieldPath === "country.name",
    )).toMatchObject({
      fieldPath: "country.name",
      status: "candidate",
      extractionMethod: "manual",
    });
    expect(result.materialization.extractedFacts.facts.filter(
      ({ fieldPath }) => DERIVED_PATHS.includes(fieldPath as typeof DERIVED_PATHS[number]),
    ).map(({ fieldPath }) => fieldPath)).toEqual(DERIVED_PATHS);
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

    expect(result.materialization.sourceRegister.sources[0]?.evidenceLocators).toEqual([
      "capture:/retrievedAt",
      "html:meta=country-code",
      "html:section=overview",
      "metadata:/credibility",
      "metadata:/publishedAt",
      "metadata:/sourceName",
      "metadata:/sourceUrl",
    ]);
    expect(result.materialization.extractedFacts.facts.find(
      ({ fieldPath }) => fieldPath === "country.summary",
    )).toMatchObject({
      fieldPath: "country.summary",
      extractionMethod: "manual",
      status: "candidate",
    });
    expect(result.materialization.receipts).toEqual(fixture.preliminary.receipts);
    expect(result.sourceChecks).toEqual(fixture.result.sourceChecks);
    expectDeeplyFrozen(result);
  });

  test("builds a source-ID-sorted mixed union with complete review ownership", async () => {
    const fixture = await documentFixture(
      "reviewed fixture", false, false, null, false, { countryCodeFact: false },
    );
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
      .toEqual([
        "country.code",
        "country.flagEmoji",
        "country.name",
        "country.summary",
        "country.updatedAt",
        "marketOverview.collectedAt",
        "marketOverview.countryCode",
        "marketOverview.credibility",
        "marketOverview.source",
        "marketOverview.sourceUrl",
        "marketOverview.updatedAt",
      ]);
  });

  test("rejects a structured review when the preliminary run has no deterministic sources", async () => {
    const fixture = await documentFixture();
    const unexpectedDeterministic = structuredPreliminary("country.name", {
      zh: "Indonesia",
      en: "Indonesia",
    }, identityFrom(fixture.preliminary));

    expectInvalid({
      preliminary: fixture.preliminary,
      structuredReview: structuredReview(unexpectedDeterministic),
      documentResult: fixture.result,
      editorial: documentEditorial(fixture),
    });
  });

  test("rejects null document materialization when the preliminary run has document captures", async () => {
    const fixture = await documentFixture();

    expectInvalid({
      preliminary: fixture.preliminary,
      structuredReview: null,
      documentResult: null,
      editorial: documentEditorial(fixture),
    });
  });

  test("rejects deterministic and manual sources that reuse the same source ID", async () => {
    const fixture = await documentFixture();
    const deterministic = structuredPreliminary("country.name", {
      zh: "Indonesia",
      en: "Indonesia",
    }, identityFrom(fixture.preliminary), "official-html");
    const preliminary = {
      ...fixture.preliminary,
      sourceRegister: deterministic.sourceRegister,
      extractedFacts: deterministic.extractedFacts,
      structuredEditorialEvidence: deterministic.structuredEditorialEvidence,
      receipts: [...fixture.preliminary.receipts, ...deterministic.receipts],
    };

    expectInvalid({
      preliminary,
      structuredReview: structuredReview(deterministic),
      documentResult: fixture.result,
      editorial: editorial(preliminary, [{
        fieldPath: "country.name",
        normalizedValue: { zh: "印度尼西亚", en: "Indonesia" },
        evidence: [editorialEvidence("official-html", "json:/country/name", "Indonesia")],
        uncertainty: null,
      }, documentSummaryItem()]),
    });
  });

  test("rejects unsorted editorial items instead of normalizing contract input", async () => {
    const value = await mixedInput();

    expectInvalid({
      ...value,
      editorial: {
        ...value.editorial,
        items: [...value.editorial.items].reverse(),
      },
    });
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

  test("rejects a branded result whose capture differs only by response final URL", async () => {
    const preliminaryFixture = await documentFixture();
    const redirectedFixture = await documentFixture(
      "reviewed fixture",
      false,
      false,
      "https://documents.example/redirected/official.html",
    );

    expectInvalid({
      preliminary: preliminaryFixture.preliminary,
      structuredReview: null,
      documentResult: redirectedFixture.result,
      editorial: documentEditorial(preliminaryFixture),
    });
  });

  test("accepts reordered captures for two manual sources and rejects duplicate capture IDs", async () => {
    const fixture = await documentFixture("reviewed fixture", false, false, null, true);
    const forward = materializeBasicReviewedRunV2({
      preliminary: fixture.preliminary,
      structuredReview: null,
      documentResult: fixture.result,
      editorial: documentEditorial(fixture),
    });
    const reversedPreliminary = {
      ...fixture.preliminary,
      documentCaptures: [...fixture.preliminary.documentCaptures].reverse(),
    };
    const reversed = materializeBasicReviewedRunV2({
      preliminary: reversedPreliminary,
      structuredReview: null,
      documentResult: fixture.result,
      editorial: documentEditorial(fixture),
    });

    expect(reversed).toEqual(forward);
    expect(forward.materialization.sourceRegister.sources.map(({ sourceId }) => sourceId))
      .toEqual(["official-html", "official-pdf"]);
    expectInvalid({
      preliminary: {
        ...fixture.preliminary,
        documentCaptures: [
          fixture.preliminary.documentCaptures[0]!,
          fixture.preliminary.documentCaptures[0]!,
        ],
      },
      structuredReview: null,
      documentResult: fixture.result,
      editorial: documentEditorial(fixture),
    });
  });

  test.each([
    ["catalog source name", { sourceName: "Renamed official publication" }],
    ["catalog source family", { sourceFamily: "regulator" }],
    ["catalog credibility", { credibility: "VERIFIED" as const }],
    ["manifest request URL", { filename: "alternate.html" }],
    ["manifest retrieval timestamp", { retrievedAt: "2026-07-13T01:00:01.000Z" }],
  ])("rejects a real branded result with %s drift", async (_label, overrides) => {
    const preliminaryFixture = await documentFixture();
    const driftedFixture = await documentFixture(
      "reviewed fixture", false, false, null, false, overrides,
    );

    expectInvalid({
      preliminary: preliminaryFixture.preliminary,
      structuredReview: null,
      documentResult: driftedFixture.result,
      editorial: documentEditorial(preliminaryFixture),
    });
  });

  test("preserves same-method conflicts from two manual sources", async () => {
    const fixture = await documentFixture("reviewed fixture", false, true, null, true);

    const result = materializeBasicReviewedRunV2({
      preliminary: fixture.preliminary,
      structuredReview: null,
      documentResult: fixture.result,
      editorial: documentEditorial(fixture),
    });
    const population = result.materialization.extractedFacts.facts.find(
      ({ fieldPath }) => fieldPath === "marketOverview.population",
    );

    expect(population).toMatchObject({
      fieldPath: "marketOverview.population",
      extractionMethod: "manual",
      status: "conflict",
    });
    expect(population?.evidence.map(({ sourceId }) => sourceId))
      .toEqual(["official-html", "official-pdf"]);
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
  sourceId = "structured-source",
): BasicPreliminarySourceRunV2 {
  const locator = fieldPath === "country.name" ? "json:/country/name" : "json:/population";
  const rawValue = fieldPath === "country.name" ? "Indonesia" : "100";
  const locators = [...new Set(["json:/country/id", locator])].sort();
  const sources = [sourceRecord(sourceId, locators)];
  const observations = [{
    sourceId,
    fieldPath: "country.code",
    locator: "json:/country/id",
    rawValue: "ID",
    normalizedValue: "ID",
    unit: null,
    year: null,
    uncertainty: null,
  }, ...(fieldPath === "country.code" ? [] : [{
    sourceId,
    fieldPath,
    locator,
    rawValue,
    normalizedValue,
    unit: fieldPath === "country.name" ? null : "people",
    year: fieldPath === "country.name" ? null : 2025,
    uncertainty: null,
  }])];
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
      facts: materializeBasicSourceFactsV2(observations, "deterministic"),
    },
    structuredEditorialEvidence: [],
    documentCaptures: [],
    receipts: [{
      sourceId,
      contentSha256: DETERMINISTIC_SHA256,
      byteLength: 100,
      reused: false,
    }],
  };
}

function identityFrom(preliminary: BasicPreliminarySourceRunV2) {
  return {
    runId: preliminary.sourceRegister.runId,
    countryCode: preliminary.sourceRegister.countryCode,
    catalogVersion: preliminary.sourceRegister.catalogVersion,
    catalogSha256: preliminary.sourceRegister.catalogSha256,
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

interface DocumentFixtureOverrides {
  readonly sourceName?: string;
  readonly sourceFamily?: string;
  readonly credibility?: "OFFICIAL" | "VERIFIED";
  readonly filename?: string;
  readonly retrievedAt?: string;
  readonly countryCodeFact?: boolean;
}

async function documentFixture(
  bodyText = "reviewed fixture",
  withRisk = false,
  withPopulation = false,
  finalUrl: string | null = null,
  withSecondSource = false,
  overrides: DocumentFixtureOverrides = {},
): Promise<DocumentFixture> {
  const withCountryCode = overrides.countryCodeFact ?? true;
  const catalog = parseBasicSourceCatalog({
    schemaVersion: "basic-source-catalog/v1",
    catalogVersion: CATALOG_VERSION,
    sources: [{
      sourceId: "official-html",
      sourceName: overrides.sourceName ?? "Official HTML publication",
      sourceFamily: overrides.sourceFamily ?? "government",
      credibility: overrides.credibility ?? "OFFICIAL",
      format: "html",
      countryScope: [COUNTRY_CODE],
      requestTemplate: {
        origin: "https://documents.example",
        pathSegments: [
          { kind: "literal", value: "sources" },
          { kind: "placeholder", value: "countryCode" },
          { kind: "literal", value: overrides.filename ?? "official.html" },
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
        ? [...(withCountryCode ? ["country.code"] : []), "country.summary", "marketOverview.population"]
        : [...(withCountryCode ? ["country.code"] : []), "country.summary"],
    }, ...(withSecondSource ? [{
      sourceId: "official-pdf",
      sourceName: "Official PDF publication",
      sourceFamily: "energy-authority",
      credibility: "VERIFIED",
      format: "pdf",
      countryScope: [COUNTRY_CODE],
      requestTemplate: {
        origin: "https://documents.example",
        pathSegments: [
          { kind: "literal" as const, value: "sources" },
          { kind: "placeholder" as const, value: "countryCode" },
          { kind: "literal" as const, value: "official.pdf" },
        ],
        query: [],
      },
      accept: "application/pdf",
      approvedOrigins: ["https://documents.example"],
      allowedQueryParameters: [],
      accessMode: "open",
      licenseName: "Official public information",
      licenseUrl: "https://documents.example/license",
      attribution: "Official authority",
      refreshCadence: "event-driven",
      adapterId: "basic-manual-document-capture",
      adapterVersion: "1.0.0",
      adapterKind: "manual-document" as const,
      fieldPaths: ["marketOverview.population"],
    }] : [])],
    countryMappings: [],
  });
  const plan = createBasicSourceExecutionPlan({
    catalog,
    countryCode: COUNTRY_CODE,
    sourceIds: withSecondSource
      ? ["official-html", "official-pdf"]
      : ["official-html"],
  });
  const root = mkdtempSync(join(tmpdir(), "navigator-v2-materialization-"));
  roots.add(root);
  const transport: BasicSourceTransportV2 = {
    async execute(request) {
      const pdf = request.accept === "application/pdf";
      const body = new TextEncoder().encode(
        pdf ? `%PDF-1.7\n${bodyText}` : `<html>${bodyText}</html>`,
      );
      return {
        status: 200,
        finalUrl: finalUrl ?? request.url,
        redirectChain: finalUrl === null ? [] : [finalUrl],
        contentType: request.accept,
        retrievedAt: overrides.retrievedAt ?? "2026-07-13T01:00:00.000Z",
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
  const documentPlans = preliminary.documentCaptures.map((capture) =>
    parseBasicDocumentObservationPlan({
    schemaVersion: "basic-document-observation-plan/v1",
    runId: RUN_ID,
    countryCode: COUNTRY_CODE,
    catalogVersion: plan.catalogVersion,
    catalogSha256: plan.catalogSha256,
    sourceId: capture.catalogSource.sourceId,
    capture: {
      adapterId: capture.manifest.adapterId,
      adapterVersion: capture.manifest.adapterVersion,
      requestUrl: capture.manifest.request.url,
      retrievedAt: capture.manifest.response.retrievedAt,
      contentType: capture.manifest.response.contentType,
      byteLength: capture.manifest.response.byteLength,
      contentSha256: capture.manifest.response.contentSha256,
    },
    observations: capture.catalogSource.sourceId === "official-html" ? [
      ...(withCountryCode ? [{
        usage: "source-fact" as const,
        fieldPath: "country.code",
        locator: "html:meta=country-code",
        rawValue: "ID",
        normalizedValue: "ID",
        unit: null,
        year: null,
        uncertainty: null,
      }] : []),
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
    ] : [{
      usage: "source-fact" as const,
      fieldPath: "marketOverview.population",
      locator: "pdf:page=2#population",
      rawValue: "101",
      normalizedValue: 101,
      unit: "people",
      year: 2025,
      uncertainty: null,
    }],
  }));
  const review = parseBasicManualSourceReview({
    schemaVersion: "basic-manual-source-review/v1",
    runId: RUN_ID,
    countryCode: COUNTRY_CODE,
    catalogVersion: plan.catalogVersion,
    catalogSha256: plan.catalogSha256,
    sources: preliminary.documentCaptures.map(({ catalogSource }) => ({
      sourceId: catalogSource.sourceId,
      publishedAt: catalogSource.format === "html"
        ? "2026-07-01T00:00:00.000Z"
        : null,
      accessNotes: null,
      promptInjectionRisk: withRisk && catalogSource.format === "html"
        ? "suspected"
        : "none",
      sourceCheck: {
        status: "passed" as const,
        notes: catalogSource.format === "html" ? null : "Publication date is not stated",
      },
      injectionRisks: withRisk && catalogSource.format === "html" ? [{
        locator: "html:section=overview",
        severity: "suspected" as const,
        details: "Instruction-like content was reviewed",
      }] : [],
    })),
  }, {
    runId: RUN_ID,
    countryCode: COUNTRY_CODE,
    catalogVersion: plan.catalogVersion,
    catalogSha256: plan.catalogSha256,
    deterministicSourceIds: [],
    manualSourceIds: preliminary.documentCaptures
      .map(({ catalogSource }) => catalogSource.sourceId)
      .sort((left, right) => left.localeCompare(right)),
  });
  return {
    plan,
    preliminary,
    result: materializeBasicDocumentEvidence({
      plan,
      captures: preliminary.documentCaptures,
      review,
      documentPlans,
    }),
  };
}

function documentEditorial(fixture: DocumentFixture): BasicCountryEditorialInput {
  return editorial(fixture.preliminary, [documentSummaryItem()]);
}

async function mixedInput(): Promise<ReviewedInput> {
  const fixture = await documentFixture(
    "reviewed fixture", false, false, null, false, { countryCodeFact: false },
  );
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

function withForbiddenRuntimeSentinels<T>(callback: () => T): T {
  const names = ["fetch", "model", "Hermes", "llama", "SearXNG", "search", "socket", "child_process"];
  const globalDescriptors = names.map((name) => [
    name,
    Object.getOwnPropertyDescriptor(globalThis, name),
  ] as const);
  const environmentDescriptor = Object.getOwnPropertyDescriptor(process, "env");
  const accesses: string[] = [];
  const denied = (name: string): never => {
    accesses.push(name);
    throw new Error(`forbidden runtime access: ${name}`);
  };

  try {
    for (const [name, descriptor] of globalDescriptors) {
      if (descriptor?.configurable === false) continue;
      Object.defineProperty(globalThis, name, {
        configurable: true,
        get: () => denied(name),
      });
    }
    if (environmentDescriptor?.configurable !== false) {
      Object.defineProperty(process, "env", {
        configurable: true,
        get: () => denied("process.env"),
      });
    }
    return callback();
  } finally {
    for (const [name, descriptor] of globalDescriptors) {
      if (descriptor?.configurable === false) continue;
      if (descriptor === undefined) Reflect.deleteProperty(globalThis, name);
      else Object.defineProperty(globalThis, name, descriptor);
    }
    if (environmentDescriptor?.configurable !== false) {
      if (environmentDescriptor === undefined) Reflect.deleteProperty(process, "env");
      else Object.defineProperty(process, "env", environmentDescriptor);
    }
    expect(accesses).toEqual([]);
  }
}

function expectDeeplyFrozen(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeeplyFrozen(child);
}
