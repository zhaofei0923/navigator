import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

import {
  parseBasicDocumentObservationPlan,
} from "./collection/basic-document-observation-parser.js";
import {
  materializeBasicDocumentEvidence,
} from "./collection/basic-document-observation-materializer.js";
import type {
  BasicDocumentObservationPlan,
} from "./collection/basic-document-observation-contracts.js";
import type {
  BasicDocumentCaptureV2,
} from "./collection/basic-collection-v2-contracts.js";
import {
  parseBasicSourceCatalog,
} from "./collection/basic-source-catalog.js";
import {
  parseBasicManualSourceReview,
} from "./collection/basic-source-review-parser.js";
import type {
  BasicManualSourceReview,
} from "./collection/basic-source-review-contracts.js";
import {
  createBasicSourceExecutionPlan,
  type BasicSourceExecutionPlan,
} from "./collection/basic-source-request-materializer.js";
import {
  runBasicSourceExecutionPlanV2,
} from "./collection/basic-source-plan-runner-v2.js";
import type {
  BasicSourceTransportV2,
} from "./collection/basic-source-v2-contracts.js";

const CATALOG_SHA256 =
  "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
const CONTENT_SHA256 =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const ERROR = "document observation plan is invalid";
const REQUEST_URL_PREFIX = "https://documents.example/";
const SECOND_CONTENT_SHA256 =
  "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
const MATERIALIZATION_ERROR = "basic document evidence materialization is invalid";
const MATERIALIZATION_RUN_ID = "run-20260712";
const materializationRoots = new Set<string>();

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of materializationRoots) {
    rmSync(root, { recursive: true, force: true });
  }
  materializationRoots.clear();
});

type MutableRecord = Record<string | symbol, unknown>;

function plan(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schemaVersion: "basic-document-observation-plan/v1",
    runId: "run-20260712",
    countryCode: "VN",
    catalogVersion: "2026.07.12",
    catalogSha256: CATALOG_SHA256,
    sourceId: "official-energy-policy",
    capture: capture(),
    observations: [
      editorialObservation(),
      sourceFactObservation(),
    ],
    ...overrides,
  };
}

function capture(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    adapterId: "basic-manual-document-capture",
    adapterVersion: "1.0.0",
    requestUrl: "https://documents.example/policy?country=VN",
    retrievedAt: "2026-07-12T04:00:00.000Z",
    contentType: "text/html",
    byteLength: 1_024,
    contentSha256: CONTENT_SHA256,
    ...overrides,
  };
}

function sourceFactObservation(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    usage: "source-fact",
    fieldPath: "marketOverview.population",
    locator: "html:section=population-table;row=2025",
    rawValue: { source: "official", value: 101_598_527 },
    normalizedValue: 101_598_527,
    unit: "people",
    year: 2025,
    uncertainty: null,
    ...overrides,
  };
}

function editorialObservation(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    usage: "editorial-evidence",
    fieldPath: "country.summary",
    locator: "html:section=overview",
    rawValue: "Reviewed policy overview",
    ...overrides,
  };
}

function expectInvalid(value: unknown): void {
  expect(() => parseBasicDocumentObservationPlan(value)).toThrow(ERROR);
}

function unsafeRecord(
  value: Record<string, unknown>,
  kind: "accessor" | "proxy" | "symbol",
  probe = { executions: 0 },
): unknown {
  const copy = { ...value } as MutableRecord;
  if (kind === "accessor") {
    Object.defineProperty(copy, "runId", {
      enumerable: true,
      get() {
        probe.executions += 1;
        return "run-20260712";
      },
    });
    return copy;
  }
  if (kind === "symbol") return { ...copy, [Symbol("hidden")]: true };
  return new Proxy(copy, {
    get(target, property, receiver) {
      probe.executions += 1;
      return Reflect.get(target, property, receiver);
    },
  });
}

function nestedArrays(depth: number, leaf: unknown): unknown {
  let value = leaf;
  for (let index = 0; index < depth; index += 1) value = [value];
  return value;
}

