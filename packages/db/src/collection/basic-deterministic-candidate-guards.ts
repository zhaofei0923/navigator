import { isDeepStrictEqual } from "node:util";
import { isPromise, isProxy } from "node:util/types";

import {
  SAFE_COUNTRY_DIRECTORY,
  SAFE_RUN_ID,
} from "../seed/basic-country-validation-utils.js";
import { snapshotBasicBoundedJsonValue } from "./basic-bounded-json.js";
import {
  BASIC_COLLECTION_BLOCKER_CODES,
  type BasicCollectionJsonValue,
  type BasicInjectionRisk,
  type BasicSourceCheck,
} from "./basic-collection-contracts.js";
import {
  isBasicCollectionAuditValidationResultV2FromValidator,
} from "./basic-collection-v2-validator.js";
import type {
  BasicCollectionAuditArtifactsV2,
  BasicCollectionAuditBundleV2,
  BasicCollectionAuditValidationResultV2,
  BasicDeterministicMaterializationResultV2,
} from "./basic-collection-v2-contracts.js";
import type {
  BasicDeterministicRunnerPort,
} from "./basic-deterministic-candidate-contracts.js";

const INPUT_KEYS = [
  "countryDirectory",
  "countryCode",
  "runId",
  "catalogVersion",
  "catalogSha256",
  "runner",
  "sourceChecks",
  "injectionRisks",
] as const;
const RUNNER_KEYS = ["run"] as const;
const RUN_RESULT_KEYS = ["sourceRegister", "extractedFacts", "receipts"] as const;
const RECEIPT_KEYS = ["sourceId", "contentSha256", "byteLength", "reused"] as const;
const PREFLIGHT_KEYS = ["valid", "blockers", "errors"] as const;
const VALIDATION_KEYS = [
  "valid", "data", "errors", "readyForHumanReview", "blockers", "summary",
] as const;
const SUMMARY_KEYS = ["countryCode", "runId", "sourceCount", "factCount"] as const;
const ARTIFACT_NAMES = [
  "source-register.json",
  "extracted-facts.json",
  "market-overview.draft.json",
  "review-report.json",
] as const;
const ISO2 = /^[A-Z]{2}$/;
const SAFE_VERSION = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const SHA256 = /^[0-9a-f]{64}$/;
export const BASIC_DETERMINISTIC_CANDIDATE_SNAPSHOT_BUDGETS = Object.freeze({
  maximumObjectProperties: 256,
  maximumTotalNodes: 65_536,
});

export interface CandidateInputSnapshot {
  readonly countryDirectory: string;
  readonly countryCode: string;
  readonly runId: string;
  readonly catalogVersion: string;
  readonly catalogSha256: string;
  readonly sourceChecks: readonly BasicSourceCheck[];
  readonly injectionRisks: readonly BasicInjectionRisk[];
  readonly runner: BasicDeterministicRunnerPort;
  readonly run: BasicDeterministicRunnerPort["run"];
}

export function readInput(value: unknown): CandidateInputSnapshot | null {
  const input = exactDataRecord(value, INPUT_KEYS);
  if (input === null) return null;
  const runnerValue = input.get("runner");
  const runner = exactDataRecord(runnerValue, RUNNER_KEYS);
  const run = runner?.get("run");
  if (
    runner === null || typeof run !== "function" || isProxy(run) ||
    typeof runnerValue !== "object" || runnerValue === null
  ) return null;
  const snapshot = snapshotBasicBoundedJsonValue({
    countryDirectory: input.get("countryDirectory"),
    countryCode: input.get("countryCode"),
    runId: input.get("runId"),
    catalogVersion: input.get("catalogVersion"),
    catalogSha256: input.get("catalogSha256"),
    sourceChecks: input.get("sourceChecks"),
    injectionRisks: input.get("injectionRisks"),
  }, () => undefined, BASIC_DETERMINISTIC_CANDIDATE_SNAPSHOT_BUDGETS);
  if (!snapshot.valid || !isJsonRecord(snapshot.data)) return null;
  const material = snapshot.data;
  if (
    typeof material.countryDirectory !== "string" ||
    !SAFE_COUNTRY_DIRECTORY.test(material.countryDirectory) ||
    typeof material.countryCode !== "string" || !ISO2.test(material.countryCode) ||
    typeof material.runId !== "string" || !SAFE_RUN_ID.test(material.runId) ||
    typeof material.catalogVersion !== "string" ||
    !SAFE_VERSION.test(material.catalogVersion) ||
    typeof material.catalogSha256 !== "string" || !SHA256.test(material.catalogSha256) ||
    !Array.isArray(material.sourceChecks) || !Array.isArray(material.injectionRisks)
  ) return null;
  return Object.freeze({
    countryDirectory: material.countryDirectory,
    countryCode: material.countryCode,
    runId: material.runId,
    catalogVersion: material.catalogVersion,
    catalogSha256: material.catalogSha256,
    sourceChecks: material.sourceChecks as unknown as readonly BasicSourceCheck[],
    injectionRisks: material.injectionRisks as unknown as readonly BasicInjectionRisk[],
    runner: runnerValue as BasicDeterministicRunnerPort,
    run: run as BasicDeterministicRunnerPort["run"],
  });
}

