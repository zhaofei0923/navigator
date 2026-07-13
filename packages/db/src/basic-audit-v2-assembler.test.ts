import { describe, expect, test } from "vitest";

import { createBasicCollectionAuditV2Fixture } from "./basic-collection-test-fixture.js";
import {
  BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION,
  type BasicCollectionAuditBundleV2,
  type BasicCollectionAuditAssemblyInputV2,
} from "./collection/basic-collection-v2-contracts.js";
import { assembleBasicCollectionAuditBundleV2 } from "./collection/basic-audit-v2-assembler.js";
import { validateBasicCollectionAuditBundleV2 } from "./collection/basic-collection-v2-validator.js";

describe("Basic audit v2 assembler", () => {
  test("assembles ready material with sorted derived review state", () => {
    const input = assemblyInput();
    input.sourceChecks.reverse();

    const bundle = assemble(input);

    expect(bundle.reviewReport).toEqual({
      schemaVersion: BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION,
      runId: input.runId,
      countryCode: input.sourceRegister.countryCode,
      status: "ready-for-human-review",
      missingFields: [],
      conflicts: [],
      sourceChecks: [
        { sourceId: "source-1", status: "passed", notes: null },
        { sourceId: "source-2", status: "passed", notes: null },
      ],
      injectionRisks: [],
      publicationRecommendation: "request-human-review",
      humanDecision: null,
    });
    expect(validateBasicCollectionAuditBundleV2(bundle)).toMatchObject({
      valid: true,
      blockers: [],
      readyForHumanReview: true,
    });
  });

  test("derives sorted missing fields, conflicts, blockers, and blocked recommendation", () => {
    const input = assemblyInput();
    const missing = factAt(input, "marketOverview.gdp");
    missing.status = "missing";
    missing.evidence = [];
    input.extractedFacts.facts = input.extractedFacts.facts.filter(
      ({ fieldPath }) => fieldPath !== "country.summary",
    );
    const conflict = factAt(input, "marketOverview.gdpGrowth");
    conflict.status = "conflict";
    conflict.evidence.push({
      ...structuredClone(conflict.evidence[0]!),
      sourceId: "source-2",
      normalizedValue: 99,
    });
    input.sourceChecks = [];

    const bundle = assemble(input);

    expect(bundle.reviewReport).toMatchObject({
      status: "blocked",
      missingFields: ["country.summary", "marketOverview.gdp"],
      conflicts: [{
        fieldPath: "marketOverview.gdpGrowth",
        factIds: [conflict.factId],
        resolution: "unresolved",
      }],
      publicationRecommendation: "do-not-publish",
      humanDecision: null,
    });
    expect(validateBasicCollectionAuditBundleV2(bundle)).toMatchObject({
      valid: true,
      blockers: [
        "MISSING_REQUIRED_FACT",
        "UNRESOLVED_CONFLICT",
        "UNTRUSTED_INPUT",
      ],
      readyForHumanReview: false,
    });
  });

  test("verifies candidate catalog identity against the source register", () => {
    const version = assemblyInput();
    version.catalogVersion = "catalog-other";
    expectFixedError(version);

    const digest = assemblyInput();
    digest.catalogSha256 = "0".repeat(64);
    expectFixedError(digest);
  });

  test.each([
    ["sources", (input: MutableAssemblyInput) => {
      input.sourceRegister.sources.reverse();
    }],
    ["facts", (input: MutableAssemblyInput) => {
      input.extractedFacts.facts.reverse();
    }],
    ["evidence locators", (input: MutableAssemblyInput) => {
      input.sourceRegister.sources[0]!.evidenceLocators.reverse();
    }],
  ] as const)("rejects non-canonical trusted %s instead of normalizing it", (_name, mutate) => {
    const input = assemblyInput();
    mutate(input);
    expectFixedError(input);
  });

  test("sorts semantic-free checks while preserving byte-equivalent bundle material", () => {
    const first = assemblyInput();
    const second = assemblyInput();
    second.sourceChecks.reverse();

    expect(assemble(first)).toEqual(assemble(second));
  });

  test("rejects duplicate source-check coverage instead of normalizing it", () => {
    const input = assemblyInput();
    input.sourceChecks.splice(1, 0, {
      sourceId: "source-1",
      status: "passed",
      notes: "duplicate reviewed claim",
    });

    expectFixedError(input);
  });

  test.each([
    ["extra key", (input: MutableAssemblyInput) => Object.assign(input, { token: "secret" })],
    ["wrong run", (input: MutableAssemblyInput) => { input.runId = "run-other"; }],
    ["unsafe ownership", (input: MutableAssemblyInput) => {
      factAt(input, "country.summary").extractionMethod = "deterministic";
    }],
    ["cycle", (input: MutableAssemblyInput) => {
      const cycle: Record<string, unknown> = {};
      cycle.self = cycle;
      factAt(input, "marketOverview.gdp").evidence[0]!.rawValue = cycle as never;
    }],
  ])("returns one redacted error for invalid %s", (_name, mutate) => {
    const input = assemblyInput();
    mutate(input);
    expectFixedError(input);
  });

  test("returns a recursively frozen snapshot detached from later mutation", () => {
    const input = assemblyInput();
    const bundle = assemble(input);
    input.sourceRegister.sources[0]!.sourceName = "mutated";

    expect(bundle.sourceRegister.sources[0]!.sourceName).not.toBe("mutated");
    expectRecursivelyFrozen(bundle);
  });
});

type MutableAssemblyInput = DeepMutable<BasicCollectionAuditAssemblyInputV2>;

type DeepMutable<T> = T extends readonly (infer Item)[]
  ? DeepMutable<Item>[]
  : T extends object
    ? { -readonly [Key in keyof T]: DeepMutable<T[Key]> }
    : T;

function assemblyInput(): MutableAssemblyInput {
  const bundle = structuredClone(createBasicCollectionAuditV2Fixture()) as DeepMutable<
    BasicCollectionAuditBundleV2
  >;
  const { sourceRegister, extractedFacts } = bundle;
  return {
    countryDirectory: bundle.countryDirectory,
    runId: bundle.runId,
    catalogVersion: sourceRegister.catalogVersion,
    catalogSha256: sourceRegister.catalogSha256,
    sourceRegister,
    extractedFacts,
    marketOverviewDraft: bundle.marketOverviewDraft,
    sourceChecks: [...bundle.reviewReport.sourceChecks],
    injectionRisks: [...bundle.reviewReport.injectionRisks],
  };
}

function factAt(input: MutableAssemblyInput, fieldPath: string) {
  const fact = input.extractedFacts.facts.find((item) => item.fieldPath === fieldPath);
  if (fact === undefined) throw new Error(`missing fixture fact ${fieldPath}`);
  return fact;
}

function assemble(input: MutableAssemblyInput) {
  return assembleBasicCollectionAuditBundleV2(
    input as unknown as BasicCollectionAuditAssemblyInputV2,
  );
}

function expectFixedError(input: MutableAssemblyInput): void {
  expect(() => assemble(input)).toThrowError(
    /^Basic audit v2 assembly failed$/,
  );
}

function expectRecursivelyFrozen(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectRecursivelyFrozen(child);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
