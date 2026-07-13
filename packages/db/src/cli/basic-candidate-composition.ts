import type { BasicDeterministicCandidateResult } from "../collection/basic-deterministic-candidate-contracts.js";
import { materializeBasicDocumentEvidence } from "../collection/basic-document-observation-materializer.js";
import { parseBasicDocumentObservationPlan } from "../collection/basic-document-observation-parser.js";
import { parseBasicCountryEditorialInput } from "../collection/basic-editorial-input-parser.js";
import { parseBasicSourceCatalog } from "../collection/basic-source-catalog.js";
import {
  createBasicSourceExecutionPlan,
  type BasicSourceExecutionPlan,
} from "../collection/basic-source-request-materializer.js";
import {
  parseBasicManualSourceReview,
  parseBasicStructuredSourceReview,
} from "../collection/basic-source-review-parser.js";
import { runBasicSourceExecutionPlanV2 } from "../collection/basic-source-plan-runner-v2.js";
import type { BasicSourceTransportV2 } from "../collection/basic-source-v2-contracts.js";
import { materializeBasicReviewedRunV2 } from "../collection/basic-v2-materialization.js";
import {
  closeBasicCandidateConfig,
  loadBasicCandidateConfig,
  parseBasicCandidateConfig,
  readBasicCandidateCatalog,
  readBasicCandidateConfigInput,
  type LoadedBasicCandidateConfig,
} from "./basic-candidate-config.js";
import {
  getBasicCandidateWorkspaceDescriptorRoot,
  type BasicCandidateWorkspace,
} from "./basic-candidate-workspace.js";
import { runBasicCandidateProduction } from "./basic-candidate-production-runner.js";

export interface BasicCandidateCompositionInput {
  readonly workspace: BasicCandidateWorkspace;
  readonly configPath: string;
  readonly transport: BasicSourceTransportV2;
}

export type BasicCandidateCompositionResult = Readonly<{
  status: "ready" | "blocked" | "error";
  candidate: BasicDeterministicCandidateResult | null;
}>;

export interface BasicCandidateCompositionDependencies {
  loadConfig: typeof loadBasicCandidateConfig;
  readCatalog: typeof readBasicCandidateCatalog;
  parseCatalog: typeof parseBasicSourceCatalog;
  createPlan: typeof createBasicSourceExecutionPlan;
  runPlan: typeof runBasicSourceExecutionPlanV2;
  readConfigInput: typeof readBasicCandidateConfigInput;
  parseStructuredReview: typeof parseBasicStructuredSourceReview;
  parseManualReview: typeof parseBasicManualSourceReview;
  parseDocumentPlan: typeof parseBasicDocumentObservationPlan;
  materializeDocument: typeof materializeBasicDocumentEvidence;
  parseEditorial: typeof parseBasicCountryEditorialInput;
  materializeReviewed: typeof materializeBasicReviewedRunV2;
  runCandidate: typeof runBasicCandidateProduction;
  getWorkspaceDescriptorRoot: typeof getBasicCandidateWorkspaceDescriptorRoot;
}

const DEFAULT_DEPENDENCIES: BasicCandidateCompositionDependencies = Object.freeze({
  loadConfig: loadBasicCandidateConfig,
  readCatalog: readBasicCandidateCatalog,
  parseCatalog: parseBasicSourceCatalog,
  createPlan: createBasicSourceExecutionPlan,
  runPlan: runBasicSourceExecutionPlanV2,
  readConfigInput: readBasicCandidateConfigInput,
  parseStructuredReview: parseBasicStructuredSourceReview,
  parseManualReview: parseBasicManualSourceReview,
  parseDocumentPlan: parseBasicDocumentObservationPlan,
  materializeDocument: materializeBasicDocumentEvidence,
  parseEditorial: parseBasicCountryEditorialInput,
  materializeReviewed: materializeBasicReviewedRunV2,
  runCandidate: runBasicCandidateProduction,
  getWorkspaceDescriptorRoot: getBasicCandidateWorkspaceDescriptorRoot,
});

const ERROR_RESULT: BasicCandidateCompositionResult = Object.freeze({
  status: "error",
  candidate: null,
});

