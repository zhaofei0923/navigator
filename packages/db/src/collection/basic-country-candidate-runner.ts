import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";

import { WORLD_BANK_CORE_INDICATOR_ADAPTERS } from "./adapters/world-bank-indicators.js";
import { worldBankCountryAdapter } from "./adapters/world-bank-country.js";
import {
  BASIC_COUNTRY_CANDIDATE_ARTIFACTS,
  parseBasicCountryCandidateInput,
  snapshotBasicCountryCandidateRuntime,
  type BasicCountryCandidateErrorCode,
  type BasicCountryCandidateResult,
  type BasicCountryCandidateRuntime,
  type OpenedJsonSourcePlan,
} from "./basic-country-candidate-contracts.js";
import type { BasicCollectionJsonValue } from "./basic-collection-contracts.js";
import { writeCandidatePackage } from "./basic-country-candidate-filesystem.js";
import { runBasicHermesDiscovery } from "./basic-hermes-discovery.js";
import { promoteBasicHermesJsonEvidence } from "./basic-hermes-json-evidence.js";
import type {
  BasicHermesDiscoveryBatch,
  BasicHermesOpenedJsonSource,
} from "./basic-hermes-llama-contracts.js";
import { bridgeBasicMarketOverviewDraft } from "./basic-llama-draft-bridge.js";
import { createBasicLlamaCppDraftTransport } from "./basic-llama-cpp-transport.js";
import { runBasicOfflineDryRun } from "./basic-offline-dry-run.js";
import { preflightBasicOfflineCollection } from "./basic-offline-source-preflight.js";
import { captureBasicRawSource } from "./basic-raw-capture.js";
import { runBasicDeterministicSourceAdapters } from "./basic-source-adapter-runner.js";
import type { BasicSourceAdapterRunResult } from "./basic-source-adapter-contracts.js";
import { createBasicSourceTransport } from "./basic-source-transport.js";

const WORLD_BANK_ADAPTERS = Object.freeze([
  worldBankCountryAdapter,
  ...WORLD_BANK_CORE_INDICATOR_ADAPTERS,
]);

export async function runBasicCountryCandidate(
  input: unknown,
  runtime: BasicCountryCandidateRuntime,
): Promise<BasicCountryCandidateResult> {
  let code: BasicCountryCandidateErrorCode = "INPUT_INVALID";
  let countryCode = "";
  let runId = "";
  try {
    const parsed = parseBasicCountryCandidateInput(input);
    const capturedRuntime = snapshotBasicCountryCandidateRuntime(runtime);
    if (parsed === null || capturedRuntime === null) return failure("INPUT_INVALID", "", "");
    countryCode = parsed.config.countryCode;
    runId = parsed.config.runId;
    return await orchestrate(parsed, capturedRuntime, (next) => { code = next; });
  } catch {
    return failure(code, countryCode, runId);
  }
}

async function orchestrate(
  parsed: NonNullable<ReturnType<typeof parseBasicCountryCandidateInput>>,
  runtime: BasicCountryCandidateRuntime,
  stage: (code: BasicCountryCandidateErrorCode) => void,
): Promise<BasicCountryCandidateResult> {
  const { config, discoveryResponse } = parsed;
  stage("OUTPUT_REJECTED");
  if (!(await validRuntimeRoots(runtime))) return failure("OUTPUT_REJECTED", config.countryCode, config.runId);

  stage("SOURCE_CAPTURE_FAILED");
  const transport = createBasicSourceTransport(runtime.sourceFetch);
  let base: BasicSourceAdapterRunResult;
  try {
    base = await runBasicDeterministicSourceAdapters({
      repoRoot: runtime.repositoryRoot,
      countryCode: config.countryCode,
      runId: config.runId,
      adapters: WORLD_BANK_ADAPTERS,
      transport,
    });
  } catch {
    return failure("SOURCE_CAPTURE_FAILED", config.countryCode, config.runId);
  }

  stage("DISCOVERY_REJECTED");
  const discoveryResult = await runBasicHermesDiscovery(config.discoveryRequest, {
    async discover() { return discoveryResponse; },
  });
  if (!discoveryResult.ok) return failure("DISCOVERY_REJECTED", config.countryCode, config.runId);
  stage("EVIDENCE_REJECTED");
  if (!authorizedOpenedPlans(config.openedSources, discoveryResult.data)) {
    return failure("EVIDENCE_REJECTED", config.countryCode, config.runId);
  }

  stage("SOURCE_CAPTURE_FAILED");
  let openedSources: BasicHermesOpenedJsonSource[];
  try {
    openedSources = [];
    for (const plan of config.openedSources) {
      openedSources.push(await captureOpened(plan, config.countryCode, config.runId, runtime.repositoryRoot, transport));
    }
  } catch (error) {
    const code = error instanceof PointerError ? "EVIDENCE_REJECTED" : "SOURCE_CAPTURE_FAILED";
    return failure(code, config.countryCode, config.runId);
  }

  const promoted = promoteBasicHermesJsonEvidence({ base, discovery: discoveryResult.data, openedSources });
  if (!promoted.ok) {
    const code = promoted.error.code === "SOURCE_CAPTURE_INVALID" ? "SOURCE_CAPTURE_FAILED" : "EVIDENCE_REJECTED";
    return failure(code, config.countryCode, config.runId);
  }

  stage("PREFLIGHT_BLOCKED");
  const preflight = preflightBasicOfflineCollection({
    sourceRegister: promoted.data.sourceRegister,
    extractedFacts: promoted.data.extractedFacts,
    sourceChecks: config.sourceChecks,
    injectionRisks: config.injectionRisks,
  });
  if (!preflight.valid || preflight.blockers.length > 0) return failure("PREFLIGHT_BLOCKED", config.countryCode, config.runId);

  stage("DRAFT_FAILED");
  let model: ReturnType<typeof createBasicLlamaCppDraftTransport>;
  try {
    model = createBasicLlamaCppDraftTransport({ ...config.llama, fetchImpl: runtime.llamaFetch });
  } catch {
    return failure("DRAFT_FAILED", config.countryCode, config.runId);
  }
  const dryRun = await runBasicOfflineDryRun({
    scenario: "normal",
    countryDirectory: config.countryDirectory,
    runId: config.runId,
    runner: { async run() { return promoted.data; } },
    bridge: { async bridge(value) { return await bridgeBasicMarketOverviewDraft(value); } },
    model,
    sourceChecks: config.sourceChecks,
    injectionRisks: config.injectionRisks,
  });
  stage("AUDIT_INVALID");
  if (dryRun.artifacts === null) {
    return failure(dryRun.stages[3]?.outcome === "blocked" ? "DRAFT_FAILED" : "AUDIT_INVALID", config.countryCode, config.runId);
  }
  if (!dryRun.validation.valid || !dryRun.validation.readyForHumanReview || dryRun.validation.blockers.length > 0 ||
    dryRun.artifacts["review-report.json"].humanDecision !== null) return failure("AUDIT_INVALID", config.countryCode, config.runId);

  stage("OUTPUT_REJECTED");
  const packageResult = await writeCandidatePackage({
    outputRoot: runtime.outputRoot,
    countryDirectory: config.countryDirectory,
    runId: config.runId,
    artifacts: dryRun.artifacts,
    filesystem: runtime.filesystem,
  });
  if (!packageResult.ok) return failure(packageResult.code, config.countryCode, config.runId);
  return {
    ok: true,
    code: "READY_FOR_HUMAN_REVIEW",
    summary: {
      countryCode: config.countryCode,
      runId: config.runId,
      sourceCount: dryRun.validation.summary.sourceCount,
      factCount: dryRun.validation.summary.factCount,
      readyForHumanReview: true,
    },
    artifacts: BASIC_COUNTRY_CANDIDATE_ARTIFACTS,
  };
}

