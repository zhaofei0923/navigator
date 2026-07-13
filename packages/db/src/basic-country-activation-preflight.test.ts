import { describe, expect, test } from "vitest";

import {
  preflightBasicCountryActivation,
  type BasicActivationCountPort,
  type BasicActivationModel,
  type BasicActivationScope,
} from "./seed/basic-country-activation-preflight.js";

const DEEP_MODELS = [
  "policy",
  "risk",
  "opportunity",
  "project",
  "partner",
  "chineseCompany",
  "entryStrategy",
  "report",
  "knowledgeChunk",
] as const satisfies readonly BasicActivationModel[];
const ALL_MODELS = ["marketOverview", ...DEEP_MODELS] as const;
const QUERY_MATRIX = [
  ...DEEP_MODELS.map((model) => ({ model, scope: "all" as const })),
  ...DEEP_MODELS.map((model) => ({ model, scope: "published" as const })),
  ...ALL_MODELS.map((model) => ({ model, scope: "ai-eligible" as const })),
];

describe("preflightBasicCountryActivation", () => {
  test("passes all-zero counts in the fixed country-generic query order", async () => {
    const fixture = countPort();

    const result = await preflightBasicCountryActivation("VN", fixture.port);

    expect(fixture.calls).toEqual(
      QUERY_MATRIX.map(({ model, scope }) => ({ model, scope, countryCode: "VN" })),
    );
    expect(result).toEqual({
      countryCode: "VN",
      activation: "ready",
      blockerCode: null,
      cleanupRequired: false,
      valid: true,
      errors: [],
      counts: Object.fromEntries(
        QUERY_MATRIX.map(({ model, scope }) => [key(model, scope), 0]),
      ),
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.errors)).toBe(true);
    expect(Object.isFrozen(result.counts)).toBe(true);
  });

  test.each(DEEP_MODELS)("blocks when %s has legacy rows", async (model) => {
    const countKey = key(model, "all");
    const result = await preflightBasicCountryActivation(
      "VN",
      countPort({ [countKey]: 1 }).port,
    );

    expect(result).toMatchObject({
      activation: "blocked",
      blockerCode: "LEGACY_COUNTRY_DATA_PRESENT",
      cleanupRequired: true,
      valid: true,
    });
    expect(result.counts?.[countKey]).toBe(1);
  });

  test.each(DEEP_MODELS)(
    "blocks when %s has a published non-market row",
    async (model) => {
      const countKey = key(model, "published");
      const result = await preflightBasicCountryActivation(
        "VN",
        countPort({ [countKey]: 1 }).port,
      );

      expect(result.blockerCode).toBe("LEGACY_COUNTRY_DATA_PRESENT");
      expect(result.counts?.[countKey]).toBe(1);
    },
  );

  test.each(ALL_MODELS)("blocks when %s has an AI-eligible row", async (model) => {
    const countKey = key(model, "ai-eligible");
    const result = await preflightBasicCountryActivation(
      "VN",
      countPort({ [countKey]: 1 }).port,
    );

    expect(result.blockerCode).toBe("LEGACY_COUNTRY_DATA_PRESENT");
    expect(result.counts?.[countKey]).toBe(1);
  });

  test.each(["", "V", "VNM", "vn", "V1", " V"])(
    "fails closed without querying invalid ISO2 %j",
    async (countryCode) => {
      const fixture = countPort();
      const result = await preflightBasicCountryActivation(countryCode, fixture.port);

      expect(fixture.calls).toEqual([]);
      expect(result).toEqual({
        countryCode,
        activation: "blocked",
        blockerCode: "PREFLIGHT_QUERY_FAILED",
        cleanupRequired: false,
        valid: false,
        errors: ["INVALID_COUNTRY_CODE"],
        counts: null,
      });
    },
  );

  test("fails closed and redacts partial counts and query errors", async () => {
    const fixture = countPort({}, key("project", "published"));

    const result = await preflightBasicCountryActivation("VN", fixture.port);

    expect(result).toEqual({
      countryCode: "VN",
      activation: "blocked",
      blockerCode: "PREFLIGHT_QUERY_FAILED",
      cleanupRequired: false,
      valid: false,
      errors: ["COUNT_QUERY_FAILED"],
      counts: null,
    });
    expect(JSON.stringify(result)).not.toContain("sensitive datastore failure");
  });

  test.each([
    Number.NaN,
    -1,
    0.5,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
    "0",
    { count: 0 },
  ])("fails closed for invalid runtime count %j", async (invalidValue) => {
    let calls = 0;
    const port: BasicActivationCountPort = {
      async count() {
        calls += 1;
        return (calls === 4 ? invalidValue : 0) as number;
      },
    };

    const result = await preflightBasicCountryActivation("VN", port);

    expect(calls).toBe(4);
    expect(result).toMatchObject({
      blockerCode: "PREFLIGHT_QUERY_FAILED",
      valid: false,
      counts: null,
    });
  });

  test("returns only frozen aggregate fields and no record content", async () => {
    const result = await preflightBasicCountryActivation(
      "VN",
      countPort({ [key("risk", "all")]: 3 }).port,
    );
    const serialized = JSON.stringify(result);

    expect(Object.keys(result).sort()).toEqual([
      "activation",
      "blockerCode",
      "cleanupRequired",
      "countryCode",
      "counts",
      "errors",
      "valid",
    ]);
    expect(serialized).not.toMatch(/records|sourceUrl|evidence/i);
    expect(serialized).not.toMatch(/Indonesia|OPS-DATA-ID-BASIC-CLEANUP/i);
  });
});

function key(model: BasicActivationModel, scope: BasicActivationScope): string {
  return `${model}:${scope}`;
}

function countPort(
  counts: Readonly<Record<string, number>> = {},
  rejectedKey: string | null = null,
) {
  const calls: Array<{
    model: BasicActivationModel;
    scope: BasicActivationScope;
    countryCode: string;
  }> = [];
  const port: BasicActivationCountPort = {
    async count(model, scope, countryCode) {
      calls.push({ model, scope, countryCode });
      if (key(model, scope) === rejectedKey) {
        throw new Error("sensitive datastore failure");
      }
      return counts[key(model, scope)] ?? 0;
    },
  };
  return { calls, port };
}
