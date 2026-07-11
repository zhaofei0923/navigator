import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, test } from "vitest";

import {
  preflightBasicCountryActivation,
  type BasicActivationCountPort,
  type BasicActivationModel,
  type BasicActivationScope,
} from "./seed/basic-country-activation-preflight.js";
import {
  classifyBasicCountryActivationPreflightArgs,
  createIdBasicActivationOperatorSummary,
  createPrismaBasicActivationCountPort,
  runBasicCountryActivationPreflightCli,
} from "./seed/basic-country-activation-preflight-cli.js";

interface CountCall {
  readonly model: BasicActivationModel;
  readonly scope: BasicActivationScope;
  readonly countryCode: string;
}

const DEEP_AND_KNOWLEDGE_MODELS = [
  "policy",
  "risk",
  "opportunity",
  "project",
  "partner",
  "chineseCompany",
  "entryStrategy",
  "report",
  "knowledgeChunk",
] as const satisfies readonly BasicActivationModel[];

const ALL_MODELS = [
  "marketOverview",
  ...DEEP_AND_KNOWLEDGE_MODELS,
] as const satisfies readonly BasicActivationModel[];

const EXPECTED_QUERY_MATRIX = [
  ...DEEP_AND_KNOWLEDGE_MODELS.map((model) => ({ model, scope: "all" as const })),
  ...DEEP_AND_KNOWLEDGE_MODELS.map((model) => ({
    model,
    scope: "published" as const,
  })),
  ...ALL_MODELS.map((model) => ({ model, scope: "ai-eligible" as const })),
] as const;

function countKey(model: BasicActivationModel, scope: BasicActivationScope): string {
  return `${model}:${scope}`;
}

function createCountPort(
  counts: Readonly<Record<string, number>> = {},
  rejectedKey: string | null = null,
): { readonly port: BasicActivationCountPort; readonly calls: CountCall[] } {
  const calls: CountCall[] = [];

  return {
    calls,
    port: {
      async count(model, scope, countryCode) {
        calls.push({ model, scope, countryCode });
        const key = countKey(model, scope);
        if (key === rejectedKey) {
          throw new Error("sensitive datastore failure");
        }
        return counts[key] ?? 0;
      },
    },
  };
}

function createRuntimeCountPort(
  invalidValue: unknown,
  invalidCallIndex = 4,
): { readonly port: BasicActivationCountPort; readonly calls: CountCall[] } {
  const calls: CountCall[] = [];

  return {
    calls,
    port: {
      async count(model, scope, countryCode) {
        calls.push({ model, scope, countryCode });
        return (calls.length === invalidCallIndex ? invalidValue : 0) as number;
      },
    },
  };
}

