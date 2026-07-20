import type { BasicCollectionAuditArtifactsV3 } from "../collection/basic-collection-v3-contracts.js";
import type { BasicCollectionAuditValidationResultV3 } from "../collection/basic-collection-v3-contracts.js";
import { assembleBasicCollectionAuditBundleV3 } from "../collection/basic-audit-v3-assembler.js";
import { createBasicCollectionAuditArtifactsV3 } from "../collection/basic-audit-v3-artifacts.js";
import { validateBasicCollectionAuditBundleV3 } from "../collection/basic-collection-v3-validator.js";

export interface BasicV3CandidateCompositionInput {
  readonly baseBundle: unknown;
  readonly basicProfile: unknown;
  readonly profileAuditSources?: Parameters<typeof assembleBasicCollectionAuditBundleV3>[0]["profileAuditSources"];
  readonly profileSourceChecks?: Parameters<typeof assembleBasicCollectionAuditBundleV3>[0]["profileSourceChecks"];
}

export type BasicV3CandidateCompositionResult = Readonly<{
  status: "ready";
  validation: BasicCollectionAuditValidationResultV3 & { readonly valid: true };
  artifacts: BasicCollectionAuditArtifactsV3;
}>;

const PRODUCTION_RESULTS = new WeakSet<object>();

export function isBasicV3CandidateProductionResult(
  value: unknown,
): value is BasicV3CandidateCompositionResult {
  return typeof value === "object" && value !== null && PRODUCTION_RESULTS.has(value);
}

export function createBasicV3CandidateComposition(
  input: BasicV3CandidateCompositionInput,
): BasicV3CandidateCompositionResult {
  const bundle = assembleBasicCollectionAuditBundleV3({
    baseBundle: input.baseBundle,
    basicProfile: input.basicProfile,
    ...(input.profileAuditSources === undefined ? {} : {
      profileAuditSources: input.profileAuditSources,
    }),
    ...(input.profileSourceChecks === undefined ? {} : {
      profileSourceChecks: input.profileSourceChecks,
    }),
  });
  const validation = validateBasicCollectionAuditBundleV3(bundle);
  if (!validation.valid || !validation.readyForHumanReview || validation.blockers.length > 0) {
    throw new Error("basic v3 candidate composition failed");
  }
  const result = Object.freeze({
    status: "ready" as const,
    validation,
    artifacts: createBasicCollectionAuditArtifactsV3(validation.data),
  });
  PRODUCTION_RESULTS.add(result);
  return result;
}