describe("Basic document observation plan parser", () => {
  test("reconstructs exact HTML capture and both observation variants", () => {
    const input = plan();

    const result = parseBasicDocumentObservationPlan(input);

    expect(result).toEqual(input);
    expect(result).not.toBe(input);
    expect(result.capture).not.toBe(input.capture);
    expect(result.observations).not.toBe(input.observations);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.capture)).toBe(true);
    expect(Object.isFrozen(result.observations)).toBe(true);
    expect(Object.isFrozen(result.observations[0])).toBe(true);
    expect(Object.isFrozen(result.observations[1])).toBe(true);
  });

  test("preserves reconstructed raw JSON while canonicalizing generic object keys", () => {
    const value = plan({
      observations: [
        editorialObservation({ rawValue: { zebra: [true, null], alpha: { y: 1, x: 2 } } }),
        sourceFactObservation({ rawValue: { zebra: 2, alpha: 1 } }),
      ],
    });

    const result = parseBasicDocumentObservationPlan(value);
    const [editorial, sourceFact] = result.observations;

    expect(editorial?.rawValue).toEqual({ alpha: { x: 2, y: 1 }, zebra: [true, null] });
    expect(sourceFact?.rawValue).toEqual({ alpha: 1, zebra: 2 });
    expect(Object.keys(editorial?.rawValue as object)).toEqual(["alpha", "zebra"]);
    expect(Object.isFrozen(editorial?.rawValue)).toBe(true);
    expect(Object.isFrozen(sourceFact?.rawValue)).toBe(true);
  });

  test("accepts PDF locators only for a PDF capture", () => {
    const result = parseBasicDocumentObservationPlan(plan({
      capture: capture({ contentType: "application/pdf" }),
      observations: [
        editorialObservation({ locator: "pdf:page=1#policy-overview" }),
        sourceFactObservation({ locator: "pdf:page=2#population-table" }),
      ],
    }));

    expect(result.capture.contentType).toBe("application/pdf");
    expect(result.observations.map(({ locator }) => locator)).toEqual([
      "pdf:page=1#policy-overview",
      "pdf:page=2#population-table",
    ]);
  });

  test("rejects a malformed capture content type", () => {
    expectInvalid(plan({ capture: capture({ contentType: "text/html;" }) }));
  });

  test.each([
    ["surrounding whitespace", " https://documents.example/policy"],
    ["non-canonical origin", "https://documents.example"],
    ["non-HTTPS protocol", "http://documents.example/policy"],
    ["credentials", "https://user:pass@documents.example/policy"],
    ["fragment", "https://documents.example/policy#section"],
    [
      "an 8193-byte URL",
      `${REQUEST_URL_PREFIX}${"a".repeat(8_193 - REQUEST_URL_PREFIX.length)}`,
    ],
  ])("rejects a capture request URL with %s", (_label, requestUrl) => {
    expectInvalid(plan({ capture: capture({ requestUrl }) }));
  });

  test.each([
    ["extra top-level key", (value: Record<string, unknown>) => ({ ...value, extra: true })],
    ["missing top-level key", (value: Record<string, unknown>) => {
      const copy = { ...value };
      delete copy.sourceId;
      return copy;
    }],
    ["extra capture key", (value: Record<string, unknown>) => ({
      ...value,
      capture: { ...(value.capture as object), extra: true },
    })],
    ["missing capture key", (value: Record<string, unknown>) => {
      const captureValue = { ...(value.capture as Record<string, unknown>) };
      delete captureValue.byteLength;
      return { ...value, capture: captureValue };
    }],
  ])("rejects %s", (_label, mutate) => {
    expectInvalid(mutate(plan()));
  });

  test.each(["accessor", "proxy", "symbol"] as const)(
    "rejects a top-level %s without executing it",
    (kind) => {
      const probe = { executions: 0 };

      expectInvalid(unsafeRecord(plan(), kind, probe));

      expect(probe.executions).toBe(0);
    },
  );

  test.each([
    ["extra source-fact key", [
      editorialObservation(),
      sourceFactObservation({ extra: true }),
    ]],
    ["extra editorial key", [
      editorialObservation({ normalizedValue: "not permitted" }),
      sourceFactObservation(),
    ]],
    ["missing source-fact key", [
      editorialObservation(),
      (() => {
        const observation = sourceFactObservation();
        delete observation.year;
        return observation;
      })(),
    ]],
    ["missing editorial key", [
      (() => {
        const observation = editorialObservation();
        delete observation.rawValue;
        return observation;
      })(),
      sourceFactObservation(),
    ]],
  ])("rejects %s", (_label, observations) => {
    expectInvalid(plan({ observations }));
  });

  test.each([
    ["empty observations", []],
    ["duplicate observation identity", [
      editorialObservation(),
      editorialObservation(),
      sourceFactObservation(),
    ]],
    ["unsorted observations", [
      sourceFactObservation(),
      editorialObservation(),
    ]],
  ])("rejects %s", (_label, observations) => {
    expectInvalid(plan({ observations }));
  });

  test.each([
    ["source fact on an editorial path", [
      editorialObservation(),
      sourceFactObservation({ fieldPath: "marketOverview.overview" }),
    ]],
    ["editorial evidence on a source-backed path", [
      editorialObservation({ fieldPath: "marketOverview.population" }),
      sourceFactObservation(),
    ]],
    ["hybrid name as a source fact", [
      editorialObservation(),
      sourceFactObservation({ fieldPath: "country.name" }),
    ]],
    ["derived path as editorial evidence", [
      editorialObservation({ fieldPath: "country.updatedAt" }),
      sourceFactObservation(),
    ]],
  ])("rejects %s", (_label, observations) => {
    expectInvalid(plan({ observations }));
  });

  test.each([
    ["non-finite raw JSON", { rawValue: Number.NaN }],
    ["non-finite normalized JSON", { normalizedValue: Number.POSITIVE_INFINITY }],
    ["blank unit", { unit: "  " }],
    ["non-finite year", { year: Number.NaN }],
    ["blank uncertainty", { uncertainty: "\t" }],
  ])("rejects a source fact with %s", (_label, overrides) => {
    expectInvalid(plan({ observations: [
      editorialObservation(),
      sourceFactObservation(overrides),
    ] }));
  });

  test.each([
    ["HTML locator on a PDF capture", "application/pdf", "html:section=overview"],
    ["PDF locator on an HTML capture", "text/html", "pdf:page=1#overview"],
    ["page zero", "application/pdf", "pdf:page=0#overview"],
    ["blank PDF anchor", "application/pdf", "pdf:page=1#  "],
    ["blank HTML location", "text/html", "html:  "],
    ["HTML trailing whitespace", "text/html", "html:section=overview "],
    ["PDF trailing whitespace", "application/pdf", "pdf:page=1#overview "],
    ["NUL HTML location", "text/html", "html:section=over\0view"],
    ["NUL PDF anchor", "application/pdf", "pdf:page=1#over\0view"],
    ["C0 HTML location", "text/html", "html:section=over\u001Fview"],
    ["C0 PDF anchor", "application/pdf", "pdf:page=1#over\u001Fview"],
    ["DEL HTML location", "text/html", "html:section=over\u007Fview"],
    ["DEL PDF anchor", "application/pdf", "pdf:page=1#over\u007Fview"],
    ["URL location", "text/html", "html:https://search.example/?q=policy"],
    ["search location", "text/html", "html:search=renewable policy"],
    ["metadata location", "text/html", "html:metadata:/publishedAt"],
    ["capture location", "text/html", "html:capture:/retrievedAt"],
  ])("rejects %s", (_label, contentType, locator) => {
    expectInvalid(plan({
      capture: capture({ contentType }),
      observations: [
        editorialObservation({ locator }),
        sourceFactObservation({ locator: contentType === "application/pdf"
          ? "pdf:page=2#population-table"
          : "html:section=population-table" }),
      ],
    }));
  });

  test("accepts a 65536-byte JSON object key", () => {
    const key = "a".repeat(65_536);
    const result = parseBasicDocumentObservationPlan(plan({ observations: [
      editorialObservation({ rawValue: { [key]: "reviewed" } }),
      sourceFactObservation(),
    ] }));

    expect(result.observations[0]?.rawValue).toEqual({ [key]: "reviewed" });
  });

  test.each([
    ["an overlong key", "a".repeat(65_537)],
    ["an ill-formed Unicode key", "\uD800"],
  ])("rejects a JSON object with %s", (_label, key) => {
    expectInvalid(plan({ observations: [
      editorialObservation({ rawValue: { [key]: "reviewed" } }),
      sourceFactObservation(),
    ] }));
  });

  test("rejects cyclic, sparse, deep, oversized, and overlong input values", () => {
    const cyclic = plan();
    cyclic.cycle = cyclic;
    const sparse = plan({ observations: new Array(2) });
    const deep = plan({ observations: nestedArrays(65, "DOCUMENT_DEPTH_MUST_NOT_LEAK") });
    const oversized = plan({ observations: Array.from(
      { length: 257 },
      (_, index) => editorialObservation({
        fieldPath: `marketOverview.keyIndicators[${index}].label`,
        locator: `html:section=indicator-${index}`,
      }),
    ) });
    const overlong = plan({ observations: [
      editorialObservation({ rawValue: `${"x".repeat(65_536)}x` }),
      sourceFactObservation(),
    ] });

    expectInvalid(cyclic);
    expectInvalid(sparse);
    expectInvalid(deep);
    expectInvalid(oversized);
    expectInvalid(overlong);
  });

  test("returns a stable redacted error without inspecting document bytes", () => {
    const sentinel = "DOCUMENT_CONTENT_MUST_NOT_LEAK";
    const value = plan({ observations: nestedArrays(65, sentinel) });

    try {
      parseBasicDocumentObservationPlan(value);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(ERROR);
      expect((error as Error).message).not.toContain(sentinel);
    }
  });

  test("returns a stable redacted error without leaking rejected values", () => {
    const sentinel = "DOCUMENT_PLAN_VALUE_MUST_NOT_LEAK";
    const value = plan({ capture: capture({
      requestUrl: `${REQUEST_URL_PREFIX}${sentinel} `,
    }) });

    try {
      parseBasicDocumentObservationPlan(value);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(ERROR);
      expect((error as Error).message).not.toContain(sentinel);
    }
  });
});

