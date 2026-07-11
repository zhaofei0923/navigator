import type {
  BasicCollectionAuditValidationResult,
  BasicCollectionBlockerCode,
  BasicExtractedFacts,
  BasicInjectionRisk,
  BasicMarketOverviewDraft,
  BasicSourceCheck,
  BasicSourceRegister,
} from "./basic-collection-contracts.js";
import type { BasicCollectionAuditArtifacts } from "./basic-offline-audit-artifacts.js";
import type { BasicBridgeResult, BasicDraftModelPort } from "./basic-hermes-llama-contracts.js";
import type { BasicSourceAdapterRunResult } from "./basic-source-adapter-contracts.js";

export type BasicOfflineDryRunScenario = "normal" | "missing" | "conflict" | "untrusted";

export interface BasicOfflinePreflightInput {
  sourceRegister: unknown;
  extractedFacts: unknown;
  sourceChecks: unknown;
  injectionRisks: unknown;
}

export interface BasicOfflinePreflightResult {
  valid: boolean;
  blockers: readonly BasicCollectionBlockerCode[];
  errors: readonly string[];
}

export interface BasicCollectionAuditAssemblyInput {
  countryDirectory: string;
  runId: string;
  sourceRegister: BasicSourceRegister;
  extractedFacts: BasicExtractedFacts;
  marketOverviewDraft: BasicMarketOverviewDraft;
  sourceChecks: readonly BasicSourceCheck[];
  injectionRisks: readonly BasicInjectionRisk[];
}

export interface BasicOfflineRunnerPort {
  run(): Promise<BasicSourceAdapterRunResult>;
}

export interface BasicOfflineDraftBridgePort {
  bridge(input: {
    sourceRegister: BasicSourceRegister;
    extractedFacts: BasicExtractedFacts;
    model: BasicDraftModelPort;
  }): Promise<BasicBridgeResult<BasicMarketOverviewDraft>>;
}

export interface BasicOfflineNormalDryRunInput {
  scenario: "normal";
  countryDirectory: string;
  runId: string;
  runner: BasicOfflineRunnerPort;
  bridge: BasicOfflineDraftBridgePort;
  model: BasicDraftModelPort;
  sourceChecks: readonly BasicSourceCheck[];
  injectionRisks: readonly BasicInjectionRisk[];
}

export interface BasicOfflineBlockedDryRunInput {
  scenario: "missing" | "conflict" | "untrusted";
  material: BasicCollectionAuditAssemblyInput;
}

export type BasicOfflineDryRunInput = BasicOfflineNormalDryRunInput | BasicOfflineBlockedDryRunInput;

export const BASIC_OFFLINE_STAGE_NAMES = Object.freeze([
  "input",
  "runner",
  "preflight",
  "draft-bridge",
  "assemble",
  "validate",
  "artifacts",
  "boundary",
] as const);
export type BasicOfflineStageName = (typeof BASIC_OFFLINE_STAGE_NAMES)[number];
export type BasicOfflineStageOutcome = "passed" | "blocked" | "skipped";

export interface BasicOfflineDryRunStage {
  name: BasicOfflineStageName;
  outcome: BasicOfflineStageOutcome;
}

export interface BasicOfflineBoundaryVerdict {
  rawCache: "not-produced";
  stagingWrite: "not-attempted";
  manifest: "not-produced";
  canonicalWrite: "not-attempted";
  prismaWrite: "not-attempted";
  coverageDerivation: "not-attempted";
  publishAction: "not-attempted";
  knowledgeChunkCount: 0;
  aiUsableTrueCount: 0;
  aiEligibleKnowledgeIds: readonly [];
}

export interface BasicOfflineDryRunResult {
  scenario: BasicOfflineDryRunScenario;
  stages: readonly BasicOfflineDryRunStage[];
  validation: BasicCollectionAuditValidationResult;
  artifacts: BasicCollectionAuditArtifacts | null;
  boundaryVerdict: BasicOfflineBoundaryVerdict;
}
