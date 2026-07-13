import { describe, expect, test } from "vitest";

import { createBasicCollectionAuditFixture } from "./basic-collection-test-fixture.js";
import type {
  BasicCollectionJsonValue,
  BasicInjectionRisk,
  BasicSourceCheck,
} from "./collection/basic-collection-contracts.js";
import {
  BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION,
  classifyBasicV2FieldPath,
} from "./collection/basic-collection-v2-contracts.js";
import { preflightBasicDeterministicCollection } from "./collection/basic-deterministic-source-preflight.js";

interface PreflightInput {
  sourceRegister: unknown;
  extractedFacts: unknown;
  sourceChecks: unknown;
  injectionRisks: unknown;
  catalogVersion: unknown;
  catalogSha256: unknown;
}

interface MutableEvidence {
  sourceId: string;
  locator: string;
  rawValue: BasicCollectionJsonValue;
  normalizedValue: BasicCollectionJsonValue;
  unit: string | null;
  year: number | null;
}

interface MutableFact {
  factId: string;
  fieldPath: string;
  status: "candidate" | "missing" | "conflict" | "untrusted";
  evidence: MutableEvidence[];
  extractionMethod: string;
  uncertainty: string | null;
}

interface MutableSource {
  sourceId: string;
  sourceName: string;
  sourceUrl: string;
  retrievedAt: string;
  publishedAt: string | null;
  contentSha256: string;
  evidenceLocators: string[];
  sourceFamily: string;
  accessStatus: string;
  accessNotes: string | null;
  credibility: string;
  discoveryOnly: boolean;
  promptInjectionRisk: string;
}

interface MutableSourceRegister {
  schemaVersion: string;
  runId: string;
  countryCode: string;
  catalogVersion: string;
  catalogSha256: string;
  sources: MutableSource[];
}

interface MutableExtractedFacts {
  schemaVersion: string;
  runId: string;
  countryCode: string;
  facts: MutableFact[];
}