interface MaterializationFixture {
  readonly plan: BasicSourceExecutionPlan;
  readonly captures: readonly BasicDocumentCaptureV2[];
  readonly review: BasicManualSourceReview;
  readonly documentPlans: readonly BasicDocumentObservationPlan[];
}

describe("Basic document evidence materializer", () => {
  test("rejects self-consistent handmade document captures", () => {
    const fixture = handmadeMaterializationFixture();

    expectMaterializationInvalid(fixture);
  });

  test("materializes exact catalog/capture/review owners and reviewed document observations", async () => {
    const fixture = await materializationFixture();
    const capturesBefore = structuredClone(fixture.captures);
    const reviewBefore = structuredClone(fixture.review);
    const documentPlansBefore = structuredClone(fixture.documentPlans);

    const result = materializeBasicDocumentEvidence(fixture);

    expect(result.sources).toEqual([
      {
        sourceId: "official-html",
        sourceName: "Official HTML publication",
        sourceUrl: "https://documents.example/sources/VN/official.html",
        retrievedAt: "2026-07-12T04:00:00.000Z",
        publishedAt: "2026-07-01T00:00:00.000Z",
        contentSha256: fixture.captures[0]!.manifest.response.contentSha256,
        evidenceLocators: [
          "html:section=overview",
          "html:section=population-table;row=2025",
        ],
        sourceFamily: "government",
        accessStatus: "open",
        accessNotes: "Public HTML publication",
        credibility: "OFFICIAL",
        discoveryOnly: false,
        promptInjectionRisk: "none",
      },
      {
        sourceId: "official-pdf",
        sourceName: "Official PDF publication",
        sourceUrl: "https://documents.example/sources/VN/official.pdf",
        retrievedAt: "2026-07-12T05:00:00.000Z",
        publishedAt: null,
        contentSha256: fixture.captures[1]!.manifest.response.contentSha256,
        evidenceLocators: [
          "pdf:page=2#gdp-table",
          "pdf:page=3#renewable-target",
        ],
        sourceFamily: "energy-authority",
        accessStatus: "open",
        accessNotes: null,
        credibility: "VERIFIED",
        discoveryOnly: false,
        promptInjectionRisk: "none",
      },
    ]);
    expect(result.facts.map(({ fieldPath, extractionMethod, status }) => ({
      fieldPath,
      extractionMethod,
      status,
    }))).toEqual([
      {
        fieldPath: "marketOverview.gdp",
        extractionMethod: "manual",
        status: "candidate",
      },
      {
        fieldPath: "marketOverview.population",
        extractionMethod: "manual",
        status: "candidate",
      },
    ]);
    expect(result.editorialEvidence).toEqual([
      {
        sourceId: "official-html",
        fieldPath: "country.summary",
        locator: "html:section=overview",
        rawValue: "Reviewed country summary",
      },
      {
        sourceId: "official-pdf",
        fieldPath: "marketOverview.renewableTarget",
        locator: "pdf:page=3#renewable-target",
        rawValue: "Reviewed renewable target",
      },
    ]);
    expect(result.sourceChecks).toEqual([
      { sourceId: "official-html", status: "passed", notes: null },
      {
        sourceId: "official-pdf",
        status: "passed",
        notes: "Publication date is not stated",
      },
    ]);
    expect(result.injectionRisks).toEqual([]);
    expectDeeplyFrozen(result);
    expect(fixture.captures).toEqual(capturesBefore);
    expect(fixture.review).toEqual(reviewBefore);
    expect(fixture.documentPlans).toEqual(documentPlansBefore);
  });

  test("is order-independent and emits stable source, fact, and evidence ordering", async () => {
    const fixture = await materializationFixture();

    const forward = materializeBasicDocumentEvidence(fixture);
    const reversed = materializeBasicDocumentEvidence({
      ...fixture,
      captures: Array.from(fixture.captures).reverse(),
      documentPlans: Array.from(fixture.documentPlans).reverse(),
    });

    expect(reversed).toEqual(forward);
  });

  test("preserves failed checks, UNVERIFIED credibility, and reviewed prompt risks for preflight", async () => {
    const fixture = await materializationFixture("UNVERIFIED");
    const review = reviewedManualSources(fixture.plan, {
      "official-html": {
        sourceCheck: { status: "failed", notes: "Hash reviewed but access check failed" },
      },
      "official-pdf": {
        promptInjectionRisk: "confirmed",
        injectionRisks: [
          {
            locator: "pdf:page=2#gdp-table",
            severity: "suspected",
            details: "Suspicious instruction-like text",
          },
          {
            locator: "pdf:page=3#renewable-target",
            severity: "confirmed",
            details: "Confirmed instruction-like text",
          },
        ],
      },
    });

    const result = materializeBasicDocumentEvidence({ ...fixture, review });

    expect(result.sources[0]).toMatchObject({
      sourceId: "official-html",
      credibility: "UNVERIFIED",
    });
    expect(result.sources[1]).toMatchObject({
      sourceId: "official-pdf",
      promptInjectionRisk: "confirmed",
    });
    expect(result.sourceChecks[0]).toEqual({
      sourceId: "official-html",
      status: "failed",
      notes: "Hash reviewed but access check failed",
    });
    expect(result.injectionRisks).toEqual([
      {
        sourceId: "official-pdf",
        locator: "pdf:page=2#gdp-table",
        severity: "suspected",
        details: "Suspicious instruction-like text",
      },
      {
        sourceId: "official-pdf",
        locator: "pdf:page=3#renewable-target",
        severity: "confirmed",
        details: "Confirmed instruction-like text",
      },
    ]);
    expect(result.facts).toHaveLength(2);
    expect(result.editorialEvidence).toHaveLength(2);
    expectDeeplyFrozen(result);
  });

  test("rejects a forged or mixed-provenance execution plan", async () => {
    const fixture = await materializationFixture();
    const other = await materializationFixture();
    const forged = structuredClone(fixture.plan);
    const mixed = {
      ...fixture.plan,
      sources: [
        fixture.plan.sources[0]!,
        other.plan.sources[1]!,
      ],
    };

    expectMaterializationInvalid({ ...fixture, plan: forged });
    expectMaterializationInvalid({ ...fixture, plan: mixed });
  });

  test("rejects spread and JSON-cloned runner captures", async () => {
    const fixture = await materializationFixture();
    const spreadCapture = { ...fixture.captures[0] } as BasicDocumentCaptureV2;
    const jsonCapture = JSON.parse(
      JSON.stringify(fixture.captures[0]),
    ) as BasicDocumentCaptureV2;

    expectMaterializationInvalid({
      ...fixture,
      captures: [spreadCapture, ...fixture.captures.slice(1)],
    });
    expectMaterializationInvalid({
      ...fixture,
      captures: [jsonCapture, ...fixture.captures.slice(1)],
    });
  });

  test("rejects branded captures mixed across plans, catalogs, and runs", async () => {
    const fixture = await materializationFixture();
    const otherPlan = await materializationFixture();
    const otherCatalog = await materializationFixture("UNVERIFIED");
    const otherRun = await materializationFixture("OFFICIAL", {
      plan: fixture.plan,
      runId: "other-run-20260712",
    });

    expectMaterializationInvalid({
      ...fixture,
      captures: [fixture.captures[0]!, otherPlan.captures[1]!],
    });
    expectMaterializationInvalid({
      ...fixture,
      captures: [fixture.captures[0]!, otherCatalog.captures[1]!],
    });
    expectMaterializationInvalid({
      ...fixture,
      captures: [fixture.captures[0]!, otherRun.captures[1]!],
    });
  });

  test.each([
    ["missing capture", (fixture: MaterializationFixture) => ({
      ...fixture,
      captures: fixture.captures.slice(1),
    })],
    ["duplicate capture", (fixture: MaterializationFixture) => ({
      ...fixture,
      captures: [...fixture.captures, fixture.captures[0]],
    })],
    ["untrusted capture overlap", (fixture: MaterializationFixture) => ({
      ...fixture,
      captures: [
        ...fixture.captures,
        structuredClone(fixture.captures[0]!),
      ],
    })],
    ["missing document plan", (fixture: MaterializationFixture) => ({
      ...fixture,
      documentPlans: fixture.documentPlans.slice(1),
    })],
    ["duplicate document plan", (fixture: MaterializationFixture) => ({
      ...fixture,
      documentPlans: [...fixture.documentPlans, fixture.documentPlans[0]],
    })],
    ["structured document-plan overlap", (fixture: MaterializationFixture) => ({
      ...fixture,
      documentPlans: [...fixture.documentPlans, {
        ...fixture.documentPlans[0],
        sourceId: "structured-data",
      }],
    })],
  ])("rejects %s", async (_label, mutate) => {
    const fixture = await materializationFixture();
    expectMaterializationInvalid(mutate(fixture));
  });

  test.each([
    ["missing review", (value: Record<string, unknown>) => {
      const sources = (value.sources as unknown[]).slice(1);
      return { ...value, sources };
    }],
    ["duplicate review", (value: Record<string, unknown>) => {
      const sources = value.sources as unknown[];
      return { ...value, sources: [...sources, sources[0]] };
    }],
    ["review run", (value: Record<string, unknown>) => ({
      ...value,
      runId: "other-run-20260712",
    })],
    ["review country", (value: Record<string, unknown>) => ({
      ...value,
      countryCode: "ID",
    })],
    ["review catalog version", (value: Record<string, unknown>) => ({
      ...value,
      catalogVersion: "2026.07.12.other",
    })],
    ["review catalog digest", (value: Record<string, unknown>) => ({
      ...value,
      catalogSha256: SECOND_CONTENT_SHA256,
    })],
  ])("rejects %s mismatch", async (_label, mutate) => {
    const fixture = await materializationFixture();
    const invalidReview = mutate(structuredClone(fixture.review) as unknown as Record<string, unknown>);
    expectMaterializationInvalid({ ...fixture, review: invalidReview });
  });

  test.each([
    ["capture run", (captureValue: Record<string, unknown>) => ({
      ...captureValue,
      runId: "other-run-20260712",
    })],
    ["capture country", (captureValue: Record<string, unknown>) => ({
      ...captureValue,
      countryCode: "ID",
    })],
    ["capture catalog version", (captureValue: Record<string, unknown>) => ({
      ...captureValue,
      catalogVersion: "2026.07.12.other",
    })],
    ["capture catalog digest", (captureValue: Record<string, unknown>) => ({
      ...captureValue,
      catalogSha256: SECOND_CONTENT_SHA256,
    })],
  ])("rejects %s mismatch", async (_label, mutateManifest) => {
    const fixture = await materializationFixture();
    const captures = replaceFirstCaptureManifest(fixture, mutateManifest);
    expectMaterializationInvalid({ ...fixture, captures });
  });

  test.each([
    ["adapter ID", { adapterId: "other-manual-adapter" }],
    ["adapter version", { adapterVersion: "2.0.0" }],
    ["request URL", { requestUrl: "https://documents.example/sources/VN/other.html" }],
    ["retrieval timestamp", { retrievedAt: "2026-07-12T04:00:01.000Z" }],
    ["byte length", { byteLength: 1_025 }],
    ["content hash", { contentSha256: SECOND_CONTENT_SHA256 }],
  ])("rejects document-plan %s drift", async (_label, captureOverrides) => {
    const fixture = await materializationFixture();
    const documentPlans = replaceFirstDocumentPlan(fixture, {
      capture: {
        ...fixture.documentPlans[0]!.capture,
        ...captureOverrides,
      },
    });
    expectMaterializationInvalid({ ...fixture, documentPlans });
  });

  test.each([
    ["adapter ID", (manifest: Record<string, unknown>) => ({
      ...manifest,
      adapterId: "other-manual-adapter",
    })],
    ["adapter version", (manifest: Record<string, unknown>) => ({
      ...manifest,
      adapterVersion: "2.0.0",
    })],
    ["request URL", (manifest: Record<string, unknown>) => ({
      ...manifest,
      request: {
        ...(manifest.request as object),
        url: "https://documents.example/sources/VN/other.html",
      },
    })],
    ["MIME", (manifest: Record<string, unknown>) => ({
      ...manifest,
      response: {
        ...(manifest.response as object),
        contentType: "application/pdf",
      },
    })],
    ["HTTP status", (manifest: Record<string, unknown>) => ({
      ...manifest,
      response: { ...(manifest.response as object), status: 404 },
    })],
    ["final URL policy", (manifest: Record<string, unknown>) => ({
      ...manifest,
      response: {
        ...(manifest.response as object),
        finalUrl: "https://unapproved.example/redirected.html",
      },
    })],
    ["retrieval timestamp", (manifest: Record<string, unknown>) => ({
      ...manifest,
      response: {
        ...(manifest.response as object),
        retrievedAt: "2026-07-12T04:00:01.000Z",
      },
    })],
    ["byte length", (manifest: Record<string, unknown>) => ({
      ...manifest,
      response: { ...(manifest.response as object), byteLength: 1_025 },
    })],
    ["content hash", (manifest: Record<string, unknown>) => ({
      ...manifest,
      response: {
        ...(manifest.response as object),
        contentSha256: SECOND_CONTENT_SHA256,
      },
    })],
  ])("rejects raw-capture %s drift", async (_label, mutateManifest) => {
    const fixture = await materializationFixture();
    const captures = replaceFirstCaptureManifest(fixture, mutateManifest);
    expectMaterializationInvalid({ ...fixture, captures });
  });

  test("rejects catalog owner drift and a forged non-open execution", async () => {
    const fixture = await materializationFixture();
    const captures = [{
      ...fixture.captures[0],
      catalogSource: {
        ...fixture.captures[0]!.catalogSource,
        sourceName: "Conflicting source owner",
      },
    }, ...fixture.captures.slice(1)];
    const forgedPlan = structuredClone(fixture.plan);
    (forgedPlan.sources[0]!.source as { accessMode: string }).accessMode =
      "optional-credentialed";

    expectMaterializationInvalid({ ...fixture, captures });
    expectMaterializationInvalid({ ...fixture, plan: forgedPlan });
  });

  test("rejects unaccepted risk locators and unsupported severity binding", async () => {
    const fixture = await materializationFixture();
    const unknownLocatorReview = reviewedManualSourcesValue(fixture.plan, {
      "official-html": {
        promptInjectionRisk: "suspected",
        injectionRisks: [{
          locator: "html:section=not-reviewed",
          severity: "suspected",
          details: "Not part of the reviewed plan",
        }],
      },
    });
    const wrongSeverityReview = reviewedManualSourcesValue(fixture.plan, {
      "official-html": {
        promptInjectionRisk: "suspected",
        injectionRisks: [{
          locator: "html:section=overview",
          severity: "confirmed",
          details: "Severity does not support the source conclusion",
        }],
      },
    });

    expectMaterializationInvalid({ ...fixture, review: unknownLocatorReview });
    expectMaterializationInvalid({ ...fixture, review: wrongSeverityReview });
  });

  test("rejects catalog-unaccepted paths, owner bypasses, and mixed MIME locators", async () => {
    const fixture = await materializationFixture();
    const unacceptedPath = replaceFirstDocumentPlan(fixture, {
      observations: [
        fixture.documentPlans[0]!.observations[0],
        {
          ...fixture.documentPlans[0]!.observations[1],
          fieldPath: "marketOverview.gdp",
        },
      ],
    });
    const sourceFactEditorialPath = replaceFirstDocumentPlan(fixture, {
      observations: [
        fixture.documentPlans[0]!.observations[0],
        {
          ...fixture.documentPlans[0]!.observations[1],
          fieldPath: "marketOverview.overview",
        },
      ],
    });
    const editorialSourcePath = replaceFirstDocumentPlan(fixture, {
      observations: [
        {
          ...fixture.documentPlans[0]!.observations[0],
          fieldPath: "marketOverview.population",
        },
        fixture.documentPlans[0]!.observations[1],
      ],
    });
    const mixedMime = replaceFirstDocumentPlan(fixture, {
      capture: {
        ...fixture.documentPlans[0]!.capture,
        contentType: "application/pdf",
      },
    });

    expectMaterializationInvalid({ ...fixture, documentPlans: unacceptedPath });
    expectMaterializationInvalid({ ...fixture, documentPlans: sourceFactEditorialPath });
    expectMaterializationInvalid({ ...fixture, documentPlans: editorialSourcePath });
    expectMaterializationInvalid({ ...fixture, documentPlans: mixedMime });
  });

  test("rejects exact-input accessors without executing them", async () => {
    const fixture = await materializationFixture();
    const probe = { executions: 0 };
    const input = { ...fixture } as MutableRecord;
    Object.defineProperty(input, "captures", {
      enumerable: true,
      get() {
        probe.executions += 1;
        return fixture.captures;
      },
    });

    expectMaterializationInvalid(input);
    expect(probe.executions).toBe(0);
  });

  test("returns one stable redacted error without leaking rejected material", async () => {
    const fixture = await materializationFixture();
    const sentinel = "DOCUMENT_MATERIALIZATION_SECRET_MUST_NOT_LEAK";
    const documentPlans = replaceFirstDocumentPlan(fixture, {
      capture: {
        ...fixture.documentPlans[0]!.capture,
        requestUrl: `https://documents.example/${sentinel}`,
      },
    });

    try {
      materializeBasicDocumentEvidence({ ...fixture, documentPlans });
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(MATERIALIZATION_ERROR);
      expect((error as Error).message).not.toContain(sentinel);
    }
  });
});

