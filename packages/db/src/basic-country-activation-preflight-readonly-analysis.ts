import { createPrismaAnalysisContext } from "./basic-country-activation-preflight-readonly-context.js";
import { collectPrismaRoots } from "./basic-country-activation-preflight-readonly-roots.js";
import { inspectPrismaUses } from "./basic-country-activation-preflight-readonly-values.js";

export interface PrismaUsageAnalysis {
  readonly rootedCalls: readonly string[];
  readonly violations: readonly string[];
  readonly unrelatedCalls: readonly string[];
}

export function analyzePrismaUsage(sourceText: string): PrismaUsageAnalysis {
  const context = createPrismaAnalysisContext(sourceText);
  collectPrismaRoots(context);
  inspectPrismaUses(context);

  return {
    rootedCalls: context.rootedCalls,
    violations: [...context.violations],
    unrelatedCalls: context.unrelatedCalls,
  };
}
