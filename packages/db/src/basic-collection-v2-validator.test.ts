import { describe, expect, test } from "vitest";

import { createBasicCollectionAuditFixture } from "./basic-collection-test-fixture.js";
import {
  BASIC_COLLECTION_REQUIRED_STATIC_FACT_PATHS,
  type BasicCollectionAuditBundle,
  type BasicCollectionJsonValue,
} from "./collection/basic-collection-contracts.js";
import {
  BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION,
  classifyBasicV2FieldPath,
  type BasicExtractedFactV2,
} from "./collection/basic-collection-v2-contracts.js";
import { validateBasicV2FactOwnership } from "./collection/basic-v2-fact-ownership.js";
import { validateBasicCollectionAuditBundleV2 } from "./collection/basic-collection-v2-validator.js";

const INDICATOR_PATHS = [
  "marketOverview.keyIndicators[0].label",
  "marketOverview.keyIndicators[0].value",
  "marketOverview.keyIndicators[0].unit",
  "marketOverview.keyIndicators[0].year",
] as const;
const ALL_PATHS = [...BASIC_COLLECTION_REQUIRED_STATIC_FACT_PATHS, ...INDICATOR_PATHS];

describe("Basic collection audit v2 validation", () => {
  test("validates complete ready v2 material as a frozen detached snapshot", () => {
    const bundle = createV2Bundle();
    const result = validateBasicCollectionAuditBundleV2(bundle);

    expect(result).toMatchObject({
      valid: true,
      readyForHumanReview: true,
      blockers: [],
    });
    if (!result.valid) return;
    expect(result.data).toEqual(bundle);
    expect(result.data).not.toBe(bundle);
    expect(Object.isFrozen(result)).toBe(true);
    expectRecursivelyFrozen(result.data);
  });

  test.each(ALL_PATHS)("rejects the wrong final extraction method for %s", (fieldPath) => {
    const bundle = createV2Bundle();
    const fact = factAt(bundle, fieldPath);
    const owner = classifyBasicV2FieldPath(fieldPath);
    fact.extractionMethod = (
      owner === "source-backed"
        ? "hermes"
        : owner === "derived"
          ? "manual"
          : "deterministic"
    ) as never;

    const errors = validateBasicV2FactOwnership([
      fact as unknown as BasicExtractedFactV2,
    ]);
    expect(errors).toEqual([
      expect.stringContaining(fieldPath),
    ]);
    expectInvalid(bundle, "extractionMethod");
  });

  test("rejects deterministic/manual collisions on one final path", () => {
    const bundle = createV2Bundle();
    const duplicate = structuredClone(factAt(bundle, "marketOverview.population"));
    duplicate.factId = "manual-collision";
    duplicate.extractionMethod = "manual";
    bundle.extractedFacts.facts.push(duplicate);

    expectInvalid(bundle, "deterministic and manual");
  });

  test.each([
    ["zero indicators", (bundle: MutableV2Bundle) => {
      bundle.marketOverviewDraft.keyIndicators = [];
      bundle.extractedFacts.facts = bundle.extractedFacts.facts.filter(
        ({ fieldPath }) => !fieldPath.startsWith("marketOverview.keyIndicators["),
      );
    }],
    ["incomplete index zero", (bundle: MutableV2Bundle) => {
      bundle.extractedFacts.facts = bundle.extractedFacts.facts.filter(
        ({ fieldPath }) => fieldPath !== "marketOverview.keyIndicators[0].year",
      );
    }],
    ["gapped indices", (bundle: MutableV2Bundle) => {
      addIndicator(bundle, 2);
    }],
  ])("rejects invalid indicator coverage: %s", (_name, mutate) => {
    const bundle = createV2Bundle();
    mutate(bundle);
    expectInvalid(bundle, "indicator");
  });

  test("keeps v1 zero-indicator validation behavior unchanged", () => {
    const legacy = createBasicCollectionAuditFixture();
    legacy.marketOverviewDraft.keyIndicators = [];
    legacy.extractedFacts.facts = legacy.extractedFacts.facts.filter(
      ({ fieldPath }) => !fieldPath.startsWith("marketOverview.keyIndicators["),
    );

    const result = validateBasicCollectionAuditBundleV2(legacy);
    expect(result.valid).toBe(false);
  });

  test.each([
    ["orphan source", (bundle: MutableV2Bundle) => {
      factAt(bundle, "marketOverview.gdp").evidence[0]!.sourceId = "missing";
    }, "registered sourceId"],
    ["missing derived locator", (bundle: MutableV2Bundle) => {
      factAt(bundle, "marketOverview.source").evidence[0]!.locator = "metadata:/missing";
    }, "registered evidenceLocator"],
    ["draft mismatch", (bundle: MutableV2Bundle) => {
      factAt(bundle, "marketOverview.gdp").evidence[0]!.normalizedValue = 1;
    }, "deeply equal"],
    ["country identity mismatch", (bundle: MutableV2Bundle) => {
      bundle.marketOverviewDraft.countryCode = "YY";
    }, "sourceRegister.countryCode"],
    ["missing source check", (bundle: MutableV2Bundle) => {
      bundle.reviewReport.sourceChecks = [];
      blockReport(bundle);
    }, ""],
    ["unsafe source", (bundle: MutableV2Bundle) => {
      bundle.sourceRegister.sources[0]!.promptInjectionRisk = "suspected";
      blockReport(bundle);
    }, ""],
    ["injection risk", (bundle: MutableV2Bundle) => {
      bundle.reviewReport.injectionRisks = [{
        sourceId: "source-1",
        locator: "table 1",
        severity: "suspected",
        details: "review required",
      }];
      blockReport(bundle);
    }, ""],
  ] as const)("handles trust and relation case: %s", (_name, mutate, error) => {
    const bundle = createV2Bundle();
    mutate(bundle);
    const result = validateBasicCollectionAuditBundleV2(bundle);
    if (error === "") {
      expect(result).toMatchObject({
        valid: true,
        readyForHumanReview: false,
        blockers: ["UNTRUSTED_INPUT"],
      });
    } else {
      expectInvalid(bundle, error);
    }
  });

  test("derives blockers and rejects review state that contradicts material", () => {
    const bundle = createV2Bundle();
    const missing = factAt(bundle, "marketOverview.gdp");
    missing.status = "missing";
    missing.evidence = [];
    bundle.reviewReport.missingFields = ["marketOverview.gdp"];

    expectInvalid(bundle, "reviewReport.status must be blocked");

    blockReport(bundle);
    expect(validateBasicCollectionAuditBundleV2(bundle)).toMatchObject({
      valid: true,
      blockers: ["MISSING_REQUIRED_FACT"],
      readyForHumanReview: false,
    });
  });

  test("rejects unsorted report collections and a non-null human decision", () => {
    const unsorted = createV2Bundle();
    unsorted.reviewReport.sourceChecks.reverse();
    expectInvalid(unsorted, "sourceChecks must be sorted");

    const decided = createV2Bundle();
    decided.reviewReport.humanDecision = {
      decision: "approved",
      reviewerId: "reviewer",
      decidedAt: "2026-07-10T00:00:00Z",
      notes: "approved",
    };
    expectInvalid(decided, "humanDecision must be null");
  });

  test("rejects mixed v1 and v2 envelopes in every in-memory permutation", () => {
    for (let mask = 1; mask < 7; mask += 1) {
      const bundle = createV2Bundle();
      if ((mask & 1) !== 0) bundle.sourceRegister.schemaVersion = "basic-country-audit/v1" as never;
      if ((mask & 2) !== 0) bundle.extractedFacts.schemaVersion = "basic-country-audit/v1" as never;
      if ((mask & 4) !== 0) bundle.reviewReport.schemaVersion = "basic-country-audit/v1" as never;
      expect(validateBasicCollectionAuditBundleV2(bundle).valid).toBe(false);
    }
  });
});