async function materializationFixture(
  htmlCredibility: "OFFICIAL" | "UNVERIFIED" = "OFFICIAL",
  options: Readonly<{
    plan?: BasicSourceExecutionPlan;
    runId?: string;
  }> = {},
): Promise<MaterializationFixture> {
  const planValue = options.plan ?? materializationPlan(htmlCredibility);
  const runId = options.runId ?? MATERIALIZATION_RUN_ID;
  const root = mkdtempSync(join(tmpdir(), "navigator-document-materialization-"));
  materializationRoots.add(root);
  const run = await runBasicSourceExecutionPlanV2({
    repoRoot: root,
    countryCode: "VN",
    runId,
    plan: planValue,
    transport: materializationTransport(planValue),
  });
  const captures = run.documentCaptures;
  const fixtureBase = {
    plan: planValue,
    captures,
    documentPlans: captures.map(documentObservationPlan),
  };
  return {
    ...fixtureBase,
    review: reviewedManualSources(planValue, {}, runId),
  };
}

function handmadeMaterializationFixture(): MaterializationFixture {
  const planValue = materializationPlan("OFFICIAL");
  const captures = planValue.sources.map(
    (entry, index) => documentCapture(entry, index, planValue),
  );
  return {
    plan: planValue,
    captures,
    documentPlans: captures.map(documentObservationPlan),
    review: reviewedManualSources(planValue),
  };
}