describe("preflightBasicCountryActivation", () => {
  test("passes all-zero counts in the fixed country-generic query order", async () => {
    const { port, calls } = createCountPort();

    const result = await preflightBasicCountryActivation("VN", port);

    expect(calls).toEqual(
      EXPECTED_QUERY_MATRIX.map(({ model, scope }) => ({
        model,
        scope,
        countryCode: "VN",
      })),
    );
    expect(result).toEqual({
      countryCode: "VN",
      activation: "ready",
      blockerCode: null,
      cleanupRequired: false,
      valid: true,
      errors: [],
      counts: Object.fromEntries(
        EXPECTED_QUERY_MATRIX.map(({ model, scope }) => [
          countKey(model, scope),
          0,
        ]),
      ),
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.errors)).toBe(true);
    expect(Object.isFrozen(result.counts)).toBe(true);
  });

  test.each(DEEP_AND_KNOWLEDGE_MODELS)(
    "blocks when %s has any total legacy rows",
    async (model) => {
      const key = countKey(model, "all");
      const { port } = createCountPort({ [key]: 1 });

      const result = await preflightBasicCountryActivation("VN", port);

      expect(result).toMatchObject({
        activation: "blocked",
        blockerCode: "LEGACY_COUNTRY_DATA_PRESENT",
        cleanupRequired: true,
        valid: true,
      });
      expect(result.counts?.[key]).toBe(1);
    },
  );

  test.each(DEEP_AND_KNOWLEDGE_MODELS)(
    "blocks when %s has a published non-market row",
    async (model) => {
      const key = countKey(model, "published");
      const { port } = createCountPort({ [key]: 1 });

      const result = await preflightBasicCountryActivation("VN", port);

      expect(result).toMatchObject({
        activation: "blocked",
        blockerCode: "LEGACY_COUNTRY_DATA_PRESENT",
        cleanupRequired: true,
        valid: true,
      });
      expect(result.counts?.[key]).toBe(1);
    },
  );

  test.each(ALL_MODELS)(
    "blocks when %s has an AI-eligible row",
    async (model) => {
      const key = countKey(model, "ai-eligible");
      const { port } = createCountPort({ [key]: 1 });

      const result = await preflightBasicCountryActivation("VN", port);

      expect(result).toMatchObject({
        activation: "blocked",
        blockerCode: "LEGACY_COUNTRY_DATA_PRESENT",
        cleanupRequired: true,
        valid: true,
      });
      expect(result.counts?.[key]).toBe(1);
    },
  );

  test.each(["", "V", "VNM", "vn", "V1", " V"])(
    "fails closed without querying for invalid ISO2 input %j",
    async (countryCode) => {
      const { port, calls } = createCountPort();

      const result = await preflightBasicCountryActivation(countryCode, port);

      expect(calls).toEqual([]);
      expect(result).toEqual({
        countryCode,
        activation: "blocked",
        blockerCode: "PREFLIGHT_QUERY_FAILED",
        cleanupRequired: false,
        valid: false,
        errors: ["INVALID_COUNTRY_CODE"],
        counts: null,
      });
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.errors)).toBe(true);
    },
  );

  test("fails closed and redacts partial counts and query errors", async () => {
    const rejectedKey = countKey("project", "published");
    const { port } = createCountPort({}, rejectedKey);

    const result = await preflightBasicCountryActivation("VN", port);

    expect(result).toEqual({
      countryCode: "VN",
      activation: "blocked",
      blockerCode: "PREFLIGHT_QUERY_FAILED",
      cleanupRequired: false,
      valid: false,
      errors: ["COUNT_QUERY_FAILED"],
      counts: null,
    });
    expect(JSON.stringify(result)).not.toContain("sensitive datastore failure");
  });

  test.each([
    ["NaN", Number.NaN],
    ["negative", -1],
    ["fractional", 0.5],
    ["positive infinity", Number.POSITIVE_INFINITY],
    ["negative infinity", Number.NEGATIVE_INFINITY],
    ["unsafe integer", Number.MAX_SAFE_INTEGER + 1],
    ["runtime string", "0"],
    ["runtime object", { count: 0 }],
  ])("fails closed and discards partial counts for a %s count", async (_label, value) => {
    const { port, calls } = createRuntimeCountPort(value);

    const result = await preflightBasicCountryActivation("VN", port);

    expect(calls).toHaveLength(4);
    expect(result).toEqual({
      countryCode: "VN",
      activation: "blocked",
      blockerCode: "PREFLIGHT_QUERY_FAILED",
      cleanupRequired: false,
      valid: false,
      errors: ["COUNT_QUERY_FAILED"],
      counts: null,
    });
    expect(JSON.stringify(result)).not.toContain(String(value));
  });

  test("returns only frozen aggregate fields and no records or evidence", async () => {
    const { port } = createCountPort({ [countKey("risk", "all")]: 3 });

    const result = await preflightBasicCountryActivation("VN", port);
    const serialized = JSON.stringify(result);

    expect(Object.keys(result).sort()).toEqual([
      "activation",
      "blockerCode",
      "cleanupRequired",
      "countryCode",
      "counts",
      "errors",
      "valid",
    ]);
    expect(serialized).not.toMatch(/records|sourceUrl|evidence/i);
    expect(serialized).not.toMatch(/Indonesia|OPS-DATA-ID-BASIC-CLEANUP/i);
  });
});

