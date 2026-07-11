import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import * as database from "./index.js";
import {
  createBasicCollectionAuditFixture,
  readBasicCollectionAuditFixture,
} from "./basic-collection-test-fixture.js";
import type {
  BasicCollectionAuditArtifactName,
  BasicCollectionAuditArtifacts,
  BasicCollectionAuditAssemblyInput,
  BasicOfflineBoundaryVerdict,
  BasicOfflineBlockedDryRunInput,
  BasicOfflineDraftBridgePort,
  BasicOfflineDryRunInput,
  BasicOfflineDryRunResult,
  BasicOfflineDryRunScenario,
  BasicOfflineDryRunStage,
  BasicOfflineNormalDryRunInput,
  BasicOfflineRunnerPort,
  BasicOfflineStageName,
  BasicOfflineStageOutcome,
} from "./index.js";
import type { BasicCollectionAuditBundle } from "./index.js";

// @ts-expect-error BasicOfflinePreflightInput is package-private.
import type { BasicOfflinePreflightInput } from "./index.js";
// @ts-expect-error BasicOfflinePreflightResult is package-private.
import type { BasicOfflinePreflightResult } from "./index.js";

// @ts-expect-error preflightBasicOfflineCollection is package-private.
type PreflightBasicOfflineCollectionLeak = typeof import("./index.js")["preflightBasicOfflineCollection"];
// @ts-expect-error createBasicOfflineResult is package-private.
type CreateBasicOfflineResultLeak = typeof import("./index.js")["createBasicOfflineResult"];
// @ts-expect-error createBasicOfflineFailureResult is package-private.
type CreateBasicOfflineFailureResultLeak = typeof import("./index.js")["createBasicOfflineFailureResult"];
// @ts-expect-error createBasicOfflineStageOutcomes is package-private.
type CreateBasicOfflineStageOutcomesLeak = typeof import("./index.js")["createBasicOfflineStageOutcomes"];
// @ts-expect-error runBasicOfflineBlockedDryRun is package-private.
type RunBasicOfflineBlockedDryRunLeak = typeof import("./index.js")["runBasicOfflineBlockedDryRun"];
// @ts-expect-error snapshotBasicOfflineValue is package-private.
type SnapshotBasicOfflineValueLeak = typeof import("./index.js")["snapshotBasicOfflineValue"];
// @ts-expect-error deepFreezeBasicOfflineValue is package-private.
type DeepFreezeBasicOfflineValueLeak = typeof import("./index.js")["deepFreezeBasicOfflineValue"];
// @ts-expect-error BASIC_OFFLINE_STAGE_NAMES is package-private.
type BasicOfflineStageNamesLeak = typeof import("./index.js")["BASIC_OFFLINE_STAGE_NAMES"];

type PublicOfflineTypeWitness = [
  BasicCollectionAuditArtifactName,
  BasicCollectionAuditArtifacts,
  BasicCollectionAuditAssemblyInput,
  BasicOfflineDryRunScenario,
  BasicOfflineDryRunInput,
  BasicOfflineNormalDryRunInput,
  BasicOfflineBlockedDryRunInput,
  BasicOfflineDryRunResult,
  BasicOfflineDryRunStage,
  BasicOfflineStageName,
  BasicOfflineStageOutcome,
  BasicOfflineBoundaryVerdict,
  BasicOfflineRunnerPort,
  BasicOfflineDraftBridgePort,
];

void (undefined as unknown as PublicOfflineTypeWitness);

const EXPECTED_BASIC_OFFLINE_RUNTIME_EXPORTS = [
  'export { assembleBasicCollectionAuditBundle } from "./collection/basic-offline-audit-assembler.js";',
  'export { createBasicCollectionAuditArtifacts } from "./collection/basic-offline-audit-artifacts.js";',
  'export { runBasicOfflineDryRun } from "./collection/basic-offline-dry-run.js";',
] as const;

