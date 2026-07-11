import { describe, expect, test } from "vitest";

import { createBasicCollectionAuditFixture } from "./basic-collection-test-fixture.js";
import type {
  BasicCollectionAuditBundle,
  BasicCollectionBlockerCode,
  BasicCollectionAuditValidationResult,
} from "./collection/basic-collection-contracts.js";
import type { BasicSourceAdapterRunResult } from "./collection/basic-source-adapter-contracts.js";
import type {
  BasicOfflineNormalDryRunInput,
} from "./collection/basic-offline-dry-run-contracts.js";
import { runBasicOfflineDryRun } from "./collection/basic-offline-dry-run.js";
import {
  createBasicOfflineFailureResult,
  createBasicOfflineStageOutcomes,
} from "./collection/basic-offline-dry-run-result.js";

describe("Basic offline dry run", () => {
  test("normal runs runner before bridge and returns a ready four-file result", async () => {
    const fixture = createBasicCollectionAuditFixture();
    const calls: string[] = [];
    const approvedSourceName = fixture.sourceRegister.sources[0]!.sourceName;
    const approvedFactStatus = fixture.extractedFacts.facts[0]!.status;
    const runnerResult: BasicSourceAdapterRunResult = {
      sourceRegister: fixture.sourceRegister,
      extractedFacts: fixture.extractedFacts,
      receipts: [],
    };
    const modelComplete = async () => {
      calls.push("model");
      return {};
    };
    const input: BasicOfflineNormalDryRunInput = {
      scenario: "normal",
      countryDirectory: fixture.countryDirectory,
      runId: fixture.runId,
      runner: {
        async run() {
          calls.push("runner");
          input.model.complete = async () => {
            calls.push("replacement-model");
            return {};
          };
          return runnerResult;
        },
      },
      bridge: {
        async bridge(bridgeInput) {
          calls.push("bridge");
          expect(bridgeInput.sourceRegister).toEqual(runnerResult.sourceRegister);
          expect(bridgeInput.extractedFacts).toEqual(runnerResult.extractedFacts);
          expect(bridgeInput.sourceRegister).not.toBe(runnerResult.sourceRegister);
          expect(bridgeInput.extractedFacts).not.toBe(runnerResult.extractedFacts);
          expect(bridgeInput.model).not.toBe(input.model);
          expect(bridgeInput.model.complete).toBe(modelComplete);
          expect(Object.isFrozen(bridgeInput.model)).toBe(true);
          expectRecursivelyFrozen(bridgeInput.sourceRegister);
          expectRecursivelyFrozen(bridgeInput.extractedFacts);

          const source = bridgeInput.sourceRegister.sources[0]!;
          const fact = bridgeInput.extractedFacts.facts[0]!;
          expect(Reflect.set(source, "sourceName", "bridge mutation")).toBe(false);
          expect(Reflect.deleteProperty(source, "sourceName")).toBe(false);
          expect(Reflect.defineProperty(source, "sourceName", { value: "bridge mutation" })).toBe(false);
          expect(Reflect.set(bridgeInput.sourceRegister.sources, "0", { ...source, sourceName: "bridge mutation" })).toBe(false);
          expect(Reflect.set(fact, "status", "untrusted")).toBe(false);
          expect(Reflect.deleteProperty(bridgeInput.extractedFacts.facts, "0")).toBe(false);
          expect(Reflect.defineProperty(fact, "status", { value: "untrusted" })).toBe(false);
          return { ok: true, data: fixture.marketOverviewDraft };
        },
      },
      model: { complete: modelComplete },
      sourceChecks: fixture.reviewReport.sourceChecks,
      injectionRisks: fixture.reviewReport.injectionRisks,
    };

    const result = await runBasicOfflineDryRun(input);

    expect(calls).toEqual(["runner", "bridge"]);
    expect(result.stages).toEqual([
      { name: "input", outcome: "passed" },
      { name: "runner", outcome: "passed" },
      { name: "preflight", outcome: "passed" },
      { name: "draft-bridge", outcome: "passed" },
      { name: "assemble", outcome: "passed" },
      { name: "validate", outcome: "passed" },
      { name: "artifacts", outcome: "passed" },
      { name: "boundary", outcome: "passed" },
    ]);
    expect(result.validation).toMatchObject({
      valid: true,
      blockers: [],
      readyForHumanReview: true,
    });
    expect(Object.keys(result.artifacts ?? {}).sort()).toEqual([
      "extracted-facts.json",
      "market-overview.draft.json",
      "review-report.json",
      "source-register.json",
    ]);
    expect(result.artifacts?.["source-register.json"].sources[0]?.sourceName).toBe(approvedSourceName);
    expect(result.artifacts?.["extracted-facts.json"].facts[0]?.status).toBe(approvedFactStatus);
    expect(result.boundaryVerdict).toEqual({
      rawCache: "not-produced",
      stagingWrite: "not-attempted",
      manifest: "not-produced",
      canonicalWrite: "not-attempted",
      prismaWrite: "not-attempted",
      coverageDerivation: "not-attempted",
      publishAction: "not-attempted",
      knowledgeChunkCount: 0,
      aiUsableTrueCount: 0,
      aiEligibleKnowledgeIds: [],
    });
    expect(JSON.stringify(result)).not.toMatch(/"(model|complete|receipts)"\s*:/);
    expectRecursivelyFrozen(result);
    expect(Reflect.set(result, "unexpected", true)).toBe(false);
  });

  test("normal stops before bridge and model when preflight has a blocker", async () => {
    const fixture = createBasicCollectionAuditFixture();
    const fact = fixture.extractedFacts.facts.find(({ fieldPath }) => fieldPath === "marketOverview.gdp");
    if (fact === undefined) throw new Error("fixture fact is required");
    fact.status = "missing";
    fact.evidence = [];
    let bridgeCalls = 0;
    let modelCalls = 0;
    const input = normalInput(fixture, {
      bridge: { async bridge() { bridgeCalls += 1; return { ok: true, data: fixture.marketOverviewDraft }; } },
      model: { async complete() { modelCalls += 1; return {}; } },
    });

    const result = await runBasicOfflineDryRun(input);

    expect(bridgeCalls).toBe(0);
    expect(modelCalls).toBe(0);
    expect(result.validation).toMatchObject({ valid: false, blockers: ["MISSING_REQUIRED_FACT"], summary: { countryCode: "", runId: "" } });
    expect(result.artifacts).toBeNull();
    expect(result.stages[2]).toEqual({ name: "preflight", outcome: "blocked" });
  });

  test.each([
    ["failed source check", (fixture: BasicCollectionAuditBundle) => {
      fixture.reviewReport.sourceChecks[0]!.status = "failed";
    }, "UNTRUSTED_INPUT"],
    ["injection risk", (fixture: BasicCollectionAuditBundle) => {
      fixture.reviewReport.injectionRisks.push({
        sourceId: "source-1",
        locator: "table 1",
        severity: "suspected",
        details: "unsafe instruction",
      });
    }, "UNTRUSTED_INPUT"],
    ["conflict fact", (fixture: BasicCollectionAuditBundle) => {
      const fact = factAt(fixture, "marketOverview.gdpGrowth");
      fact.status = "conflict";
      fact.evidence.push({
        ...fact.evidence[0]!,
        sourceId: "source-2",
        rawValue: 7.1,
        normalizedValue: 7.1,
      });
    }, "UNRESOLVED_CONFLICT"],
    ["untrusted fact", (fixture: BasicCollectionAuditBundle) => {
      factAt(fixture, "marketOverview.gdp").status = "untrusted";
    }, "UNTRUSTED_INPUT"],
    ["discovery-only source", (fixture: BasicCollectionAuditBundle) => {
      fixture.sourceRegister.sources[0]!.discoveryOnly = true;
    }, "UNTRUSTED_INPUT"],
    ["restricted source", (fixture: BasicCollectionAuditBundle) => {
      fixture.sourceRegister.sources[0]!.accessStatus = "restricted";
    }, "UNTRUSTED_INPUT"],
    ["unknown source access", (fixture: BasicCollectionAuditBundle) => {
      fixture.sourceRegister.sources[0]!.accessStatus = "unknown";
    }, "UNTRUSTED_INPUT"],
    ["unsafe source prompt risk", (fixture: BasicCollectionAuditBundle) => {
      fixture.sourceRegister.sources[0]!.promptInjectionRisk = "suspected";
    }, "UNTRUSTED_INPUT"],
    ["evidence source without passed check", (fixture: BasicCollectionAuditBundle) => {
      fixture.reviewReport.sourceChecks = fixture.reviewReport.sourceChecks.filter(({ sourceId }) => sourceId !== "source-1");
    }, "UNTRUSTED_INPUT"],
    ["candidate credibility UNVERIFIED", (fixture: BasicCollectionAuditBundle) => {
      const evidence = factAt(fixture, "marketOverview.credibility").evidence[0]!;
      evidence.rawValue = "UNVERIFIED";
      evidence.normalizedValue = "UNVERIFIED";
    }, "UNTRUSTED_INPUT"],
  ] satisfies ReadonlyArray<readonly [
    string,
    (fixture: BasicCollectionAuditBundle) => void,
    BasicCollectionBlockerCode,
  ]>)("blocks %s before bridge and model", async (_name, mutate, blocker) => {
    const fixture = createBasicCollectionAuditFixture();
    mutate(fixture);
    let bridgeCalls = 0;
    let modelCalls = 0;
    const result = await runBasicOfflineDryRun(normalInput(fixture, {
      bridge: {
        async bridge() {
          bridgeCalls += 1;
          return { ok: true, data: fixture.marketOverviewDraft };
        },
      },
      model: {
        async complete() {
          modelCalls += 1;
          return {};
        },
      },
    }));

    expect(bridgeCalls).toBe(0);
    expect(modelCalls).toBe(0);
    expect(result.validation.blockers).toEqual([blocker]);
    expect(result.validation.errors).toEqual(["P1-6D preflight failed"]);
    expect(result.stages[2]).toEqual({ name: "preflight", outcome: "blocked" });
    expect(result.stages.slice(3, 7).map(({ outcome }) => outcome)).toEqual([
      "skipped", "skipped", "skipped", "skipped",
    ]);
    expect(result.stages[7]).toEqual({ name: "boundary", outcome: "passed" });
    expect(result.artifacts).toBeNull();
  });

  test("normal fail-closes runner and bridge failures without diagnostic leakage", async () => {
    const fixture = createBasicCollectionAuditFixture();
    let bridgeCalls = 0;
    const input = normalInput(fixture, {
      runner: { async run() { throw new Error("provider=https://secret.example/token"); } },
      bridge: { async bridge() { bridgeCalls += 1; return { ok: false, error: { code: "LLAMA_UNAVAILABLE", phase: "llama", retryable: true } }; } },
    });

    const runnerResult = await runBasicOfflineDryRun(input);
    expect(runnerResult.validation.errors).toEqual(["P1-6D runner failed"]);
    expect(runnerResult.validation.errors.join(" ")).not.toContain("secret");
    expect(runnerResult.artifacts).toBeNull();
    expect(bridgeCalls).toBe(0);

    const bridgeResult = await runBasicOfflineDryRun(normalInput(fixture, {
      bridge: { async bridge() { return { ok: false, error: { code: "LLAMA_UNAVAILABLE", phase: "llama", retryable: true } }; } },
    }));
    expect(bridgeResult.validation.errors).toEqual(["P1-6D draft-bridge failed"]);
    expect(bridgeResult.artifacts).toBeNull();
  });

  test.each([
    ["sync throw", (_fixture: BasicCollectionAuditBundle, _probe: FailureProbe) => ({
      run() { throw new Error(FAILURE_SECRET); },
    })],
    ["rejection", (_fixture: BasicCollectionAuditBundle, _probe: FailureProbe) => ({
      async run() { throw new Error(FAILURE_SECRET); },
    })],
    ["non-exact promise", (fixture: BasicCollectionAuditBundle, _probe: FailureProbe) => ({
      run() { return promiseWithOwnThen(runResult(fixture)); },
    })],
    ["hostile thenable", (_fixture: BasicCollectionAuditBundle, probe: FailureProbe) => ({
      run() { return hostileThenable(probe) as unknown as Promise<BasicSourceAdapterRunResult>; },
    })],
    ["hostile output", (fixture: BasicCollectionAuditBundle, probe: FailureProbe) => ({
      async run() {
        const output = runResult(fixture);
        Object.defineProperty(output, "receipts", {
          enumerable: true,
          get() { probe.getterCalls += 1; throw new Error(FAILURE_SECRET); },
        });
        return output;
      },
    })],
  ] satisfies ReadonlyArray<readonly [string, RunnerFactory]>) (
    "fail-closes runner %s with fixed diagnostics",
    async (_name, makeRunner) => {
      const fixture = createBasicCollectionAuditFixture();
      const probe: FailureProbe = { getterCalls: 0 };
      let bridgeCalls = 0;
      let modelCalls = 0;
      const result = await runBasicOfflineDryRun(normalInput(fixture, {
        runner: makeRunner(fixture, probe),
        bridge: {
          async bridge() {
            bridgeCalls += 1;
            return { ok: true, data: fixture.marketOverviewDraft };
          },
        },
        model: { async complete() { modelCalls += 1; return {}; } },
      }));

      expect(probe.getterCalls).toBe(0);
      expect(bridgeCalls).toBe(0);
      expect(modelCalls).toBe(0);
      expectFailure(result, "runner");
    },
  );

  test.each([
    ["sync throw", (_fixture: BasicCollectionAuditBundle, _probe: FailureProbe) => ({
      bridge() { throw new Error(FAILURE_SECRET); },
    })],
    ["rejection", (_fixture: BasicCollectionAuditBundle, _probe: FailureProbe) => ({
      async bridge() { throw new Error(FAILURE_SECRET); },
    })],
    ["ok false", (_fixture: BasicCollectionAuditBundle, _probe: FailureProbe) => ({
      async bridge() {
        return { ok: false as const, error: { code: "LLAMA_UNAVAILABLE" as const, phase: "llama" as const, retryable: true } };
      },
    })],
    ["non-exact promise", (fixture: BasicCollectionAuditBundle, _probe: FailureProbe) => ({
      bridge() { return promiseWithOwnThen({ ok: true as const, data: fixture.marketOverviewDraft }); },
    })],
    ["hostile thenable", (_fixture: BasicCollectionAuditBundle, probe: FailureProbe) => ({
      bridge() { return hostileThenable(probe) as unknown as ReturnType<BridgePort["bridge"]>; },
    })],
    ["hostile output", (fixture: BasicCollectionAuditBundle, probe: FailureProbe) => ({
      async bridge() {
        const output = { ok: true as const, data: fixture.marketOverviewDraft };
        Object.defineProperty(output, "data", {
          enumerable: true,
          get() { probe.getterCalls += 1; throw new Error(FAILURE_SECRET); },
        });
        return output;
      },
    })],
    ["invalid draft", (_fixture: BasicCollectionAuditBundle, _probe: FailureProbe) => ({
      async bridge() { return { ok: true as const, data: {} as unknown as BasicCollectionAuditBundle["marketOverviewDraft"] }; },
    })],
  ] satisfies ReadonlyArray<readonly [string, BridgeFactory]>) (
    "fail-closes bridge %s with fixed diagnostics",
    async (_name, makeBridge) => {
      const fixture = createBasicCollectionAuditFixture();
      const probe: FailureProbe = { getterCalls: 0 };
      let bridgeCalls = 0;
      let modelCalls = 0;
      const suppliedBridge: BridgePort = makeBridge(fixture, probe);
      const result = await runBasicOfflineDryRun(normalInput(fixture, {
        bridge: {
          bridge(input) {
            bridgeCalls += 1;
            return suppliedBridge.bridge(input);
          },
        },
        model: { async complete() { modelCalls += 1; return {}; } },
      }));

      expect(probe.getterCalls).toBe(0);
      expect(bridgeCalls).toBe(1);
      expect(modelCalls).toBe(0);
      expectFailure(result, "draft-bridge");
    },
  );

  test("rejects an input accessor without invoking its getter or runner", async () => {
    const fixture = createBasicCollectionAuditFixture();
    const input = normalInput(fixture);
    let getterCalls = 0;
    Object.defineProperty(input, "sourceChecks", {
      enumerable: true,
      get() { getterCalls += 1; return fixture.reviewReport.sourceChecks; },
    });
    let runnerCalls = 0;
    input.runner = { async run() { runnerCalls += 1; return runResult(fixture); } };

    const result = await runBasicOfflineDryRun(input);

    expect(getterCalls).toBe(0);
    expect(runnerCalls).toBe(0);
    expect(result.stages[0]).toEqual({ name: "input", outcome: "blocked" });
    expect(result.validation.errors).toEqual(["P1-6D input failed"]);
  });

  test("validation failure preserves safe validator summary and blockers without raw errors", () => {
    const validatorResult: BasicCollectionAuditValidationResult = {
      valid: false,
      data: null,
      errors: [FAILURE_SECRET],
      readyForHumanReview: false,
      blockers: ["UNTRUSTED_INPUT"],
      summary: { countryCode: "XZ", runId: "run-safe-summary", sourceCount: 2, factCount: 24 },
    };
    const outcomes = createBasicOfflineStageOutcomes();
    outcomes[1] = "passed";
    outcomes[2] = "passed";
    outcomes[3] = "passed";
    outcomes[4] = "passed";

    const result = createBasicOfflineFailureResult(
      "normal",
      outcomes,
      "validate",
      [],
      validatorResult,
    );

    expect(result.validation).toEqual({
      valid: false,
      data: null,
      errors: ["P1-6D validate failed"],
      readyForHumanReview: false,
      blockers: ["UNTRUSTED_INPUT"],
      summary: validatorResult.summary,
    });
    expect(result.stages[5]).toEqual({ name: "validate", outcome: "blocked" });
    expect(result.stages[6]).toEqual({ name: "artifacts", outcome: "skipped" });
    expect(JSON.stringify(result)).not.toContain(FAILURE_SECRET);
  });
});

