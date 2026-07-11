import { describe, expect, test } from "vitest";

import { createBasicCollectionAuditFixture } from "./basic-collection-test-fixture.js";
import type {
  BasicCollectionJsonValue,
  BasicExtractedFact,
  BasicExtractedFacts,
  BasicInjectionRisk,
  BasicSourceCheck,
  BasicSourceRegister,
} from "./collection/basic-collection-contracts.js";
import { preflightBasicOfflineCollection } from "./collection/basic-offline-source-preflight.js";

interface PreflightInput {
  sourceRegister: unknown;
  extractedFacts: unknown;
  sourceChecks: unknown;
  injectionRisks: unknown;
}

describe("Basic offline source preflight", () => {
  test("accepts a complete trusted model-free material snapshot", () => {
    const input = preflightInput();

    const result = preflightBasicOfflineCollection(input);

    expect(result).toEqual({ valid: true, blockers: [], errors: [] });
    expect(input).not.toHaveProperty("marketOverviewDraft");
    expect(input).not.toHaveProperty("model");
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.blockers)).toBe(true);
  });

  test.each([
    ["failed source check", (input: PreflightInput) => {
      input.sourceChecks = [{ sourceId: "source-1", status: "failed", notes: null }, passedCheck("source-2")];
    }, "UNTRUSTED_INPUT"],
    ["injection risk", (input: PreflightInput) => {
      input.injectionRisks = [injectionRisk()];
    }, "UNTRUSTED_INPUT"],
    ["missing fact", (input: PreflightInput) => {
      factAt(input, "marketOverview.gdp").status = "missing";
      factAt(input, "marketOverview.gdp").evidence = [];
    }, "MISSING_REQUIRED_FACT"],
    ["conflict fact", (input: PreflightInput) => makeConflict(input), "UNRESOLVED_CONFLICT"],
  ] as const)("blocks %s without a draft or model", (_name, mutate, blocker) => {
    const input = preflightInput();
    mutate(input);

    expect(preflightBasicOfflineCollection(input)).toMatchObject({
      valid: true,
      blockers: [blocker],
    });
    expect(input).not.toHaveProperty("marketOverviewDraft");
    expect(input).not.toHaveProperty("model");
  });

  test.each([
    ["discoveryOnly", (input: PreflightInput) => { firstSource(input).discoveryOnly = true; }],
    ["UNVERIFIED source", (input: PreflightInput) => { firstSource(input).credibility = "UNVERIFIED"; }],
    ["restricted", (input: PreflightInput) => { firstSource(input).accessStatus = "restricted"; }],
    ["unknown", (input: PreflightInput) => { firstSource(input).accessStatus = "unknown"; }],
    ["prompt risk", (input: PreflightInput) => { firstSource(input).promptInjectionRisk = "suspected"; }],
    ["untrusted fact", (input: PreflightInput) => { factAt(input, "marketOverview.gdp").status = "untrusted"; }],
  ] as const)("blocks unsafe state: %s", (_name, mutate) => {
    const input = preflightInput();
    mutate(input);

    expect(preflightBasicOfflineCollection(input)).toMatchObject({
      valid: true,
      blockers: ["UNTRUSTED_INPUT"],
    });
  });

  test("blocks a candidate credibility value of UNVERIFIED even with otherwise trusted sources", () => {
    const input = preflightInput();
    const fact = factAt(input, "marketOverview.credibility");
    fact.evidence[0]!.normalizedValue = "UNVERIFIED";
    fact.evidence[0]!.rawValue = "UNVERIFIED";

    expect(preflightBasicOfflineCollection(input)).toEqual({
      valid: true,
      blockers: ["UNTRUSTED_INPUT"],
      errors: [],
    });
  });

  test("returns blockers in contract order and without duplicates", () => {
    const input = preflightInput();
    const missing = factAt(input, "marketOverview.gdp");
    missing.status = "missing";
    missing.evidence = [];
    makeConflict(input);
    firstSource(input).credibility = "UNVERIFIED";
    input.injectionRisks = [injectionRisk(), injectionRisk()];

    expect(preflightBasicOfflineCollection(input).blockers).toEqual([
      "MISSING_REQUIRED_FACT",
      "UNRESOLVED_CONFLICT",
      "UNTRUSTED_INPUT",
    ]);
  });

  test.each([
    ["proxy", () => new Proxy(preflightInput(), {})],
    ["accessor", () => {
      const input = preflightInput();
      Object.defineProperty(input, "sourceChecks", { enumerable: true, get: () => [] });
      return input;
    }],
    ["cyclic", () => {
      const input = preflightInput();
      const cycle: Record<string, unknown> = {};
      cycle.self = cycle;
      factAt(input, "marketOverview.gdp").evidence[0]!.rawValue = cycle as BasicCollectionJsonValue;
      return input;
    }],
    ["inherited", () => Object.create(preflightInput())],
    ["symbol key", () => Object.assign(preflightInput(), { [Symbol("hidden")]: true })],
    ["non-finite", () => {
      const input = preflightInput();
      factAt(input, "marketOverview.gdp").evidence[0]!.normalizedValue = Number.NaN;
      return input;
    }],
  ] as const)("fails closed for %s input", (_name, createInput) => {
    expect(() => preflightBasicOfflineCollection(createInput())).not.toThrow();
    expect(preflightBasicOfflineCollection(createInput())).toMatchObject({
      valid: false,
      blockers: [],
      errors: expect.any(Array),
    });
  });

  test("rejects a sparse array without executing an accessor side effect", () => {
    const input = preflightInput();
    let getterCalls = 0;
    const sparseChecks = new Array<unknown>(2);
    Object.defineProperty(sparseChecks, "1", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return passedCheck("source-1");
      },
    });
    input.sourceChecks = sparseChecks;

    expect(0 in sparseChecks).toBe(false);
    expect(preflightBasicOfflineCollection(input)).toEqual({
      valid: false,
      blockers: [],
      errors: ["preflight input must be safely parseable"],
    });
    expect(getterCalls).toBe(0);
  });

  test.each([
    ["duplicate source ID", (input: PreflightInput) => { sourceRegister(input).sources[1]!.sourceId = "source-1"; }],
    ["duplicate fact ID", (input: PreflightInput) => { extractedFacts(input).facts[1]!.factId = extractedFacts(input).facts[0]!.factId; }],
    ["duplicate fact path", (input: PreflightInput) => { extractedFacts(input).facts[1]!.fieldPath = extractedFacts(input).facts[0]!.fieldPath; }],
    ["wrong runId", (input: PreflightInput) => { extractedFacts(input).runId = "run-002"; }],
    ["wrong countryCode", (input: PreflightInput) => { extractedFacts(input).countryCode = "YY"; }],
    ["unknown evidence source", (input: PreflightInput) => { factAt(input, "marketOverview.gdp").evidence[0]!.sourceId = "missing-source"; }],
    ["unknown evidence locator", (input: PreflightInput) => { factAt(input, "marketOverview.gdp").evidence[0]!.locator = "missing locator"; }],
    ["disagreeing candidate tuple", (input: PreflightInput) => {
      const fact = factAt(input, "marketOverview.gdp");
      fact.evidence.push({ ...fact.evidence[0]!, sourceId: "source-2", normalizedValue: 999 });
    }],
    ["partial indicator", (input: PreflightInput) => {
      extractedFacts(input).facts = extractedFacts(input).facts.filter((fact) => fact.fieldPath !== "marketOverview.keyIndicators[0].year");
    }],
    ["non-contiguous indicator", (input: PreflightInput) => {
      for (const fact of extractedFacts(input).facts) fact.fieldPath = fact.fieldPath.replace("keyIndicators[0]", "keyIndicators[1]");
    }],
  ] as const)("rejects structural violation: %s", (_name, mutate) => {
    const input = preflightInput();
    mutate(input);

    const result = preflightBasicOfflineCollection(input);
    expect(result.valid).toBe(false);
    expect(result.blockers).toEqual([]);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test("treats an absent required static path as missing rather than malformed", () => {
    const input = preflightInput();
    extractedFacts(input).facts = extractedFacts(input).facts.filter((fact) => fact.fieldPath !== "marketOverview.gdp");

    expect(preflightBasicOfflineCollection(input)).toEqual({
      valid: true,
      blockers: ["MISSING_REQUIRED_FACT"],
      errors: [],
    });
  });
});

