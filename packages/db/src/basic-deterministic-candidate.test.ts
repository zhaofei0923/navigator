import { beforeEach, describe, expect, test, vi } from "vitest";

import { createBasicCollectionAuditFixture } from "./basic-collection-test-fixture.js";
import {
  BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION,
  classifyBasicV2FieldPath,
  type BasicCollectionAuditValidationResultV2,
  type BasicDeterministicMaterializationResultV2,
} from "./collection/basic-collection-v2-contracts.js";
import type {
  BasicDeterministicCandidateInput,
  BasicDeterministicRunnerPort,
} from "./collection/basic-deterministic-candidate-contracts.js";
import {
  BASIC_DETERMINISTIC_STAGE_NAMES,
} from "./collection/basic-deterministic-candidate-contracts.js";
import {
  createBasicDeterministicFailureResult,
} from "./collection/basic-deterministic-candidate-result.js";
import { runBasicDeterministicCandidate } from "./collection/basic-deterministic-candidate.js";

const dependencyModes = vi.hoisted(() => ({
  preflight: "actual",
  draft: "actual",
  audit: "actual",
  validate: "actual",
  validateCalls: 0,
  artifacts: "actual",
}));

vi.mock("./collection/basic-deterministic-source-preflight.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./collection/basic-deterministic-source-preflight.js")>();
  return {
    ...actual,
    preflightBasicDeterministicCollection(input: Parameters<typeof actual.preflightBasicDeterministicCollection>[0]) {
      if (dependencyModes.preflight === "throw") throw new Error("SECRET token cookie https://dependency.invalid/");
      if (dependencyModes.preflight === "malformed") {
        return { valid: true, blockers: [], errors: [], raw: "SECRET" };
      }
      return actual.preflightBasicDeterministicCollection(input);
    },
  };
});

vi.mock("./collection/basic-market-overview-draft-assembler.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./collection/basic-market-overview-draft-assembler.js")>();
  return {
    ...actual,
    assembleBasicMarketOverviewDraft(input: Parameters<typeof actual.assembleBasicMarketOverviewDraft>[0]) {
      if (dependencyModes.draft === "throw") throw new Error("SECRET token cookie https://dependency.invalid/");
      if (dependencyModes.draft === "malformed") return { overview: "SECRET" };
      return actual.assembleBasicMarketOverviewDraft(input);
    },
  };
});

vi.mock("./collection/basic-audit-v2-assembler.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./collection/basic-audit-v2-assembler.js")>();
  return {
    ...actual,
    assembleBasicCollectionAuditBundleV2(input: Parameters<typeof actual.assembleBasicCollectionAuditBundleV2>[0]) {
      if (dependencyModes.audit === "throw") throw new Error("SECRET token cookie https://dependency.invalid/");
      if (dependencyModes.audit === "malformed") return { token: "SECRET" };
      return actual.assembleBasicCollectionAuditBundleV2(input);
    },
  };
});

vi.mock("./collection/basic-collection-v2-validator.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./collection/basic-collection-v2-validator.js")>();
  return {
    ...actual,
    validateBasicCollectionAuditBundleV2(input: unknown) {
      dependencyModes.validateCalls += 1;
      if (dependencyModes.validate !== "actual" && dependencyModes.validateCalls <= 2) {
        return actual.validateBasicCollectionAuditBundleV2(input);
      }
      if (dependencyModes.validate === "throw") throw new Error("SECRET token cookie https://dependency.invalid/");
      if (dependencyModes.validate === "malformed") {
        return { valid: true, data: input, errors: [], readyForHumanReview: true, blockers: [], extra: "SECRET" };
      }
      if (dependencyModes.validate === "invalid") {
        return actual.validateBasicCollectionAuditBundleV2({ token: "SECRET" });
      }
      return actual.validateBasicCollectionAuditBundleV2(input);
    },
  };
});

vi.mock("./collection/basic-audit-v2-artifacts.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./collection/basic-audit-v2-artifacts.js")>();
  return {
    ...actual,
    createBasicCollectionAuditArtifactsV2(input: unknown) {
      if (dependencyModes.artifacts === "throw") throw new Error("SECRET token cookie https://dependency.invalid/");
      if (dependencyModes.artifacts === "malformed") return Object.freeze({ token: "SECRET" });
      return actual.createBasicCollectionAuditArtifactsV2(input);
    },
  };
});