function runResult(fixture: BasicCollectionAuditBundle): BasicSourceAdapterRunResult {
  return { sourceRegister: fixture.sourceRegister, extractedFacts: fixture.extractedFacts, receipts: [] };
}

function factAt(fixture: BasicCollectionAuditBundle, fieldPath: string) {
  const fact = fixture.extractedFacts.facts.find((candidate) => candidate.fieldPath === fieldPath);
  if (fact === undefined) throw new Error(`fixture fact is required: ${fieldPath}`);
  return fact;
}

function normalInput(
  fixture: BasicCollectionAuditBundle,
  overrides: Partial<BasicOfflineNormalDryRunInput> = {},
): BasicOfflineNormalDryRunInput {
  return {
    scenario: "normal",
    countryDirectory: fixture.countryDirectory,
    runId: fixture.runId,
    runner: { async run() { return runResult(fixture); } },
    bridge: { async bridge() { return { ok: true, data: fixture.marketOverviewDraft }; } },
    model: { async complete() { return {}; } },
    sourceChecks: fixture.reviewReport.sourceChecks,
    injectionRisks: fixture.reviewReport.injectionRisks,
    ...overrides,
  };
}

function expectRecursivelyFrozen(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectRecursivelyFrozen(child);
}

const FAILURE_SECRET = "provider=https://secret.example/raw-cache/path";
type RunnerFactory = (
  fixture: BasicCollectionAuditBundle,
  probe: FailureProbe,
) => BasicOfflineNormalDryRunInput["runner"];
type BridgePort = BasicOfflineNormalDryRunInput["bridge"];
type BridgeFactory = (
  fixture: BasicCollectionAuditBundle,
  probe: FailureProbe,
) => BridgePort;
interface FailureProbe { getterCalls: number }

function promiseWithOwnThen<T>(value: T): Promise<T> {
  const promise = Promise.resolve(value);
  Object.defineProperty(promise, "then", {
    value: promise.then.bind(promise),
    enumerable: true,
  });
  return promise;
}

function hostileThenable(probe: FailureProbe): object {
  const thenable = {};
  Object.defineProperty(thenable, "then", {
    enumerable: true,
    get() { probe.getterCalls += 1; throw new Error(FAILURE_SECRET); },
  });
  return thenable;
}

function expectFailure(
  result: Awaited<ReturnType<typeof runBasicOfflineDryRun>>,
  stage: "runner" | "draft-bridge",
): void {
  const stageIndex = stage === "runner" ? 1 : 3;
  expect(result.validation.errors).toEqual([`P1-6D ${stage} failed`]);
  expect(result.stages[stageIndex]).toEqual({ name: stage, outcome: "blocked" });
  expect(result.stages.slice(stageIndex + 1, 7).every(({ outcome }) => outcome === "skipped")).toBe(true);
  expect(result.stages[7]).toEqual({ name: "boundary", outcome: "passed" });
  expect(result.artifacts).toBeNull();
  expect(JSON.stringify(result)).not.toContain(FAILURE_SECRET);
}