function materializationPlan(
  htmlCredibility: "OFFICIAL" | "UNVERIFIED",
): BasicSourceExecutionPlan {
  return createBasicSourceExecutionPlan({
    catalog: parseBasicSourceCatalog(materializationCatalog(htmlCredibility)),
    countryCode: "VN",
    sourceIds: ["official-html", "official-pdf"],
  });
}

function materializationTransport(
  planValue: BasicSourceExecutionPlan,
): BasicSourceTransportV2 {
  const sourceByUrl = new Map(planValue.sources.map((entry) => [
    entry.request.url,
    entry.source,
  ]));
  return {
    async execute(request) {
      const source = sourceByUrl.get(request.url);
      if (source === undefined) throw new Error("unexpected document request");
      const isHtml = source.format === "html";
      const body = new TextEncoder().encode(
        isHtml ? "<html>reviewed fixture</html>" : "%PDF-1.7\nreviewed fixture",
      );
      return {
        status: 200,
        finalUrl: request.url,
        redirectChain: [],
        contentType: source.accept,
        retrievedAt: isHtml
          ? "2026-07-12T04:00:00.000Z"
          : "2026-07-12T05:00:00.000Z",
        body: documentBytes(body),
      };
    },
  };
}

async function* documentBytes(value: Uint8Array): AsyncIterable<Uint8Array> {
  yield new Uint8Array(value);
}