describe("model-free Basic deterministic candidate", () => {
  beforeEach(() => {
    dependencyModes.preflight = "actual";
    dependencyModes.draft = "actual";
    dependencyModes.audit = "actual";
    dependencyModes.validate = "actual";
    dependencyModes.validateCalls = 0;
    dependencyModes.artifacts = "actual";
  });

  test("calls one exact runner once with its stable receiver and returns ready artifacts", async () => {
    const fixture = candidateFixture();
    let calls = 0;
    let receiver: unknown;
    const runner: BasicDeterministicRunnerPort = {
      run() {
        calls += 1;
        receiver = this;
        return Promise.resolve(fixture.materialization);
      },
    };

    const result = await runBasicDeterministicCandidate({ ...fixture.input, runner });

    expect(calls).toBe(1);
    expect(receiver).toBe(runner);
    expect(result.failedStage).toBeNull();
    expect(result.stages).toEqual(BASIC_DETERMINISTIC_STAGE_NAMES.map((name) => ({
      name,
      outcome: "passed",
    })));
    expect(result.validation).toMatchObject({
      valid: true,
      readyForHumanReview: true,
      blockers: [],
    });
    expect(Object.keys(result.artifacts ?? {})).toEqual([
      "source-register.json",
      "extracted-facts.json",
      "market-overview.draft.json",
      "review-report.json",
    ]);
    expectRecursivelyFrozen(result);
  });

  test.each([
    "countryDirectory", "countryCode", "runId", "catalogVersion", "catalogSha256",
    "runner", "sourceChecks", "injectionRisks",
  ] as const)("rejects an input missing %s before the runner", async (key) => {
    const fixture = candidateFixture();
    const malformed = { ...fixture.input } as Record<string, unknown>;
    delete malformed[key];

    const result = await runBasicDeterministicCandidate(
      malformed as unknown as BasicDeterministicCandidateInput,
    );

    expectInputFailure(result, fixture.calls);
  });

  test.each([
    "bridge", "model", "prompt", "Prompt", "scenario", "hermes", "Hermes",
    "search", "completion", "generative",
  ])("rejects forbidden extra %s input without reading it", async (key) => {
    const fixture = candidateFixture();
    let reads = 0;
    const malformed = { ...fixture.input };
    Object.defineProperty(malformed, key, {
      enumerable: true,
      get() {
        reads += 1;
        throw new Error("SECRET token cookie https://input.invalid/");
      },
    });

    const result = await runBasicDeterministicCandidate(
      malformed as unknown as BasicDeterministicCandidateInput,
    );

    expect(reads).toBe(0);
    expectInputFailure(result, fixture.calls);
  });

  test.each([
    ["accessor method", () => {
      const port = {};
      Object.defineProperty(port, "run", {
        enumerable: true,
        get() { throw new Error("runner accessor executed"); },
      });
      return port;
    }],
    ["extra key", () => ({ run() { return Promise.resolve({}); }, model: true })],
    ["inherited method", () => Object.create({ run() { return Promise.resolve({}); } })],
    ["proxy port", () => new Proxy({ run() { return Promise.resolve({}); } }, {
      ownKeys() { throw new Error("runner proxy executed"); },
    })],
    ["proxy method", () => ({ run: new Proxy(() => Promise.resolve({}), {
      apply() { throw new Error("runner function proxy executed"); },
    }) })],
  ] as const)("rejects a hostile %s without invoking it", async (_name, createRunner) => {
    const fixture = candidateFixture();

    const result = await runBasicDeterministicCandidate({
      ...fixture.input,
      runner: createRunner() as BasicDeterministicRunnerPort,
    });

    expect(result.failedStage).toBe("input");
    expect(fixture.calls()).toBe(0);
  });

  test.each([
    ["plain thenable", { then(resolve: (value: unknown) => void) { resolve({}); } }],
    ["Promise subclass", new (class extends Promise<unknown> {})((resolve) => resolve({}))],
    ["own then", Object.assign(Promise.resolve({}), { then: Promise.prototype.then })],
    ["own constructor", Object.assign(Promise.resolve({}), { constructor: Promise })],
  ] as const)("blocks a runner returning a non-exact native Promise: %s", async (_name, pending) => {
    const fixture = candidateFixture();
    let calls = 0;

    const result = await runBasicDeterministicCandidate({
      ...fixture.input,
      runner: { run() { calls += 1; return pending as Promise<BasicDeterministicMaterializationResultV2>; } },
    });

    expect(calls).toBe(1);
    expectFailure(result, "runner", null);
  });

  test("rejects an otherwise valid native Promise with an extra own key", async () => {
    const fixture = candidateFixture();
    const pending = Object.assign(Promise.resolve(fixture.materialization), {
      model: "forbidden",
    });

    const result = await runBasicDeterministicCandidate({
      ...fixture.input,
      runner: { run() { return pending; } },
    });

    expectFailure(result, "runner", null);
  });

  test.each([
    ["extra result key", (value: Record<string, unknown>) => { value.token = "SECRET"; }],
    ["missing result key", (value: Record<string, unknown>) => { delete value.receipts; }],
    ["extra receipt key", (value: Record<string, unknown>) => {
      value.receipts = [{ sourceId: "source-1", contentSha256: "0".repeat(64), byteLength: 1, reused: false, url: "SECRET" }];
    }],
    ["malformed receipt", (value: Record<string, unknown>) => {
      value.receipts = [{ sourceId: "source-1", contentSha256: "bad", byteLength: -1, reused: "no" }];
    }],
  ] as const)("blocks malformed runner output: %s", async (_name, mutate) => {
    const fixture = candidateFixture();
    const output = structuredClone(fixture.materialization) as unknown as Record<string, unknown>;
    mutate(output);

    const result = await runBasicDeterministicCandidate({
      ...fixture.input,
      runner: { run() { return Promise.resolve(output as unknown as BasicDeterministicMaterializationResultV2); } },
    });

    expectFailure(result, "runner", null);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("SECRET");
    expect(serialized).not.toContain("dependency.invalid");
    expect(serialized).not.toContain("cookie");
  });

  test.each([
    ["runId", (fixture: CandidateFixture) => { fixture.input.runId = "run-other"; }],
    ["countryCode", (fixture: CandidateFixture) => { fixture.input.countryCode = "YY"; }],
    ["catalogVersion", (fixture: CandidateFixture) => { fixture.input.catalogVersion = "catalog-other"; }],
    ["catalogSha256", (fixture: CandidateFixture) => { fixture.input.catalogSha256 = "0".repeat(64); }],
  ] as const)("blocks %s identity mismatch at preflight", async (_name, mutate) => {
    const fixture = candidateFixture();
    mutate(fixture);

    const result = await runBasicDeterministicCandidate(fixture.input);

    expectFailure(result, "preflight", null);
  });

  test("snapshots static input before awaiting and runner output immediately after awaiting", async () => {
    const fixture = candidateFixture();
    const materialization = structuredClone(fixture.materialization);
    let resolve!: (value: BasicDeterministicMaterializationResultV2) => void;
    const pending = new Promise<BasicDeterministicMaterializationResultV2>((done) => { resolve = done; });
    let called!: () => void;
    const runnerCalled = new Promise<void>((done) => { called = done; });
    fixture.input.runner = {
      run() {
        called();
        return pending;
      },
    };

    const candidate = runBasicDeterministicCandidate(fixture.input);
    await runnerCalled;
    fixture.input.countryCode = "YY";
    fixture.input.sourceChecks.length = 0;
    resolve(materialization);
    const result = await candidate;
    materialization.sourceRegister.sources[0]!.sourceName = "post-call mutation";
    (materialization.extractedFacts.facts[0]! as { factId: string }).factId =
      "post-call mutation";

    expect(result.failedStage).toBeNull();
    expect(result.artifacts?.["source-register.json"].sources[0]?.sourceName).not.toBe("post-call mutation");
    expect(result.artifacts?.["extracted-facts.json"].facts[0]?.factId).not.toBe("post-call mutation");
  });

  test.each([
    ["preflight", "throw", "preflight"],
    ["preflight", "malformed", "preflight"],
    ["draft", "throw", "draft-assemble"],
    ["draft", "malformed", "draft-assemble"],
    ["audit", "throw", "audit-assemble"],
    ["audit", "malformed", "audit-assemble"],
    ["validate", "throw", "validate"],
    ["validate", "malformed", "validate"],
    ["artifacts", "throw", "artifacts"],
    ["artifacts", "malformed", "artifacts"],
  ] as const)("redacts %s %s failures at the exact stage", async (dependency, mode, stage) => {
    dependencyModes[dependency] = mode;
    const fixture = candidateFixture();

    const result = await runBasicDeterministicCandidate(fixture.input);

    const validation = stageIndex(stage) >= stageIndex("validate")
      ? result.validation
      : null;
    expectFailure(result, stage, validation);
    if (stage === "validate") {
      expect(result.validation).toMatchObject({ valid: false, readyForHumanReview: false });
    }
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("SECRET");
    expect(serialized).not.toContain("dependency.invalid");
    expect(serialized).not.toContain("cookie");
  });

  test("preserves an exact invalid validation while withholding artifacts", async () => {
    dependencyModes.validate = "invalid";
    const result = await runBasicDeterministicCandidate(candidateFixture().input);

    expectFailure(result, "validate", result.validation);
    expect(result.validation).toEqual({
      valid: false,
      data: null,
      errors: expect.any(Array),
      readyForHumanReview: false,
      blockers: [],
      summary: { countryCode: "", runId: "", sourceCount: 0, factCount: 0 },
    });
    expect(Object.keys(result.validation ?? {})).toEqual([
      "valid", "data", "errors", "readyForHumanReview", "blockers", "summary",
    ]);
  });

  test.each(BASIC_DETERMINISTIC_STAGE_NAMES)(
    "builds exact first-failure outcomes for the %s stage",
    (failedStage) => {
      const validation = stageIndex(failedStage) >= stageIndex("validate")
        ? redactedValidation()
        : null;
      const result = createBasicDeterministicFailureResult(failedStage, validation);
      const failedIndex = stageIndex(failedStage);

      expect(result.stages).toEqual(BASIC_DETERMINISTIC_STAGE_NAMES.map((name, index) => ({
        name,
        outcome: index < failedIndex ? "passed" : index === failedIndex ? "blocked" : "skipped",
      })));
      expect(result.failedStage).toBe(failedStage);
      expect(result.validation).toBe(validation);
      expect(result.artifacts).toBeNull();
      expect(Object.keys(result)).toEqual([
        "stages", "failedStage", "validation", "artifacts", "boundaryVerdict",
      ]);
      expectRecursivelyFrozen(result);
    },
  );
});