function preflightInput(): PreflightInput {
  const fixture = structuredClone(createBasicCollectionAuditFixture());
  return {
    sourceRegister: fixture.sourceRegister,
    extractedFacts: fixture.extractedFacts,
    sourceChecks: fixture.reviewReport.sourceChecks,
    injectionRisks: fixture.reviewReport.injectionRisks,
  };
}

function sourceRegister(input: PreflightInput): BasicSourceRegister {
  return input.sourceRegister as BasicSourceRegister;
}

function extractedFacts(input: PreflightInput): BasicExtractedFacts {
  return input.extractedFacts as BasicExtractedFacts;
}

function firstSource(input: PreflightInput): BasicSourceRegister["sources"][number] {
  return sourceRegister(input).sources[0]!;
}

function factAt(input: PreflightInput, fieldPath: string): BasicExtractedFact {
  const fact = extractedFacts(input).facts.find((candidate) => candidate.fieldPath === fieldPath);
  if (fact === undefined) throw new Error(`missing fixture fact ${fieldPath}`);
  return fact;
}

function passedCheck(sourceId: string): BasicSourceCheck {
  return { sourceId, status: "passed", notes: null };
}

function injectionRisk(): BasicInjectionRisk {
  return { sourceId: "source-1", locator: "table 1", severity: "suspected", details: "risk" };
}

function makeConflict(input: PreflightInput): void {
  const fact = factAt(input, "marketOverview.gdpGrowth");
  fact.status = "conflict";
  fact.evidence.push({ ...fact.evidence[0]!, sourceId: "source-2", normalizedValue: 7.1 });
}
