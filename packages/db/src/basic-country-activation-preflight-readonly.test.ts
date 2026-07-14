import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, test } from "vitest";

import { analyzePrismaUsage } from "./basic-country-activation-preflight-readonly-analysis.js";

const MODELS = [
  "marketOverview",
  "policy",
  "risk",
  "opportunity",
  "project",
  "partner",
  "chineseCompany",
  "entryStrategy",
  "report",
  "knowledgeChunk",
] as const;

describe("Basic activation Prisma architecture", () => {
  test("uses direct count calls, one typed handoff, and one disconnect", () => {
    const source = readFileSync(
      new URL("./seed/basic-country-activation-preflight-cli.ts", import.meta.url),
      "utf8",
    );
    const analysis = analyzePrismaUsage(source);

    expect([...analysis.rootedCalls].sort()).toEqual([
      ...MODELS.map((model) => `prismaClient.${model}.count`),
      "prismaClient.$disconnect",
    ].sort());
    expect(analysis.violations).toEqual([]);
    expect(analysis.unrelatedCalls).toContain("JSON.stringify");
    expect(analysis.unrelatedCalls).toContain("process.stdout.write");
    expect(source.match(/new PrismaClient\(\)/g)).toHaveLength(1);
    expect(source).not.toMatch(/\$queryRaw|\$executeRaw|\$transaction/);
  });

  test("the port factory accepts only the named PrismaClient parameter", () => {
    const source = readFileSync(
      new URL("./seed/basic-country-activation-preflight-cli.ts", import.meta.url),
      "utf8",
    );
    const sourceFile = ts.createSourceFile("cli.ts", source, ts.ScriptTarget.Latest, true);
    const factories: ts.FunctionDeclaration[] = [];
    const visit = (node: ts.Node): void => {
      if (
        ts.isFunctionDeclaration(node) &&
        node.name?.text === "createPrismaBasicActivationCountPort"
      ) {
        factories.push(node);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);

    expect(factories).toHaveLength(1);
    expect(factories[0]?.parameters).toHaveLength(1);
    expect(factories[0]?.parameters[0]?.name.getText(sourceFile)).toBe("prismaClient");
    expect(factories[0]?.parameters[0]?.type?.getText(sourceFile)).toBe("PrismaClient");
  });
});
