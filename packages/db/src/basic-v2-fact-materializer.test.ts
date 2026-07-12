import { describe, expect, test } from "vitest";

import {
  classifyBasicV2FieldPath,
} from "./collection/basic-collection-v2-contracts.js";
import {
  materializeBasicSourceFactsV2,
  type BasicSourcedObservationV2,
} from "./collection/basic-v2-fact-materializer.js";

const METHODS = ["deterministic", "manual"] as const;

describe("Basic audit v2 fact materializer", () => {
  test.each(METHODS)(
    "materializes stable fact IDs and field order for %s observations",
    (extractionMethod) => {
      const facts = materializeBasicSourceFactsV2([
        observation({ fieldPath: "marketOverview.population", sourceId: "source-b" }),
        observation({ fieldPath: "country.code", sourceId: "source-a" }),
      ], extractionMethod);

      expect(facts.map(({ factId, fieldPath, extractionMethod: method }) => ({
        factId,
        fieldPath,
        extractionMethod: method,
      }))).toEqual([
        {
          factId: "fact-058b82f953852e90",
          fieldPath: "country.code",
          extractionMethod,
        },
        {
          factId: "fact-23ca2a3293b7ec25",
          fieldPath: "marketOverview.population",
          extractionMethod,
        },
      ]);
    },
  );

  test.each(METHODS)(
    "treats equal normalized tuples as candidates for %s observations",
    (extractionMethod) => {
      const [fact] = materializeBasicSourceFactsV2([
        observation({
          sourceId: "source-a",
          normalizedValue: { values: [1, 2], name: "same" },
        }),
        observation({
          sourceId: "source-b",
          locator: "table:2",
          normalizedValue: { name: "same", values: [1, 2] },
        }),
      ], extractionMethod);

      expect(fact?.status).toBe("candidate");
      expect(fact?.evidence).toHaveLength(2);
    },
  );

  test.each(METHODS)(
    "preserves source conflicts for different tuples with %s observations",
    (extractionMethod) => {
      const [fact] = materializeBasicSourceFactsV2([
        observation({ sourceId: "source-a", normalizedValue: 101 }),
        observation({ sourceId: "source-b", locator: "table:2", normalizedValue: 102 }),
      ], extractionMethod);

      expect(fact?.status).toBe("conflict");
      expect(fact?.evidence).toHaveLength(2);
    },
  );

  test.each(METHODS)(
    "rejects multiple tuples from one source for %s observations",
    (extractionMethod) => {
      expect(() => materializeBasicSourceFactsV2([
        observation({ sourceId: "source-a", normalizedValue: 101 }),
        observation({ sourceId: "source-a", locator: "table:2", normalizedValue: 102 }),
      ], extractionMethod)).toThrow("source fact materialization is invalid");
    },
  );

  test.each(METHODS)(
    "sorts evidence and merges normalized uncertainty for %s observations",
    (extractionMethod) => {
      const [fact] = materializeBasicSourceFactsV2([
        observation({ sourceId: "source-b", locator: "table:2", uncertainty: " range " }),
        observation({ sourceId: "source-a", locator: "table:3", uncertainty: "estimated" }),
        observation({ sourceId: "source-a", locator: "table:1", uncertainty: " estimated " }),
      ], extractionMethod);

      expect(fact?.evidence.map(({ sourceId, locator }) => ({ sourceId, locator }))).toEqual([
        { sourceId: "source-a", locator: "table:1" },
        { sourceId: "source-a", locator: "table:3" },
        { sourceId: "source-b", locator: "table:2" },
      ]);
      expect(fact?.uncertainty).toBe("estimated | range");
    },
  );

  test.each(METHODS)(
    "rejects non-finite JSON values for %s observations",
    (extractionMethod) => {
      expect(() => materializeBasicSourceFactsV2([
        observation({ rawValue: Number.NaN }),
      ], extractionMethod)).toThrow("source fact materialization is invalid");
    },
  );

  test.each(METHODS)(
    "does not retain mutable input values and freezes returned facts for %s observations",
    (extractionMethod) => {
      const rawValue = { nested: [{ value: "original" }] };
      const [fact] = materializeBasicSourceFactsV2([
        observation({ rawValue, normalizedValue: { nested: [1, 2] } }),
      ], extractionMethod);

      rawValue.nested[0]!.value = "changed";
      expect(fact?.evidence[0]?.rawValue).toEqual({ nested: [{ value: "original" }] });
      expect(Object.isFrozen(fact)).toBe(true);
      expect(Object.isFrozen(fact?.evidence)).toBe(true);
      expect(Object.isFrozen(fact?.evidence[0])).toBe(true);
      expect(Object.isFrozen(fact?.evidence[0]?.rawValue as object)).toBe(true);
    },
  );

  test.each(METHODS)(
    "only materializes source-backed and preliminary hybrid-name fields for %s observations",
    (extractionMethod) => {
      expect(materializeBasicSourceFactsV2([
        observation({ fieldPath: "country.name" }),
      ], extractionMethod)).toHaveLength(1);

      for (const fieldPath of [
        "country.summary",
        "marketOverview.source",
        "marketOverview.unknown",
      ]) {
        expect(() => materializeBasicSourceFactsV2([
          observation({ fieldPath }),
        ], extractionMethod)).toThrow("source fact materialization is invalid");
      }
    },
  );

  test.each(METHODS)(
    "reconstructs recursively frozen canonical JSON evidence for %s observations",
    (extractionMethod) => {
      const [fact] = materializeBasicSourceFactsV2([
        observation({
          rawValue: { z: [{ b: 2, a: 1 }], a: true },
          normalizedValue: { z: [{ b: 2, a: 1 }], a: true },
        }),
      ], extractionMethod);

      const rawValue = fact?.evidence[0]?.rawValue;
      expect(rawValue).toEqual({ a: true, z: [{ a: 1, b: 2 }] });
      expect(Object.keys(rawValue as object)).toEqual(["a", "z"]);
      expect(Object.keys((rawValue as { z: object[] }).z[0]!)).toEqual(["a", "b"]);
      expect(Object.isFrozen(rawValue as object)).toBe(true);
      expect(Object.isFrozen((rawValue as { z: object[] }).z)).toBe(true);
      expect(Object.isFrozen((rawValue as { z: object[] }).z[0]!)).toBe(true);
    },
  );

  test.each(METHODS)(
    "rejects non-JSON and descriptor-unsafe evidence values for %s observations",
    (extractionMethod) => {
      const sparse = [1, , 3];
      const accessor: Record<string, unknown> = {};
      Object.defineProperty(accessor, "secret", {
        enumerable: true,
        get: () => "SECRET-accessor-9dd2",
      });
      const cyclic: { self?: unknown } = {};
      cyclic.self = cyclic;

      for (const rawValue of [
        sparse,
        new Date(),
        Symbol("secret-symbol-ec31"),
        accessor,
        new Proxy({ value: 1 }, {}),
        cyclic,
        { value: Number.POSITIVE_INFINITY },
      ]) {
        expect(() => materializeBasicSourceFactsV2([
          observation({ rawValue: rawValue as never }),
        ], extractionMethod)).toThrow("source fact materialization is invalid");
      }
    },
  );

  test.each(METHODS)(
    "snapshots each observation before reading it and never leaks hostile errors for %s observations",
    (extractionMethod) => {
      const secret = "SECRET-observation-516f";
      const accessor = observation();
      Object.defineProperty(accessor, "sourceId", {
        enumerable: true,
        get: () => {
          throw new Error(secret);
        },
      });

      const proxy = new Proxy(observation(), {
        getOwnPropertyDescriptor: () => {
          throw new Error(secret);
        },
      });

      for (const value of [accessor, proxy]) {
        const error = captureMaterializationError(() => materializeBasicSourceFactsV2(
          [value as BasicSourcedObservationV2],
          extractionMethod,
        ));
        expect(error?.message).toBe("source fact materialization is invalid");
        expect(error?.message).not.toContain(secret);
      }
    },
  );

  test("rejects unsupported extraction methods, including hermes", () => {
    expect(() => materializeBasicSourceFactsV2([
      observation(),
    ], "hermes" as never)).toThrow("source fact materialization is invalid");
  });

  test.each([
    ["country.code", "source-backed"],
    ["country.name", "hybrid-name"],
    ["country.summary", "editorial"],
    ["country.region", "editorial"],
    ["country.flagEmoji", "derived"],
    ["country.updatedAt", "derived"],
    ["marketOverview.overview", "editorial"],
    ["marketOverview.population", "source-backed"],
    ["marketOverview.gdp", "source-backed"],
    ["marketOverview.gdpGrowth", "source-backed"],
    ["marketOverview.energyDemand", "editorial"],
    ["marketOverview.renewableTarget", "editorial"],
    ["marketOverview.source", "derived"],
    ["marketOverview.sourceUrl", "derived"],
    ["marketOverview.collectedAt", "derived"],
    ["marketOverview.updatedAt", "derived"],
    ["marketOverview.credibility", "derived"],
    ["marketOverview.countryCode", "derived"],
    ["marketOverview.industryTags", "editorial"],
    ["marketOverview.techTags", "editorial"],
    ["marketOverview.keyIndicators[0].label", "editorial"],
    ["marketOverview.keyIndicators[0].value", "source-backed"],
    ["marketOverview.keyIndicators[0].unit", "source-backed"],
    ["marketOverview.keyIndicators[0].year", "source-backed"],
    ["marketOverview.keyIndicators[17].label", "editorial"],
    ["marketOverview.keyIndicators[17].value", "source-backed"],
    ["marketOverview.keyIndicators[17].unit", "source-backed"],
    ["marketOverview.keyIndicators[17].year", "source-backed"],
    ["marketOverview.keyIndicators[-1].value", null],
    ["marketOverview.keyIndicators[01].value", null],
    ["marketOverview.unknown", null],
  ] as const)("classifies %s as %s", (fieldPath, owner) => {
    expect(classifyBasicV2FieldPath(fieldPath)).toBe(owner);
  });
});

function observation(
  overrides: Partial<BasicSourcedObservationV2> = {},
): BasicSourcedObservationV2 {
  return {
    sourceId: "source-a",
    fieldPath: "marketOverview.population",
    locator: "table:1",
    rawValue: 101,
    normalizedValue: 101,
    unit: "people",
    year: 2025,
    uncertainty: null,
    ...overrides,
  };
}

function captureMaterializationError(action: () => void): Error | null {
  try {
    action();
    return null;
  } catch (error) {
    return error instanceof Error ? error : null;
  }
}