function authorizedOpenedPlans(
  plans: readonly OpenedJsonSourcePlan[],
  discovery: BasicHermesDiscoveryBatch,
): boolean {
  const candidates = new Map(discovery.candidates.map((candidate) => [candidate.discoveryId, candidate]));
  if (candidates.size !== discovery.candidates.length) return false;
  const used = new Set<string>();
  for (const plan of plans) {
    const candidate = candidates.get(plan.discoveryId);
    if (candidate === undefined || candidate.url !== plan.policy.sourceUrl || used.has(plan.discoveryId)) return false;
    used.add(plan.discoveryId);
  }
  return true;
}

async function captureOpened(
  plan: OpenedJsonSourcePlan,
  countryCode: string,
  runId: string,
  repositoryRoot: string,
  transport: ReturnType<typeof createBasicSourceTransport>,
): Promise<BasicHermesOpenedJsonSource> {
  const request = {
    method: "GET" as const,
    url: plan.policy.sourceUrl,
    accept: "application/json",
    allowedOrigins: plan.policy.approvedOrigins,
    allowedQueryParameters: plan.policy.allowedQueryParameters,
  };
  const capture = await captureBasicRawSource({
    repoRoot: repositoryRoot,
    countryCode,
    runId,
    adapterId: `hermes-json-${plan.discoveryId}`,
    adapterVersion: "1.0.0",
    sourceId: plan.policy.sourceId,
    request,
  }, transport);
  const body = parseJsonBody(capture.body);
  return {
    discoveryId: plan.discoveryId,
    policy: plan.policy,
    capture,
    observations: plan.observations.map((observation) => ({
      ...observation,
      rawValue: resolvePointer(body, observation.locator.slice(5)),
    })),
  };
}

function parseJsonBody(body: Uint8Array): BasicCollectionJsonValue {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) as BasicCollectionJsonValue;
  } catch { throw new PointerError(); }
}

function resolvePointer(root: BasicCollectionJsonValue, pointer: string): BasicCollectionJsonValue {
  if (pointer === "") return root;
  let current = root;
  for (const encoded of pointer.slice(1).split("/")) {
    const token = encoded.replace(/~1/g, "/").replace(/~0/g, "~");
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9]\d*)$/.test(token)) throw new PointerError();
      const index = Number(token);
      if (!Number.isSafeInteger(index) || index >= current.length || !Object.hasOwn(current, index)) throw new PointerError();
      current = current[index]!;
    } else if (typeof current === "object" && current !== null && Object.hasOwn(current, token)) {
      current = current[token]!;
    } else { throw new PointerError(); }
  }
  return current;
}

async function validRuntimeRoots(runtime: BasicCountryCandidateRuntime): Promise<boolean> {
  try {
    if (!isAbsolute(runtime.repositoryRoot) || !isAbsolute(runtime.outputRoot)) return false;
    const repository = await lstat(runtime.repositoryRoot);
    const output = await lstat(runtime.outputRoot);
    if (!repository.isDirectory() || repository.isSymbolicLink() || !output.isDirectory() || output.isSymbolicLink()) return false;
    const repositoryReal = await realpath(runtime.repositoryRoot);
    const outputReal = await realpath(runtime.outputRoot);
    const inside = relative(repositoryReal, outputReal);
    return inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside);
  } catch { return false; }
}

function failure(code: BasicCountryCandidateErrorCode, countryCode: string, runId: string): BasicCountryCandidateResult {
  return { ok: false, code, summary: { countryCode, runId, sourceCount: 0, factCount: 0, readyForHumanReview: false }, artifacts: null };
}

class PointerError extends Error {}
