import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import {
  createSourceFile,
  isExportDeclaration,
  isImportDeclaration,
  isNamedExports,
  isNamedImports,
  isStringLiteral,
  ScriptKind,
  ScriptTarget,
} from "typescript";
import { describe, expect, test, vi } from "vitest";

import { createBasicCollectionAuditFixture } from "./basic-collection-test-fixture.js";
import {
  BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION,
  classifyBasicV2FieldPath,
  type BasicDeterministicMaterializationResultV2,
} from "./collection/basic-collection-v2-contracts.js";
import type { BasicDeterministicCandidateInput } from "./collection/basic-deterministic-candidate-contracts.js";
import { runBasicDeterministicCandidate } from "./collection/basic-deterministic-candidate.js";

const CANDIDATE_ENTRY = join(
  process.cwd(),
  "src",
  "collection",
  "basic-deterministic-candidate.ts",
);
const FORBIDDEN_RUNTIME_MODULES = [
  "fs",
  "fs/promises",
  "net",
  "tls",
  "dgram",
  "http",
  "https",
  "http2",
  "child_process",
  "node:fs",
  "node:fs/promises",
  "node:net",
  "node:tls",
  "node:dgram",
  "node:http",
  "node:https",
  "node:http2",
  "node:child_process",
  "./collection/basic-source-transport.js",
  "./collection/basic-source-transport-v2.js",
  "./collection/basic-llama-cpp-transport.js",
  "./collection/basic-llama-draft-bridge.js",
  "./collection/basic-hermes-discovery.js",
  "./collection/basic-hermes-json-evidence.js",
  "./collection/basic-hermes-evidence-materializer.js",
  "./collection/basic-hermes-llama-contracts.js",
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

  test("isolates candidate import and run from environment, I/O, model, Hermes, and search modules", async () => {
    vi.resetModules();
    const runtimeFiles = readRuntimeImportClosure(CANDIDATE_ENTRY).files.map(
      ({ file }) => resolve(process.cwd(), file),
    );
    const moduleAccesses: string[] = [];
    for (const moduleName of FORBIDDEN_RUNTIME_MODULES) {
      vi.doMock(moduleName, () => {
        moduleAccesses.push(moduleName);
        return {};
      });
    }
    const originalFetch = Object.getOwnPropertyDescriptor(globalThis, "fetch");
    let fetchCalls = 0;
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value() {
        fetchCalls += 1;
        throw new Error("global fetch must not run");
      },
    });
    const originalEnv = Object.getOwnPropertyDescriptor(process, "env");
    if (originalEnv === undefined || !originalEnv.configurable) {
      throw new Error("process.env must be configurable for the isolation sentinel");
    }
    const envAccessStacks: string[] = [];
    Object.defineProperty(process, "env", {
      configurable: true,
      enumerable: originalEnv.enumerable ?? true,
      get() {
        envAccessStacks.push(new Error("process.env accessed").stack ?? "");
        return originalEnv.value;
      },
    });

    try {
      const candidate = await import("./collection/basic-deterministic-candidate.js");
      const result = await candidate.runBasicDeterministicCandidate(candidateInput());
      expect(result.failedStage).toBeNull();
    } finally {
      Object.defineProperty(process, "env", originalEnv);
      if (originalFetch === undefined) {
        delete (globalThis as { fetch?: unknown }).fetch;
      } else {
        Object.defineProperty(globalThis, "fetch", originalFetch);
      }
      for (const moduleName of FORBIDDEN_RUNTIME_MODULES) vi.doUnmock(moduleName);
      vi.resetModules();
    }

    expect(envAccessStacks.filter((stack) =>
      runtimeFiles.some((file) => stack.includes(file)))).toEqual([]);
    expect(fetchCalls).toBe(0);
    expect(moduleAccesses).toEqual([]);
  });

  test("has no forbidden module in the complete runtime import closure", () => {
    const closure = readRuntimeImportClosure(CANDIDATE_ENTRY);

    expect(closure.externalImports).not.toEqual(expect.arrayContaining([
      expect.stringMatching(/^(?:node:)?(?:fs(?:\/promises)?|path|net|tls|dgram|http|https|http2|child_process)$|\/cli\/|prisma|hermes|llama|model|search|searx|transport/i),
    ]));
    expect(closure.files.map(({ file }) => file)).not.toEqual(
      expect.arrayContaining([
        expect.stringMatching(/(?:basic-(?:source-transport(?:-v2)?|llama-cpp-transport|llama-draft-bridge|hermes-(?:discovery|json-evidence|evidence-materializer|llama-contracts))|search|searx|\/cli\/)/i),
      ]),
    );
    const runtimeSource = closure.files.map(({ source }) => source).join("\n");
    expect(runtimeSource).not.toMatch(
      /process\.env|\bfetch\s*\(|knowledgeChunk\s*\(|canonicalWrite\s*\(|stagingWrite\s*\(/i,
    );
    expect(runtimeSource).not.toMatch(/\b(?:import|require)\s*\(/);
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

function readRuntimeImportClosure(entry: string): {
  readonly files: ReadonlyArray<{ readonly file: string; readonly source: string }>;
  readonly externalImports: readonly string[];
} {
  const queue = [entry];
  const visited = new Set<string>();
  const files: Array<{ file: string; source: string }> = [];
  const externalImports: string[] = [];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (visited.has(file)) continue;
    visited.add(file);
    const source = readFileSync(file, "utf8");
    files.push({ file: relative(process.cwd(), file), source });
    for (const specifier of readRuntimeImports(source)) {
      const resolved = resolveWorkspaceModule(file, specifier);
      if (resolved === null) {
        externalImports.push(specifier);
      } else {
        queue.push(resolved);
      }
    }
  }
  return {
    files: files.sort((left, right) => compareText(left.file, right.file)),
    externalImports: externalImports.sort(compareText),
  };
}

function readRuntimeImports(source: string): string[] {
  const sourceFile = createSourceFile(
    "basic-deterministic-candidate-boundary.ts",
    source,
    ScriptTarget.Latest,
    true,
    ScriptKind.TS,
  );
  return sourceFile.statements.flatMap((statement) => {
    if (isImportDeclaration(statement) && isStringLiteral(statement.moduleSpecifier)) {
      const clause = statement.importClause;
      const namedBindings = clause?.namedBindings;
      const typeOnly = clause?.isTypeOnly === true || (
        clause?.name === undefined && namedBindings !== undefined &&
        isNamedImports(namedBindings) &&
        namedBindings.elements.every((element) => element.isTypeOnly)
      );
      return typeOnly ? [] : [statement.moduleSpecifier.text];
    }
    if (
      isExportDeclaration(statement) &&
      statement.moduleSpecifier !== undefined &&
      isStringLiteral(statement.moduleSpecifier)
    ) {
      const typeOnly = statement.isTypeOnly || (
        statement.exportClause !== undefined &&
        isNamedExports(statement.exportClause) &&
        statement.exportClause.elements.every((element) => element.isTypeOnly)
      );
      return typeOnly ? [] : [statement.moduleSpecifier.text];
    }
    return [];
  });
}

function resolveWorkspaceModule(importer: string, specifier: string): string | null {
  if (specifier.startsWith(".")) {
    const imported = resolve(dirname(importer), specifier);
    return imported.endsWith(".js")
      ? `${imported.slice(0, -".js".length)}.ts`
      : `${imported}.ts`;
  }
  if (specifier === "@navigator/shared-types/schema") {
    return resolve(process.cwd(), "..", "shared-types", "src", "schema.ts");
  }
  return null;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
