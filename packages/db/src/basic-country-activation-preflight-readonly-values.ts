import ts from "typescript";

import {
  type PrismaAnalysisContext,
  symbolAt,
  unwrap,
} from "./basic-country-activation-preflight-readonly-context.js";
import {
  allowedFactoryConstructor,
  exactAdapterCall,
  inspectEphemeralRoot,
  inspectRootExpressionUse,
  isFactoryCall,
} from "./basic-country-activation-preflight-readonly-root-uses.js";
import { isConstructedClient } from "./basic-country-activation-preflight-readonly-roots.js";

export function inspectPrismaUses(context: PrismaAnalysisContext): void {
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      inspectConstructorValue(context, node);
      inspectAdapterValue(context, node);
    }
    if (ts.isIdentifier(node) && !context.rootDeclarations.has(node)) {
      const symbol = symbolAt(context, node);
      if (symbol !== null && context.rootSymbols.has(symbol)) {
        inspectRootExpressionUse(context, node, node.text, true);
      }
    }
    if (ts.isNewExpression(node) && isConstructedClient(context, node)) {
      inspectEphemeralRoot(context, node, "constructor");
    }
    if (isFactoryCall(context, node)) {
      inspectEphemeralRoot(context, node, "factory-call");
    }
    if (ts.isCallExpression(node)) {
      const callee = unwrap(node.expression);
      if (
        (ts.isPropertyAccessExpression(callee) ||
          ts.isElementAccessExpression(callee)) &&
        !calleeContainsRoot(context, callee)
      ) {
        context.unrelatedCalls.push(callee.getText(context.sourceFile));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(context.sourceFile);
}

function inspectConstructorValue(
  context: PrismaAnalysisContext,
  identifier: ts.Identifier,
): void {
  const symbol = symbolAt(context, identifier);
  const isConstructor =
    (symbol !== null && context.constructorSymbols.has(symbol)) ||
    (context.constructorSymbols.size === 0 && identifier.text === "PrismaClient");
  if (
    !isConstructor ||
    context.constructorDeclarationNames.has(identifier) ||
    isTypePosition(identifier) ||
    isNonValueName(identifier)
  ) {
    return;
  }
  const parent = identifier.parent;
  if (
    ts.isNewExpression(parent) &&
    parent.expression === identifier &&
    context.rootInitializers.has(parent)
  ) {
    return;
  }
  if (
    ts.isNewExpression(parent) &&
    parent.expression === identifier &&
    allowedFactoryConstructor(context, parent)
  ) {
    return;
  }
  context.violations.add(
    `unsupported-constructor-use@${identifier.getStart(context.sourceFile)}`,
  );
}

function inspectAdapterValue(
  context: PrismaAnalysisContext,
  identifier: ts.Identifier,
): void {
  const symbol = symbolAt(context, identifier);
  if (
    symbol === null ||
    symbol !== context.exactAdapterSymbol ||
    context.adapterDeclarationNames.has(identifier) ||
    isTypePosition(identifier)
  ) {
    return;
  }
  const parent = identifier.parent;
  const argument =
    ts.isCallExpression(parent) && parent.arguments.length === 1
      ? parent.arguments[0]
      : undefined;
  if (
    ts.isCallExpression(parent) &&
    argument !== undefined &&
    parent.expression === identifier &&
    exactAdapterCall(context, parent, argument)
  ) {
    return;
  }
  context.violations.add(
    `unsupported-adapter-use@${identifier.getStart(context.sourceFile)}`,
  );
}

function isTypePosition(identifier: ts.Identifier): boolean {
  let current: ts.Node | undefined = identifier.parent;
  while (current !== undefined && !ts.isSourceFile(current)) {
    if (ts.isTypeNode(current)) {
      return !(
        ts.isExpressionWithTypeArguments(current) &&
        ts.isHeritageClause(current.parent)
      );
    }
    if (ts.isExpression(current) || ts.isStatement(current)) return false;
    current = current.parent;
  }
  return false;
}

function isNonValueName(identifier: ts.Identifier): boolean {
  const parent = identifier.parent;
  return (
    (ts.isPropertyAccessExpression(parent) && parent.name === identifier) ||
    (ts.isPropertyAssignment(parent) && parent.name === identifier) ||
    (ts.isVariableDeclaration(parent) && parent.name === identifier) ||
    (ts.isParameter(parent) && parent.name === identifier) ||
    (ts.isFunctionDeclaration(parent) && parent.name === identifier) ||
    (ts.isClassDeclaration(parent) && parent.name === identifier)
  );
}

function calleeContainsRoot(
  context: PrismaAnalysisContext,
  node: ts.Node,
): boolean {
  let found = false;
  const inspect = (candidate: ts.Node): void => {
    if (ts.isIdentifier(candidate)) {
      const symbol = symbolAt(context, candidate);
      if (symbol !== null && context.rootSymbols.has(symbol)) {
        found = true;
        return;
      }
    }
    ts.forEachChild(candidate, inspect);
  };
  inspect(node);
  return found;
}
