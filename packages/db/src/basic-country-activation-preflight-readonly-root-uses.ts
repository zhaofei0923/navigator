import ts from "typescript";

import {
  PRISMA_MODELS,
  type PrismaAnalysisContext,
  symbolAt,
  unwrap,
} from "./basic-country-activation-preflight-readonly-context.js";
import {
  callReturnsPrismaClient,
  functionReturnsPrismaClient,
} from "./basic-country-activation-preflight-readonly-roots.js";

interface MemberSegment {
  readonly access: "dot" | "element";
  readonly name: string | null;
  readonly optional: boolean;
}

interface RootExpressionChain {
  readonly current: ts.Expression;
  readonly segments: readonly MemberSegment[];
  readonly wrapped: boolean;
}

export function inspectRootExpressionUse(
  context: PrismaAnalysisContext,
  expression: ts.Expression,
  label: string,
  allowHandoff: boolean,
): void {
  const { current, segments, wrapped } = rootExpressionChain(expression);
  const parent = current.parent;
  const call =
    ts.isCallExpression(parent) && parent.expression === current ? parent : null;
  const directDots =
    !wrapped &&
    segments.every((segment) => segment.access === "dot" && !segment.optional);
  const allowedCount =
    call !== null &&
    call.questionDotToken === undefined &&
    directDots &&
    segments.length === 2 &&
    PRISMA_MODELS.includes(
      segments[0]?.name as (typeof PRISMA_MODELS)[number],
    ) &&
    segments[1]?.name === "count";
  const allowedDisconnect =
    call !== null &&
    call.questionDotToken === undefined &&
    directDots &&
    segments.length === 1 &&
    segments[0]?.name === "$disconnect";
  const allowedHandoff =
    allowHandoff &&
    !wrapped &&
    segments.length === 0 &&
    ts.isCallExpression(parent) &&
    exactAdapterCall(context, parent, current);

  if (allowedCount) {
    context.rootedCalls.push(
      `${label}.${segments[0]!.name}.${segments[1]!.name}`,
    );
    return;
  }
  if (allowedDisconnect) {
    context.rootedCalls.push(`${label}.$disconnect`);
    return;
  }
  if (allowedHandoff) return;

  context.violations.add(
    `unsupported-root-use:${label}@${expression.getStart(context.sourceFile)}`,
  );
}

export function inspectEphemeralRoot(
  context: PrismaAnalysisContext,
  expression: ts.NewExpression | ts.CallExpression,
  kind: "constructor" | "factory-call",
): void {
  if (context.rootInitializers.has(expression)) return;
  if (
    kind === "constructor" &&
    ts.isNewExpression(expression) &&
    allowedFactoryConstructor(context, expression)
  ) {
    return;
  }
  inspectRootExpressionUse(context, expression, kind, false);
}

export function exactAdapterCall(
  context: PrismaAnalysisContext,
  call: ts.CallExpression,
  argument: ts.Expression,
): boolean {
  if (
    call.arguments.length !== 1 ||
    call.arguments[0] !== argument ||
    call.questionDotToken !== undefined ||
    !ts.isIdentifier(call.expression) ||
    call.expression.text !== "createPrismaBasicActivationCountPort"
  ) {
    return false;
  }
  const symbol = symbolAt(context, call.expression);
  return symbol !== null && symbol === context.exactAdapterSymbol;
}

function rootExpressionChain(expression: ts.Expression): RootExpressionChain {
  let current = expression;
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
    if (ts.isPropertyAccessExpression(parent) && parent.expression === current) {
      segments.push({
        access: "dot",
        name: parent.name.text,
        optional: parent.questionDotToken !== undefined,
      });
      current = parent;
      continue;
    }
    if (ts.isElementAccessExpression(parent) && parent.expression === current) {
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

  return { current, segments, wrapped };
}

function transparentParent(expression: ts.Expression): ts.Expression | null {
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
}

function memberName(expression: ts.Expression | undefined): string | null {
  if (expression === undefined) return null;
  const candidate = unwrap(expression);
  if (
    ts.isStringLiteral(candidate) ||
    ts.isNoSubstitutionTemplateLiteral(candidate) ||
    ts.isNumericLiteral(candidate)
  ) {
    return candidate.text;
  }
  return null;
}

export function allowedFactoryConstructor(
  context: PrismaAnalysisContext,
  expression: ts.NewExpression,
): boolean {
  const direct = directTransparentParent(expression);
  const parent = direct.parent;
  if (
    ts.isArrowFunction(parent) &&
    parent.body === direct &&
    functionReturnsPrismaClient(context, parent)
  ) {
    return true;
  }
  if (ts.isReturnStatement(parent) && parent.expression === direct) {
    const factory = enclosingFactory(parent);
    return factory !== null && functionReturnsPrismaClient(context, factory);
  }
  return false;
}

function directTransparentParent(expression: ts.Expression): ts.Expression {
  let current = expression;
  let parent = transparentParent(current);
  while (parent !== null) {
    current = parent;
    parent = transparentParent(current);
  }
  return current;
}

function enclosingFactory(node: ts.Node): ts.Declaration | null {
  let current: ts.Node | undefined = node.parent;
  while (current !== undefined) {
    if (ts.isFunctionLike(current)) return current;
    current = current.parent;
  }
  return null;
}

export function isFactoryCall(
  context: PrismaAnalysisContext,
  node: ts.Node,
): node is ts.CallExpression {
  return ts.isCallExpression(node) && callReturnsPrismaClient(context, node);
}
