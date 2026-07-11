import { describe, expect, test } from "vitest";

import { createBasicCollectionAuditFixture } from "./basic-collection-test-fixture.js";
import type {
  BasicCollectionJsonValue,
  BasicExtractedFact,
} from "./collection/basic-collection-contracts.js";
import { assembleBasicCollectionAuditBundle } from "./collection/basic-offline-audit-assembler.js";
import type {
  BasicCollectionAuditAssemblyInput,
  BasicOfflineDryRunInput,
} from "./collection/basic-offline-dry-run-contracts.js";
import { validateBasicCollectionAuditBundle } from "./collection/basic-collection-validator.js";

describe("Basic offline audit assembler", () => {
  test("defines blocked dry-run inputs around material without model-capable fields", () => {
    const blocked = {
      scenario: "missing",
      material: assemblyInput(),
    } satisfies BasicOfflineDryRunInput;

    expect(Object.keys(blocked)).toEqual(["scenario", "material"]);
  });

  test("assembles ready material without inventing review state", () => {
    const input = assemblyInput();

    const bundle = assembleBasicCollectionAuditBundle(input);

    expect(bundle.reviewReport).toMatchObject({
      status: "ready-for-human-review",
      missingFields: [],
      conflicts: [],
      sourceChecks: input.sourceChecks,
      injectionRisks: [],
      publicationRecommendation: "request-human-review",
      humanDecision: null,
    });
    expect(validateBasicCollectionAuditBundle(bundle)).toMatchObject({
      valid: true,
      readyForHumanReview: true,
      blockers: [],
    });
  });

  test("preserves empty explicit checks and blocks instead of auto-passing sources", () => {
    const bundle = assembleBasicCollectionAuditBundle(assemblyInput({ sourceChecks: [] }));

    expect(bundle.reviewReport.sourceChecks).toEqual([]);
    expect(bundle.reviewReport.humanDecision).toBeNull();
    expect(bundle.reviewReport).toMatchObject({ status: "blocked", publicationRecommendation: "do-not-publish" });
    expect(validateBasicCollectionAuditBundle(bundle)).toMatchObject({
      valid: true,
      blockers: ["UNTRUSTED_INPUT"],
    });
  });

  test("preserves explicit risks and failed checks", () => {
    const input = assemblyInput({
      sourceChecks: [
        { sourceId: "source-1", status: "failed", notes: "failed" },
        { sourceId: "source-2", status: "passed", notes: null },
      ],
      injectionRisks: [
        { sourceId: "source-1", locator: "table 1", severity: "confirmed", details: "risk" },
      ],
    });

    const bundle = assembleBasicCollectionAuditBundle(input);

    expect(bundle.reviewReport.sourceChecks).toEqual(input.sourceChecks);
    expect(bundle.reviewReport.injectionRisks).toEqual(input.injectionRisks);
    expect(validateBasicCollectionAuditBundle(bundle).blockers).toEqual(["UNTRUSTED_INPUT"]);
  });

  test("derives stable unique missing fields from missing and absent facts", () => {
    const input = assemblyInput();
    const gdp = factAt(input, "marketOverview.gdp");
    gdp.status = "missing";
    gdp.evidence = [];
    input.extractedFacts.facts = input.extractedFacts.facts.filter((fact) =>
      fact.fieldPath !== "country.name" && fact.fieldPath !== "marketOverview.population");

    const bundle = assembleBasicCollectionAuditBundle(input);

    expect(bundle.reviewReport.missingFields).toEqual([
      "country.name",
      "marketOverview.gdp",
      "marketOverview.population",
    ]);
    expect(validateBasicCollectionAuditBundle(bundle).blockers).toEqual(["MISSING_REQUIRED_FACT"]);
  });

  test("keeps every conflict unresolved in stable path and fact order", () => {
    const input = assemblyInput();
    makeConflict(input, "marketOverview.gdpGrowth", "source-2", 7.1);
    makeConflict(input, "country.region", "source-2", "OTHER_REGION");

    const bundle = assembleBasicCollectionAuditBundle(input);

    expect(bundle.reviewReport.conflicts).toEqual([
      {
        fieldPath: "country.region",
        factIds: [factAt(input, "country.region").factId],
        resolution: "unresolved",
        notes: expect.any(String),
      },
      {
        fieldPath: "marketOverview.gdpGrowth",
        factIds: [factAt(input, "marketOverview.gdpGrowth").factId],
        resolution: "unresolved",
        notes: expect.any(String),
      },
    ]);
    expect(bundle.reviewReport.conflicts.every(({ notes }) => notes.length > 0)).toBe(true);
    expect(validateBasicCollectionAuditBundle(bundle).blockers).toEqual(["UNRESOLVED_CONFLICT"]);
  });

  test("uses contract blocker order for combined missing, conflict, and untrusted material", () => {
    const input = assemblyInput({ sourceChecks: [] });
    const missing = factAt(input, "marketOverview.gdp");
    missing.status = "missing";
    missing.evidence = [];
    makeConflict(input, "marketOverview.gdpGrowth", "source-2", 7.1);

    const result = validateBasicCollectionAuditBundle(assembleBasicCollectionAuditBundle(input));

    expect(result).toMatchObject({
      valid: true,
      blockers: ["MISSING_REQUIRED_FACT", "UNRESOLVED_CONFLICT", "UNTRUSTED_INPUT"],
      readyForHumanReview: false,
    });
  });

  test("returns a fresh recursively frozen snapshot detached from later input mutation", () => {
    const input = assemblyInput();
    const bundle = assembleBasicCollectionAuditBundle(input);
    const originalSourceName = bundle.sourceRegister.sources[0]!.sourceName;
    input.sourceRegister.sources[0]!.sourceName = "mutated";
    input.sourceChecks[0]!.notes = "mutated";

    expect(bundle.sourceRegister.sources[0]!.sourceName).toBe(originalSourceName);
    expect(bundle.reviewReport.sourceChecks[0]!.notes).toBeNull();
    expect(bundle).not.toBe(input);
    expect(Object.isFrozen(bundle)).toBe(true);
    expect(Object.isFrozen(bundle.sourceRegister.sources)).toBe(true);
    expect(Object.isFrozen(bundle.sourceRegister.sources[0])).toBe(true);
    expect(Object.isFrozen(bundle.reviewReport.sourceChecks)).toBe(true);
  });

  test.each([
    ["proxy", () => new Proxy(assemblyInput(), {})],
    ["accessor", () => {
      const input = assemblyInput();
      Object.defineProperty(input, "runId", { enumerable: true, get: () => "run-001" });
      return input;
    }],
    ["cycle", () => {
      const input = assemblyInput();
      const cycle: Record<string, unknown> = {};
      cycle.self = cycle;
      factAt(input, "marketOverview.gdp").evidence[0]!.rawValue = cycle as BasicCollectionJsonValue;
      return input;
    }],
    ["inherited", () => Object.create(assemblyInput())],
    ["symbol key", () => Object.assign(assemblyInput(), { [Symbol("hidden")]: true })],
    ["nonfinite", () => {
      const input = assemblyInput();
      input.marketOverviewDraft.gdp = Number.POSITIVE_INFINITY;
      return input;
    }],
    ["wrong runId", () => assemblyInput({ runId: "run-002" })],
    ["wrong countryCode", () => {
      const input = assemblyInput();
      input.marketOverviewDraft.countryCode = "YY";
      return input;
    }],
    ["bad evidence reference", () => {
      const input = assemblyInput();
      factAt(input, "marketOverview.gdp").evidence[0]!.sourceId = "missing-source";
      return input;
    }],
    ["duplicate fact path", () => {
      const input = assemblyInput();
      input.extractedFacts.facts[1]!.fieldPath = input.extractedFacts.facts[0]!.fieldPath;
      return input;
    }],
  ] as const)("throws only the redacted fixed error for invalid %s input", (_name, createInput) => {
    expect(() => assembleBasicCollectionAuditBundle(
      createInput() as BasicCollectionAuditAssemblyInput,
    )).toThrowError(/^P1-6D audit assembly failed$/);
  });
});

