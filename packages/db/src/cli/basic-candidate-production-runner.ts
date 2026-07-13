import type {
  BasicDeterministicCandidateInput,
  BasicDeterministicCandidateResult,
} from "../collection/basic-deterministic-candidate-contracts.js";
import { runBasicDeterministicCandidate } from "../collection/basic-deterministic-candidate.js";

const PRODUCTION_RESULTS = new WeakSet<object>();

export async function runBasicCandidateProduction(
  input: BasicDeterministicCandidateInput,
): Promise<BasicDeterministicCandidateResult> {
  const result = await runBasicDeterministicCandidate(input);
  if (isSuccessfulCandidate(result)) PRODUCTION_RESULTS.add(result);
  return result;
}

export function isBasicCandidateProductionResult(
  value: unknown,
): value is BasicDeterministicCandidateResult {
  return typeof value === "object" && value !== null && PRODUCTION_RESULTS.has(value);
}

function isSuccessfulCandidate(result: BasicDeterministicCandidateResult): boolean {
  return result.failedStage === null && result.artifacts !== null &&
    result.validation?.valid === true && result.validation.readyForHumanReview &&
    result.validation.blockers.length === 0;
}
