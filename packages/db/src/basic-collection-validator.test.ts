import { describe, expect, test } from "vitest";

import type {
  BasicCollectionJsonValue,
  BasicFactEvidence,
} from "./collection/basic-collection-contracts.js";
import { createBasicCollectionAuditFixture } from "./basic-collection-test-fixture.js";
import { validateBasicCollectionAuditBundle } from "./collection/basic-collection-validator.js";

describe("Basic collection audit validation", () => {
  test("reconstructs an exact valid audit bundle", () => {
    const bundle = createBasicCollectionAuditFixture();
    const result = validateBasicCollectionAuditBundle(bundle);

    expect(result).toMatchObject({
      valid: true,
      readyForHumanReview: true,
      blockers: [],
    });
    expect(result.data).not.toBeNull();
    if (result.valid) {
      expect(result.data).toEqual(bundle);
      expect(result.data).not.toBe(bundle);
      expect(result.data.sourceRegister).not.toBe(bundle.sourceRegister);
      expect(result.data.extractedFacts.facts[0]).not.toBe(
        bundle.extractedFacts.facts[0],
      );
    }
  });

  test("rejects an extra key on a source record", () => {
    const bundle = createBasicCollectionAuditFixture();
    const source = getFirstSource(bundle);
    Object.assign(source, { unexpected: true });

    expectInvalid(bundle, "sourceRegister.sources[0]");
  });

  test("rejects an inherited evidence record", () => {
    const bundle = createBasicCollectionAuditFixture();
    const inheritedEvidence = Object.create({
      sourceId: "source-1",
      locator: "table 1",
      rawValue: 1,
      normalizedValue: 1,
      unit: null,
      year: 2025,
    }) as unknown as BasicFactEvidence;
    getFirstFact(bundle).evidence = [inheritedEvidence];

    expectInvalid(
      bundle,
      "extractedFacts.facts[0].evidence[0]",
    );
  });

  test("rejects a cyclic rawValue", () => {
    const bundle = createBasicCollectionAuditFixture();
    const cyclicValue: Record<string, unknown> = {};
    cyclicValue.self = cyclicValue;
    getFirstEvidence(bundle).rawValue =
      cyclicValue as unknown as BasicCollectionJsonValue;

    expectInvalid(
      bundle,
      "extractedFacts.facts[0].evidence[0].rawValue",
    );
  });

  test("rejects a bigint normalizedValue", () => {
    const bundle = createBasicCollectionAuditFixture();
    getFirstEvidence(bundle).normalizedValue =
      BigInt(1) as unknown as BasicCollectionJsonValue;

    expectInvalid(
      bundle,
      "extractedFacts.facts[0].evidence[0].normalizedValue",
    );
  });

  test("rejects mismatched runId and countryCode", () => {
    const bundle = createBasicCollectionAuditFixture();
    bundle.extractedFacts.runId = "run-002";
    bundle.marketOverviewDraft.countryCode = "YY";

    expect(() => validateBasicCollectionAuditBundle(bundle)).not.toThrow();
    const result = validateBasicCollectionAuditBundle(bundle);
    expect(result).toMatchObject({ valid: false, data: null });
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "extractedFacts.runId must match runId",
        "marketOverviewDraft.countryCode must match sourceRegister.countryCode",
      ]),
    );
  });

  test.each([
    ["normal", [], true],
    ["missing", ["MISSING_REQUIRED_FACT"], false],
    ["conflict", ["UNRESOLVED_CONFLICT"], false],
    ["untrusted", ["UNTRUSTED_INPUT"], false],
  ] as const)("classifies %s audit input", (scenario, blockers, ready) => {
    const result = validateBasicCollectionAuditBundle(
      createBasicCollectionAuditFixture(scenario),
    );

    expect(result.valid).toBe(true);
    expect(result.blockers).toEqual(blockers);
    expect(result.readyForHumanReview).toBe(ready);
  });
});

function getFirstSource(bundle: ReturnType<typeof createBasicCollectionAuditFixture>) {
  const source = bundle.sourceRegister.sources[0];
  if (source === undefined) {
    throw new Error("fixture source is required");
  }
  return source;
}

function getFirstFact(bundle: ReturnType<typeof createBasicCollectionAuditFixture>) {
  const fact = bundle.extractedFacts.facts[0];
  if (fact === undefined) {
    throw new Error("fixture fact is required");
  }
  return fact;
}

function getFirstEvidence(bundle: ReturnType<typeof createBasicCollectionAuditFixture>) {
  const evidence = getFirstFact(bundle).evidence[0];
  if (evidence === undefined) {
    throw new Error("fixture evidence is required");
  }
  return evidence;
}

function expectInvalid(value: unknown, expectedError: string): void {
  expect(() => validateBasicCollectionAuditBundle(value)).not.toThrow();
  const result = validateBasicCollectionAuditBundle(value);
  expect(result).toMatchObject({ valid: false, data: null });
  expect(result.errors).toEqual(
    expect.arrayContaining([expect.stringContaining(expectedError)]),
  );
}
