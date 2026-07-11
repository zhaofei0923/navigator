import { describe, expect, test } from "vitest";

import { createBasicCollectionAuditFixture } from "./basic-collection-test-fixture.js";
import type { BasicCollectionAuditBundle } from "./collection/basic-collection-contracts.js";
import type { BasicSourceAdapterRunResult } from "./collection/basic-source-adapter-contracts.js";
import type {
  BasicOfflineNormalDryRunInput,
} from "./collection/basic-offline-dry-run-contracts.js";
import { runBasicOfflineDryRun } from "./collection/basic-offline-dry-run.js";

describe("Basic offline dry run", () => {
  test("normal runs runner before bridge and returns a ready four-file result", async () => {
    const fixture = createBasicCollectionAuditFixture();
    const calls: string[] = [];
    const runnerResult: BasicSourceAdapterRunResult = {
      sourceRegister: fixture.sourceRegister,
      extractedFacts: fixture.extractedFacts,
      receipts: [],
    };
    const input: BasicOfflineNormalDryRunInput = {
      scenario: "normal",
      countryDirectory: fixture.countryDirectory,
      runId: fixture.runId,
      runner: {
        async run() {
          calls.push("runner");
          return runnerResult;
        },
      },
      bridge: {
        async bridge(bridgeInput) {
          calls.push("bridge");
          expect(bridgeInput.sourceRegister).toEqual(runnerResult.sourceRegister);
          expect(bridgeInput.extractedFacts).toEqual(runnerResult.extractedFacts);
          const originalSourceName = bridgeInput.sourceRegister.sources[0]?.sourceName;
          runnerResult.sourceRegister.sources[0]!.sourceName = "mutated after runner";
          expect(bridgeInput.sourceRegister.sources[0]?.sourceName).toBe(originalSourceName);
          return { ok: true, data: fixture.marketOverviewDraft };
        },
      },
      model: {
        async complete() {
          calls.push("model");
          return {};
        },
      },
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

  test("normal blocks candidate UNVERIFIED credibility despite trusted source checks", async () => {
    const fixture = createBasicCollectionAuditFixture();
    const fact = fixture.extractedFacts.facts.find(({ fieldPath }) => fieldPath === "marketOverview.credibility");
    if (fact === undefined || fact.evidence[0] === undefined) throw new Error("fixture fact is required");
    fact.evidence[0].normalizedValue = "UNVERIFIED";
    fact.evidence[0].rawValue = "UNVERIFIED";
    const bridge = { async bridge() { return { ok: true as const, data: fixture.marketOverviewDraft }; } };
    const result = await runBasicOfflineDryRun(normalInput(fixture, { bridge }));

    expect(result.validation).toMatchObject({ valid: false, blockers: ["UNTRUSTED_INPUT"] });
    expect(result.stages[2]).toEqual({ name: "preflight", outcome: "blocked" });
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
});

function runResult(fixture: BasicCollectionAuditBundle): BasicSourceAdapterRunResult {
  return { sourceRegister: fixture.sourceRegister, extractedFacts: fixture.extractedFacts, receipts: [] };
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