function materializationCatalog(htmlCredibility: "OFFICIAL" | "UNVERIFIED") {
  return {
    schemaVersion: "basic-source-catalog/v1",
    catalogVersion: "2026.07.12.documents-1",
    sources: [
      materializationCatalogSource({
        sourceId: "official-html",
        sourceName: "Official HTML publication",
        sourceFamily: "government",
        credibility: htmlCredibility,
        format: "html",
        accept: "text/html",
        filename: "official.html",
        fieldPaths: ["country.summary", "marketOverview.population"],
      }),
      materializationCatalogSource({
        sourceId: "official-pdf",
        sourceName: "Official PDF publication",
        sourceFamily: "energy-authority",
        credibility: "VERIFIED",
        format: "pdf",
        accept: "application/pdf",
        filename: "official.pdf",
        fieldPaths: ["marketOverview.gdp", "marketOverview.renewableTarget"],
      }),
      materializationCatalogSource({
        sourceId: "structured-data",
        sourceName: "Structured official data",
        sourceFamily: "official-statistics",
        credibility: "OFFICIAL",
        format: "json",
        accept: "application/json",
        filename: "structured.json",
        fieldPaths: ["country.code"],
        adapterId: "fixture-structured-adapter",
        adapterKind: "deterministic",
      }),
    ],
    countryMappings: [],
  };
}

