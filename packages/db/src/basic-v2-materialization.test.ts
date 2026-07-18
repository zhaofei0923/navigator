import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

import { worldBankCountryAdapter } from "./collection/adapters/world-bank-country.js";
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
import { validateBasicV2FactOwnership } from "./collection/basic-v2-fact-ownership.js";

const ERROR = "basic reviewed materialization is invalid";
const RUN_ID = "run-20260713";
const COUNTRY_CODE = "ID";
const CATALOG_VERSION = "2026.07.13.editorial-1";
const CATALOG_SHA256 =
  "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
const DETERMINISTIC_SHA256 =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const EMPTY_TECH_TAGS_UNCERTAINTY =
  "No exact registered product-level subtype is supported.";
const EMPTY_TECH_TAGS_RAW_VALUE = "solar,storage";
const STRUCTURED_EMPTY_TECH_TAGS_LOCATOR =
  "json:/market-overview/industry-tags/tech-taxonomy";
const DOCUMENT_EMPTY_TECH_TAGS_LOCATOR =
  "html:section=industry-tags;detail=tech-taxonomy";
const REQUIRED_EDITORIAL_PATHS = [
  "country.region",
  "country.summary",
  "marketOverview.energyDemand",
  "marketOverview.industryTags",
  "marketOverview.overview",
  "marketOverview.renewableTarget",
  "marketOverview.techTags",
] as const;
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
  vi.restoreAllMocks();
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
      "html:section=energy-demand",
      "html:section=industry-tags",
      "html:section=overview",
      "html:section=region",
      "html:section=renewable-target",
      "html:section=summary",
      "html:section=tech-tags",
      "json:/country/id",
      "json:/country/name",
      "metadata:/credibility",
      "metadata:/publishedAt",
      "metadata:/sourceName",
      "metadata:/sourceUrl",
    ]);
    expect(result.materialization.extractedFacts.facts).toHaveLength(17);
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

  test("materializes empty tech tags through a catalog-limited structured production run", async () => {
    const fixture = await structuredIndustryTagsFixture();
    const input = {
      preliminary: fixture.preliminary,
      structuredReview: structuredReview(fixture.preliminary),
      documentResult: null,
      editorial: structuredIndustryTagsEditorial(fixture.preliminary),
    };

    const result = materializeBasicReviewedRunV2(input);

    expectTaxonomyOwnership(fixture.plan);
    expectEmptyTechTagsMaterialization(
      result,
      "world-bank-country",
      STRUCTURED_EMPTY_TECH_TAGS_LOCATOR,
    );
  });

  test("rejects direct structured tech-tags evidence outside industry-only catalog ownership", async () => {
    await expect(structuredIndustryTagsFixture(true)).rejects.toThrow(
      "basic source plan run is invalid",
    );
  });

  test("rejects empty editorial items and every missing required static editorial path", () => {
    const preliminary = structuredPreliminary();

    expectInvalid({
      preliminary: { ...preliminary, structuredEditorialEvidence: [] },
      structuredReview: structuredReview(preliminary),
      documentResult: null,
      editorial: editorial(preliminary, [], false),
    });
    const complete = editorial(preliminary, []);
    for (const fieldPath of REQUIRED_EDITORIAL_PATHS) {
      const incompletePreliminary = {
        ...preliminary,
        structuredEditorialEvidence: preliminary.structuredEditorialEvidence.filter(
          (evidence) => evidence.fieldPath !== fieldPath,
        ),
      };
      expectInvalid({
        preliminary: incompletePreliminary,
        structuredReview: structuredReview(incompletePreliminary),
        documentResult: null,
        editorial: {
          ...complete,
          items: complete.items.filter((item) => item.fieldPath !== fieldPath),
        },
      });
    }
  });

  test("rejects an existing key indicator without its editorial label", () => {
    const preliminary = structuredPreliminary(
      "marketOverview.keyIndicators[0].value",
      100,
    );

    expectInvalid({
      preliminary,
      structuredReview: structuredReview(preliminary),
      documentResult: null,
      editorial: editorial(preliminary, []),
    });
  });

  test("accepts an existing key indicator when its exact editorial label is present", () => {
    const preliminary = structuredPreliminary(
      "marketOverview.keyIndicators[0].value",
      100,
    );
    const sourceId = preliminary.sourceRegister.sources[0]!.sourceId;
    const locator = "html:indicator=0-label";
    const labelEvidence = {
      sourceId,
      fieldPath: "marketOverview.keyIndicators[0].label",
      locator,
      rawValue: "Installed capacity",
    };
    const withLabel = {
      ...preliminary,
      sourceRegister: {
        ...preliminary.sourceRegister,
        sources: preliminary.sourceRegister.sources.map((source) => ({
          ...source,
          evidenceLocators: [...source.evidenceLocators, locator].sort(),
        })),
      },
      structuredEditorialEvidence: [
        ...preliminary.structuredEditorialEvidence,
        labelEvidence,
      ].sort((left, right) => [left.sourceId, left.fieldPath, left.locator]
        .join("\0").localeCompare([right.sourceId, right.fieldPath, right.locator].join("\0"))),
    };

    const result = materializeBasicReviewedRunV2({
      preliminary: withLabel,
      structuredReview: structuredReview(withLabel),
      documentResult: null,
      editorial: editorial(withLabel, [{
        fieldPath: labelEvidence.fieldPath,
        normalizedValue: { zh: "装机容量", en: "Installed capacity" },
        evidence: [editorialEvidence(sourceId, locator, labelEvidence.rawValue)],
        uncertainty: null,
      }]),
    });

    expect(result.materialization.extractedFacts.facts.some(
      ({ fieldPath }) => fieldPath === labelEvidence.fieldPath,
    )).toBe(true);
  });

  test("rejects oversized reviewed source arrays before reading entries", () => {
    const preliminary = structuredPreliminary();
    const probe = { executions: 0 };
    const sources = Array.from({ length: 65 }, (_, index) =>
      sourceRecord(`source-${String(index).padStart(2, "0")}`));
    Object.defineProperty(sources, "0", {
      enumerable: true,
      get() {
        probe.executions += 1;
        return sourceRecord("source-00");
      },
    });

    expectInvalid({
      preliminary: {
        ...preliminary,
        sourceRegister: { ...preliminary.sourceRegister, sources },
      },
      structuredReview: structuredReview(preliminary),
      documentResult: null,
      editorial: editorial(preliminary, []),
    });
    expect(probe.executions).toBe(0);
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
      "html:section=energy-demand",
      "html:section=industry-tags",
      "html:section=overview",
      "html:section=region",
      "html:section=renewable-target",
      "html:section=summary",
      "html:section=tech-tags",
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

  test("materializes empty tech tags through catalog-limited branded document evidence", async () => {
    const fixture = await documentFixture(
      "reviewed fixture",
      false,
      false,
      null,
      false,
      { emptyTechTagsFromIndustryTags: true },
    );
    const editorialInput = editorial(fixture.preliminary, [emptyTechTagsItem(
      "official-html",
      DOCUMENT_EMPTY_TECH_TAGS_LOCATOR,
    )]);
    const input = {
      preliminary: fixture.preliminary,
      structuredReview: null,
      documentResult: fixture.result,
      editorial: editorialInput,
    };

    const result = materializeBasicReviewedRunV2(input);

    expectTaxonomyOwnership(fixture.plan);
    expectEmptyTechTagsMaterialization(
      result,
      "official-html",
      DOCUMENT_EMPTY_TECH_TAGS_LOCATOR,
    );
    expectInvalid({ ...input, documentResult: { ...fixture.result } });
  });

  test("rejects direct document tech-tags evidence outside industry-only catalog ownership", async () => {
    await expect(documentFixture(
      "reviewed fixture",
      false,
      false,
      null,
      false,
      {
        emptyTechTagsFromIndustryTags: true,
        directTechTagsObservation: true,
      },
    )).rejects.toThrow("basic document evidence materialization is invalid");
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
        "country.region",
        "country.summary",
        "country.updatedAt",
        "marketOverview.collectedAt",
        "marketOverview.countryCode",
        "marketOverview.credibility",
        "marketOverview.energyDemand",
        "marketOverview.industryTags",
        "marketOverview.overview",
        "marketOverview.renewableTarget",
        "marketOverview.source",
        "marketOverview.sourceUrl",
        "marketOverview.techTags",
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

async function structuredIndustryTagsFixture(
  directTechTagsObservation = false,
): Promise<Readonly<{
  plan: BasicSourceExecutionPlan;
  preliminary: BasicPreliminarySourceRunV2;
}>> {
  const definitions = structuredIndustryTagsDefinitions();
  const catalog = parseBasicSourceCatalog({
    schemaVersion: "basic-source-catalog/v1",
    catalogVersion: CATALOG_VERSION,
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
        query: [{ name: "format", value: { kind: "literal", value: "json" } }],
      },
      accept: "application/json",
      approvedOrigins: ["https://api.worldbank.org"],
      allowedQueryParameters: ["format"],
      accessMode: "open",
      licenseName: "Creative Commons Attribution 4.0 International (CC BY 4.0)",
      licenseUrl: "https://datacatalog.worldbank.org/public-licenses",
      attribution: "World Bank",
      refreshCadence: "annual",
      adapterId: "world-bank-country",
      adapterVersion: "1.0.0",
      adapterKind: "deterministic",
      fieldPaths: [
        "country.code",
        "country.name",
        ...definitions.map(({ fieldPath }) => fieldPath),
      ].sort(),
    }],
    countryMappings: [],
  });
  const plan = createBasicSourceExecutionPlan({
    catalog,
    countryCode: COUNTRY_CODE,
    sourceIds: ["world-bank-country"],
  });
  vi.spyOn(worldBankCountryAdapter, "extract").mockReturnValue({
    publishedAt: "2026-07-01T00:00:00.000Z",
    promptInjectionRisk: "none",
    accessNotes: null,
    observations: [
      {
        fieldPath: "country.code",
        locator: "json:/country/code",
        rawValue: COUNTRY_CODE,
        normalizedValue: COUNTRY_CODE,
        unit: null,
        year: null,
        uncertainty: null,
      },
      {
        fieldPath: "country.name",
        locator: "json:/country/name",
        rawValue: "Indonesia",
        normalizedValue: { zh: "", en: "Indonesia" },
        unit: null,
        year: null,
        uncertainty: null,
      },
      ...definitions.map((definition) => ({
        fieldPath: definition.fieldPath,
        locator: definition.locator,
        rawValue: definition.rawValue,
        normalizedValue: definition.normalizedValue,
        unit: null,
        year: null,
        uncertainty: null,
      })),
      {
        fieldPath: directTechTagsObservation
          ? "marketOverview.techTags"
          : "marketOverview.industryTags",
        locator: STRUCTURED_EMPTY_TECH_TAGS_LOCATOR,
        rawValue: EMPTY_TECH_TAGS_RAW_VALUE,
        normalizedValue: ["solar", "storage"],
        unit: null,
        year: null,
        uncertainty: null,
      },
    ],
  });
  const root = mkdtempSync(join(tmpdir(), "navigator-v2-structured-tech-tags-"));
  roots.add(root);
  const transport: BasicSourceTransportV2 = {
    async execute(request) {
      return {
        status: 200,
        finalUrl: request.url,
        redirectChain: [],
        contentType: "application/json",
        retrievedAt: "2026-07-13T01:00:00.000Z",
        body: bytes(new TextEncoder().encode("{}")),
      };
    },
  };
  return {
    plan,
    preliminary: await runBasicSourceExecutionPlanV2({
      repoRoot: root,
      countryCode: COUNTRY_CODE,
      runId: RUN_ID,
      plan,
      transport,
    }),
  };
}

function structuredIndustryTagsDefinitions() {
  return requiredEditorialDefinitions()
    .filter(({ fieldPath }) => fieldPath !== "marketOverview.techTags")
    .map((definition) => ({
      ...definition,
      locator: definition.locator.replace("html:section=", "json:/market-overview/"),
    }));
}

function structuredIndustryTagsEditorial(
  preliminary: BasicPreliminarySourceRunV2,
): BasicCountryEditorialInput {
  return editorial(preliminary, [
    {
      fieldPath: "country.name",
      normalizedValue: { zh: "印度尼西亚", en: "Indonesia" },
      evidence: [editorialEvidence(
        "world-bank-country",
        "json:/country/name",
        "Indonesia",
      )],
      uncertainty: null,
    },
    ...structuredIndustryTagsDefinitions().map((definition) => ({
      fieldPath: definition.fieldPath,
      normalizedValue: definition.normalizedValue,
      evidence: [editorialEvidence(
        "world-bank-country",
        definition.locator,
        definition.rawValue,
      )],
      uncertainty: null,
    })),
    emptyTechTagsItem("world-bank-country", STRUCTURED_EMPTY_TECH_TAGS_LOCATOR),
  ]);
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
  const requiredEvidence = requiredEditorialEvidence(sourceId);
  const locators = [...new Set([
    "json:/country/id",
    locator,
    ...requiredEvidence.map((item) => item.locator),
  ])].sort();
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
    structuredEditorialEvidence: requiredEvidence,
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
    structuredEditorialEvidence: preliminary.documentCaptures.length === 0
      ? structured.structuredEditorialEvidence
      : [],
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
  complete = true,
  primarySourceId?: string,
): BasicCountryEditorialInput {
  const requiredSourceId = items.find(({ fieldPath }) => fieldPath !== "country.name")
    ?.evidence[0]?.sourceId;
  const sourceId = primarySourceId ?? requiredSourceId ?? items[0]?.evidence[0]?.sourceId ??
    preliminary.sourceRegister.sources[0]?.sourceId;
  if (sourceId === undefined) throw new Error("test fixture requires a source");
  const byPath = new Map(
    (complete ? requiredEditorialItems(sourceId) : []).map((item) => [item.fieldPath, item]),
  );
  for (const value of items) byPath.set(value.fieldPath, value);
  return {
    schemaVersion: "basic-country-editorial-input/v1",
    runId: preliminary.sourceRegister.runId,
    countryCode: preliminary.sourceRegister.countryCode,
    catalogVersion: preliminary.sourceRegister.catalogVersion,
    catalogSha256: preliminary.sourceRegister.catalogSha256,
    primarySourceId: sourceId,
    items: [...byPath.values()].sort((left, right) =>
      left.fieldPath.localeCompare(right.fieldPath)),
  };
}

function editorialEvidence(
  sourceId: string,
  locator: string,
  rawValue: BasicCountryEditorialInput["items"][number]["evidence"][number]["rawValue"],
) {
  return { sourceId, locator, rawValue, unit: null, year: null } as const;
}

function documentSummaryItem(): BasicCountryEditorialInput["items"][number] {
  return {
    fieldPath: "country.summary",
    normalizedValue: { zh: "审阅后的国家摘要", en: "Reviewed country summary" },
    evidence: [editorialEvidence(
      "official-html", "html:section=summary", "Reviewed country summary",
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
  readonly emptyTechTagsFromIndustryTags?: boolean;
  readonly directTechTagsObservation?: boolean;
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
  const emptyTechTagsFromIndustryTags =
    overrides.emptyTechTagsFromIndustryTags ?? false;
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
      fieldPaths: [
        ...(withCountryCode ? ["country.code"] : []),
        ...REQUIRED_EDITORIAL_PATHS.filter((fieldPath) =>
          !emptyTechTagsFromIndustryTags || fieldPath !== "marketOverview.techTags"),
        ...(withPopulation ? ["marketOverview.population"] : []),
      ].sort(),
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
    observations: capture.catalogSource.sourceId === "official-html" ? ([
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
      ...requiredDocumentEditorialObservations(
        emptyTechTagsFromIndustryTags,
        overrides.directTechTagsObservation ?? false,
      ),
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
    ]).sort((left, right) =>
      `${left.fieldPath}\0${left.locator}`.localeCompare(`${right.fieldPath}\0${right.locator}`)) : [{
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

function emptyTechTagsItem(
  sourceId: string,
  locator: string,
): BasicCountryEditorialInput["items"][number] {
  return {
    fieldPath: "marketOverview.techTags",
    normalizedValue: [],
    evidence: [editorialEvidence(sourceId, locator, EMPTY_TECH_TAGS_RAW_VALUE)],
    uncertainty: EMPTY_TECH_TAGS_UNCERTAINTY,
  };
}

function requiredEditorialDefinitions(): readonly Readonly<{
  fieldPath: typeof REQUIRED_EDITORIAL_PATHS[number];
  locator: string;
  rawValue: BasicCountryEditorialInput["items"][number]["normalizedValue"];
  normalizedValue: BasicCountryEditorialInput["items"][number]["normalizedValue"];
}>[] {
  return [
    {
      fieldPath: "country.region",
      locator: "html:section=region",
      rawValue: "Southeast Asia",
      normalizedValue: "southeast-asia",
    },
    {
      fieldPath: "country.summary",
      locator: "html:section=summary",
      rawValue: "Reviewed country summary",
      normalizedValue: { zh: "审阅后的国家摘要", en: "Reviewed country summary" },
    },
    {
      fieldPath: "marketOverview.energyDemand",
      locator: "html:section=energy-demand",
      rawValue: "Demand is growing",
      normalizedValue: { zh: "能源需求增长", en: "Energy demand is growing" },
    },
    {
      fieldPath: "marketOverview.industryTags",
      locator: "html:section=industry-tags",
      rawValue: "solar,storage",
      normalizedValue: ["solar", "storage"],
    },
    {
      fieldPath: "marketOverview.overview",
      locator: "html:section=overview",
      rawValue: "Market overview",
      normalizedValue: { zh: "市场概览", en: "Market overview" },
    },
    {
      fieldPath: "marketOverview.renewableTarget",
      locator: "html:section=renewable-target",
      rawValue: "Renewable target",
      normalizedValue: { zh: "可再生能源目标", en: "Renewable target" },
    },
    {
      fieldPath: "marketOverview.techTags",
      locator: "html:section=tech-tags",
      rawValue: "pv-module,inverter",
      normalizedValue: ["inverter", "pv-module"],
    },
  ];
}

function requiredEditorialItems(
  sourceId: string,
): BasicCountryEditorialInput["items"] {
  return requiredEditorialDefinitions().map((definition) => ({
    fieldPath: definition.fieldPath,
    normalizedValue: definition.normalizedValue,
    evidence: [editorialEvidence(
      sourceId,
      definition.locator,
      definition.rawValue,
    )],
    uncertainty: null,
  }));
}

function requiredEditorialEvidence(
  sourceId: string,
): BasicPreliminarySourceRunV2["structuredEditorialEvidence"] {
  return requiredEditorialDefinitions().map((definition) => ({
    sourceId,
    fieldPath: definition.fieldPath,
    locator: definition.locator,
    rawValue: definition.rawValue,
  })).sort((left, right) => [left.sourceId, left.fieldPath, left.locator]
    .join("\0").localeCompare([right.sourceId, right.fieldPath, right.locator].join("\0")));
}

function requiredDocumentEditorialObservations(
  emptyTechTagsFromIndustryTags = false,
  directTechTagsObservation = false,
) {
  const observations = requiredEditorialDefinitions()
    .filter((definition) =>
      !emptyTechTagsFromIndustryTags || definition.fieldPath !== "marketOverview.techTags")
    .map((definition) => ({
    usage: "editorial-evidence" as const,
    fieldPath: definition.fieldPath,
    locator: definition.locator,
    rawValue: definition.rawValue,
  }));
  if (emptyTechTagsFromIndustryTags) {
    observations.push({
      usage: "editorial-evidence",
      fieldPath: directTechTagsObservation
        ? "marketOverview.techTags"
        : "marketOverview.industryTags",
      locator: DOCUMENT_EMPTY_TECH_TAGS_LOCATOR,
      rawValue: EMPTY_TECH_TAGS_RAW_VALUE,
    });
  }
  return observations;
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

function expectTaxonomyOwnership(plan: BasicSourceExecutionPlan): void {
  expect(plan.sources[0]?.source.fieldPaths.filter((fieldPath) =>
    fieldPath === "marketOverview.industryTags" ||
    fieldPath === "marketOverview.techTags"))
    .toEqual(["marketOverview.industryTags"]);
}

function expectEmptyTechTagsMaterialization(
  result: ReturnType<typeof materializeBasicReviewedRunV2>,
  sourceId: string,
  locator: string,
): void {
  expect(result.materialization.extractedFacts.facts.find(
    ({ fieldPath }) => fieldPath === "marketOverview.techTags",
  )).toMatchObject({
    fieldPath: "marketOverview.techTags",
    status: "candidate",
    extractionMethod: "manual",
    uncertainty: EMPTY_TECH_TAGS_UNCERTAINTY,
    evidence: [{
      sourceId,
      locator,
      rawValue: EMPTY_TECH_TAGS_RAW_VALUE,
      normalizedValue: [],
      unit: null,
      year: null,
    }],
  });
  expect(validateBasicV2FactOwnership(
    result.materialization.extractedFacts.facts,
  )).toEqual([]);
  expect(result.materialization.sourceRegister.sources.find(
    (source) => source.sourceId === sourceId,
  )?.evidenceLocators).toContain(locator);
  expect(result.sourceChecks).toContainEqual({
    sourceId,
    status: "passed",
    notes: null,
  });
  expectDeeplyFrozen(result);
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