function assemblyInput(
  overrides: Partial<BasicCollectionAuditAssemblyInput> = {},
): BasicCollectionAuditAssemblyInput {
  const fixture = structuredClone(createBasicCollectionAuditFixture());
  return {
    countryDirectory: fixture.countryDirectory,
    runId: fixture.runId,
    sourceRegister: fixture.sourceRegister,
    extractedFacts: fixture.extractedFacts,
    marketOverviewDraft: fixture.marketOverviewDraft,
    sourceChecks: fixture.reviewReport.sourceChecks,
    injectionRisks: fixture.reviewReport.injectionRisks,
    ...overrides,
  };
}

function factAt(input: BasicCollectionAuditAssemblyInput, fieldPath: string): BasicExtractedFact {
  const fact = input.extractedFacts.facts.find((candidate) => candidate.fieldPath === fieldPath);
  if (fact === undefined) throw new Error(`missing fixture fact ${fieldPath}`);
  return fact;
}

function makeConflict(
  input: BasicCollectionAuditAssemblyInput,
  fieldPath: string,
  sourceId: string,
  normalizedValue: BasicCollectionJsonValue,
): void {
  const fact = factAt(input, fieldPath);
  fact.status = "conflict";
  fact.evidence.push({ ...fact.evidence[0]!, sourceId, normalizedValue });
}
