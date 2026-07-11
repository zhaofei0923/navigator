import type {
  BasicCollectionAuditValidationResult,
  BasicCollectionBlockerCode,
} from "./basic-collection-contracts.js";
import type { BasicCollectionAuditArtifacts } from "./basic-offline-audit-artifacts.js";
import {
  BASIC_OFFLINE_STAGE_NAMES,
  type BasicOfflineBoundaryVerdict,
  type BasicOfflineDryRunResult,
  type BasicOfflineDryRunStage,
  type BasicOfflineDryRunScenario,
  type BasicOfflineStageOutcome,
} from "./basic-offline-dry-run-contracts.js";
import { deepFreezeBasicOfflineValue } from "./basic-offline-value.js";

const EMPTY_SUMMARY = { countryCode: "", runId: "", sourceCount: 0, factCount: 0 } as const;
const BOUNDARY_VALUES: Omit<BasicOfflineBoundaryVerdict, "aiEligibleKnowledgeIds"> = {
  rawCache: "not-produced",
  stagingWrite: "not-attempted",
  manifest: "not-produced",
  canonicalWrite: "not-attempted",
  prismaWrite: "not-attempted",
  coverageDerivation: "not-attempted",
  publishAction: "not-attempted",
  knowledgeChunkCount: 0,
  aiUsableTrueCount: 0,
};

export function createBasicOfflineStageOutcomes(): BasicOfflineStageOutcome[] {
  return ["passed", "skipped", "skipped", "skipped", "skipped", "skipped", "skipped", "passed"];
}

export function createBasicOfflineFailureResult(
  scenario: BasicOfflineDryRunScenario,
  outcomes: readonly BasicOfflineStageOutcome[],
  blockedStage: BasicOfflineDryRunStage["name"],
  blockers: readonly BasicCollectionBlockerCode[] = [],
): BasicOfflineDryRunResult {
  const normalized = [...outcomes];
  normalized[BASIC_OFFLINE_STAGE_NAMES.indexOf(blockedStage)] = "blocked";
  return createBasicOfflineResult(
    scenario,
    normalized,
    invalidValidation(blockers, `P1-6D ${blockedStage} failed`),
    null,
  );
}

export function createBasicOfflineResult(
  scenario: BasicOfflineDryRunScenario,
  outcomes: readonly BasicOfflineStageOutcome[],
  validation: BasicCollectionAuditValidationResult,
  artifacts: BasicCollectionAuditArtifacts | null,
): BasicOfflineDryRunResult {
  const stages: BasicOfflineDryRunStage[] = BASIC_OFFLINE_STAGE_NAMES.map((name, index) => ({
    name,
    outcome: outcomes[index] ?? "skipped",
  }));
  return deepFreezeBasicOfflineValue({
    scenario,
    stages,
    validation,
    artifacts,
    boundaryVerdict: { ...BOUNDARY_VALUES, aiEligibleKnowledgeIds: [] },
  });
}

function invalidValidation(
  blockers: readonly BasicCollectionBlockerCode[],
  error: string,
): BasicCollectionAuditValidationResult {
  return {
    valid: false,
    data: null,
    errors: [error],
    readyForHumanReview: false,
    blockers: [...blockers],
    summary: EMPTY_SUMMARY,
  };
}
