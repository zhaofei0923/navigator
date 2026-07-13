import { isDeepStrictEqual } from "node:util";
import { isPromise, isProxy } from "node:util/types";

import {
  SAFE_COUNTRY_DIRECTORY,
  SAFE_RUN_ID,
} from "../seed/basic-country-validation-utils.js";
import { createBasicCollectionAuditArtifactsV2 } from "./basic-audit-v2-artifacts.js";
import { assembleBasicCollectionAuditBundleV2 } from "./basic-audit-v2-assembler.js";
import { snapshotBasicBoundedJsonValue } from "./basic-bounded-json.js";
import {
  BASIC_COLLECTION_BLOCKER_CODES,
  type BasicCollectionJsonValue,
  type BasicInjectionRisk,
  type BasicSourceCheck,
} from "./basic-collection-contracts.js";
import { parseBasicCollectionAuditBundleV2 } from "./basic-collection-v2-parser.js";
import { validateBasicCollectionAuditBundleV2 } from "./basic-collection-v2-validator.js";
import type {
  BasicCollectionAuditArtifactsV2,
  BasicCollectionAuditBundleV2,
  BasicCollectionAuditValidationResultV2,
  BasicDeterministicMaterializationResultV2,
} from "./basic-collection-v2-contracts.js";
import type {
  BasicDeterministicCandidateInput,
  BasicDeterministicCandidateResult,
  BasicDeterministicRunnerPort,
} from "./basic-deterministic-candidate-contracts.js";
import {
  createBasicDeterministicFailureResult,
  createBasicDeterministicRedactedValidation,
  createBasicDeterministicSuccessResult,
} from "./basic-deterministic-candidate-result.js";
import { preflightBasicDeterministicCollection } from "./basic-deterministic-source-preflight.js";
import { assembleBasicMarketOverviewDraft } from "./basic-market-overview-draft-assembler.js";
import { parseBasicMarketOverviewDraft } from "./basic-market-overview-draft-parser.js";

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
const SNAPSHOT_BUDGETS = Object.freeze({
  maximumObjectProperties: 256,
  maximumTotalNodes: 65_536,
});

