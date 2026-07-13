import type {
  BasicCollectionAuditArtifactsV2,
  BasicCollectionAuditValidationResultV2,
} from "./basic-collection-v2-contracts.js";
import {
  BASIC_DETERMINISTIC_STAGE_NAMES,
  type BasicDeterministicBoundaryVerdict,
  type BasicDeterministicCandidateResult,
  type BasicDeterministicCandidateStage,
  type BasicDeterministicStageName,
  type BasicDeterministicStageOutcome,
} from "./basic-deterministic-candidate-contracts.js";

const BOUNDARY_VERDICT: BasicDeterministicBoundaryVerdict = Object.freeze({
  rawCache: "not-produced",
  stagingWrite: "not-attempted",
  manifest: "not-produced",
  canonicalWrite: "not-attempted",
  prismaWrite: "not-attempted",
  coverageDerivation: "not-attempted",
  publishAction: "not-attempted",
  knowledgeChunkCount: 0,
  aiUsableTrueCount: 0,
  aiEligibleKnowledgeIds: Object.freeze([] as const),
});
export function createBasicDeterministicFailureResult(
  failedStage: BasicDeterministicStageName,
  validation: BasicCollectionAuditValidationResultV2 | null = null,
): BasicDeterministicCandidateResult {
  const failedIndex = BASIC_DETERMINISTIC_STAGE_NAMES.indexOf(failedStage);
  return createResult(
    BASIC_DETERMINISTIC_STAGE_NAMES.map((_name, index) =>
      index < failedIndex ? "passed" : index === failedIndex ? "blocked" : "skipped"),
    failedStage,
    validation,
    null,
  );
}

export function createBasicDeterministicSuccessResult(
  validation: BasicCollectionAuditValidationResultV2,
  artifacts: BasicCollectionAuditArtifactsV2,
): BasicDeterministicCandidateResult {
  return createResult(
    BASIC_DETERMINISTIC_STAGE_NAMES.map(() => "passed"),
    null,
    validation,
    artifacts,
  );
}

export function createBasicDeterministicRedactedValidation():
BasicCollectionAuditValidationResultV2 {
  return Object.freeze({
    valid: false,
    data: null,
    errors: Object.freeze(["Basic deterministic candidate validation failed"]),
    readyForHumanReview: false,
    blockers: Object.freeze([]),
    summary: Object.freeze({
      countryCode: "",
      runId: "",
      sourceCount: 0,
      factCount: 0,
    }),
  });
}

function createResult(
  outcomes: readonly BasicDeterministicStageOutcome[],
  failedStage: BasicDeterministicStageName | null,
  validation: BasicCollectionAuditValidationResultV2 | null,
  artifacts: BasicCollectionAuditArtifactsV2 | null,
): BasicDeterministicCandidateResult {
  const stages: readonly BasicDeterministicCandidateStage[] = Object.freeze(
    BASIC_DETERMINISTIC_STAGE_NAMES.map((name, index) => Object.freeze({
      name,
      outcome: outcomes[index] ?? "skipped",
    })),
  );
  const result: BasicDeterministicCandidateResult = Object.freeze({
    stages,
    failedStage,
    validation,
    artifacts,
    boundaryVerdict: BOUNDARY_VERDICT,
  });
  return result;
}
