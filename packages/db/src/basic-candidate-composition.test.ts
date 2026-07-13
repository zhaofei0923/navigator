import { describe, expect, test, vi } from "vitest";

import {
  composeBasicCountryCandidate,
  type BasicCandidateCompositionDependencies,
} from "./cli/basic-candidate-composition.js";
import {
  BASIC_COUNTRY_CANDIDATE_CONFIG_SCHEMA_VERSION,
} from "./cli/basic-candidate-config.js";
import { isBasicCandidateProductionResult } from "./cli/basic-candidate-production-runner.js";

const SECRET = "https://outside.invalid/?token=SECRET&cookie=SESSION raw content";

describe("Basic candidate production composition", () => {
  test("runs the reviewed production chain in order with one final candidate runner", async () => {
    const fixture = compositionFixture();

    const result = await composeBasicCountryCandidate(fixture.input, fixture.dependencies);

    expect(result.status).toBe("ready");
    expect(result.candidate).toBe(fixture.readyCandidate);
    expect(fixture.calls).toEqual([
      "load-config",
      "read-catalog",
      "parse-catalog",
      "create-plan",
      "run-plan",
      "read:reviews/structured.json",
      "parse-structured-review",
      "read:reviews/manual.json",
      "parse-manual-review",
      "read:plans/manual-source.json",
      "parse-document-plan",
      "materialize-document",
      "read:editorial.json",
      "parse-editorial",
      "materialize-reviewed",
      "run-candidate",
      "candidate-runner",
    ]);
    expect(fixture.candidateInput).toMatchObject({
      countryDirectory: "indonesia",
      countryCode: "ID",
      runId: "run-1",
      catalogVersion: "catalog-v1",
      catalogSha256: "a".repeat(64),
      sourceChecks: [{ sourceId: "det-source", status: "passed", notes: null }],
      injectionRisks: [],
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  test("passes the held workspace descriptor root to the v2 runner", async () => {
    const fixture = compositionFixture();
    const workspace = Object.freeze({});
    fixture.input = Object.freeze({
      workspace,
      configPath: fixture.input.configPath,
      transport: fixture.input.transport,
    }) as never;
    (fixture.dependencies as unknown as Record<string, unknown>)
      .getWorkspaceDescriptorRoot = () => "/proc/self/fd/91/";

    const result = await composeBasicCountryCandidate(fixture.input, fixture.dependencies);

    expect(result.status).toBe("ready");
    expect(fixture.runPlanInput).toMatchObject({
      repoRoot: "/proc/self/fd/91/",
    });
  });

  test("requires review paths exactly when the corresponding source kind is selected", async () => {
    for (const [name, configOverride] of [
      ["missing structured review", { structuredReviewPath: null }],
      ["missing manual review", { manualReviewPath: null }],
      ["missing document plan", { documentPlanPaths: [] }],
    ] as const) {
      const fixture = compositionFixture(configOverride);

      const result = await composeBasicCountryCandidate(fixture.input, fixture.dependencies);

      expect(result).toEqual({ status: "error", candidate: null });
      expect(fixture.calls, name).not.toContain("run-plan");
    }
  });

  test("requires null manual review and no plans when no manual source is selected", async () => {
    const fixture = compositionFixture({
      manualReviewPath: null,
      documentPlanPaths: [],
    }, [
      { source: { sourceId: "det-source", adapterKind: "deterministic" } },
    ]);

    const result = await composeBasicCountryCandidate(fixture.input, fixture.dependencies);

    expect(result.status).toBe("ready");
    expect(fixture.calls).not.toContain("parse-manual-review");
    expect(fixture.calls).not.toContain("materialize-document");
    expect(fixture.reviewedInput).toMatchObject({
      structuredReview: { kind: "structured-review" },
      documentResult: null,
    });
  });

  test("maps a candidate-core block to a stable blocked result", async () => {
    const fixture = compositionFixture();
    const blocked = Object.freeze({
      ...fixture.readyCandidate,
      failedStage: "preflight",
      artifacts: null,
    });
    fixture.dependencies.runCandidate = vi.fn(async () => blocked) as never;

    const result = await composeBasicCountryCandidate(fixture.input, fixture.dependencies);

    expect(result).toEqual({ status: "blocked", candidate: blocked });
  });

  test("does not grant publication provenance to an injected candidate runner", async () => {
    const fixture = compositionFixture();

    const result = await composeBasicCountryCandidate(fixture.input, fixture.dependencies);

    expect(result.status).toBe("ready");
    expect(isBasicCandidateProductionResult(result.candidate)).toBe(false);
  });

  test.each([
    "loadConfig",
    "readCatalog",
    "parseCatalog",
    "createPlan",
    "runPlan",
    "readConfigInput",
    "parseStructuredReview",
    "parseManualReview",
    "parseDocumentPlan",
    "materializeDocument",
    "parseEditorial",
    "materializeReviewed",
    "runCandidate",
    "getWorkspaceDescriptorRoot",
  ] as const)("redacts a throwing or rejecting %s dependency", async (dependency) => {
    const fixture = compositionFixture();
    fixture.dependencies[dependency] = vi.fn(() => {
      throw new Error(SECRET);
    }) as never;

    const result = await composeBasicCountryCandidate(fixture.input, fixture.dependencies);

    expect(result).toEqual({ status: "error", candidate: null });
    expect(JSON.stringify(result)).not.toMatch(/outside\.invalid|SECRET|SESSION|raw content/);
  });

  test("does not use global fetch when a transport is injected", async () => {
    const fixture = compositionFixture();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(() => {
      throw new Error("global fetch must not be called");
    }) as never;
    try {
      const result = await composeBasicCountryCandidate(fixture.input, fixture.dependencies);
      expect(result.status).toBe("ready");
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

function compositionFixture(
  configOverride: Record<string, unknown> = {},
  planSources: readonly { source: { sourceId: string; adapterKind: string } }[] = [
    { source: { sourceId: "det-source", adapterKind: "deterministic" } },
    { source: { sourceId: "manual-source", adapterKind: "manual-document" } },
  ],
) {
  const calls: string[] = [];
  const config = {
    schemaVersion: BASIC_COUNTRY_CANDIDATE_CONFIG_SCHEMA_VERSION,
    countryDirectory: "indonesia",
    countryCode: "ID",
    runId: "run-1",
    sourceIds: planSources.map(({ source }) => source.sourceId).sort(),
    structuredReviewPath: "reviews/structured.json",
    manualReviewPath: "reviews/manual.json",
    documentPlanPaths: ["plans/manual-source.json"],
    editorialInputPath: "editorial.json",
    ...configOverride,
  };
  const loaded = Object.freeze({ config });
  const plan = Object.freeze({
    catalogVersion: "catalog-v1",
    catalogSha256: "a".repeat(64),
    countryCode: "ID",
    sources: Object.freeze([...planSources]),
  });
  const preliminary = Object.freeze({ kind: "preliminary" });
  const structuredReview = Object.freeze({ kind: "structured-review" });
  const manualReview = Object.freeze({ kind: "manual-review" });
  const documentPlan = Object.freeze({ kind: "document-plan" });
  const documentResult = Object.freeze({ kind: "document-result" });
  const editorial = Object.freeze({ kind: "editorial" });
  const reviewed = Object.freeze({
    materialization: Object.freeze({ kind: "final-materialization" }),
    sourceChecks: Object.freeze([
      Object.freeze({ sourceId: "det-source", status: "passed", notes: null }),
    ]),
    injectionRisks: Object.freeze([]),
  });
  const readyCandidate = Object.freeze({
    stages: Object.freeze([]),
    failedStage: null,
    validation: Object.freeze({
      valid: true,
      readyForHumanReview: true,
      blockers: Object.freeze([]),
    }),
    artifacts: Object.freeze({ ready: true }),
    boundaryVerdict: Object.freeze({ stagingWrite: "not-attempted" }),
  });
  const inputValues: Readonly<Record<string, unknown>> = Object.freeze({
    "reviews/structured.json": {},
    "reviews/manual.json": {},
    "plans/manual-source.json": {},
    "editorial.json": {},
  });
  let candidateInput: Record<string, unknown> | null = null;
  let reviewedInput: Record<string, unknown> | null = null;
  let runPlanInput: Record<string, unknown> | null = null;

  const dependencies: BasicCandidateCompositionDependencies = {
    getWorkspaceDescriptorRoot() {
      return "/proc/self/fd/91/";
    },
    async loadConfig() {
      calls.push("load-config");
      return loaded as never;
    },
    async readCatalog() {
      calls.push("read-catalog");
      return { kind: "catalog-json" };
    },
    parseCatalog() {
      calls.push("parse-catalog");
      return { catalog: { kind: "catalog" }, catalogSha256: "a".repeat(64) } as never;
    },
    createPlan() {
      calls.push("create-plan");
      return plan as never;
    },
    async runPlan(value) {
      calls.push("run-plan");
      runPlanInput = value as unknown as Record<string, unknown>;
      return preliminary as never;
    },
    async readConfigInput(_loaded, path) {
      calls.push(`read:${path}`);
      if (!Object.hasOwn(inputValues, path)) throw new Error(SECRET);
      return inputValues[path];
    },
    parseStructuredReview() {
      calls.push("parse-structured-review");
      return structuredReview as never;
    },
    parseManualReview() {
      calls.push("parse-manual-review");
      return manualReview as never;
    },
    parseDocumentPlan() {
      calls.push("parse-document-plan");
      return documentPlan as never;
    },
    materializeDocument() {
      calls.push("materialize-document");
      return documentResult as never;
    },
    parseEditorial() {
      calls.push("parse-editorial");
      return editorial as never;
    },
    materializeReviewed(value) {
      calls.push("materialize-reviewed");
      reviewedInput = value as unknown as Record<string, unknown>;
      return reviewed as never;
    },
    async runCandidate(value) {
      calls.push("run-candidate");
      candidateInput = value as unknown as Record<string, unknown>;
      const runner = candidateInput.runner as { run(): Promise<unknown> };
      expect(await runner.run()).toBe(reviewed.materialization);
      calls.push("candidate-runner");
      return readyCandidate as never;
    },
  };

  return {
    input: {
      workspace: Object.freeze({}),
      configPath: ".cache/basic-country/ID/run-1/candidate-config.json",
      transport: Object.freeze({ execute: vi.fn() }),
    },
    dependencies,
    calls,
    readyCandidate,
    get candidateInput() { return candidateInput; },
    get reviewedInput() { return reviewedInput; },
    get runPlanInput() { return runPlanInput; },
  };
}
