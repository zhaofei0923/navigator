import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { MODULE_KEYS } from "@navigator/shared-types/schema";
import {
  createSourceFile,
  isImportDeclaration,
  isStringLiteral,
  ScriptKind,
  ScriptTarget,
} from "typescript";
import { describe, expect, test } from "vitest";

import {
  createBasicCollectionAuditFixture,
  readBasicCollectionAuditFixture,
} from "./basic-collection-test-fixture.js";
import { createValidBundle, getModuleCoverage } from "./basic-country-test-fixture.js";
import type {
  BasicCollectionAuditBundle,
} from "./collection/basic-collection-contracts.js";
import type { BasicSourceAdapterRunResult } from "./collection/basic-source-adapter-contracts.js";
import {
  createBasicCollectionAuditArtifacts,
  type BasicCollectionAuditArtifacts,
} from "./collection/basic-offline-audit-artifacts.js";
import type {
  BasicCollectionAuditAssemblyInput,
  BasicOfflineDryRunInput,
  BasicOfflineNormalDryRunInput,
} from "./collection/basic-offline-dry-run-contracts.js";
import { runBasicOfflineDryRun } from "./collection/basic-offline-dry-run.js";
import { buildBasicCountryImportPlan } from "./seed/basic-country-import.js";
import { validateBasicCountryBundle } from "./seed/basic-country-validator.js";

const ARTIFACT_NAMES = [
  "source-register.json",
  "extracted-facts.json",
  "market-overview.draft.json",
  "review-report.json",
] as const;

const FORBIDDEN_ARTIFACT_KEYS = [
  "canonical",
  "coverage",
  "aiEligibleKnowledgeIds",
  "publishAction",
  "boundaryVerdict",
] as const;