type CandidateFixture = ReturnType<typeof candidateFixture>;

function candidateFixture() {
  const bundle = structuredClone(createBasicCollectionAuditFixture());
  const sourceRegister = {
    ...bundle.sourceRegister,
    schemaVersion: BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION,
    catalogVersion: "catalog-v1",
    catalogSha256: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
  };
  const extractedFacts = {
    ...bundle.extractedFacts,
    schemaVersion: BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION,
  };
  for (const fact of extractedFacts.facts) {
    const owner = classifyBasicV2FieldPath(fact.fieldPath);
    fact.extractionMethod = owner === "source-backed" || owner === "derived"
      ? "deterministic"
      : "manual";
  }
  extractedFacts.facts.sort((left, right) => compareText(left.fieldPath, right.fieldPath));
  const materialization = {
    sourceRegister,
    extractedFacts,
    receipts: [],
  } as unknown as BasicDeterministicMaterializationResultV2;
  let calls = 0;
  const runner: BasicDeterministicRunnerPort = {
    run() {
      calls += 1;
      return Promise.resolve(materialization);
    },
  };
  const input = {
    countryDirectory: bundle.countryDirectory,
    countryCode: sourceRegister.countryCode,
    runId: sourceRegister.runId,
    catalogVersion: sourceRegister.catalogVersion,
    catalogSha256: sourceRegister.catalogSha256,
    runner,
    sourceChecks: bundle.reviewReport.sourceChecks.sort((left, right) => compareText(left.sourceId, right.sourceId)),
    injectionRisks: [],
  };
  return { input, materialization, calls: () => calls };
}