interface CandidateInputSnapshot {
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

export async function runBasicDeterministicCandidate(
  input: BasicDeterministicCandidateInput,
): Promise<BasicDeterministicCandidateResult> {
  const parsed = readInput(input);
  if (parsed === null) return createBasicDeterministicFailureResult("input");

  let run: BasicDeterministicMaterializationResultV2;
  try {
    const pending = Reflect.apply(parsed.run, parsed.runner, []);
    if (!isExactPromise(pending)) return createBasicDeterministicFailureResult("runner");
    const rawRun = await pending;
    const snapshot = snapshotBasicBoundedJsonValue(
      rawRun,
      () => undefined,
      SNAPSHOT_BUDGETS,
    );
    if (!snapshot.valid || !validRunResult(snapshot.data)) {
      return createBasicDeterministicFailureResult("runner");
    }
    run = snapshot.data as unknown as BasicDeterministicMaterializationResultV2;
  } catch {
    return createBasicDeterministicFailureResult("runner");
  }

  try {
    if (!identitiesMatch(parsed, run)) {
      return createBasicDeterministicFailureResult("preflight");
    }
    const preflight = preflightBasicDeterministicCollection({
      sourceRegister: run.sourceRegister,
      extractedFacts: run.extractedFacts,
      sourceChecks: parsed.sourceChecks,
      injectionRisks: parsed.injectionRisks,
      catalogVersion: parsed.catalogVersion,
      catalogSha256: parsed.catalogSha256,
    });
    if (!validPassingPreflight(preflight)) {
      return createBasicDeterministicFailureResult("preflight");
    }
  } catch {
    return createBasicDeterministicFailureResult("preflight");
  }

  let draft: NonNullable<ReturnType<typeof assembleBasicMarketOverviewDraft>>;
  try {
    const assembled = assembleBasicMarketOverviewDraft({
      sourceRegister: run.sourceRegister,
      extractedFacts: run.extractedFacts,
    });
    const parsedDraft = parseBasicMarketOverviewDraft(assembled);
    if (assembled === null || parsedDraft.data === null) {
      return createBasicDeterministicFailureResult("draft-assemble");
    }
    draft = parsedDraft.data;
  } catch {
    return createBasicDeterministicFailureResult("draft-assemble");
  }

  let bundle: BasicCollectionAuditBundleV2;
  try {
    const assembled = assembleBasicCollectionAuditBundleV2({
      countryDirectory: parsed.countryDirectory,
      runId: parsed.runId,
      catalogVersion: parsed.catalogVersion,
      catalogSha256: parsed.catalogSha256,
      sourceRegister: run.sourceRegister,
      extractedFacts: run.extractedFacts,
      marketOverviewDraft: draft,
      sourceChecks: parsed.sourceChecks,
      injectionRisks: parsed.injectionRisks,
    });
    const parsedBundle = parseBasicCollectionAuditBundleV2(assembled);
    if (parsedBundle.data === null) {
      return createBasicDeterministicFailureResult("audit-assemble");
    }
    bundle = parsedBundle.data;
  } catch {
    return createBasicDeterministicFailureResult("audit-assemble");
  }

  let validation: BasicCollectionAuditValidationResultV2;
  try {
    const candidate = validateBasicCollectionAuditBundleV2(bundle);
    validation = exactValidation(candidate, bundle) ??
      createBasicDeterministicRedactedValidation();
  } catch {
    validation = createBasicDeterministicRedactedValidation();
  }
  if (
    !validation.valid || !validation.readyForHumanReview ||
    validation.blockers.length > 0
  ) return createBasicDeterministicFailureResult("validate", validation);

  let artifacts: BasicCollectionAuditArtifactsV2;
  try {
    const candidate = createBasicCollectionAuditArtifactsV2(bundle);
    if (!validArtifacts(candidate, validation.data)) {
      return createBasicDeterministicFailureResult("artifacts", validation);
    }
    artifacts = candidate;
  } catch {
    return createBasicDeterministicFailureResult("artifacts", validation);
  }

  return createBasicDeterministicSuccessResult(validation, artifacts);
}

function readInput(value: unknown): CandidateInputSnapshot | null {
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
  }, () => undefined, SNAPSHOT_BUDGETS);
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

function isExactPromise(value: unknown): value is Promise<unknown> {
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

function validRunResult(value: BasicCollectionJsonValue): boolean {
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

function identitiesMatch(
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

function validPassingPreflight(value: unknown): boolean {
  const snapshot = snapshotBasicBoundedJsonValue(value, () => undefined, {
    maximumObjectProperties: 8,
    maximumTotalNodes: 32,
  });
  if (!snapshot.valid || !hasExactJsonKeys(snapshot.data, PREFLIGHT_KEYS)) return false;
  return snapshot.data.valid === true && Array.isArray(snapshot.data.blockers) &&
    snapshot.data.blockers.length === 0 && Array.isArray(snapshot.data.errors) &&
    snapshot.data.errors.length === 0;
}

function exactValidation(
  value: unknown,
  bundle: BasicCollectionAuditBundleV2,
): BasicCollectionAuditValidationResultV2 | null {
  const snapshot = snapshotBasicBoundedJsonValue(
    value,
    () => undefined,
    SNAPSHOT_BUDGETS,
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
  return value as BasicCollectionAuditValidationResultV2;
}

function validArtifacts(
  value: unknown,
  bundle: BasicCollectionAuditBundleV2,
): value is BasicCollectionAuditArtifactsV2 {
  const snapshot = snapshotBasicBoundedJsonValue(
    value,
    () => undefined,
    SNAPSHOT_BUDGETS,
  );
  if (
    !snapshot.valid || !hasExactJsonKeys(snapshot.data, ARTIFACT_NAMES) ||
    !isRecursivelyFrozenData(value)
  ) return false;
  return isDeepStrictEqual(snapshot.data["source-register.json"], bundle.sourceRegister) &&
    isDeepStrictEqual(snapshot.data["extracted-facts.json"], bundle.extractedFacts) &&
    isDeepStrictEqual(snapshot.data["market-overview.draft.json"], bundle.marketOverviewDraft) &&
    isDeepStrictEqual(snapshot.data["review-report.json"], bundle.reviewReport);
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
