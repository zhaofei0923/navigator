import type {
  BasicInjectionRisk,
  BasicSourceCheck,
} from "./basic-collection-contracts.js";
import type {
  BasicCollectionAuditArtifactsV2,
  BasicCollectionAuditValidationResultV2,
  BasicDeterministicMaterializationResultV2,
} from "./basic-collection-v2-contracts.js";

export const BASIC_DETERMINISTIC_STAGE_NAMES = Object.freeze([
  "input",
  "runner",
  "preflight",
  "draft-assemble",
  "audit-assemble",
  "validate",
  "artifacts",
  "boundary",
] as const);

export type BasicDeterministicStageName =
  (typeof BASIC_DETERMINISTIC_STAGE_NAMES)[number];
export type BasicDeterministicStageOutcome = "passed" | "blocked" | "skipped";

export interface BasicDeterministicRunnerPort {
  run(): Promise<BasicDeterministicMaterializationResultV2>;
}

export interface BasicDeterministicCandidateInput {
  readonly countryDirectory: string;
  readonly countryCode: string;
  readonly runId: string;
  readonly catalogVersion: string;
  readonly catalogSha256: string;
  readonly runner: BasicDeterministicRunnerPort;
  readonly sourceChecks: readonly BasicSourceCheck[];
  readonly injectionRisks: readonly BasicInjectionRisk[];
}

export interface BasicDeterministicCandidateStage {
  readonly name: BasicDeterministicStageName;
  readonly outcome: BasicDeterministicStageOutcome;
}

export interface BasicDeterministicBoundaryVerdict {
  readonly rawCache: "not-produced";
  readonly stagingWrite: "not-attempted";
  readonly manifest: "not-produced";
  readonly canonicalWrite: "not-attempted";
  readonly prismaWrite: "not-attempted";
  readonly coverageDerivation: "not-attempted";
  readonly publishAction: "not-attempted";
  readonly knowledgeChunkCount: 0;
  readonly aiUsableTrueCount: 0;
  readonly aiEligibleKnowledgeIds: readonly [];
}

export interface BasicDeterministicCandidateResult {
  readonly stages: readonly BasicDeterministicCandidateStage[];
  readonly failedStage: BasicDeterministicStageName | null;
  readonly validation: BasicCollectionAuditValidationResultV2 | null;
  readonly artifacts: BasicCollectionAuditArtifactsV2 | null;
  readonly boundaryVerdict: BasicDeterministicBoundaryVerdict;
}