describe("Basic deterministic source preflight", () => {
  test("accepts a complete trusted canonical v2 candidate snapshot", () => {
    const input = preflightInput();

    const result = preflightBasicDeterministicCollection(input);

    expect(result).toEqual({ valid: true, blockers: [], errors: [] });
    expectRecursivelyFrozen(result);
  });

  test.each([
    ["missing static fact", (input: PreflightInput) => removeFact(input, "marketOverview.gdp")],
    ["missing-status fact", (input: PreflightInput) => {
      const fact = factAt(input, "marketOverview.gdp");
      fact.status = "missing";
      fact.evidence = [];
    }],
    ["zero indicators", (input: PreflightInput) => {
      facts(input).facts = facts(input).facts.filter(
        (fact: { fieldPath: string }) => !fact.fieldPath.startsWith("marketOverview.keyIndicators["),
      );
    }],
    ["incomplete indicator", (input: PreflightInput) =>
      removeFact(input, "marketOverview.keyIndicators[0].year")],
    ["non-contiguous indicators", (input: PreflightInput) => {
      for (const fact of facts(input).facts) {
        fact.fieldPath = fact.fieldPath.replace("keyIndicators[0]", "keyIndicators[1]");
      }
      sortFacts(input);
    }],
  ] as const)("returns MISSING_REQUIRED_FACT for %s", (_name, mutate) => {
    const input = preflightInput();
    mutate(input);

    expect(preflightBasicDeterministicCollection(input)).toEqual({
      valid: true,
      blockers: ["MISSING_REQUIRED_FACT"],
      errors: [],
    });
  });

  test("returns all material blockers in canonical order", () => {
    const input = preflightInput();
    removeFact(input, "marketOverview.gdp");
    const conflict = factAt(input, "marketOverview.gdpGrowth");
    conflict.status = "conflict";
    conflict.evidence.push({ ...conflict.evidence[0]!, sourceId: "source-2", normalizedValue: 7.1 });
    firstSource(input).credibility = "UNVERIFIED";

    expect(preflightBasicDeterministicCollection(input)).toEqual({
      valid: true,
      blockers: [
        "MISSING_REQUIRED_FACT",
        "UNRESOLVED_CONFLICT",
        "UNTRUSTED_INPUT",
      ],
      errors: [],
    });
  });

  test.each([
    ["failed source check", (input: PreflightInput) => {
      checks(input)[0]!.status = "failed";
    }],
    ["missing registered source check", (input: PreflightInput) => {
      input.sourceChecks = checks(input).filter((check) => check.sourceId !== "source-2");
    }],
    ["restricted source", (input: PreflightInput) => { firstSource(input).accessStatus = "restricted"; }],
    ["UNVERIFIED source", (input: PreflightInput) => { firstSource(input).credibility = "UNVERIFIED"; }],
    ["discovery source", (input: PreflightInput) => { firstSource(input).discoveryOnly = true; }],
    ["source prompt-injection risk", (input: PreflightInput) => { firstSource(input).promptInjectionRisk = "suspected"; }],
    ["reviewed injection risk", (input: PreflightInput) => {
      input.injectionRisks = [injectionRisk("source-1", "page 1", "suspected")];
    }],
    ["untrusted fact", (input: PreflightInput) => { factAt(input, "marketOverview.gdp").status = "untrusted"; }],
    ["UNVERIFIED candidate credibility", (input: PreflightInput) => {
      factAt(input, "marketOverview.credibility").evidence[0]!.normalizedValue = "UNVERIFIED";
    }],
  ] as const)("returns UNTRUSTED_INPUT for %s", (_name, mutate) => {
    const input = preflightInput();
    mutate(input);

    expect(preflightBasicDeterministicCollection(input)).toEqual({
      valid: true,
      blockers: ["UNTRUSTED_INPUT"],
      errors: [],
    });
  });

  test.each([
    ["source order", (input: PreflightInput) => sources(input).reverse(), "sourceRegister.sources"],
    ["fact order", (input: PreflightInput) => facts(input).facts.reverse(), "extractedFacts.facts"],
    ["duplicate fact path", (input: PreflightInput) => {
      facts(input).facts[1]!.fieldPath = facts(input).facts[0]!.fieldPath;
      sortFacts(input);
    }, "fieldPath duplicates"],
    ["source-check order", (input: PreflightInput) => checks(input).reverse(), "sourceChecks must be sorted"],
    ["duplicate source check", (input: PreflightInput) => {
      checks(input).push({ ...checks(input)[0]! });
      sortChecks(input);
    }, "sourceChecks[1].sourceId duplicates sourceChecks[0].sourceId"],
    ["injection-risk order", (input: PreflightInput) => {
      input.injectionRisks = [
        injectionRisk("source-2", "table 1", "confirmed"),
        injectionRisk("source-1", "page 1", "suspected"),
      ];
    }, "injectionRisks must be sorted"],
    ["duplicate injection risk", (input: PreflightInput) => {
      const risk = injectionRisk("source-1", "page 1", "suspected");
      input.injectionRisks = [risk, { ...risk }];
    }, "injectionRisks[1] duplicates injectionRisks[0]"],
    ["unknown evidence source", (input: PreflightInput) => {
      factAt(input, "marketOverview.gdp").evidence[0]!.sourceId = "not-registered";
    }, "evidence[0].sourceId"],
    ["unknown evidence locator", (input: PreflightInput) => {
      factAt(input, "marketOverview.gdp").evidence[0]!.locator = "not-registered";
    }, "evidence[0].locator"],
    ["unknown source check", (input: PreflightInput) => {
      checks(input)[0]!.sourceId = "not-registered";
      sortChecks(input);
    }, "sourceChecks[0].sourceId"],
    ["unknown injection-risk locator", (input: PreflightInput) => {
      input.injectionRisks = [injectionRisk("source-1", "not-registered", "suspected")];
    }, "injectionRisks[0].locator"],
    ["disagreeing candidate evidence", (input: PreflightInput) => {
      const fact = factAt(input, "marketOverview.gdp");
      fact.evidence.push({ ...fact.evidence[0]!, sourceId: "source-2", normalizedValue: 7.1 });
    }, "normalizedValue must deeply equal the candidate value"],
  ] as const)("rejects structural %s without blockers", (_name, mutate, error) => {
    const input = preflightInput();
    mutate(input);

    const result = preflightBasicDeterministicCollection(input);

    expect(result).toMatchObject({ valid: false, blockers: [] });
    expect(result.errors.join("\n")).toContain(error);
  });

  test.each([
    ["register schema", (input: PreflightInput) => {
      sourceRegister(input).schemaVersion = "basic-country-audit/v1";
    }, "sourceRegister.schemaVersion"],
    ["fact identity", (input: PreflightInput) => {
      facts(input).runId = "run-002";
    }, "extractedFacts.runId must match runId"],
    ["catalog version", (input: PreflightInput) => { input.catalogVersion = "catalog-v2"; }, "catalogVersion must match sourceRegister.catalogVersion"],
    ["catalog SHA", (input: PreflightInput) => {
      input.catalogSha256 = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
    }, "catalogSha256 must match sourceRegister.catalogSha256"],
  ] as const)("rejects exact v2 %s mismatch", (_name, mutate, error) => {
    const input = preflightInput();
    mutate(input);

    const result = preflightBasicDeterministicCollection(input);
    expect(result).toMatchObject({ valid: false, blockers: [] });
    expect(result.errors.join("\n")).toContain(error);
  });

  test("uses the v2 ownership validator before deriving material blockers", () => {
    const input = preflightInput();
    factAt(input, "marketOverview.source").extractionMethod = "manual";
    removeFact(input, "marketOverview.population");

    const result = preflightBasicDeterministicCollection(input);

    expect(result).toMatchObject({ valid: false, blockers: [] });
    expect(result.errors.join("\n")).toContain("extractionMethod is not allowed");
  });

  test.each([
    ["proxy", () => new Proxy(preflightInput(), {})],
    ["accessor", () => {
      const input = preflightInput();
      Object.defineProperty(input, "sourceChecks", { enumerable: true, get: () => [] });
      return input;
    }],
    ["inherited", () => Object.create(preflightInput())],
    ["symbol", () => Object.assign(preflightInput(), { [Symbol("secret")]: true })],
    ["non-finite", () => {
      const input = preflightInput();
      factAt(input, "marketOverview.gdp").evidence[0]!.rawValue = Number.NaN;
      return input;
    }],
  ] as const)("fails closed for hostile %s input", (_name, createInput) => {
    const secret = "SECRET-token-cookie-url-raw";
    const result = preflightBasicDeterministicCollection(createInput());

    expect(result).toMatchObject({ valid: false, blockers: [], errors: expect.any(Array) });
    expect(result.errors.join("\n")).not.toContain(secret);
  });

  test("rejects sparse arrays without executing a getter", () => {
    const input = preflightInput();
    let getterCalls = 0;
    const sparse = new Array<unknown>(2);
    Object.defineProperty(sparse, "1", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return { sourceId: "source-1", status: "passed", notes: null };
      },
    });
    input.sourceChecks = sparse;

    expect(preflightBasicDeterministicCollection(input)).toEqual({
      valid: false,
      blockers: [],
      errors: ["preflight input must be a bounded JSON value"],
    });
    expect(getterCalls).toBe(0);
  });
});

