import { isPromise, isProxy } from "node:util/types";

import type {
  BasicCollectionJsonValue,
  BasicExtractedFacts,
  BasicMarketOverviewDraft,
  BasicSourceCheck,
  BasicSourceRegister,
  BasicInjectionRisk,
} from "./basic-collection-contracts.js";
import type { BasicCollectionAuditArtifacts } from "./basic-offline-audit-artifacts.js";
import { validateBasicCollectionAuditBundle } from "./basic-collection-validator.js";
import { createBasicCollectionAuditArtifacts } from "./basic-offline-audit-artifacts.js";
import { assembleBasicCollectionAuditBundle } from "./basic-offline-audit-assembler.js";
import {
  type BasicOfflineDryRunInput,
  type BasicOfflineDryRunResult,
  type BasicOfflineNormalDryRunInput,
  type BasicOfflineStageOutcome,
} from "./basic-offline-dry-run-contracts.js";
import {
  createBasicOfflineFailureResult,
  createBasicOfflineResult,
  createBasicOfflineStageOutcomes,
} from "./basic-offline-dry-run-result.js";
import { preflightBasicOfflineCollection } from "./basic-offline-source-preflight.js";
import { parseBasicMarketOverviewDraft } from "./basic-market-overview-draft-parser.js";
import {
  deepFreezeBasicOfflineValue,
  isRecord,
  snapshotBasicOfflineValue,
} from "./basic-offline-value.js";
import type { BasicSourceAdapterRunResult } from "./basic-source-adapter-contracts.js";

const NORMAL_INPUT_KEYS = [
  "scenario", "countryDirectory", "runId", "runner", "bridge", "model",
  "sourceChecks", "injectionRisks",
] as const;
const PORT_KEYS = {
  runner: ["run"],
  bridge: ["bridge"],
  model: ["complete"],
} as const;
const RUN_RESULT_KEYS = ["sourceRegister", "extractedFacts", "receipts"] as const;
const RECEIPT_KEYS = ["sourceId", "contentSha256", "byteLength", "reused"] as const;
interface NormalInputSnapshot {
  countryDirectory: string;
  runId: string;
  sourceChecks: readonly BasicSourceCheck[];
  injectionRisks: readonly BasicInjectionRisk[];
  runner: BasicOfflineNormalDryRunInput["runner"];
  bridge: BasicOfflineNormalDryRunInput["bridge"];
  model: BasicOfflineNormalDryRunInput["model"];
}

export async function runBasicOfflineDryRun(
  input: BasicOfflineDryRunInput,
): Promise<BasicOfflineDryRunResult> {
  const scenario = readScenario(input);
  const parsed = readNormalInput(input);
  if (parsed === null) {
    const stages = createBasicOfflineStageOutcomes();
    stages[0] = "blocked";
    return createBasicOfflineFailureResult(scenario, stages, "input");
  }
  const stages: BasicOfflineStageOutcome[] = createBasicOfflineStageOutcomes();

  let run: BasicSourceAdapterRunResult;
  try {
    const pending = Reflect.apply(parsed.runner.run, parsed.runner, []);
    if (!isExactPromise(pending)) return createBasicOfflineFailureResult(scenario, stages, "runner");
    const rawRun = await pending;
    const snapshot = snapshotBasicOfflineValue(rawRun);
    if (!snapshot.valid || !hasExactKeys(snapshot.data, RUN_RESULT_KEYS) || !validReceipts(snapshot.data)) {
      return createBasicOfflineFailureResult(scenario, stages, "runner");
    }
    run = snapshot.data as unknown as BasicSourceAdapterRunResult;
  } catch {
    return createBasicOfflineFailureResult(scenario, stages, "runner");
  }
  stages[1] = "passed";

  let preflight: ReturnType<typeof preflightBasicOfflineCollection>;
  try {
    preflight = preflightBasicOfflineCollection({
      sourceRegister: run.sourceRegister,
      extractedFacts: run.extractedFacts,
      sourceChecks: parsed.sourceChecks,
      injectionRisks: parsed.injectionRisks,
    });
  } catch {
    return createBasicOfflineFailureResult(scenario, stages, "preflight");
  }
  if (!preflight.valid) return createBasicOfflineFailureResult(scenario, stages, "preflight", preflight.blockers);
  if (preflight.blockers.length > 0) return createBasicOfflineFailureResult(scenario, stages, "preflight", preflight.blockers);
  stages[2] = "passed";

  let draft: BasicMarketOverviewDraft;
  try {
    const bridgeSnapshot = snapshotBasicOfflineValue({
      sourceRegister: run.sourceRegister,
      extractedFacts: run.extractedFacts,
    });
    if (!bridgeSnapshot.valid || !hasExactKeys(bridgeSnapshot.data, ["sourceRegister", "extractedFacts"])) {
      return createBasicOfflineFailureResult(scenario, stages, "draft-bridge");
    }
    const bridgeMaterial = deepFreezeBasicOfflineValue(bridgeSnapshot.data);
    const pending = Reflect.apply(parsed.bridge.bridge, parsed.bridge, [{
      sourceRegister: bridgeMaterial.sourceRegister as unknown as BasicSourceRegister,
      extractedFacts: bridgeMaterial.extractedFacts as unknown as BasicExtractedFacts,
      model: parsed.model,
    }]);
    if (!isExactPromise(pending)) return createBasicOfflineFailureResult(scenario, stages, "draft-bridge");
    const bridge = snapshotBasicOfflineValue(await pending);
    if (!bridge.valid || !hasExactKeys(bridge.data, ["ok", "data"]) || bridge.data.ok !== true) {
      return createBasicOfflineFailureResult(scenario, stages, "draft-bridge");
    }
    const parsedDraft = parseBasicMarketOverviewDraft(bridge.data.data);
    if (parsedDraft.data === null) return createBasicOfflineFailureResult(scenario, stages, "draft-bridge");
    draft = parsedDraft.data;
  } catch {
    return createBasicOfflineFailureResult(scenario, stages, "draft-bridge");
  }
  stages[3] = "passed";

  let bundle: ReturnType<typeof assembleBasicCollectionAuditBundle>;
  try {
    bundle = assembleBasicCollectionAuditBundle({
      countryDirectory: parsed.countryDirectory,
      runId: parsed.runId,
      sourceRegister: run.sourceRegister,
      extractedFacts: run.extractedFacts,
      marketOverviewDraft: draft,
      sourceChecks: parsed.sourceChecks,
      injectionRisks: parsed.injectionRisks,
    });
  } catch {
    return createBasicOfflineFailureResult(scenario, stages, "assemble");
  }
  stages[4] = "passed";

  let validation: ReturnType<typeof validateBasicCollectionAuditBundle>;
  try {
    validation = validateBasicCollectionAuditBundle(bundle);
  } catch {
    return createBasicOfflineFailureResult(scenario, stages, "validate");
  }
  if (!validation.valid || validation.blockers.length > 0 || !validation.readyForHumanReview) {
    return createBasicOfflineFailureResult(
      scenario,
      stages,
      "validate",
      validation.blockers,
      validation,
    );
  }
  stages[5] = "passed";

  let artifacts: BasicCollectionAuditArtifacts;
  try {
    artifacts = createBasicCollectionAuditArtifacts(bundle);
  } catch {
    return createBasicOfflineFailureResult(scenario, stages, "artifacts", validation.blockers);
  }
  stages[6] = "passed";
  return createBasicOfflineResult(scenario, stages, validation, artifacts);
}