function materializationCatalogSource(value: {
  readonly sourceId: string;
  readonly sourceName: string;
  readonly sourceFamily: string;
  readonly credibility: string;
  readonly format: string;
  readonly accept: string;
  readonly filename: string;
  readonly fieldPaths: readonly string[];
  readonly adapterId?: string;
  readonly adapterKind?: string;
}) {
  return {
    sourceId: value.sourceId,
    sourceName: value.sourceName,
    sourceFamily: value.sourceFamily,
    credibility: value.credibility,
    format: value.format,
    countryScope: ["VN"],
    requestTemplate: {
      origin: "https://documents.example",
      pathSegments: [
        { kind: "literal", value: "sources" },
        { kind: "placeholder", value: "countryCode" },
        { kind: "literal", value: value.filename },
      ],
      query: [],
    },
    accept: value.accept,
    approvedOrigins: ["https://documents.example"],
    allowedQueryParameters: [],
    accessMode: "open",
    licenseName: "Official public information",
    licenseUrl: "https://documents.example/license",
    attribution: "Official authority",
    refreshCadence: "event-driven",
    adapterId: value.adapterId ?? "basic-manual-document-capture",
    adapterVersion: "1.0.0",
    adapterKind: value.adapterKind ?? "manual-document",
    fieldPaths: Array.from(value.fieldPaths),
  };
}

function documentCapture(
  entry: BasicSourceExecutionPlan["sources"][number],
  index: number,
  planValue: BasicSourceExecutionPlan,
): BasicDocumentCaptureV2 {
  const isHtml = entry.source.format === "html";
  return {
    catalogSource: entry.source,
    manifest: {
      schemaVersion: "basic-country-raw-capture/v2",
      countryCode: "VN",
      runId: "run-20260712",
      catalogVersion: planValue.catalogVersion,
      catalogSha256: planValue.catalogSha256,
      adapterId: entry.source.adapterId,
      adapterVersion: entry.source.adapterVersion,
      sourceId: entry.source.sourceId,
      request: entry.request,
      response: {
        status: 200,
        finalUrl: entry.request.url,
        redirectChain: [],
        contentType: entry.source.accept,
        retrievedAt: isHtml
          ? "2026-07-12T04:00:00.000Z"
          : "2026-07-12T05:00:00.000Z",
        byteLength: (index + 1) * 1_024,
        contentSha256: isHtml ? CONTENT_SHA256 : SECOND_CONTENT_SHA256,
      },
    },
  };
}