export function isExactPromise(value: unknown): value is Promise<unknown> {
  try {
    return typeof value === "object" && value !== null && !isProxy(value) &&
      isPromise(value) && Object.getPrototypeOf(value) === Promise.prototype &&
      Reflect.ownKeys(value).length === 0 &&
      Object.getOwnPropertyDescriptor(value, "then") === undefined &&
      Object.getOwnPropertyDescriptor(value, "constructor") === undefined;
  } catch {
    return false;
  }
}

export function validRunResult(value: BasicCollectionJsonValue): boolean {
  if (!hasExactJsonKeys(value, RUN_RESULT_KEYS) || !Array.isArray(value.receipts)) {
    return false;
  }
  const sourceIds = new Set<string>();
  let prior = "";
  for (const receipt of value.receipts) {
    if (!hasExactJsonKeys(receipt, RECEIPT_KEYS)) return false;
    if (
      typeof receipt.sourceId !== "string" || receipt.sourceId.length === 0 ||
      sourceIds.has(receipt.sourceId) || receipt.sourceId < prior ||
      typeof receipt.contentSha256 !== "string" || !SHA256.test(receipt.contentSha256) ||
      typeof receipt.byteLength !== "number" ||
      !Number.isSafeInteger(receipt.byteLength) || receipt.byteLength < 0 ||
      typeof receipt.reused !== "boolean"
    ) return false;
    sourceIds.add(receipt.sourceId);
    prior = receipt.sourceId;
  }
  return true;
}

export function identitiesMatch(
  input: CandidateInputSnapshot,
  run: BasicDeterministicMaterializationResultV2,
): boolean {
  return input.runId === run.sourceRegister.runId &&
    input.runId === run.extractedFacts.runId &&
    input.countryCode === run.sourceRegister.countryCode &&
    input.countryCode === run.extractedFacts.countryCode &&
    input.catalogVersion === run.sourceRegister.catalogVersion &&
    input.catalogSha256 === run.sourceRegister.catalogSha256;
}

export function validPassingPreflight(value: unknown): boolean {
  const snapshot = snapshotBasicBoundedJsonValue(value, () => undefined, {
    maximumObjectProperties: 8,
    maximumTotalNodes: 32,
  });
  if (!snapshot.valid || !hasExactJsonKeys(snapshot.data, PREFLIGHT_KEYS)) return false;
  return snapshot.data.valid === true && Array.isArray(snapshot.data.blockers) &&
    snapshot.data.blockers.length === 0 && Array.isArray(snapshot.data.errors) &&
    snapshot.data.errors.length === 0;
}

export function exactValidation(
  value: unknown,
  bundle: BasicCollectionAuditBundleV2,
): BasicCollectionAuditValidationResultV2 | null {
  if (!isBasicCollectionAuditValidationResultV2FromValidator(value)) return null;
  const snapshot = snapshotBasicBoundedJsonValue(
    value,
    () => undefined,
    BASIC_DETERMINISTIC_CANDIDATE_SNAPSHOT_BUDGETS,
  );
  if (!snapshot.valid || !hasExactJsonKeys(snapshot.data, VALIDATION_KEYS)) {
    return null;
  }
  const candidate = snapshot.data;
  const errors = candidate.errors;
  const blockers = candidate.blockers;
  const summary = candidate.summary;
  if (
    !hasExactJsonKeys(summary, SUMMARY_KEYS) ||
    typeof candidate.valid !== "boolean" ||
    typeof candidate.readyForHumanReview !== "boolean" ||
    !stringArray(errors) || !blockerArray(blockers) ||
    !validSummary(summary) || !isRecursivelyFrozenData(value)
  ) return null;
  if (candidate.valid) {
    if (
      errors.length !== 0 || candidate.data === null || candidate.data === undefined ||
      !isDeepStrictEqual(candidate.data, bundle)
    ) return null;
  } else if (candidate.data !== null || candidate.readyForHumanReview) {
    return null;
  }
  return value;
}

