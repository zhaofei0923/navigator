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

  test("uses only count on Prisma delegates and disconnect on the client", () => {
    const cliPath = new URL(
      "./seed/basic-country-activation-preflight-cli.ts",
      import.meta.url,
    );
    const sourceText = readFileSync(cliPath, "utf8");
    const sourceFile = ts.createSourceFile(
      cliPath.pathname,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const prismaRoots = new Set<string>();
    const rootedCalls: string[] = [];
    const unrelatedCalls: string[] = [];

    const accessPath = (expression: ts.Expression): readonly string[] | null => {
      if (ts.isIdentifier(expression)) {
        return [expression.text];
      }
      if (ts.isPropertyAccessExpression(expression)) {
        const base = accessPath(expression.expression);
        return base === null ? null : [...base, expression.name.text];
      }
      return null;
    };

    const discoverPrismaRoots = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer !== undefined &&
        ts.isNewExpression(node.initializer) &&
        ts.isIdentifier(node.initializer.expression) &&
        node.initializer.expression.text === "PrismaClient"
      ) {
        prismaRoots.add(node.name.text);
      }
      ts.forEachChild(node, discoverPrismaRoots);
    };
    discoverPrismaRoots(sourceFile);

    const inspectCalls = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const path = accessPath(node.expression);
        if (path !== null) {
          const rendered = path.join(".");
          if (prismaRoots.has(path[0]!)) {
            rootedCalls.push(rendered);
          } else {
            unrelatedCalls.push(rendered);
          }
        }
      }
      ts.forEachChild(node, inspectCalls);
    };
    inspectCalls(sourceFile);

    expect([...prismaRoots]).toEqual(["prismaClient"]);
    expect(rootedCalls).toContain("prismaClient.$disconnect");
    expect(rootedCalls.filter((call) => call.endsWith(".count"))).toHaveLength(
      ALL_MODELS.length,
    );
    for (const call of rootedCalls) {
      const members = call.split(".");
      const allowedDirectLifecycleCall =
        members.length === 2 && members[1] === "$disconnect";
      const allowedDelegateCount =
        members.length === 3 &&
        ALL_MODELS.includes(members[1] as (typeof ALL_MODELS)[number]) &&
        members[2] === "count";
      expect(
        allowedDirectLifecycleCall || allowedDelegateCount,
        `disallowed Prisma-rooted call: ${call}`,
      ).toBe(true);
    }
    expect(unrelatedCalls).toContain("JSON.stringify");
    expect(unrelatedCalls).toContain("process.stdout.write");
  });
});
