import ts from "typescript";

import {
  type PrismaAnalysisContext,
  isPrismaClientTypeNode,
  symbolAt,
  unwrap,
} from "./basic-country-activation-preflight-readonly-context.js";

export function isConstructedClient(
  context: PrismaAnalysisContext,
  expression: ts.Expression,
): boolean {
  const candidate = unwrap(expression);
  const constructorSymbol =
    ts.isNewExpression(candidate) && ts.isIdentifier(candidate.expression)
      ? symbolAt(context, candidate.expression)
      : null;
  return (
    ts.isNewExpression(candidate) &&
    ts.isIdentifier(candidate.expression) &&
    (candidate.expression.text === "PrismaClient" ||
      (constructorSymbol !== null &&
        context.constructorSymbols.has(constructorSymbol)))
  );
}

export function functionReturnsPrismaClient(
  context: PrismaAnalysisContext,
  declaration: ts.Declaration,
): boolean {
  if (
    (ts.isFunctionDeclaration(declaration) ||
      ts.isFunctionExpression(declaration) ||
      ts.isArrowFunction(declaration) ||
      ts.isMethodDeclaration(declaration) ||
      ts.isMethodSignature(declaration)) &&
    isPrismaClientTypeNode(context, declaration.type)
  ) {
    return true;
  }
  if (
    ts.isPropertySignature(declaration) &&
    declaration.type !== undefined &&
    ts.isFunctionTypeNode(declaration.type) &&
    isPrismaClientTypeNode(context, declaration.type.type)
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
  if (body === undefined) return false;
  if (!ts.isBlock(body)) return isConstructedClient(context, body);

  let returnsClient = false;
  const inspectReturn = (node: ts.Node): void => {
    if (
      ts.isReturnStatement(node) &&
      node.expression !== undefined &&
      isConstructedClient(context, node.expression)
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
}

export function callReturnsPrismaClient(
  context: PrismaAnalysisContext,
  call: ts.CallExpression,
): boolean {
  const signature = context.checker.getResolvedSignature(call);
  if (signature !== undefined) {
    const returnName = context.checker.typeToString(
      context.checker.getReturnTypeOfSignature(signature),
    );
    if (returnName === "PrismaClient" || returnName.endsWith(".PrismaClient")) {
      return true;
    }
    if (
      signature.declaration !== undefined &&
      functionReturnsPrismaClient(context, signature.declaration)
    ) {
      return true;
    }
  }

  const callee = unwrap(call.expression);
  const symbol = symbolAt(
    context,
    ts.isPropertyAccessExpression(callee) ? callee.name : callee,
  );
  return symbol?.declarations?.some((declaration) => {
    if (
      ts.isVariableDeclaration(declaration) &&
      declaration.initializer !== undefined &&
      (ts.isArrowFunction(declaration.initializer) ||
        ts.isFunctionExpression(declaration.initializer))
    ) {
      return functionReturnsPrismaClient(context, declaration.initializer);
    }
    return functionReturnsPrismaClient(context, declaration);
  }) ?? false;
}

export function initializerCreatesRoot(
  context: PrismaAnalysisContext,
  initializer: ts.Expression | undefined,
): boolean {
  if (initializer === undefined) return false;
  const candidate = unwrap(initializer);
  return (
    isConstructedClient(context, candidate) ||
    (ts.isCallExpression(candidate) && callReturnsPrismaClient(context, candidate))
  );
}

export function collectPrismaRoots(context: PrismaAnalysisContext): void {
  collectConstructorSymbols(context, context.sourceFile);

  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      (isPrismaClientTypeNode(context, node.type) ||
        initializerCreatesRoot(context, node.initializer))
    ) {
      const symbol = symbolAt(context, node.name);
      if (symbol !== null) {
        context.rootSymbols.add(symbol);
        context.rootDeclarations.add(node.name);
        if (
          node.initializer !== undefined &&
          initializerCreatesRoot(context, node.initializer)
        ) {
          context.rootInitializers.add(unwrap(node.initializer));
        }
      }
    } else if (
      ts.isVariableDeclaration(node) &&
      !ts.isIdentifier(node.name) &&
      initializerCreatesRoot(context, node.initializer)
    ) {
      context.violations.add("unsupported-root-binding-pattern");
    } else if (
      ts.isParameter(node) &&
      ts.isIdentifier(node.name) &&
      isPrismaClientTypeNode(context, node.type)
    ) {
      const symbol = symbolAt(context, node.name);
      if (symbol !== null) {
        context.rootSymbols.add(symbol);
        context.rootDeclarations.add(node.name);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(context.sourceFile);
  context.exactAdapterSymbol = resolveExactAdapterSymbol(context);
}

function collectConstructorSymbols(
  context: PrismaAnalysisContext,
  node: ts.Node,
): void {
  const constructorName = ts.isImportSpecifier(node)
    ? (node.propertyName?.text ?? node.name.text) === "PrismaClient"
      ? node.name
      : null
    : ts.isClassDeclaration(node) && node.name?.text === "PrismaClient"
      ? node.name
      : null;
  if (constructorName !== null) {
    const symbol = symbolAt(context, constructorName);
    if (symbol !== null) {
      context.constructorSymbols.add(symbol);
      context.constructorDeclarationNames.add(constructorName);
    }
  }
  ts.forEachChild(node, (child) => collectConstructorSymbols(context, child));
}

function resolveExactAdapterSymbol(
  context: PrismaAnalysisContext,
): ts.Symbol | null {
  const candidate = context.sourceFile.statements.find(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) &&
      statement.name?.text === "createPrismaBasicActivationCountPort" &&
      ts.getModifiers(statement)?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      ) === true,
  );
  if (candidate?.name === undefined) return null;
  const symbol = symbolAt(context, candidate.name);
  const declarations = symbol?.declarations ?? [];
  if (
    symbol === null ||
    declarations.length !== 1 ||
    declarations[0] !== candidate ||
    candidate.getSourceFile() !== context.sourceFile ||
    candidate.body === undefined ||
    candidate.parameters.length !== 1
  ) {
    return null;
  }
  const parameter = candidate.parameters[0];
  if (
    parameter === undefined ||
    !ts.isIdentifier(parameter.name) ||
    !isPrismaClientTypeNode(context, parameter.type)
  ) {
    return null;
  }
  const parameterSymbol = symbolAt(context, parameter.name);
  if (parameterSymbol === null || !context.rootSymbols.has(parameterSymbol)) {
    return null;
  }
  context.adapterDeclarationNames.add(candidate.name);
  return symbol;
}
