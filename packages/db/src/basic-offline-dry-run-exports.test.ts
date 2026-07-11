import { readFileSync } from "node:fs";

import {
  createSourceFile,
  isExportDeclaration,
  isNamedExports,
  isStringLiteral,
  ScriptKind,
  ScriptTarget,
} from "typescript";
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
// @ts-expect-error BasicOfflineSnapshotResult is package-private.
import type { BasicOfflineSnapshotResult } from "./index.js";

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
// @ts-expect-error deeplyEqualBasicOfflineValue is package-private.
type DeeplyEqualBasicOfflineValueLeak = typeof import("./index.js")["deeplyEqualBasicOfflineValue"];
// @ts-expect-error isRecord is package-private.
type IsRecordLeak = typeof import("./index.js")["isRecord"];
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

const EXPECTED_BASIC_OFFLINE_RUNTIME_EXPORTS: readonly BasicOfflineNamedExport[] = [
  {
    moduleSpecifier: "./collection/basic-offline-audit-artifacts.js",
    exportedName: "createBasicCollectionAuditArtifacts",
    localName: "createBasicCollectionAuditArtifacts",
  },
  {
    moduleSpecifier: "./collection/basic-offline-audit-assembler.js",
    exportedName: "assembleBasicCollectionAuditBundle",
    localName: "assembleBasicCollectionAuditBundle",
  },
  {
    moduleSpecifier: "./collection/basic-offline-dry-run.js",
    exportedName: "runBasicOfflineDryRun",
    localName: "runBasicOfflineDryRun",
  },
] as const;

const DOCUMENTED_BASIC_OFFLINE_PUBLIC_TYPES = [
  "BasicCollectionAuditArtifactName",
  "BasicCollectionAuditArtifacts",
  "BasicCollectionAuditAssemblyInput",
  "BasicOfflineBoundaryVerdict",
  "BasicOfflineBlockedDryRunInput",
  "BasicOfflineDraftBridgePort",
  "BasicOfflineDryRunInput",
  "BasicOfflineDryRunResult",
  "BasicOfflineDryRunScenario",
  "BasicOfflineDryRunStage",
  "BasicOfflineNormalDryRunInput",
  "BasicOfflineRunnerPort",
  "BasicOfflineStageName",
  "BasicOfflineStageOutcome",
] as const;

const INTERNAL_BASIC_OFFLINE_RUNTIME_NAMES = [
  "preflightBasicOfflineCollection",
  "createBasicOfflineResult",
  "createBasicOfflineFailureResult",
  "createBasicOfflineStageOutcomes",
  "runBasicOfflineBlockedDryRun",
  "snapshotBasicOfflineValue",
  "deepFreezeBasicOfflineValue",
  "deeplyEqualBasicOfflineValue",
  "isRecord",
  "BASIC_OFFLINE_STAGE_NAMES",
  "prepareSourceDirectory",
  "publishCapture",
  "publishNoClobber",
  "readVerifiedCapture",
  "rawCache",
  "stagingWrite",
  "canonicalWrite",
  "publishAction",
] as const;

describe("P1-6D public exports", () => {
  test("exposes only the three documented Basic offline runtime entry points", () => {
    expect(database.assembleBasicCollectionAuditBundle).toBeTypeOf("function");
    expect(database.createBasicCollectionAuditArtifacts).toBeTypeOf("function");
    expect(database.runBasicOfflineDryRun).toBeTypeOf("function");

    for (const internalName of INTERNAL_BASIC_OFFLINE_RUNTIME_NAMES) {
      expect(database).not.toHaveProperty(internalName);
    }
  });

  test("keeps documented Basic offline exports named, explicit, and wildcard-free", () => {
    const indexSource = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    const exports = collectBasicOfflineExports(indexSource);

    expect(exports.runtime).toEqual(EXPECTED_BASIC_OFFLINE_RUNTIME_EXPORTS);
    expect(exports.types.map(({ exportedName }) => exportedName).sort()).toEqual(
      [...DOCUMENTED_BASIC_OFFLINE_PUBLIC_TYPES].sort(),
    );
    expect(exports.wildcards).toEqual([]);
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

interface BasicOfflineNamedExport {
  moduleSpecifier: string;
  exportedName: string;
  localName: string;
}

interface BasicOfflineExports {
  runtime: BasicOfflineNamedExport[];
  types: BasicOfflineNamedExport[];
  wildcards: string[];
}

function collectBasicOfflineExports(source: string): BasicOfflineExports {
  const sourceFile = createSourceFile(
    "index.ts",
    source,
    ScriptTarget.Latest,
    true,
    ScriptKind.TS,
  );
  const result: BasicOfflineExports = { runtime: [], types: [], wildcards: [] };

  for (const statement of sourceFile.statements) {
    if (
      !isExportDeclaration(statement) ||
      statement.moduleSpecifier === undefined ||
      !isStringLiteral(statement.moduleSpecifier) ||
      !statement.moduleSpecifier.text.startsWith("./collection/basic-offline-")
    ) {
      continue;
    }

    const moduleSpecifier = statement.moduleSpecifier.text;
    if (statement.exportClause === undefined || !isNamedExports(statement.exportClause)) {
      result.wildcards.push(moduleSpecifier);
      continue;
    }

    for (const element of statement.exportClause.elements) {
      const target = statement.isTypeOnly || element.isTypeOnly
        ? result.types
        : result.runtime;
      target.push({
        moduleSpecifier,
        exportedName: element.name.text,
        localName: element.propertyName?.text ?? element.name.text,
      });
    }
  }

  result.runtime.sort(compareNamedExports);
  result.types.sort(compareNamedExports);
  result.wildcards.sort();
  return result;
}

function compareNamedExports(
  left: BasicOfflineNamedExport,
  right: BasicOfflineNamedExport,
): number {
  return left.moduleSpecifier.localeCompare(right.moduleSpecifier) ||
    left.exportedName.localeCompare(right.exportedName) ||
    left.localName.localeCompare(right.localName);
}
