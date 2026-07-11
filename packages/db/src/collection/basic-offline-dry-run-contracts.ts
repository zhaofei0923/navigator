import type {
  BasicCollectionBlockerCode,
  BasicExtractedFacts,
  BasicInjectionRisk,
  BasicMarketOverviewDraft,
  BasicSourceCheck,
  BasicSourceRegister,
} from "./basic-collection-contracts.js";
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