function documentObservationPlan(
  captureValue: BasicDocumentCaptureV2,
): BasicDocumentObservationPlan {
  const { catalogSource, manifest } = captureValue;
  const isHtml = catalogSource.format === "html";
  return parseBasicDocumentObservationPlan({
    schemaVersion: "basic-document-observation-plan/v1",
    runId: manifest.runId,
    countryCode: manifest.countryCode,
    catalogVersion: manifest.catalogVersion,
    catalogSha256: manifest.catalogSha256,
    sourceId: catalogSource.sourceId,
    capture: {
      adapterId: manifest.adapterId,
      adapterVersion: manifest.adapterVersion,
      requestUrl: manifest.request.url,
      retrievedAt: manifest.response.retrievedAt,
      contentType: manifest.response.contentType,
      byteLength: manifest.response.byteLength,
      contentSha256: manifest.response.contentSha256,
    },
    observations: isHtml
      ? [
        {
          usage: "editorial-evidence",
          fieldPath: "country.summary",
          locator: "html:section=overview",
          rawValue: "Reviewed country summary",
        },
        {
          usage: "source-fact",
          fieldPath: "marketOverview.population",
          locator: "html:section=population-table;row=2025",
          rawValue: "101598527",
          normalizedValue: 101_598_527,
          unit: "people",
          year: 2025,
          uncertainty: null,
        },
      ]
      : [
        {
          usage: "source-fact",
          fieldPath: "marketOverview.gdp",
          locator: "pdf:page=2#gdp-table",
          rawValue: "476300000000",
          normalizedValue: 476_300_000_000,
          unit: "USD",
          year: 2025,
          uncertainty: null,
        },
        {
          usage: "editorial-evidence",
          fieldPath: "marketOverview.renewableTarget",
          locator: "pdf:page=3#renewable-target",
          rawValue: "Reviewed renewable target",
        },
      ],
  });
}

type ManualReviewOverride = Readonly<{
  sourceCheck?: Readonly<{ status: "passed" | "failed"; notes: string | null }>;
  promptInjectionRisk?: "none" | "suspected" | "confirmed";
  injectionRisks?: readonly Readonly<{
    locator: string;
    severity: "suspected" | "confirmed";
    details: string;
  }>[];
}>;

function reviewedManualSources(
  planValue: BasicSourceExecutionPlan,
  overrides: Readonly<Record<string, ManualReviewOverride>> = {},
  runId = MATERIALIZATION_RUN_ID,
): BasicManualSourceReview {
  return parseBasicManualSourceReview(
    reviewedManualSourcesValue(planValue, overrides, runId),
    reviewExpectation(planValue, runId),
  );
}

function reviewedManualSourcesValue(
  planValue: BasicSourceExecutionPlan,
  overrides: Readonly<Record<string, ManualReviewOverride>> = {},
  runId = MATERIALIZATION_RUN_ID,
): Record<string, unknown> {
  const sources = planValue.sources
    .filter(({ source }) => source.adapterKind === "manual-document")
    .map(({ source }) => {
      const override = overrides[source.sourceId] ?? {};
      const pdf = source.format === "pdf";
      return {
        sourceId: source.sourceId,
        publishedAt: pdf ? null : "2026-07-01T00:00:00.000Z",
        accessNotes: pdf ? null : "Public HTML publication",
        promptInjectionRisk: override.promptInjectionRisk ?? "none",
        sourceCheck: override.sourceCheck ?? (pdf
          ? { status: "passed", notes: "Publication date is not stated" }
          : { status: "passed", notes: null }),
        injectionRisks: override.injectionRisks ?? [],
      };
    });
  return {
    schemaVersion: "basic-manual-source-review/v1",
    runId,
    countryCode: planValue.countryCode,
    catalogVersion: planValue.catalogVersion,
    catalogSha256: planValue.catalogSha256,
    sources,
  };
}

function reviewExpectation(
  planValue: BasicSourceExecutionPlan,
  runId = MATERIALIZATION_RUN_ID,
) {
  return {
    runId,
    countryCode: planValue.countryCode,
    catalogVersion: planValue.catalogVersion,
    catalogSha256: planValue.catalogSha256,
    deterministicSourceIds: planValue.sources
      .filter(({ source }) => source.adapterKind === "deterministic")
      .map(({ source }) => source.sourceId),
    manualSourceIds: planValue.sources
      .filter(({ source }) => source.adapterKind === "manual-document")
      .map(({ source }) => source.sourceId),
  };
}

function replaceFirstCaptureManifest(
  fixture: MaterializationFixture,
  mutate: (manifest: Record<string, unknown>) => Record<string, unknown>,
): readonly BasicDocumentCaptureV2[] {
  const first = fixture.captures[0]!;
  return [{
    catalogSource: first.catalogSource,
    manifest: mutate(structuredClone(first.manifest) as unknown as Record<string, unknown>),
  } as unknown as BasicDocumentCaptureV2, ...fixture.captures.slice(1)];
}

function replaceFirstDocumentPlan(
  fixture: MaterializationFixture,
  overrides: Record<string, unknown>,
): readonly BasicDocumentObservationPlan[] {
  return [{
    ...fixture.documentPlans[0],
    ...overrides,
  } as unknown as BasicDocumentObservationPlan, ...fixture.documentPlans.slice(1)];
}

function expectMaterializationInvalid(value: unknown): void {
  expect(() => materializeBasicDocumentEvidence(
    value as Parameters<typeof materializeBasicDocumentEvidence>[0],
  )).toThrow(MATERIALIZATION_ERROR);
}

function expectDeeplyFrozen(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeeplyFrozen(child);
}
