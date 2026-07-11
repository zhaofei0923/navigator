import { isProxy } from "node:util/types";

import {
  BASIC_COLLECTION_BLOCKER_CODES,
  type BasicCollectionAuditBundle,
  type BasicCollectionBlockerCode,
} from "./basic-collection-contracts.js";
import { createBasicCollectionAuditArtifacts } from "./basic-offline-audit-artifacts.js";
import { assembleBasicCollectionAuditBundle } from "./basic-offline-audit-assembler.js";
import type {
  BasicCollectionAuditAssemblyInput,
  BasicOfflineBlockedDryRunInput,
  BasicOfflineDryRunResult,
} from "./basic-offline-dry-run-contracts.js";
import {
  createBasicOfflineFailureResult,
  createBasicOfflineResult,
  createBasicOfflineStageOutcomes,
} from "./basic-offline-dry-run-result.js";
import { preflightBasicOfflineCollection } from "./basic-offline-source-preflight.js";
import { validateBasicCollectionAuditBundle } from "./basic-collection-validator.js";
import { snapshotBasicOfflineValue } from "./basic-offline-value.js";

const BLOCKED_INPUT_KEYS = ["scenario", "material"] as const;
const BLOCKED_MATERIAL_KEYS = [
  "countryDirectory",
  "runId",
  "sourceRegister",
  "extractedFacts",
  "marketOverviewDraft",
  "sourceChecks",
  "injectionRisks",
] as const;

export async function runBasicOfflineBlockedDryRun(
  value: unknown,
  scenario: BasicOfflineBlockedDryRunInput["scenario"],
): Promise<BasicOfflineDryRunResult> {
  const material = readBlockedMaterial(value, scenario);
  if (material === null) return inputFailure(scenario);

  const stages = createBasicOfflineStageOutcomes();
  const snapshot = snapshotBasicOfflineValue(material);
  if (!snapshot.valid || !hasExactKeys(snapshot.data, BLOCKED_MATERIAL_KEYS)) {
    return createBasicOfflineFailureResult(scenario, stages, "preflight");
  }
  const safeMaterial = snapshot.data as unknown as BasicCollectionAuditAssemblyInput;

  let preflight: ReturnType<typeof preflightBasicOfflineCollection>;
  try {
    preflight = preflightBasicOfflineCollection({
      sourceRegister: safeMaterial.sourceRegister,
      extractedFacts: safeMaterial.extractedFacts,
      sourceChecks: safeMaterial.sourceChecks,
      injectionRisks: safeMaterial.injectionRisks,
    });
  } catch {
    return createBasicOfflineFailureResult(scenario, stages, "preflight");
  }
  const expectedBlocker = scenarioBlocker(scenario);
  if (!preflight.valid || !hasExactBlockers(preflight.blockers, expectedBlocker)) {
    return createBasicOfflineFailureResult(scenario, stages, "preflight", preflight.blockers);
  }
  stages[2] = "blocked";

  let bundle: BasicCollectionAuditBundle;
  try {
    bundle = assembleBasicCollectionAuditBundle(safeMaterial);
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
  if (
    !validation.valid ||
    validation.readyForHumanReview ||
    !hasExactBlockers(validation.blockers, expectedBlocker)
  ) {
    return createBasicOfflineFailureResult(
      scenario,
      stages,
      "validate",
      validation.blockers,
      validation,
    );
  }
  stages[5] = "passed";

  try {
    const artifacts = createBasicCollectionAuditArtifacts(bundle);
    stages[6] = "passed";
    return createBasicOfflineResult(scenario, stages, validation, artifacts);
  } catch {
    return createBasicOfflineFailureResult(scenario, stages, "artifacts", validation.blockers);
  }
}

function readBlockedMaterial(
  value: unknown,
  scenario: BasicOfflineBlockedDryRunInput["scenario"],
): BasicCollectionAuditAssemblyInput | null {
  const record = exactDataRecord(value, BLOCKED_INPUT_KEYS);
  if (record === null || record.scenario !== scenario) return null;
  return record.material as BasicCollectionAuditAssemblyInput;
}

function exactDataRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  try {
    if (typeof value !== "object" || value === null || isProxy(value) ||
        Object.getPrototypeOf(value) !== Object.prototype) return null;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))) return null;
    const descriptors = keys.map((key) => Object.getOwnPropertyDescriptor(value, key));
    if (descriptors.some((descriptor) => descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, "value"))) return null;
    const record: Record<string, unknown> = {};
    for (const [index, key] of keys.entries()) record[key] = descriptors[index]!.value;
    return record;
  } catch {
    return null;
  }
}

function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const ownKeys = Reflect.ownKeys(value);
  return ownKeys.length === keys.length && ownKeys.every((key) => typeof key === "string" && keys.includes(key));
}

function scenarioBlocker(scenario: BasicOfflineBlockedDryRunInput["scenario"]): BasicCollectionBlockerCode {
  return scenario === "missing"
    ? "MISSING_REQUIRED_FACT"
    : scenario === "conflict"
      ? "UNRESOLVED_CONFLICT"
      : "UNTRUSTED_INPUT";
}

function hasExactBlockers(
  blockers: readonly BasicCollectionBlockerCode[],
  expected: BasicCollectionBlockerCode,
): boolean {
  return blockers.length === 1 && blockers[0] === expected && BASIC_COLLECTION_BLOCKER_CODES.includes(expected);
}

function inputFailure(scenario: BasicOfflineBlockedDryRunInput["scenario"]): BasicOfflineDryRunResult {
  const stages = createBasicOfflineStageOutcomes();
  stages[0] = "blocked";
  return createBasicOfflineFailureResult(scenario, stages, "input");
}