describe("DATA-BASIC-ID preflight CLI boundary", () => {
  test("wires the exact Node TypeScript source-loader package command", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { readonly scripts?: Readonly<Record<string, string>> };

    expect(packageJson.scripts?.["preflight:basic-activation"]).toBe(
      "node --experimental-transform-types --experimental-loader ../../scripts/node-ts-source-loader.mjs src/seed/basic-country-activation-preflight-cli.ts",
    );
  });

  test.each([
    { args: ["--", "ID"], expected: "run" },
    { args: ["--", "--help"], expected: "help" },
    { args: [], expected: "invalid" },
    { args: ["ID"], expected: "invalid" },
    { args: ["--help"], expected: "invalid" },
    { args: ["VN"], expected: "invalid" },
    { args: ["id"], expected: "invalid" },
    { args: ["ID", "extra"], expected: "invalid" },
  ])("classifies exact args $args as $expected", ({ args, expected }) => {
    expect(classifyBasicCountryActivationPreflightArgs(args)).toBe(expected);
  });

  test("maps only the generic legacy blocker to the Indonesia cleanup task", async () => {
    const { port: blockedPort } = createCountPort({
      [countKey("policy", "all")]: 1,
    });
    const genericResult = await preflightBasicCountryActivation("ID", blockedPort);

    expect(createIdBasicActivationOperatorSummary(genericResult)).toEqual({
      ...genericResult,
      nextTask: "OPS-DATA-ID-BASIC-CLEANUP",
    });

    const { port: failedPort } = createCountPort(
      {},
      countKey("policy", "all"),
    );
    const failedResult = await preflightBasicCountryActivation("ID", failedPort);
    expect(createIdBasicActivationOperatorSummary(failedResult)).toEqual(
      failedResult,
    );
  });

  function createCliHarness(options: {
    readonly constructorError?: unknown;
    readonly countError?: unknown;
    readonly disconnectError?: unknown;
    readonly preflightError?: unknown;
    readonly count?: number;
  } = {}) {
    let constructorCalls = 0;
    let disconnectCalls = 0;
    let preflightCalls = 0;
    const stdout: string[] = [];
    const stderr: string[] = [];
    const delegate = {
      count: async () => {
        if (options.countError !== undefined) {
          throw options.countError;
        }
        return options.count ?? 0;
      },
    };
    const client = {
      marketOverview: delegate,
      policy: delegate,
      risk: delegate,
      opportunity: delegate,
      project: delegate,
      partner: delegate,
      chineseCompany: delegate,
      entryStrategy: delegate,
      report: delegate,
      knowledgeChunk: delegate,
      async $disconnect() {
        disconnectCalls += 1;
        if (options.disconnectError !== undefined) {
          throw options.disconnectError;
        }
      },
    };

    return {
      dependencies: {
        createClient() {
          constructorCalls += 1;
          if (options.constructorError !== undefined) {
            throw options.constructorError;
          }
          return client as never;
        },
        async preflight(countryCode: string, port: BasicActivationCountPort) {
          preflightCalls += 1;
          if (options.preflightError !== undefined) {
            throw options.preflightError;
          }
          return preflightBasicCountryActivation(countryCode, port);
        },
        writeStdout(output: string) {
          stdout.push(output);
        },
        writeStderr(output: string) {
          stderr.push(output);
        },
      },
      counts: () => ({ constructorCalls, disconnectCalls, preflightCalls }),
      stdout,
      stderr,
    };
  }

  test.each([
    { args: ["--", "--help"], exitCode: 0, stream: "stdout" },
    { args: ["--", "VN"], exitCode: 2, stream: "stderr" },
  ] as const)(
    "handles $args before client construction",
    async ({ args, exitCode, stream }) => {
      const harness = createCliHarness({
        constructorError: new Error("must not construct"),
      });

      await expect(
        runBasicCountryActivationPreflightCli(args, harness.dependencies),
      ).resolves.toBe(exitCode);

      expect(harness.counts()).toEqual({
        constructorCalls: 0,
        disconnectCalls: 0,
        preflightCalls: 0,
      });
      expect(harness.stdout).toHaveLength(stream === "stdout" ? 1 : 0);
      expect(harness.stderr).toHaveLength(stream === "stderr" ? 1 : 0);
    },
  );

  test.each([
    {
      label: "constructor failure",
      options: { constructorError: new Error("secret constructor failure") },
      disconnectCalls: 0,
      stream: "stderr",
      error: "PREFLIGHT_LIFECYCLE_FAILED",
    },
    {
      label: "query failure",
      options: { countError: new Error("secret query failure") },
      disconnectCalls: 1,
      stream: "stdout",
      error: "COUNT_QUERY_FAILED",
    },
    {
      label: "disconnect failure",
      options: { disconnectError: new Error("secret disconnect failure") },
      disconnectCalls: 1,
      stream: "stderr",
      error: "PREFLIGHT_LIFECYCLE_FAILED",
    },
  ] as const)(
    "emits one redacted nonzero summary for $label",
    async ({ options, disconnectCalls, stream, error }) => {
      const harness = createCliHarness(options);

      await expect(
        runBasicCountryActivationPreflightCli(
          ["--", "ID"],
          harness.dependencies,
        ),
      ).resolves.toBe(1);

      expect(harness.counts()).toEqual({
        constructorCalls: 1,
        disconnectCalls,
        preflightCalls: disconnectCalls,
      });
      expect(harness.stdout.length + harness.stderr.length).toBe(1);
      const output = [...harness.stdout, ...harness.stderr][0]!;
      expect(harness.stdout).toHaveLength(stream === "stdout" ? 1 : 0);
      expect(harness.stderr).toHaveLength(stream === "stderr" ? 1 : 0);
      expect(JSON.parse(output)).toEqual({
        countryCode: "ID",
        activation: "blocked",
        blockerCode: "PREFLIGHT_QUERY_FAILED",
        cleanupRequired: false,
        valid: false,
        errors: [error],
        counts: null,
      });
      expect(output).not.toMatch(/secret|constructor|disconnect/i);
    },
  );

  test("redacts an unexpected injected preflight rejection after disconnect", async () => {
    const harness = createCliHarness({
      preflightError: new Error("secret unexpected preflight failure"),
    });

    await expect(
      runBasicCountryActivationPreflightCli(
        ["--", "ID"],
        harness.dependencies,
      ),
    ).resolves.toBe(1);

    expect(harness.counts()).toEqual({
      constructorCalls: 1,
      disconnectCalls: 1,
      preflightCalls: 1,
    });
    expect(harness.stdout).toEqual([]);
    expect(harness.stderr).toHaveLength(1);
    expect(JSON.parse(harness.stderr[0]!)).toEqual({
      countryCode: "ID",
      activation: "blocked",
      blockerCode: "PREFLIGHT_QUERY_FAILED",
      cleanupRequired: false,
      valid: false,
      errors: ["PREFLIGHT_LIFECYCLE_FAILED"],
      counts: null,
    });
    expect(harness.stderr[0]).not.toMatch(/secret|unexpected|preflight failure/i);
  });

  test.each([
    { count: 0, exitCode: 0, blockerCode: null },
    { count: 1, exitCode: 1, blockerCode: "LEGACY_COUNTRY_DATA_PRESENT" },
  ])(
    "waits for one disconnect before emitting the $blockerCode summary",
    async ({ count, exitCode, blockerCode }) => {
      const harness = createCliHarness({ count });

      await expect(
        runBasicCountryActivationPreflightCli(
          ["--", "ID"],
          harness.dependencies,
        ),
      ).resolves.toBe(exitCode);

      expect(harness.counts()).toEqual({
        constructorCalls: 1,
        disconnectCalls: 1,
        preflightCalls: 1,
      });
      expect(harness.stdout).toHaveLength(1);
      expect(harness.stderr).toEqual([]);
      expect(JSON.parse(harness.stdout[0]!)).toMatchObject({ blockerCode });
    },
  );

  test("maps models and scopes to exact Prisma count filters without a database", async () => {
    const calls: Array<{ delegate: string; args: unknown }> = [];
    const delegate = (name: string) => ({
      count: async (args: unknown) => {
        calls.push({ delegate: name, args });
        return 0;
      },
    });
    const prismaClient = {
      marketOverview: delegate("marketOverview"),
      policy: delegate("policy"),
      risk: delegate("risk"),
      opportunity: delegate("opportunity"),
      project: delegate("project"),
      partner: delegate("partner"),
      chineseCompany: delegate("chineseCompany"),
      entryStrategy: delegate("entryStrategy"),
      report: delegate("report"),
      knowledgeChunk: delegate("knowledgeChunk"),
    };
    const port = createPrismaBasicActivationCountPort(
      prismaClient as never,
    );

    for (const model of ALL_MODELS) {
      await port.count(model, "all", "VN");
      await port.count(model, "published", "VN");
      await port.count(model, "ai-eligible", "VN");
    }

    expect(calls).toEqual(
      ALL_MODELS.flatMap((model) => [
        {
          delegate: model,
          args: { where: { countryCode: "VN" } },
        },
        {
          delegate: model,
          args: {
            where: {
              countryCode: "VN",
              reviewStatus: "published",
            },
          },
        },
        {
          delegate: model,
          args: {
            where: {
              countryCode: "VN",
              reviewStatus: "published",
              aiUsable: true,
              credibility: { not: "UNVERIFIED" },
            },
          },
        },
      ]),
    );
  });

  interface PrismaUsageAnalysis {
    readonly rootedCalls: readonly string[];
    readonly violations: readonly string[];
    readonly unrelatedCalls: readonly string[];
  }

  function analyzePrismaUsage(sourceText: string): PrismaUsageAnalysis {
    const fileName = "/fixture.ts";
    const sourceFile = ts.createSourceFile(
      fileName,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const compilerHost: ts.CompilerHost = {
      fileExists: (candidate) => candidate === fileName,
      getCanonicalFileName: (candidate) => candidate,
      getCurrentDirectory: () => "/",
      getDefaultLibFileName: () => "/lib.d.ts",
      getNewLine: () => "\n",
      getSourceFile: (candidate) =>
        candidate === fileName ? sourceFile : undefined,
      readFile: (candidate) => candidate === fileName ? sourceText : undefined,
      useCaseSensitiveFileNames: () => true,
      writeFile: () => undefined,
    };
    const program = ts.createProgram({
      rootNames: [fileName],
      options: {
        module: ts.ModuleKind.ESNext,
        noLib: true,
        strict: true,
        target: ts.ScriptTarget.Latest,
      },
      host: compilerHost,
    });
    const checker = program.getTypeChecker();
    const rootSymbols = new Set<ts.Symbol>();
    const rootDeclarations = new Set<ts.Identifier>();
    const rootedCalls: string[] = [];
    const unrelatedCalls: string[] = [];
    const violations = new Set<string>();

    const isPrismaClientTypeNode = (type: ts.TypeNode | undefined): boolean =>
      type !== undefined &&
      (type.getText(sourceFile) === "PrismaClient" ||
        type.getText(sourceFile).endsWith(".PrismaClient"));

    const symbolAt = (node: ts.Node): ts.Symbol | null => {
      if (
        ts.isIdentifier(node) &&
        ts.isShorthandPropertyAssignment(node.parent) &&
        node.parent.name === node
      ) {
        return (
          checker.getShorthandAssignmentValueSymbol(node.parent) ??
          checker.getSymbolAtLocation(node) ??
          null
        );
      }
      return checker.getSymbolAtLocation(node) ?? null;
    };

    const unwrap = (expression: ts.Expression): ts.Expression => {
      let current = expression;
      while (
        ts.isParenthesizedExpression(current) ||
        ts.isAsExpression(current) ||
        ts.isTypeAssertionExpression(current) ||
        ts.isSatisfiesExpression(current) ||
        ts.isNonNullExpression(current)
      ) {
        current = current.expression;
      }
      return current;
    };

    const isConstructedClient = (expression: ts.Expression): boolean => {
      const candidate = unwrap(expression);
      return (
        ts.isNewExpression(candidate) &&
        ts.isIdentifier(candidate.expression) &&
        candidate.expression.text === "PrismaClient"
      );
    };

    const functionReturnsPrismaClient = (
      declaration: ts.Declaration,
    ): boolean => {
      if (
        (ts.isFunctionDeclaration(declaration) ||
          ts.isFunctionExpression(declaration) ||
          ts.isArrowFunction(declaration) ||
          ts.isMethodDeclaration(declaration) ||
          ts.isMethodSignature(declaration)) &&
        isPrismaClientTypeNode(declaration.type)
      ) {
        return true;
      }
      if (
        ts.isPropertySignature(declaration) &&
        declaration.type !== undefined &&
        ts.isFunctionTypeNode(declaration.type) &&
        isPrismaClientTypeNode(declaration.type.type)
      ) {
        return true;
      }

      let body: ts.ConciseBody | undefined;
      if (
        ts.isFunctionDeclaration(declaration) ||
        ts.isFunctionExpression(declaration) ||
        ts.isArrowFunction(declaration) ||
        ts.isMethodDeclaration(declaration)
      ) {
        body = declaration.body;
      }
      if (body === undefined) {
        return false;
      }
      if (!ts.isBlock(body)) {
        return isConstructedClient(body);
      }

      let returnsClient = false;
      const inspectReturn = (node: ts.Node): void => {
        if (
          ts.isReturnStatement(node) &&
          node.expression !== undefined &&
          isConstructedClient(node.expression)
        ) {
          returnsClient = true;
          return;
        }
        if (!ts.isFunctionLike(node) || node === declaration) {
          ts.forEachChild(node, inspectReturn);
        }
      };
      inspectReturn(body);
      return returnsClient;
    };

    const callReturnsPrismaClient = (call: ts.CallExpression): boolean => {
      const signature = checker.getResolvedSignature(call);
      if (signature !== undefined) {
        const returnName = checker.typeToString(
          checker.getReturnTypeOfSignature(signature),
        );
        if (
          returnName === "PrismaClient" ||
          returnName.endsWith(".PrismaClient")
        ) {
          return true;
        }
        if (
          signature.declaration !== undefined &&
          functionReturnsPrismaClient(signature.declaration)
        ) {
          return true;
        }
      }

      const callee = unwrap(call.expression);
      const symbol = symbolAt(
        ts.isPropertyAccessExpression(callee) ? callee.name : callee,
      );
      return (
        symbol?.declarations?.some((declaration) => {
          if (
            ts.isVariableDeclaration(declaration) &&
            declaration.initializer !== undefined &&
            (ts.isArrowFunction(declaration.initializer) ||
              ts.isFunctionExpression(declaration.initializer))
          ) {
            return functionReturnsPrismaClient(declaration.initializer);
          }
          return functionReturnsPrismaClient(declaration);
        }) ?? false
      );
    };

    const initializerCreatesRoot = (
      initializer: ts.Expression | undefined,
    ): boolean => {
      if (initializer === undefined) {
        return false;
      }
      const candidate = unwrap(initializer);
      return (
        isConstructedClient(candidate) ||
        (ts.isCallExpression(candidate) && callReturnsPrismaClient(candidate))
      );
    };

    const collectRoots = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        (isPrismaClientTypeNode(node.type) ||
          initializerCreatesRoot(node.initializer))
      ) {
        const symbol = symbolAt(node.name);
        if (symbol !== null) {
          rootSymbols.add(symbol);
          rootDeclarations.add(node.name);
        }
      } else if (
        ts.isVariableDeclaration(node) &&
        !ts.isIdentifier(node.name) &&
        initializerCreatesRoot(node.initializer)
      ) {
        violations.add("unsupported-root-binding-pattern");
      } else if (
        ts.isParameter(node) &&
        ts.isIdentifier(node.name) &&
        isPrismaClientTypeNode(node.type)
      ) {
        const symbol = symbolAt(node.name);
        if (symbol !== null) {
          rootSymbols.add(symbol);
          rootDeclarations.add(node.name);
        }
      }
      ts.forEachChild(node, collectRoots);
    };
    collectRoots(sourceFile);

    interface MemberSegment {
      readonly access: "dot" | "element";
      readonly name: string | null;
      readonly optional: boolean;
    }

    const transparentParent = (
      expression: ts.Expression,
    ): ts.Expression | null => {
      const parent = expression.parent;
      if (
        (ts.isParenthesizedExpression(parent) ||
          ts.isAsExpression(parent) ||
          ts.isTypeAssertionExpression(parent) ||
          ts.isSatisfiesExpression(parent) ||
          ts.isNonNullExpression(parent)) &&
        parent.expression === expression
      ) {
        return parent;
      }
      return null;
    };

    const memberName = (
      expression: ts.Expression | undefined,
    ): string | null => {
      if (expression === undefined) {
        return null;
      }
      const candidate = unwrap(expression);
      if (
        ts.isStringLiteral(candidate) ||
        ts.isNoSubstitutionTemplateLiteral(candidate) ||
        ts.isNumericLiteral(candidate)
      ) {
        return candidate.text;
      }
      return null;
    };

    const exactAdapterCall = (
      call: ts.CallExpression,
      argument: ts.Expression,
    ): boolean => {
      if (
        call.arguments.length !== 1 ||
        call.arguments[0] !== argument ||
        call.questionDotToken !== undefined ||
        !ts.isIdentifier(call.expression) ||
        call.expression.text !== "createPrismaBasicActivationCountPort"
      ) {
        return false;
      }
      const symbol = symbolAt(call.expression);
      return (
        symbol?.declarations?.some(
          (declaration) =>
            ts.isFunctionDeclaration(declaration) &&
            declaration.name?.text ===
              "createPrismaBasicActivationCountPort" &&
            declaration.parameters.length === 1 &&
            isPrismaClientTypeNode(declaration.parameters[0]?.type),
        ) ?? false
      );
    };

    const inspectRootUse = (identifier: ts.Identifier): void => {
      let current: ts.Expression = identifier;
      let wrapped = false;
      const segments: MemberSegment[] = [];

      while (true) {
        const wrapper = transparentParent(current);
        if (wrapper !== null) {
          wrapped = true;
          current = wrapper;
          continue;
        }

        const parent = current.parent;
        if (
          ts.isPropertyAccessExpression(parent) &&
          parent.expression === current
        ) {
          segments.push({
            access: "dot",
            name: parent.name.text,
            optional: parent.questionDotToken !== undefined,
          });
          current = parent;
          continue;
        }
        if (
          ts.isElementAccessExpression(parent) &&
          parent.expression === current
        ) {
          segments.push({
            access: "element",
            name: memberName(parent.argumentExpression),
            optional: parent.questionDotToken !== undefined,
          });
          current = parent;
          continue;
        }
        break;
      }

      const parent = current.parent;
      const call =
        ts.isCallExpression(parent) && parent.expression === current
          ? parent
          : null;
      const directDots =
        !wrapped &&
        segments.every(
          (segment) => segment.access === "dot" && !segment.optional,
        );
      const allowedCount =
        call !== null &&
        call.questionDotToken === undefined &&
        directDots &&
        segments.length === 2 &&
        ALL_MODELS.includes(
          segments[0]?.name as (typeof ALL_MODELS)[number],
        ) &&
        segments[1]?.name === "count";
      const allowedDisconnect =
        call !== null &&
        call.questionDotToken === undefined &&
        directDots &&
        segments.length === 1 &&
        segments[0]?.name === "$disconnect";
      const allowedHandoff =
        !wrapped &&
        segments.length === 0 &&
        ts.isCallExpression(parent) &&
        exactAdapterCall(parent, current);

      if (allowedCount) {
        rootedCalls.push(
          identifier.text +
            "." +
            segments[0]!.name +
            "." +
            segments[1]!.name,
        );
        return;
      }
      if (allowedDisconnect) {
        rootedCalls.push(identifier.text + ".$disconnect");
        return;
      }
      if (allowedHandoff) {
        return;
      }

      violations.add(
        "unsupported-root-use:" +
          identifier.text +
          "@" +
          identifier.getStart(sourceFile),
      );
    };

    const calleeContainsRoot = (node: ts.Node): boolean => {
      let found = false;
      const inspect = (candidate: ts.Node): void => {
        if (ts.isIdentifier(candidate)) {
          const symbol = symbolAt(candidate);
          if (symbol !== null && rootSymbols.has(symbol)) {
            found = true;
            return;
          }
        }
        ts.forEachChild(candidate, inspect);
      };
      inspect(node);
      return found;
    };

    const inspectUses = (node: ts.Node): void => {
      if (
        ts.isIdentifier(node) &&
        !rootDeclarations.has(node)
      ) {
        const symbol = symbolAt(node);
        if (symbol !== null && rootSymbols.has(symbol)) {
          inspectRootUse(node);
        }
      }
      if (ts.isCallExpression(node)) {
        const callee = unwrap(node.expression);
        if (
          (ts.isPropertyAccessExpression(callee) ||
            ts.isElementAccessExpression(callee)) &&
          !calleeContainsRoot(callee)
        ) {
          unrelatedCalls.push(callee.getText(sourceFile));
        }
      }
      ts.forEachChild(node, inspectUses);
    };
    inspectUses(sourceFile);

    return {
      rootedCalls,
      violations: [...violations],
      unrelatedCalls,
    };
  }
  test("uses only count on Prisma delegates and disconnect on the client", () => {
    const cliPath = new URL(
      "./seed/basic-country-activation-preflight-cli.ts",
      import.meta.url,
    );
    const sourceText = readFileSync(cliPath, "utf8");
    const analysis = analyzePrismaUsage(sourceText);

    expect(analysis.violations).toEqual([]);
    expect(
      analysis.rootedCalls.filter((call) => call.endsWith(".$disconnect")),
    ).toHaveLength(1);
    expect(analysis.rootedCalls.filter((call) => call.endsWith(".count"))).toHaveLength(
      ALL_MODELS.length,
    );
    expect(analysis.unrelatedCalls).toContain("JSON.stringify");
    expect(analysis.unrelatedCalls).toContain("process.stdout.write");
  });

  test("rejects every client and delegate provenance alias", () => {
    const analysis = analyzePrismaUsage(`
      const client = new PrismaClient();
      const alias = client;
      let assigned;
      assigned = alias;
      const policyDelegate = assigned.policy;
      const bracketDelegate = alias["risk"];
      const { project: projectDelegate, partner } = assigned;
      policyDelegate.count();
      bracketDelegate["count"]();
      projectDelegate.count();
      partner.count();
      assigned.$disconnect();
      JSON.stringify({ ok: true });
      process.stdout.write("ok");
    `);

    expect(analysis.violations).not.toEqual([]);
    expect(analysis.unrelatedCalls).toEqual(
      expect.arrayContaining(["JSON.stringify", "process.stdout.write"]),
    );
  });

  test("distinguishes shadowed bindings from Prisma aliases", () => {
    const analysis = analyzePrismaUsage(`
      {
        const alias = new PrismaClient();
        alias.policy.count();
        alias.$disconnect();
      }
      {
        const alias = { findMany() {} };
        alias.findMany();
      }
    `);

    expect(analysis.violations).toEqual([]);
    expect(analysis.rootedCalls.filter((call) => call.endsWith(".count"))).toHaveLength(1);
    expect(analysis.unrelatedCalls).toContain("alias.findMany");
  });

  test("recognizes explicit and inferred factory-created Prisma roots", () => {
    const analysis = analyzePrismaUsage(`
      const explicitFactory = (): PrismaClient => new PrismaClient();
      const inferredFactory = () => new PrismaClient();
      const explicitClient = explicitFactory();
      const inferredClient = inferredFactory();
      explicitClient.policy.count();
      inferredClient.risk.count();
      explicitClient.$disconnect();
      inferredClient.$disconnect();
    `);

    expect(analysis.violations).toEqual([]);
    expect(analysis.rootedCalls.filter((call) => call.endsWith(".count"))).toHaveLength(2);
    expect(analysis.rootedCalls.filter((call) => call.endsWith(".$disconnect"))).toHaveLength(2);
  });

  test("allows only the exact typed adapter handoff for a client root", () => {
    const analysis = analyzePrismaUsage(`
      function createPrismaBasicActivationCountPort(client: PrismaClient) {
        client.policy.count();
      }
      const client = new PrismaClient();
      createPrismaBasicActivationCountPort(client);
      client.$disconnect();
    `);

    expect(analysis.violations).toEqual([]);
    expect(analysis.rootedCalls.filter((call) => call.endsWith(".count"))).toHaveLength(1);
    expect(analysis.rootedCalls.filter((call) => call.endsWith(".$disconnect"))).toHaveLength(1);
  });

  test("terminates and rejects a self-cycle", () => {
    const analysis = analyzePrismaUsage(`
      let db: PrismaClient;
      db = db.policy;
    `);

    expect(analysis.violations).not.toEqual([]);
  }, 500);

  test("terminates and rejects a multi-symbol cycle", () => {
    const analysis = analyzePrismaUsage(`
      let first: PrismaClient;
      let second: PrismaClient;
      first = second;
      second = first;
    `);

    expect(analysis.violations).not.toEqual([]);
  }, 500);

  test.each([
    ["client alias find", "const db = new PrismaClient(); const alias = db; alias.policy.findMany();"],
    ["delegate alias write", "const db = new PrismaClient(); const delegate = db.policy; delegate.deleteMany();"],
    ["destructured delegate aggregate", "const db = new PrismaClient(); const { risk } = db; risk.aggregate();"],
    ["static bracket groupBy", "const db = new PrismaClient(); db[\"project\"][\"groupBy\"]();"],
    ["dynamic delegate read", "const db = new PrismaClient(); const model = \"policy\"; db[model].count();"],
    ["dynamic method read", "const db = new PrismaClient(); const method = \"count\"; db.policy[method]();"],
    ["bracket method write", "const db = new PrismaClient(); db[\"policy\"][\"count\"] = replacement;"],
    ["assigned raw call", "const db = new PrismaClient(); let alias; alias = db; alias[\"$queryRaw\"]();"],
    ["direct raw execute", "const db = new PrismaClient(); db.$executeRawUnsafe();"],
    ["delegate bracket read", "const db = new PrismaClient(); db.policy[\"findFirst\"]();"],
    ["unknown delegate count", "const db = new PrismaClient(); db.unknown.count();"],
    ["parenthesized call", "const db = new PrismaClient(); (db.policy).deleteMany();"],
    ["asserted call", "const db = new PrismaClient(); (db.policy as unknown as { findMany(): void }).findMany();"],
    ["type-asserted call", "const db = new PrismaClient(); (<unknown>db.policy as { aggregate(): void }).aggregate();"],
    ["satisfies call", "const db = new PrismaClient(); (db.policy satisfies unknown).groupBy();"],
    ["non-null call", "const db = new PrismaClient(); db.policy!.findFirst();"],
    ["destructured method", "const db = new PrismaClient(); const { deleteMany } = db.policy; deleteMany();"],
    ["destructured count method", "const db = new PrismaClient(); const { count } = db.policy; count();"],
    ["aliased count method", "const db = new PrismaClient(); const count = db.policy.count; count();"],
    ["destructured disconnect", "const db = new PrismaClient(); const { $disconnect } = db; $disconnect();"],
    ["destructured member owner", "const db = new PrismaClient(); const { bind } = db.policy.findMany; bind();"],
    ["tagged query raw", "const db = new PrismaClient(); db.$queryRaw`SELECT 1`;"],
    ["tagged execute raw", "const db = new PrismaClient(); db[\"$executeRaw\"]`DELETE FROM x`;"],
    ["forbidden method read", "const db = new PrismaClient(); const read = db.policy.findMany;"],
    ["inferred factory forbidden call", "const createClient = () => new PrismaClient(); const db = createClient(); db.policy.findMany();"],
    ["helper parameter transfer", "const db = new PrismaClient(); function destroy(client: unknown) {} destroy(db);"],
    ["helper return transfer", "const db = new PrismaClient(); function pass() { return db; } pass();"],
    ["object holder", "const db = new PrismaClient(); const holder = { db };"],
    ["array holder", "const db = new PrismaClient(); const holder = [db];"],
    ["conditional transfer", "const db = new PrismaClient(); const alias = condition ? db : db;"],
    ["optional delegate call", "const db = new PrismaClient(); db?.policy.count();"],
    ["optional method call", "const db = new PrismaClient(); db.policy?.count();"],
    ["array destructuring transfer", "const db = new PrismaClient(); const [alias] = [db];"],
  ])("rejects Prisma-rooted mutation fixture: %s", (_label, source) => {
    expect(analyzePrismaUsage(source).violations).not.toEqual([]);
  });
});
