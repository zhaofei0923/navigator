import { randomUUID } from "node:crypto";
import { lstat, mkdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";

import { WORLD_BANK_CORE_INDICATOR_ADAPTERS } from "./adapters/world-bank-indicators.js";
import { worldBankCountryAdapter } from "./adapters/world-bank-country.js";
import {
  BASIC_COUNTRY_CANDIDATE_ARTIFACTS,
  isBasicCountryCandidateRuntime,
  parseBasicCountryCandidateInput,
  type BasicCountryCandidateErrorCode,
  type BasicCountryCandidateResult,
  type BasicCountryCandidateRuntime,
  type OpenedJsonSourcePlan,
} from "./basic-country-candidate-contracts.js";
import { loadBasicCollectionAuditBundle } from "./basic-collection-loader.js";
import type { BasicCollectionJsonValue } from "./basic-collection-contracts.js";
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
  const parsed = parseBasicCountryCandidateInput(input);
  if (parsed === null || !isBasicCountryCandidateRuntime(runtime)) return failure("INPUT_INVALID", "", "");
  const { config, discoveryResponse } = parsed;
  if (!(await validRuntimeRoots(runtime))) return failure("OUTPUT_REJECTED", config.countryCode, config.runId);

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

  const discoveryResult = await runBasicHermesDiscovery(config.discoveryRequest, {
    async discover() { return discoveryResponse; },
  });
  if (!discoveryResult.ok) return failure("DISCOVERY_REJECTED", config.countryCode, config.runId);

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

  const preflight = preflightBasicOfflineCollection({
    sourceRegister: promoted.data.sourceRegister,
    extractedFacts: promoted.data.extractedFacts,
    sourceChecks: config.sourceChecks,
    injectionRisks: config.injectionRisks,
  });
  if (!preflight.valid || preflight.blockers.length > 0) return failure("PREFLIGHT_BLOCKED", config.countryCode, config.runId);

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
  if (dryRun.artifacts === null) {
    return failure(dryRun.stages[3]?.outcome === "blocked" ? "DRAFT_FAILED" : "AUDIT_INVALID", config.countryCode, config.runId);
  }
  if (!dryRun.validation.valid || !dryRun.validation.readyForHumanReview || dryRun.validation.blockers.length > 0 ||
    dryRun.artifacts["review-report.json"].humanDecision !== null) return failure("AUDIT_INVALID", config.countryCode, config.runId);

  const target = join(runtime.outputRoot, "data", "staging", config.countryDirectory, config.runId);
  try {
    await publishArtifacts(runtime.outputRoot, target, dryRun.artifacts);
  } catch {
    return failure("OUTPUT_REJECTED", config.countryCode, config.runId);
  }
  try {
    const loaded = loadBasicCollectionAuditBundle(runtime.outputRoot, config.countryDirectory, config.runId);
    if (loaded.reviewReport.humanDecision !== null || loaded.reviewReport.status !== "ready-for-human-review" ||
      loaded.reviewReport.publicationRecommendation !== "request-human-review") throw new Error("round trip invalid");
  } catch {
    await rm(target, { recursive: true, force: true }).catch(() => undefined);
    return failure("AUDIT_INVALID", config.countryCode, config.runId);
  }
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

async function publishArtifacts(outputRoot: string, target: string, artifacts: NonNullable<Awaited<ReturnType<typeof runBasicOfflineDryRun>>["artifacts"]>): Promise<void> {
  const existing = await lstat(target).catch(() => null);
  if (existing !== null) throw new Error("candidate output exists");
  const parent = join(outputRoot, "data", "staging", target.split(sep).at(-2)!);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const temporary = join(parent, `.candidate-${randomUUID()}`);
  await mkdir(temporary, { mode: 0o700 });
  try {
    for (const name of BASIC_COUNTRY_CANDIDATE_ARTIFACTS) {
      await writeFile(join(temporary, name), `${JSON.stringify(artifacts[name], null, 2)}\n`, { flag: "wx", mode: 0o600 });
    }
    await rename(temporary, target);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

function failure(code: BasicCountryCandidateErrorCode, countryCode: string, runId: string): BasicCountryCandidateResult {
  return { ok: false, code, summary: { countryCode, runId, sourceCount: 0, factCount: 0, readyForHumanReview: false }, artifacts: null };
}

class PointerError extends Error {}