function expectInputFailure(
  result: Awaited<ReturnType<typeof runBasicDeterministicCandidate>>,
  calls: () => number,
): void {
  expect(calls()).toBe(0);
  expectFailure(result, "input", null);
}

function expectFailure(
  result: Awaited<ReturnType<typeof runBasicDeterministicCandidate>>,
  failedStage: (typeof BASIC_DETERMINISTIC_STAGE_NAMES)[number],
  validation: BasicCollectionAuditValidationResultV2 | null,
): void {
  const failedIndex = stageIndex(failedStage);
  expect(result.failedStage).toBe(failedStage);
  expect(result.validation).toBe(validation);
  expect(result.artifacts).toBeNull();
  expect(result.stages).toEqual(BASIC_DETERMINISTIC_STAGE_NAMES.map((name, index) => ({
    name,
    outcome: index < failedIndex ? "passed" : index === failedIndex ? "blocked" : "skipped",
  })));
}

function redactedValidation(): BasicCollectionAuditValidationResultV2 {
  return Object.freeze({
    valid: false,
    data: null,
    errors: Object.freeze(["Basic deterministic candidate validation failed"]),
    readyForHumanReview: false,
    blockers: Object.freeze([]),
    summary: Object.freeze({ countryCode: "", runId: "", sourceCount: 0, factCount: 0 }),
  });
}

function stageIndex(name: (typeof BASIC_DETERMINISTIC_STAGE_NAMES)[number]): number {
  return BASIC_DETERMINISTIC_STAGE_NAMES.indexOf(name);
}

function expectRecursivelyFrozen(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectRecursivelyFrozen(child);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