describe("P1-6D public exports", () => {
  test("exposes only the three documented Basic offline runtime entry points", () => {
    expect(database.assembleBasicCollectionAuditBundle).toBeTypeOf("function");
    expect(database.createBasicCollectionAuditArtifacts).toBeTypeOf("function");
    expect(database.runBasicOfflineDryRun).toBeTypeOf("function");

    for (const internalName of [
      "preflightBasicOfflineCollection",
      "createBasicOfflineResult",
      "createBasicOfflineFailureResult",
      "createBasicOfflineStageOutcomes",
      "runBasicOfflineBlockedDryRun",
      "snapshotBasicOfflineValue",
      "deepFreezeBasicOfflineValue",
      "BASIC_OFFLINE_STAGE_NAMES",
      "prepareSourceDirectory",
      "publishCapture",
      "publishNoClobber",
      "readVerifiedCapture",
      "rawCache",
      "stagingWrite",
      "canonicalWrite",
      "publishAction",
    ]) {
      expect(database).not.toHaveProperty(internalName);
    }
  });

  test("keeps index runtime exports explicit and free of Basic offline wildcards", () => {
    const indexSource = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    const basicOfflineRuntimeExports = indexSource
      .split("\n")
      .filter((line) => line.startsWith("export ") && line.includes("./collection/basic-offline-"));

    expect(basicOfflineRuntimeExports).toEqual(EXPECTED_BASIC_OFFLINE_RUNTIME_EXPORTS);
    expect(indexSource).not.toMatch(/export \* from [^;]*basic-offline-/);
  });

  test("runs normal and blocked smoke cases through the public barrel", async () => {
    const normalFixture = createBasicCollectionAuditFixture();
    const assemblyInput = toAssemblyInput(normalFixture);
    const assembled = database.assembleBasicCollectionAuditBundle(assemblyInput);
    const artifacts = database.createBasicCollectionAuditArtifacts(assembled);

    expect(Object.keys(artifacts)).toEqual([
      "source-register.json",
      "extracted-facts.json",
      "market-overview.draft.json",
      "review-report.json",
    ]);

    const normalInput: BasicOfflineNormalDryRunInput = {
      scenario: "normal",
      countryDirectory: normalFixture.countryDirectory,
      runId: normalFixture.runId,
      runner: {
        async run() {
          return {
            sourceRegister: normalFixture.sourceRegister,
            extractedFacts: normalFixture.extractedFacts,
            receipts: [],
          };
        },
      },
      bridge: {
        async bridge() {
          return { ok: true, data: normalFixture.marketOverviewDraft };
        },
      },
      model: { async complete() { return {}; } },
      sourceChecks: normalFixture.reviewReport.sourceChecks,
      injectionRisks: normalFixture.reviewReport.injectionRisks,
    };
    const normalResult = await database.runBasicOfflineDryRun(normalInput);
    expect(normalResult.scenario).toBe("normal");
    expect(normalResult.validation.valid).toBe(true);

    const blockedFixture = readBasicCollectionAuditFixture("missing");
    const blockedResult = await database.runBasicOfflineDryRun({
      scenario: "missing",
      material: toAssemblyInput(blockedFixture),
    });
    expect(blockedResult.scenario).toBe("missing");
    expect(blockedResult.stages.find(({ name }) => name === "runner")).toEqual({
      name: "runner",
      outcome: "skipped",
    });
    expect(blockedResult.artifacts).not.toBeNull();
  });
});

function toAssemblyInput(bundle: BasicCollectionAuditBundle): BasicCollectionAuditAssemblyInput {
  return {
    countryDirectory: bundle.countryDirectory,
    runId: bundle.runId,
    sourceRegister: bundle.sourceRegister,
    extractedFacts: bundle.extractedFacts,
    marketOverviewDraft: bundle.marketOverviewDraft,
    sourceChecks: bundle.reviewReport.sourceChecks,
    injectionRisks: bundle.reviewReport.injectionRisks,
  };
}
