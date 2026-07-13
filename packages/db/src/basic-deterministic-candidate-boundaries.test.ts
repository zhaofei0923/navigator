import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  createSourceFile,
  isImportDeclaration,
  isStringLiteral,
  ScriptKind,
  ScriptTarget,
} from "typescript";
import { describe, expect, test } from "vitest";

import { createBasicCollectionAuditFixture } from "./basic-collection-test-fixture.js";
import {
  BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION,
  classifyBasicV2FieldPath,
  type BasicDeterministicMaterializationResultV2,
} from "./collection/basic-collection-v2-contracts.js";
import type { BasicDeterministicCandidateInput } from "./collection/basic-deterministic-candidate-contracts.js";
import { runBasicDeterministicCandidate } from "./collection/basic-deterministic-candidate.js";

const CANDIDATE_FILES = [
  "basic-deterministic-candidate-contracts.ts",
  "basic-deterministic-candidate-result.ts",
  "basic-deterministic-candidate.ts",
] as const;

describe("Basic deterministic candidate boundaries", () => {
  test("returns the exact negative side-effect verdict and no canonical material", async () => {
    const result = await runBasicDeterministicCandidate(candidateInput());

    expect(result.failedStage).toBeNull();
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
    expect(Object.keys(result.boundaryVerdict)).toEqual([
      "rawCache", "stagingWrite", "manifest", "canonicalWrite", "prismaWrite",
      "coverageDerivation", "publishAction", "knowledgeChunkCount",
      "aiUsableTrueCount", "aiEligibleKnowledgeIds",
    ]);
    expect(JSON.stringify(result.artifacts)).not.toMatch(
      /canonical|coverage|manifest|prisma|publishAction|knowledgeChunk|aiEligible/i,
    );
  });

  test("does not call global fetch on the ready path", async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "fetch");
    let calls = 0;
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value() {
        calls += 1;
        throw new Error("global fetch must not run");
      },
    });
    try {
      const result = await runBasicDeterministicCandidate(candidateInput());
      expect(result.failedStage).toBeNull();
      expect(calls).toBe(0);
    } finally {
      if (original === undefined) delete (globalThis as { fetch?: unknown }).fetch;
      else Object.defineProperty(globalThis, "fetch", original);
    }
  });

  test.each(["model", "hermes", "search", "completion", "generative"])(
    "rejects a hostile %s capability without executing its accessor",
    async (key) => {
      const input = candidateInput();
      let executions = 0;
      Object.defineProperty(input, key, {
        enumerable: true,
        get() {
          executions += 1;
          throw new Error("forbidden capability executed");
        },
      });

      const result = await runBasicDeterministicCandidate(
        input as BasicDeterministicCandidateInput,
      );

      expect(result.failedStage).toBe("input");
      expect(executions).toBe(0);
    },
  );

  test("has no filesystem, process, socket, child-process, CLI, model, Hermes, or search runtime boundary", () => {
    const sources = CANDIDATE_FILES.map((file) => ({
      file,
      source: readFileSync(join(process.cwd(), "src", "collection", file), "utf8"),
    }));
    const runtimeImports = sources.flatMap(({ file, source }) =>
      readImports(source)
        .filter(({ typeOnly }) => !typeOnly)
        .map(({ specifier }) => `${file}:${specifier}`),
    );

    expect(runtimeImports).not.toEqual(expect.arrayContaining([
      expect.stringMatching(/node:(?:fs|path|net|tls|dgram|child_process)|\/cli\/|prisma|hermes|llama|model|search|searx/i),
    ]));
    const runtimeSource = sources.map(({ source }) => source).join("\n");
    expect(runtimeSource).not.toMatch(
      /process\.env|\bfetch\s*\(|knowledgeChunk\s*\(|canonicalWrite\s*\(|stagingWrite\s*\(/i,
    );
  });
});

function candidateInput(): BasicDeterministicCandidateInput {
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
  return {
    countryDirectory: bundle.countryDirectory,
    countryCode: sourceRegister.countryCode,
    runId: sourceRegister.runId,
    catalogVersion: sourceRegister.catalogVersion,
    catalogSha256: sourceRegister.catalogSha256,
    runner: { run() { return Promise.resolve(materialization); } },
    sourceChecks: bundle.reviewReport.sourceChecks.sort((left, right) => compareText(left.sourceId, right.sourceId)),
    injectionRisks: [],
  };
}

function readImports(source: string): Array<{ specifier: string; typeOnly: boolean }> {
  const sourceFile = createSourceFile(
    "basic-deterministic-candidate-boundary.ts",
    source,
    ScriptTarget.Latest,
    true,
    ScriptKind.TS,
  );
  return sourceFile.statements.flatMap((statement) => {
    if (!isImportDeclaration(statement) || !isStringLiteral(statement.moduleSpecifier)) return [];
    return [{
      specifier: statement.moduleSpecifier.text,
      typeOnly: statement.importClause?.isTypeOnly ?? false,
    }];
  });
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