function preflightInput(): PreflightInput {
  const bundle = structuredClone(createBasicCollectionAuditFixture()) as unknown as Record<string, unknown>;
  const sourceRegister = bundle.sourceRegister as unknown as MutableSourceRegister;
  const extractedFacts = bundle.extractedFacts as unknown as MutableExtractedFacts;
  sourceRegister.schemaVersion = BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION;
  sourceRegister.catalogVersion = "catalog-v1";
  sourceRegister.catalogSha256 =
    "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
  extractedFacts.schemaVersion = BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION;
  for (const fact of extractedFacts.facts) {
    const owner = classifyBasicV2FieldPath(fact.fieldPath as string);
    fact.extractionMethod = owner === "source-backed" || owner === "derived"
      ? "deterministic"
      : "manual";
  }
  extractedFacts.facts.sort((left, right) => compareText(
    left.fieldPath as string,
    right.fieldPath as string,
  ));
  const reviewReport = bundle.reviewReport as Record<string, unknown>;
  const sourceChecks = structuredClone(reviewReport.sourceChecks) as BasicSourceCheck[];
  sourceChecks.sort((left, right) => compareText(left.sourceId, right.sourceId));
  return {
    sourceRegister,
    extractedFacts,
    sourceChecks,
    injectionRisks: [],
    catalogVersion: sourceRegister.catalogVersion,
    catalogSha256: sourceRegister.catalogSha256,
  };
}

function sourceRegister(input: PreflightInput): MutableSourceRegister {
  return input.sourceRegister as MutableSourceRegister;
}

function facts(input: PreflightInput): MutableExtractedFacts {
  return input.extractedFacts as MutableExtractedFacts;
}

function sources(input: PreflightInput): MutableSource[] {
  return sourceRegister(input).sources;
}

function firstSource(input: PreflightInput): MutableSource {
  const source = sources(input)[0];
  if (source === undefined) throw new Error("fixture source is required");
  return source;
}

function checks(input: PreflightInput): BasicSourceCheck[] {
  return input.sourceChecks as BasicSourceCheck[];
}

function factAt(input: PreflightInput, fieldPath: string): MutableFact {
  const fact = facts(input).facts.find((candidate) => candidate.fieldPath === fieldPath);
  if (fact === undefined) throw new Error(`fixture fact missing for ${fieldPath}`);
  return fact;
}

function removeFact(input: PreflightInput, fieldPath: string): void {
  facts(input).facts = facts(input).facts.filter((fact) => fact.fieldPath !== fieldPath);
}

function sortFacts(input: PreflightInput): void {
  facts(input).facts.sort((left, right) => compareText(
    left.fieldPath as string,
    right.fieldPath as string,
  ));
}

function sortChecks(input: PreflightInput): void {
  checks(input).sort((left, right) => compareText(left.sourceId, right.sourceId));
}

function injectionRisk(
  sourceId: string,
  locator: string,
  severity: BasicInjectionRisk["severity"],
): BasicInjectionRisk {
  return { sourceId, locator, severity, details: "reviewed risk" };
}

function expectRecursivelyFrozen(value: object): void {
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) {
    if (child !== null && typeof child === "object") expectRecursivelyFrozen(child);
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

void (null as BasicCollectionJsonValue | null);
