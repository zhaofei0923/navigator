import ts from "typescript";

export const PRISMA_MODELS = [
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

export interface PrismaAnalysisContext {
  readonly sourceFile: ts.SourceFile;
  readonly checker: ts.TypeChecker;
  readonly constructorSymbols: Set<ts.Symbol>;
  readonly constructorDeclarationNames: Set<ts.Identifier>;
  readonly rootSymbols: Set<ts.Symbol>;
  readonly rootDeclarations: Set<ts.Identifier>;
  readonly rootInitializers: Set<ts.Expression>;
  readonly rootedCalls: string[];
  readonly unrelatedCalls: string[];
  readonly violations: Set<string>;
  exactAdapterSymbol: ts.Symbol | null;
  readonly adapterDeclarationNames: Set<ts.Identifier>;
}

export function createPrismaAnalysisContext(
  sourceText: string,
): PrismaAnalysisContext {
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

  return {
    sourceFile,
    checker: program.getTypeChecker(),
    constructorSymbols: new Set(),
    constructorDeclarationNames: new Set(),
    rootSymbols: new Set(),
    rootDeclarations: new Set(),
    rootInitializers: new Set(),
    rootedCalls: [],
    unrelatedCalls: [],
    violations: new Set(),
    exactAdapterSymbol: null,
    adapterDeclarationNames: new Set(),
  };
}

export function symbolAt(
  context: PrismaAnalysisContext,
  node: ts.Node,
): ts.Symbol | null {
  if (
    ts.isIdentifier(node) &&
    ts.isShorthandPropertyAssignment(node.parent) &&
    node.parent.name === node
  ) {
    return (
      context.checker.getShorthandAssignmentValueSymbol(node.parent) ??
      context.checker.getSymbolAtLocation(node) ??
      null
    );
  }
  return context.checker.getSymbolAtLocation(node) ?? null;
}

export function unwrap(expression: ts.Expression): ts.Expression {
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
}

export function isPrismaClientTypeNode(
  context: PrismaAnalysisContext,
  type: ts.TypeNode | undefined,
): boolean {
  return type !== undefined && (
    type.getText(context.sourceFile) === "PrismaClient" ||
    type.getText(context.sourceFile).endsWith(".PrismaClient")
  );
}
