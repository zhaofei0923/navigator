import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, test } from "vitest";

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
    const sourceFile = ts.createSourceFile(
      "basic-country-activation-preflight-cli.ts",
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const rootedCalls: string[] = [];
    const forbiddenMembers: string[] = [];
    const prismaRuntimeUses: string[] = [];
    const dangerous = new Set([
      "findFirst",
      "findMany",
      "create",
      "createMany",
      "update",
      "updateMany",
      "upsert",
      "delete",
      "deleteMany",
      "aggregate",
      "groupBy",
      "$transaction",
      "$queryRaw",
      "$queryRawUnsafe",
      "$executeRaw",
      "$executeRawUnsafe",
    ]);

    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const text = node.expression.getText(sourceFile);
        if (text.startsWith("prismaClient.")) rootedCalls.push(text);
      }
      if (
        (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
        dangerous.has(memberName(node))
      ) {
        forbiddenMembers.push(node.getText(sourceFile));
      }
      if (ts.isIdentifier(node) && node.text === "prismaClient") {
        const parent = node.parent;
        if (
          !ts.isParameter(parent) &&
          !ts.isTypeQueryNode(parent) &&
          !(
            ts.isVariableDeclaration(parent) &&
            parent.name === node &&
            parent.type?.getText(sourceFile) === "PrismaClient" &&
            parent.initializer?.getText(sourceFile) === "dependencies.createClient()"
          ) &&
          !(ts.isPropertyAccessExpression(parent) && parent.expression === node) &&
          !(
            ts.isCallExpression(parent) &&
            parent.arguments.includes(node) &&
            parent.expression.getText(sourceFile) ===
              "createPrismaBasicActivationCountPort"
          )
        ) {
          prismaRuntimeUses.push(parent.getText(sourceFile));
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);

    expect(rootedCalls.sort()).toEqual([
      ...MODELS.map((model) => `prismaClient.${model}.count`),
      "prismaClient.$disconnect",
    ].sort());
    expect(forbiddenMembers).toEqual([]);
    expect(prismaRuntimeUses).toEqual([]);
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

function memberName(
  node: ts.PropertyAccessExpression | ts.ElementAccessExpression,
): string {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  return ts.isStringLiteral(node.argumentExpression)
    ? node.argumentExpression.text
    : "<dynamic>";
}
