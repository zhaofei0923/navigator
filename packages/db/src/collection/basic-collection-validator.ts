import type {
  BasicCollectionAuditSummary,
  BasicCollectionAuditValidationResult,
} from "./basic-collection-contracts.js";
import { classifyBasicCollectionAuditBundle } from "./basic-collection-classifier.js";
import { parseBasicCollectionAuditBundle } from "./basic-collection-parser.js";

const EMPTY_SUMMARY: BasicCollectionAuditSummary = {
  countryCode: "",
  runId: "",
  sourceCount: 0,
  factCount: 0,
};

export function validateBasicCollectionAuditBundle(
  value: unknown,
): BasicCollectionAuditValidationResult {
  try {
    const parsed = parseBasicCollectionAuditBundle(value);
    if (parsed.data === null) {
      return invalid(parsed.errors, parsed.summary);
    }
    const classification = classifyBasicCollectionAuditBundle(parsed.data);
    if (classification.errors.length > 0) {
      return invalid(
        classification.errors,
        parsed.summary,
        classification.blockers,
      );
    }
    return {
      valid: true,
      data: parsed.data,
      errors: [],
      readyForHumanReview: classification.readyForHumanReview,
      blockers: classification.blockers,
      summary: parsed.summary,
    };
  } catch {
    return invalid(["bundle must be a safely parseable audit bundle"], EMPTY_SUMMARY);
  }
}

function invalid(
  errors: string[],
  summary: BasicCollectionAuditSummary,
  blockers: BasicCollectionAuditValidationResult["blockers"] = [],
): BasicCollectionAuditValidationResult {
  return {
    valid: false,
    data: null,
    errors: errors.length === 0 ? ["bundle must be structurally valid"] : errors,
    readyForHumanReview: false,
    blockers,
    summary,
  };
}
