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

  type PrismaBinding =
    | { readonly kind: "client"; readonly path: string }
    | { readonly kind: "delegate"; readonly model: string; readonly path: string }
    | {
        readonly kind: "member";
        readonly member: string;
        readonly owner: "client" | "delegate" | "member" | "dynamic";
        readonly path: string;
      }
    | { readonly kind: "dynamic"; readonly path: string };

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
    const bindings = new Map<ts.Symbol, Map<string, PrismaBinding>>();
    const assignmentNodes: Array<ts.VariableDeclaration | ts.BinaryExpression> = [];
    const violations = new Set<string>();

    const isPrismaClientTypeNode = (type: ts.TypeNode | undefined): boolean =>
      type !== undefined &&
      (type.getText(sourceFile) === "PrismaClient" ||
        type.getText(sourceFile).endsWith(".PrismaClient"));

    const bindingKey = (binding: PrismaBinding): string => {
      if (binding.kind === "member") {
        return `${binding.kind}:${binding.owner}:${binding.member}:${binding.path}`;
      }
      if (binding.kind === "delegate") {
        return `${binding.kind}:${binding.model}:${binding.path}`;
      }
      return `${binding.kind}:${binding.path}`;
    };

    const symbolAt = (node: ts.Node): ts.Symbol | null =>
      checker.getSymbolAtLocation(node) ?? null;

    const addBinding = (
      symbol: ts.Symbol,
      binding: PrismaBinding,
    ): boolean => {
      let values = bindings.get(symbol);
      if (values === undefined) {
        values = new Map();
        bindings.set(symbol, values);
      }
      const key = bindingKey(binding);
      if (values.has(key)) {
        return false;
      }
      values.set(key, binding);
      return true;
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

    const staticMember = (expression: ts.Expression): string | null => {
      const unwrapped = unwrap(expression);
      if (
        ts.isStringLiteral(unwrapped) ||
        ts.isNoSubstitutionTemplateLiteral(unwrapped) ||
        ts.isNumericLiteral(unwrapped)
      ) {
        return unwrapped.text;
      }
      return null;
    };

    const extend = (base: PrismaBinding, member: string | null): PrismaBinding => {
      if (member === null) {
        return { kind: "dynamic", path: `${base.path}[dynamic]` };
      }
      const path = `${base.path}.${member}`;
      if (base.kind === "client" && ALL_MODELS.includes(member as never)) {
        return { kind: "delegate", model: member, path };
      }
      return { kind: "member", member, owner: base.kind, path };
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

      const isConstructedClient = (expression: ts.Expression): boolean => {
        const candidate = unwrap(expression);
        return (
          ts.isNewExpression(candidate) &&
          ts.isIdentifier(candidate.expression) &&
          candidate.expression.text === "PrismaClient"
        );
      };
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
        const returnType = checker.getReturnTypeOfSignature(signature);
        const returnName = checker.typeToString(returnType);
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
      if (symbol === null) {
        return false;
      }
      return symbol.declarations?.some((declaration) => {
        if (
          ts.isVariableDeclaration(declaration) &&
          declaration.initializer !== undefined &&
          (ts.isArrowFunction(declaration.initializer) ||
            ts.isFunctionExpression(declaration.initializer))
        ) {
          return functionReturnsPrismaClient(declaration.initializer);
        }
        return functionReturnsPrismaClient(declaration);
      }) ?? false;
    };

    const uniqueBindings = (
      values: readonly PrismaBinding[],
    ): readonly PrismaBinding[] => [
      ...new Map(values.map((value) => [bindingKey(value), value])).values(),
    ];

    const resolveBindings = (
      expression: ts.Expression,
    ): readonly PrismaBinding[] => {
      const candidate = unwrap(expression);
      if (ts.isIdentifier(candidate)) {
        const symbol = symbolAt(candidate);
        return symbol === null ? [] : [...(bindings.get(symbol)?.values() ?? [])];
      }
      if (
        ts.isNewExpression(candidate) &&
        ts.isIdentifier(candidate.expression) &&
        candidate.expression.text === "PrismaClient"
      ) {
        return [{ kind: "client", path: "PrismaClient" }];
      }
      if (ts.isCallExpression(candidate) && callReturnsPrismaClient(candidate)) {
        return [{ kind: "client", path: "PrismaClient" }];
      }
      if (ts.isPropertyAccessExpression(candidate)) {
        return uniqueBindings(
          resolveBindings(candidate.expression).map((base) =>
            extend(base, candidate.name.text),
          ),
        );
      }
      if (ts.isElementAccessExpression(candidate)) {
        const member =
          candidate.argumentExpression === undefined
            ? null
            : staticMember(candidate.argumentExpression);
        return uniqueBindings(
          resolveBindings(candidate.expression).map((base) =>
            extend(base, member),
          ),
        );
      }
      return [];
    };

    const bindName = (
      name: ts.BindingName,
      values: readonly PrismaBinding[],
    ): boolean => {
      let changed = false;
      if (ts.isIdentifier(name)) {
        const symbol = symbolAt(name);
        if (symbol !== null) {
          for (const value of values) {
            changed = addBinding(symbol, value) || changed;
          }
        }
        return changed;
      }
      if (ts.isObjectBindingPattern(name)) {
        for (const element of name.elements) {
          const propertyName = element.propertyName ?? element.name;
          const member = ts.isIdentifier(propertyName)
            ? propertyName.text
            : ts.isStringLiteral(propertyName)
              ? propertyName.text
              : null;
          const children = values.map((value) => extend(value, member));
          for (const child of children) {
            if (child.kind === "dynamic") {
              violations.add(child.path);
            }
          }
          changed = bindName(element.name, children) || changed;
        }
      }
      return changed;
    };

    const bindAssignmentPattern = (
      pattern: ts.ObjectLiteralExpression,
      values: readonly PrismaBinding[],
    ): boolean => {
      let changed = false;
      for (const property of pattern.properties) {
        if (ts.isShorthandPropertyAssignment(property)) {
          changed =
            bindName(
              property.name,
              values.map((value) => extend(value, property.name.text)),
            ) || changed;
        } else if (
          ts.isPropertyAssignment(property) &&
          ts.isIdentifier(property.initializer)
        ) {
          const member = ts.isIdentifier(property.name)
            ? property.name.text
            : ts.isStringLiteral(property.name)
              ? property.name.text
              : null;
          changed =
            bindName(
              property.initializer,
              values.map((value) => extend(value, member)),
            ) || changed;
        }
      }
      return changed;
    };

    const collect = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node)) {
        assignmentNodes.push(node);
        if (ts.isIdentifier(node.name) && isPrismaClientTypeNode(node.type)) {
          const symbol = symbolAt(node.name);
          if (symbol !== null) {
            addBinding(symbol, { kind: "client", path: node.name.text });
          }
        }
      } else if (
        ts.isParameter(node) &&
        ts.isIdentifier(node.name) &&
        isPrismaClientTypeNode(node.type)
      ) {
        const symbol = symbolAt(node.name);
        if (symbol !== null) {
          addBinding(symbol, { kind: "client", path: node.name.text });
        }
      } else if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      ) {
        assignmentNodes.push(node);
      }
      ts.forEachChild(node, collect);
    };
    collect(sourceFile);
    let changed = true;
    while (changed) {
      changed = false;
      for (const node of assignmentNodes) {
        const initializer = ts.isVariableDeclaration(node) ? node.initializer : node.right;
        if (initializer === undefined) continue;
        const values = resolveBindings(initializer);
        if (values.length === 0) continue;
        if (ts.isVariableDeclaration(node)) {
          changed = bindName(node.name, values) || changed;
        } else if (ts.isIdentifier(node.left)) {
          changed = bindName(node.left, values) || changed;
        } else if (ts.isObjectLiteralExpression(node.left)) {
          changed = bindAssignmentPattern(node.left, values) || changed;
        }
      }
    }

    const rootedCalls: string[] = [];
    const unrelatedCalls: string[] = [];
    const inspectCallBindings = (
      values: readonly PrismaBinding[],
      expression: ts.Expression,
      suffix = "",
    ): void => {
      const callee = unwrap(expression);
      const directStaticMember =
        ts.isPropertyAccessExpression(callee) ||
        (ts.isElementAccessExpression(callee) &&
          callee.argumentExpression !== undefined &&
          staticMember(callee.argumentExpression) !== null);
      for (const binding of values) {
        rootedCalls.push(binding.path);
        const allowedDisconnect =
          suffix === "" &&
          directStaticMember &&
          binding.kind === "member" &&
          binding.member === "$disconnect" &&
          binding.owner === "client";
        const allowedCount =
          suffix === "" &&
          directStaticMember &&
          binding.kind === "member" &&
          binding.member === "count" &&
          binding.owner === "delegate";
        if (!allowedDisconnect && !allowedCount) {
          violations.add(`${binding.path}${suffix}`);
        }
      }
    };

    const isAssignmentOperator = (kind: ts.SyntaxKind): boolean =>
      kind >= ts.SyntaxKind.FirstAssignment &&
      kind <= ts.SyntaxKind.LastAssignment;

    const inspect = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const values = resolveBindings(node.expression);
        if (values.length === 0) {
          const callee = unwrap(node.expression);
          if (
            ts.isPropertyAccessExpression(callee) ||
            ts.isElementAccessExpression(callee)
          ) {
            unrelatedCalls.push(callee.getText(sourceFile));
          }
        } else {
          inspectCallBindings(values, node.expression);
        }
      }
      if (ts.isTaggedTemplateExpression(node)) {
        inspectCallBindings(resolveBindings(node.tag), node.tag, ":tagged");
      }
      if (
        ts.isPropertyAccessExpression(node) ||
        ts.isElementAccessExpression(node)
      ) {
        for (const binding of resolveBindings(node)) {
          if (binding.kind === "dynamic") {
            violations.add(binding.path);
          } else if (
            binding.kind === "member" &&
            !(
              (binding.owner === "delegate" && binding.member === "count") ||
              (binding.owner === "client" && binding.member === "$disconnect")
            )
          ) {
            violations.add(binding.path);
          }
        }
      }
      if (
        ts.isBinaryExpression(node) &&
        isAssignmentOperator(node.operatorToken.kind)
      ) {
        for (const binding of resolveBindings(node.left)) {
          if (!ts.isIdentifier(node.left)) {
            violations.add(`${binding.path}=write`);
          }
        }
      }
      if (
        (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
        (node.operator === ts.SyntaxKind.PlusPlusToken ||
          node.operator === ts.SyntaxKind.MinusMinusToken)
      ) {
        for (const binding of resolveBindings(node.operand)) {
          violations.add(`${binding.path}=write`);
        }
      }
      if (ts.isDeleteExpression(node)) {
        for (const binding of resolveBindings(node.expression)) {
          violations.add(`${binding.path}=write`);
        }
      }
      ts.forEachChild(node, inspect);
    };
    inspect(sourceFile);
    return { rootedCalls, violations: [...violations], unrelatedCalls };
  }

  test("uses only count on Prisma delegates and disconnect on the client", () => {
    const cliPath = new URL(
      "./seed/basic-country-activation-preflight-cli.ts",
      import.meta.url,
    );
    const sourceText = readFileSync(cliPath, "utf8");
    const analysis = analyzePrismaUsage(sourceText);

    expect(analysis.violations).toEqual([]);
    expect(analysis.rootedCalls.some((call) => call.endsWith(".$disconnect"))).toBe(true);
    expect(analysis.rootedCalls.filter((call) => call.endsWith(".count"))).toHaveLength(
      ALL_MODELS.length,
    );
    expect(analysis.unrelatedCalls).toContain("JSON.stringify");
    expect(analysis.unrelatedCalls).toContain("process.stdout.write");
  });

  test("follows safe client/delegate aliases, assignments, destructuring and brackets", () => {
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

    expect(analysis.violations).toEqual([]);
    expect(analysis.rootedCalls.filter((call) => call.endsWith(".count"))).toHaveLength(4);
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
      inferredClient["risk"].count();
      explicitClient.$disconnect();
      inferredClient.$disconnect();
    `);

    expect(analysis.violations).toEqual([]);
    expect(analysis.rootedCalls.filter((call) => call.endsWith(".count"))).toHaveLength(2);
    expect(analysis.rootedCalls.filter((call) => call.endsWith(".$disconnect"))).toHaveLength(2);
  });

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
  ])("rejects Prisma-rooted mutation fixture: %s", (_label, source) => {
    expect(analyzePrismaUsage(source).violations).not.toEqual([]);
  });
});