export async function composeBasicCountryCandidate(
  input: BasicCandidateCompositionInput,
  dependencies: BasicCandidateCompositionDependencies = DEFAULT_DEPENDENCIES,
): Promise<BasicCandidateCompositionResult> {
  let loaded: LoadedBasicCandidateConfig | null = null;
  try {
    loaded = await dependencies.loadConfig(input.workspace, input.configPath);
    const config = parseBasicCandidateConfig(readLoadedConfig(loaded));
    const catalog = dependencies.parseCatalog(
      await dependencies.readCatalog(input.workspace),
    );
    const plan = dependencies.createPlan({
      catalog,
      countryCode: config.countryCode,
      sourceIds: config.sourceIds,
    });
    const sourceKinds = selectedSourceKinds(plan, config.sourceIds);
    requireReviewPathShape(config, sourceKinds);

    const preliminary = await dependencies.runPlan({
      repoRoot: dependencies.getWorkspaceDescriptorRoot(input.workspace),
      countryCode: config.countryCode,
      runId: config.runId,
      plan,
      transport: input.transport,
    });
    const expectation = Object.freeze({
      runId: config.runId,
      countryCode: config.countryCode,
      catalogVersion: plan.catalogVersion,
      catalogSha256: plan.catalogSha256,
      deterministicSourceIds: sourceKinds.deterministic,
      manualSourceIds: sourceKinds.manual,
    });
    const structuredReview = config.structuredReviewPath === null
      ? null
      : dependencies.parseStructuredReview(
        await dependencies.readConfigInput(loaded, config.structuredReviewPath),
        expectation,
      );
    const manualReview = config.manualReviewPath === null
      ? null
      : dependencies.parseManualReview(
        await dependencies.readConfigInput(loaded, config.manualReviewPath),
        expectation,
      );
    const documentPlans = [];
    for (const pathname of config.documentPlanPaths) {
      documentPlans.push(dependencies.parseDocumentPlan(
        await dependencies.readConfigInput(loaded, pathname),
      ));
    }
    const documentResult = manualReview === null
      ? null
      : dependencies.materializeDocument({
        plan,
        captures: preliminary.documentCaptures,
        review: manualReview,
        documentPlans,
      });
    const editorial = dependencies.parseEditorial(
      await dependencies.readConfigInput(loaded, config.editorialInputPath),
    );
    const reviewed = dependencies.materializeReviewed({
      preliminary,
      structuredReview,
      documentResult,
      editorial,
    });
    const materialization = reviewed.materialization;
    const runner = Object.freeze({
      run() {
        return Promise.resolve(materialization);
      },
    });
    const candidate = await dependencies.runCandidate({
      countryDirectory: config.countryDirectory,
      countryCode: config.countryCode,
      runId: config.runId,
      catalogVersion: plan.catalogVersion,
      catalogSha256: plan.catalogSha256,
      runner,
      sourceChecks: reviewed.sourceChecks,
      injectionRisks: reviewed.injectionRisks,
    });
    if (isReadyCandidate(candidate)) {
      return Object.freeze({ status: "ready", candidate });
    }
    if (isBlockedCandidate(candidate)) {
      return Object.freeze({ status: "blocked", candidate });
    }
    return ERROR_RESULT;
  } catch {
    return ERROR_RESULT;
  } finally {
    if (loaded !== null) await closeBasicCandidateConfig(loaded);
  }
}

function readLoadedConfig(
  loaded: LoadedBasicCandidateConfig,
): LoadedBasicCandidateConfig["config"] {
  if (typeof loaded !== "object" || loaded === null || !("config" in loaded)) {
    throw new Error("invalid loaded config");
  }
  return loaded.config;
}

function selectedSourceKinds(
  plan: BasicSourceExecutionPlan,
  expectedSourceIds: readonly string[],
): Readonly<{ deterministic: readonly string[]; manual: readonly string[] }> {
  if (
    plan.countryCode.length !== 2 ||
    !Array.isArray(plan.sources) ||
    plan.sources.length !== expectedSourceIds.length
  ) throw new Error("invalid source plan");
  const deterministic: string[] = [];
  const manual: string[] = [];
  const actualIds: string[] = [];
  for (const entry of plan.sources) {
    const sourceId = entry.source.sourceId;
    actualIds.push(sourceId);
    if (entry.source.adapterKind === "deterministic") deterministic.push(sourceId);
    else if (entry.source.adapterKind === "manual-document") manual.push(sourceId);
    else throw new Error("invalid source plan");
  }
  if (!sameStrings(actualIds, expectedSourceIds)) throw new Error("invalid source plan");
  return Object.freeze({
    deterministic: Object.freeze(deterministic),
    manual: Object.freeze(manual),
  });
}

function requireReviewPathShape(
  config: LoadedBasicCandidateConfig["config"],
  sourceKinds: Readonly<{ deterministic: readonly string[]; manual: readonly string[] }>,
): void {
  if (
    (sourceKinds.deterministic.length === 0) !==
      (config.structuredReviewPath === null) ||
    (sourceKinds.manual.length === 0) !== (config.manualReviewPath === null) ||
    config.documentPlanPaths.length !== sourceKinds.manual.length
  ) throw new Error("invalid review paths");
}

function isReadyCandidate(value: BasicDeterministicCandidateResult): boolean {
  return value.failedStage === null && value.artifacts !== null &&
    value.validation?.valid === true && value.validation.readyForHumanReview &&
    value.validation.blockers.length === 0;
}

function isBlockedCandidate(value: BasicDeterministicCandidateResult): boolean {
  return value.failedStage !== null && value.artifacts === null;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}
