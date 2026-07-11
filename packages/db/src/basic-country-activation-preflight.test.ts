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
    readonly count?: number;
  } = {}) {
    let constructorCalls = 0;
    let disconnectCalls = 0;
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
        writeStdout(output: string) {
          stdout.push(output);
        },
        writeStderr(output: string) {
          stderr.push(output);
        },
      },
      counts: () => ({ constructorCalls, disconnectCalls }),
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

  function analyzePrismaUsage(sourceText: string): {
    readonly rootedCalls: readonly string[];
    readonly violations: readonly string[];
    readonly unrelatedCalls: readonly string[];
  } {
    const sourceFile = ts.createSourceFile(
      "fixture.ts",
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const bindings = new Map<string, PrismaBinding>();
    const assignmentNodes: Array<ts.VariableDeclaration | ts.BinaryExpression> = [];
    const violations = new Set<string>();

    const isPrismaClientType = (type: ts.TypeNode | undefined): boolean =>
      type !== undefined &&
      ts.isTypeReferenceNode(type) &&
      ts.isIdentifier(type.typeName) &&
      type.typeName.text === "PrismaClient";

    const staticMember = (expression: ts.Expression): string | null => {
      if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
        return expression.text;
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
    const resolveBinding = (expression: ts.Expression): PrismaBinding | null => {
      if (ts.isIdentifier(expression)) {
        return bindings.get(expression.text) ?? null;
      }
      if (
        ts.isNewExpression(expression) &&
        ts.isIdentifier(expression.expression) &&
        expression.expression.text === "PrismaClient"
      ) {
        return { kind: "client", path: "PrismaClient" };
      }
      if (ts.isPropertyAccessExpression(expression)) {
        const base = resolveBinding(expression.expression);
        return base === null ? null : extend(base, expression.name.text);
      }
      if (ts.isElementAccessExpression(expression)) {
        const base = resolveBinding(expression.expression);
        return base === null
          ? null
          : extend(
              base,
              expression.argumentExpression === undefined
                ? null
                : staticMember(expression.argumentExpression),
            );
      }
      return null;
    };
    const bindName = (name: ts.BindingName, value: PrismaBinding): boolean => {
      let changed = false;
      if (ts.isIdentifier(name)) {
        if (bindings.get(name.text)?.path !== value.path) {
          bindings.set(name.text, value);
          changed = true;
        }
        return changed;
      }
      if (ts.isObjectBindingPattern(name) && value.kind === "client") {
        for (const element of name.elements) {
          const propertyName = element.propertyName ?? element.name;
          const member = ts.isIdentifier(propertyName)
            ? propertyName.text
            : ts.isStringLiteral(propertyName)
              ? propertyName.text
              : null;
          const child = extend(value, member);
          if (child.kind === "dynamic") {
            violations.add(child.path);
          } else {
            changed = bindName(element.name, child) || changed;
          }
        }
      }
      return changed;
    };
    const collect = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node)) {
        assignmentNodes.push(node);
        if (ts.isIdentifier(node.name) && isPrismaClientType(node.type)) {
          bindings.set(node.name.text, {
            kind: "client",
            path: node.name.text,
          });
        }
      } else if (
        ts.isParameter(node) &&
        ts.isIdentifier(node.name) &&
        isPrismaClientType(node.type)
      ) {
        bindings.set(node.name.text, {
          kind: "client",
          path: node.name.text,
        });
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
        const value = resolveBinding(initializer);
        if (value === null) continue;
        if (ts.isVariableDeclaration(node)) {
          changed = bindName(node.name, value) || changed;
        } else if (ts.isIdentifier(node.left)) {
          changed = bindName(node.left, value) || changed;
        } else if (ts.isObjectLiteralExpression(node.left) && value.kind === "client") {
            for (const property of node.left.properties) {
              if (ts.isShorthandPropertyAssignment(property)) {
                changed =
                  bindName(property.name, extend(value, property.name.text)) || changed;
              } else if (
                ts.isPropertyAssignment(property) &&
                ts.isIdentifier(property.initializer)
              ) {
                const member = ts.isIdentifier(property.name)
                  ? property.name.text
                  : ts.isStringLiteral(property.name)
                    ? property.name.text
                    : null;
                changed = bindName(property.initializer, extend(value, member)) || changed;
              }
            }
        }
      }
    }

    const rootedCalls: string[] = [];
    const unrelatedCalls: string[] = [];
    const inspect = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const binding = resolveBinding(node.expression);
        if (binding === null) {
          if (ts.isPropertyAccessExpression(node.expression)) {
            unrelatedCalls.push(node.expression.getText(sourceFile));
          }
        } else {
          rootedCalls.push(binding.path);
          const allowedDisconnect =
            binding.kind === "member" &&
            binding.member === "$disconnect" &&
            binding.owner === "client";
          const allowedCount =
            binding.kind === "member" &&
            binding.member === "count" &&
            binding.owner === "delegate";
          if (!allowedDisconnect && !allowedCount) {
            violations.add(binding.path);
          }
        }
      }
      if (ts.isElementAccessExpression(node)) {
        const binding = resolveBinding(node);
        if (binding?.kind === "dynamic") {
          violations.add(binding.path);
        }
      }
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      ) {
        const binding = resolveBinding(node.left);
        if (binding !== null && !ts.isIdentifier(node.left)) {
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
  ])("rejects Prisma-rooted mutation fixture: %s", (_label, source) => {
    expect(analyzePrismaUsage(source).violations).not.toEqual([]);
  });
});