describe("P1-6D DB boundaries", () => {
  test("audit artifacts fail closed as canonical import input", () => {
    const artifacts = createBasicCollectionAuditArtifacts(
      readBasicCollectionAuditFixture("missing"),
    );

    expect(() => buildBasicCountryImportPlan(artifacts as never)).toThrow();
  });

  test("canonical import remains BASIC with only the ten country operations", () => {
    const bundle = createValidBundle();
    const validation = validateBasicCountryBundle(bundle);
    const plan = buildBasicCountryImportPlan(bundle);

    expect(validation).toMatchObject({
      valid: true,
      summary: {
        countryCode: "VN",
        coverageLevel: "BASIC",
        moduleStatuses: Object.fromEntries(
          MODULE_KEYS.map((moduleKey) => [
            moduleKey,
            moduleKey === "market-overview" ? "COMPLETE" : "BUILDING",
          ]),
        ),
      },
    });
    expect(bundle.canonical.country.coverageLevel).toBe("BASIC");
    const moduleCoverage = getModuleCoverage(bundle);
    expect(moduleCoverage).toHaveLength(10);
    expect(moduleCoverage.map(({ moduleKey, status }) => [moduleKey, status])).toEqual(
      MODULE_KEYS.map((moduleKey) => [
        moduleKey,
        moduleKey === "market-overview" ? "COMPLETE" : "BUILDING",
      ]),
    );
    expect(bundle.canonical.marketOverview.aiUsable).toBe(false);
    expect(plan.operations.map(({ model }) => model)).toEqual([
      "country",
      ...MODULE_KEYS.map(() => "moduleCoverage" as const),
      "marketOverview",
    ]);
    expect(plan.operations).toHaveLength(12);
    expect(plan.operations.some(({ model }) => (model as string) === "knowledgeChunk")).toBe(false);
    expect(plan.aiEligibleKnowledgeIds).toEqual([]);
  });

  test("normal and blocked results keep four artifacts separate from negative verdicts", async () => {
    const scenarios = [
      {
        scenario: "normal",
        blockers: [],
        readyForHumanReview: true,
        boundaryStages: [
          { name: "runner", outcome: "passed" },
          { name: "preflight", outcome: "passed" },
          { name: "draft-bridge", outcome: "passed" },
        ],
      },
      {
        scenario: "missing",
        blockers: ["MISSING_REQUIRED_FACT"],
        readyForHumanReview: false,
        boundaryStages: [
          { name: "runner", outcome: "skipped" },
          { name: "preflight", outcome: "blocked" },
          { name: "draft-bridge", outcome: "skipped" },
        ],
      },
      {
        scenario: "conflict",
        blockers: ["UNRESOLVED_CONFLICT"],
        readyForHumanReview: false,
        boundaryStages: [
          { name: "runner", outcome: "skipped" },
          { name: "preflight", outcome: "blocked" },
          { name: "draft-bridge", outcome: "skipped" },
        ],
      },
      {
        scenario: "untrusted",
        blockers: ["UNTRUSTED_INPUT"],
        readyForHumanReview: false,
        boundaryStages: [
          { name: "runner", outcome: "skipped" },
          { name: "preflight", outcome: "blocked" },
          { name: "draft-bridge", outcome: "skipped" },
        ],
      },
    ] as const;
    const results = await Promise.all(
      scenarios.map(({ scenario }) => runBasicOfflineDryRun(inputForScenario(scenario))),
    );

    for (const [index, result] of results.entries()) {
      const expected = scenarios[index]!;
      expect(result.scenario).toBe(expected.scenario);
      expect(result.validation.valid).toBe(true);
      expect(result.validation.blockers).toEqual(expected.blockers);
      expect(result.validation.readyForHumanReview).toBe(expected.readyForHumanReview);
      expect(result.stages.slice(1, 4)).toEqual(expected.boundaryStages);
      expect(result.artifacts).not.toBeNull();
      assertFourArtifacts(result.artifacts!);
      expect(result).toHaveProperty("boundaryVerdict");
      expect(result.artifacts).not.toBe(result.boundaryVerdict);
      for (const key of FORBIDDEN_ARTIFACT_KEYS) {
        expect(result.artifacts).not.toHaveProperty(key);
      }
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
    }
  });

  test("reads every P1-6D production source without forbidden runtime dependencies", () => {
    const sources = readOfflineProductionSources();
    const imports = sources.flatMap(({ file, source }) =>
      readImports(source).map((declaration) => ({ file, ...declaration })),
    );
    const runtimeImports = imports.filter(({ typeOnly }) => !typeOnly);
    const runtimeImportSpecifiers = runtimeImports.map(({ specifier }) => specifier);

    expect(sources).not.toHaveLength(0);
    expect(runtimeImportSpecifiers).not.toEqual(
      expect.arrayContaining([
        expect.stringMatching(/apps\/web|country-service|basic-country-import|coverage-validation|ai-advisor|prisma/i),
      ]),
    );
    expect(runtimeImportSpecifiers).not.toEqual(
      expect.arrayContaining([
        expect.stringMatching(/node:fs|node:path|child_process|hermes|searxng|llama.*transport/i),
      ]),
    );

    const runtimeSource = sources.map(({ source }) => source).join("\n");
    expect(runtimeSource).not.toMatch(/\bfetch\s*\(/i);
  });

  test("recognizes each semicolonless import and classifies runtime boundaries", () => {
    const imports = readImports(`
import type { BasicDraftModelPort } from "./basic-hermes-llama-contracts.js"
import { type DraftShape, createTransport } from "./basic-llama-cpp-transport.js"
import "node:fs"
import { runSafely } from "./safe-runtime.js"
`);

    expect(imports.map(({ specifier, typeOnly }) => ({ specifier, typeOnly }))).toEqual([
      { specifier: "./basic-hermes-llama-contracts.js", typeOnly: true },
      { specifier: "./basic-llama-cpp-transport.js", typeOnly: false },
      { specifier: "node:fs", typeOnly: false },
      { specifier: "./safe-runtime.js", typeOnly: false },
    ]);

    const runtimeSpecifiers = imports
      .filter(({ typeOnly }) => !typeOnly)
      .map(({ specifier }) => specifier);
    expect(runtimeSpecifiers).not.toContain("./basic-hermes-llama-contracts.js");
    expect(runtimeSpecifiers.filter((specifier) =>
      /node:fs|llama.*transport/i.test(specifier),
    )).toEqual(["./basic-llama-cpp-transport.js", "node:fs"]);
  });

  test("seed, import, and coverage production sources do not reverse-import P1-6D modules", () => {
    const reverseImports = readdirSync(join(process.cwd(), "src", "seed"), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
      .flatMap((entry) => {
        const source = readFileSync(join(process.cwd(), "src", "seed", entry.name), "utf8");
        return readImports(source)
          .filter(({ specifier }) => /(?:^|\/)basic-offline-[a-z0-9-]+\.js$/i.test(specifier))
          .map(({ specifier }) => `${entry.name}:${specifier}`);
      });

    expect(reverseImports).toEqual([]);
  });
});

function inputForScenario(scenario: "normal" | "missing" | "conflict" | "untrusted"): BasicOfflineDryRunInput {
  if (scenario !== "normal") {
    const bundle = readBasicCollectionAuditFixture(scenario);
    return {
      scenario,
      material: toAssemblyInput(bundle),
    };
  }

  const bundle = createBasicCollectionAuditFixture();
  const runResult: BasicSourceAdapterRunResult = {
    sourceRegister: bundle.sourceRegister,
    extractedFacts: bundle.extractedFacts,
    receipts: [],
  };
  const input: BasicOfflineNormalDryRunInput = {
    scenario,
    countryDirectory: bundle.countryDirectory,
    runId: bundle.runId,
    runner: { async run() { return runResult; } },
    bridge: { async bridge() { return { ok: true, data: bundle.marketOverviewDraft }; } },
    model: { async complete() { return {}; } },
    sourceChecks: bundle.reviewReport.sourceChecks,
    injectionRisks: bundle.reviewReport.injectionRisks,
  };
  return input;
}

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

function assertFourArtifacts(artifacts: BasicCollectionAuditArtifacts): void {
  expect(Object.keys(artifacts)).toEqual([...ARTIFACT_NAMES]);
  expect(Object.getOwnPropertyNames(artifacts)).toEqual([...ARTIFACT_NAMES]);
  expect(Object.getOwnPropertySymbols(artifacts)).toEqual([]);
  expect(JSON.stringify(artifacts)).not.toMatch(
    /canonical|coverage|aiEligibleKnowledgeIds|publishAction|boundaryVerdict/i,
  );
}

function readOfflineProductionSources(): Array<{ file: string; source: string }> {
  const directory = join(process.cwd(), "src", "collection");
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^basic-offline-.*\.ts$/.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => ({
      file: entry.name,
      source: readFileSync(join(directory, entry.name), "utf8"),
    }));
}

interface ImportDeclaration {
  specifier: string;
  typeOnly: boolean;
}

function readImports(source: string): ImportDeclaration[] {
  const sourceFile = createSourceFile(
    "basic-offline-boundary-scan.ts",
    source,
    ScriptTarget.Latest,
    true,
    ScriptKind.TS,
  );
  return sourceFile.statements.flatMap((statement) => {
    if (!isImportDeclaration(statement) || !isStringLiteral(statement.moduleSpecifier)) {
      return [];
    }
    return [{
      specifier: statement.moduleSpecifier.text,
      typeOnly: statement.importClause?.isTypeOnly ?? false,
    }];
  });
}