function readNormalInput(value: unknown): NormalInputSnapshot | null {
  const record = exactDataRecord(value, NORMAL_INPUT_KEYS);
  if (record === null || record.scenario !== "normal") return null;
  const runner = exactPort(record.runner, PORT_KEYS.runner, "run");
  const bridge = exactPort(record.bridge, PORT_KEYS.bridge, "bridge");
  const model = exactPort(record.model, PORT_KEYS.model, "complete");
  if (runner === null || bridge === null || model === null) return null;
  const staticSnapshot = snapshotBasicOfflineValue({
    countryDirectory: record.countryDirectory,
    runId: record.runId,
    sourceChecks: record.sourceChecks,
    injectionRisks: record.injectionRisks,
  });
  if (!staticSnapshot.valid || !isRecord(staticSnapshot.data) ||
      typeof staticSnapshot.data.countryDirectory !== "string" ||
      typeof staticSnapshot.data.runId !== "string" ||
      !Array.isArray(staticSnapshot.data.sourceChecks) ||
      !Array.isArray(staticSnapshot.data.injectionRisks)) return null;
  return {
    countryDirectory: staticSnapshot.data.countryDirectory,
    runId: staticSnapshot.data.runId,
    sourceChecks: staticSnapshot.data.sourceChecks as unknown as readonly BasicSourceCheck[],
    injectionRisks: staticSnapshot.data.injectionRisks as unknown as readonly BasicInjectionRisk[],
    runner: runner as BasicOfflineNormalDryRunInput["runner"],
    bridge: bridge as BasicOfflineNormalDryRunInput["bridge"],
    model: model as BasicOfflineNormalDryRunInput["model"],
  };
}

function exactPort(value: unknown, keys: readonly string[], method: string): object | null {
  const record = exactDataRecord(value, keys);
  if (record === null || typeof record[method] !== "function" || isProxy(record[method])) return null;
  return Object.freeze(record);
}

function exactDataRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  try {
    if (typeof value !== "object" || value === null || isProxy(value) ||
        Object.getPrototypeOf(value) !== Object.prototype) return null;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))) return null;
    const record: Record<string, unknown> = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) return null;
      record[key] = descriptor.value;
    }
    return record;
  } catch {
    return null;
  }
}

function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, BasicCollectionJsonValue> {
  return isRecord(value) && Object.keys(value).length === keys.length &&
    Object.keys(value).every((key) => keys.includes(key));
}

function validReceipts(value: Record<string, BasicCollectionJsonValue>): boolean {
  if (!Array.isArray(value.receipts)) return false;
  return value.receipts.every((receipt) => {
    if (!hasExactKeys(receipt, RECEIPT_KEYS)) return false;
    return typeof receipt.sourceId === "string" &&
      typeof receipt.contentSha256 === "string" && /^[0-9a-f]{64}$/.test(receipt.contentSha256) &&
      typeof receipt.byteLength === "number" && Number.isSafeInteger(receipt.byteLength) && receipt.byteLength >= 0 &&
      typeof receipt.reused === "boolean";
  });
}

function readScenario(value: unknown): BasicOfflineDryRunResult["scenario"] {
  try {
    if (typeof value !== "object" || value === null || isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) return "normal";
    const descriptor = Object.getOwnPropertyDescriptor(value, "scenario");
    if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) return "normal";
    return descriptor.value === "missing" || descriptor.value === "conflict" || descriptor.value === "untrusted"
      ? descriptor.value : "normal";
  } catch {
    return "normal";
  }
}

function isExactPromise(value: unknown): value is Promise<unknown> {
  try {
    return typeof value === "object" && value !== null && !isProxy(value) && isPromise(value) &&
      Object.getPrototypeOf(value) === Promise.prototype &&
      Object.getOwnPropertyDescriptor(value, "then") === undefined &&
      Object.getOwnPropertyDescriptor(value, "constructor") === undefined;
  } catch {
    return false;
  }
}