export function validArtifacts(
  value: unknown,
  bundle: BasicCollectionAuditBundleV2,
): value is BasicCollectionAuditArtifactsV2 {
  const snapshot = snapshotBasicBoundedJsonValue(
    value,
    () => undefined,
    BASIC_DETERMINISTIC_CANDIDATE_SNAPSHOT_BUDGETS,
  );
  if (
    !snapshot.valid || !hasExactJsonKeys(snapshot.data, ARTIFACT_NAMES) ||
    !isRecursivelyFrozenData(value)
  ) return false;
  return isDeepStrictEqual(snapshot.data["source-register.json"], bundle.sourceRegister) &&
    isDeepStrictEqual(snapshot.data["extracted-facts.json"], bundle.extractedFacts) &&
    isDeepStrictEqual(
      snapshot.data["market-overview.draft.json"],
      bundle.marketOverviewDraft,
    ) &&
    isDeepStrictEqual(snapshot.data["review-report.json"], bundle.reviewReport);
}

function exactDataRecord(
  value: unknown,
  keys: readonly string[],
): ReadonlyMap<string, unknown> | null {
  try {
    if (
      typeof value !== "object" || value === null || isProxy(value) ||
      Object.getPrototypeOf(value) !== Object.prototype
    ) return null;
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.length !== keys.length ||
      ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))
    ) return null;
    const result = new Map<string, unknown>();
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined || !descriptor.enumerable ||
        !Object.hasOwn(descriptor, "value")
      ) return null;
      result.set(key, descriptor.value);
    }
    return result;
  } catch {
    return null;
  }
}

function isRecursivelyFrozenData(value: unknown): boolean {
  try {
    if (value === null || typeof value !== "object" || isProxy(value)) return true;
    if (!Object.isFrozen(value)) return false;
    const keys = Reflect.ownKeys(value);
    for (const key of keys) {
      if (Array.isArray(value) && key === "length") continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !Object.hasOwn(descriptor, "value")) return false;
      if (!isRecursivelyFrozenData(descriptor.value)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function validSummary(value: unknown): boolean {
  return hasExactJsonKeys(value, SUMMARY_KEYS) &&
    typeof value.countryCode === "string" && typeof value.runId === "string" &&
    typeof value.sourceCount === "number" && Number.isSafeInteger(value.sourceCount) &&
    value.sourceCount >= 0 && typeof value.factCount === "number" &&
    Number.isSafeInteger(value.factCount) && value.factCount >= 0;
}

function stringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function blockerArray(value: unknown): value is readonly string[] {
  if (!Array.isArray(value) || !value.every((item) =>
    typeof item === "string" && BASIC_COLLECTION_BLOCKER_CODES.includes(
      item as (typeof BASIC_COLLECTION_BLOCKER_CODES)[number],
    ))) return false;
  return value.every((item, index) =>
    index === 0 || BASIC_COLLECTION_BLOCKER_CODES.indexOf(
      value[index - 1] as (typeof BASIC_COLLECTION_BLOCKER_CODES)[number],
    ) < BASIC_COLLECTION_BLOCKER_CODES.indexOf(
      item as (typeof BASIC_COLLECTION_BLOCKER_CODES)[number],
    ));
}

function hasExactJsonKeys(
  value: unknown,
  keys: readonly string[],
): value is Record<string, BasicCollectionJsonValue> {
  return isJsonRecord(value) && Object.keys(value).length === keys.length &&
    Object.keys(value).every((key) => keys.includes(key));
}

function isJsonRecord(
  value: unknown,
): value is Record<string, BasicCollectionJsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