type MutableV2Bundle = ReturnType<typeof createMutableV2Bundle>;

function createV2Bundle() {
  return createMutableV2Bundle();
}

function createMutableV2Bundle() {
  const bundle = structuredClone(createBasicCollectionAuditFixture()) as unknown as Omit<
    BasicCollectionAuditBundle,
    "sourceRegister" | "extractedFacts" | "reviewReport"
  > & {
    sourceRegister: Omit<BasicCollectionAuditBundle["sourceRegister"], "schemaVersion"> & {
      schemaVersion: typeof BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION;
      catalogVersion: string;
      catalogSha256: string;
    };
    extractedFacts: Omit<BasicCollectionAuditBundle["extractedFacts"], "schemaVersion"> & {
      schemaVersion: typeof BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION;
    };
    reviewReport: Omit<BasicCollectionAuditBundle["reviewReport"], "schemaVersion"> & {
      schemaVersion: typeof BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION;
    };
  };
  bundle.sourceRegister.schemaVersion = BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION;
  bundle.sourceRegister.catalogVersion = "catalog-v1";
  bundle.sourceRegister.catalogSha256 =
    "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
  bundle.extractedFacts.schemaVersion = BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION;
  bundle.reviewReport.schemaVersion = BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION;
  bundle.reviewReport.sourceChecks.sort((left, right) => left.sourceId.localeCompare(right.sourceId));
  for (const fact of bundle.extractedFacts.facts) {
    const owner = classifyBasicV2FieldPath(fact.fieldPath);
    fact.extractionMethod = owner === "source-backed" || owner === "derived"
      ? "deterministic"
      : "manual";
  }
  return bundle;
}

function factAt(bundle: MutableV2Bundle, fieldPath: string) {
  const fact = bundle.extractedFacts.facts.find((item) => item.fieldPath === fieldPath);
  if (fact === undefined) throw new Error(`missing fixture fact ${fieldPath}`);
  return fact;
}

function addIndicator(bundle: MutableV2Bundle, index: number): void {
  for (const [key, normalizedValue] of [
    ["label", { zh: "指标", en: "Indicator" }],
    ["value", "1"],
    ["unit", "GW"],
    ["year", 2026],
  ] as const satisfies ReadonlyArray<readonly [string, BasicCollectionJsonValue]>) {
    bundle.extractedFacts.facts.push({
      factId: `indicator-${index}-${key}`,
      fieldPath: `marketOverview.keyIndicators[${index}].${key}`,
      status: "candidate",
      evidence: [{
        sourceId: "source-1",
        locator: "table 1",
        rawValue: normalizedValue,
        normalizedValue,
        unit: null,
        year: null,
      }],
      extractionMethod: key === "label" ? "manual" : "deterministic",
      uncertainty: null,
    });
  }
}

function blockReport(bundle: MutableV2Bundle): void {
  bundle.reviewReport.status = "blocked";
  bundle.reviewReport.publicationRecommendation = "do-not-publish";
}

function expectInvalid(value: unknown, error: string): void {
  expect(() => validateBasicCollectionAuditBundleV2(value)).not.toThrow();
  const result = validateBasicCollectionAuditBundleV2(value);
  expect(result).toMatchObject({ valid: false, data: null });
  expect(result.errors).toEqual(expect.arrayContaining([
    expect.stringContaining(error),
  ]));
}

function expectRecursivelyFrozen(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectRecursivelyFrozen(child);
}
