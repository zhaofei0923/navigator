import { createBasicCollectionAuditArtifactsV2 } from "./basic-audit-v2-artifacts.js";
import { assembleBasicCollectionAuditBundleV2 } from "./basic-audit-v2-assembler.js";
import { snapshotBasicBoundedJsonValue } from "./basic-bounded-json.js";
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
} from "./basic-deterministic-candidate-contracts.js";
import {
  BASIC_DETERMINISTIC_CANDIDATE_SNAPSHOT_BUDGETS,
  exactValidation,
  identitiesMatch,
  isExactPromise,
  readInput,
  validArtifacts,
  validPassingPreflight,
  validRunResult,
} from "./basic-deterministic-candidate-guards.js";
import {
  createBasicDeterministicFailureResult,
  createBasicDeterministicRedactedValidation,
  createBasicDeterministicSuccessResult,
} from "./basic-deterministic-candidate-result.js";
import { preflightBasicDeterministicCollection } from "./basic-deterministic-source-preflight.js";
import { assembleBasicMarketOverviewDraft } from "./basic-market-overview-draft-assembler.js";
import { parseBasicMarketOverviewDraft } from "./basic-market-overview-draft-parser.js";

const SUCCESSFUL_CANDIDATE_PROVENANCE = new WeakSet<object>();

export function isBasicDeterministicCandidateResultFromCore(
  value: unknown,
): value is BasicDeterministicCandidateResult {
  return typeof value === "object" && value !== null &&
    SUCCESSFUL_CANDIDATE_PROVENANCE.has(value);
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
    if (!isExactPromise(pending)) {
      return createBasicDeterministicFailureResult("runner");
    }
    const snapshot = snapshotBasicBoundedJsonValue(
      rawRun,
      () => undefined,
      BASIC_DETERMINISTIC_CANDIDATE_SNAPSHOT_BUDGETS,
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

  const result = createBasicDeterministicSuccessResult(validation, artifacts);
  SUCCESSFUL_CANDIDATE_PROVENANCE.add(result);
  return result;
}
