import {
  classifyBasicV2FieldPath,
  type BasicExtractedFactV2,
  type BasicExtractionMethodV2,
  type BasicV2FieldOwner,
} from "./basic-collection-v2-contracts.js";

export function validateBasicV2FactOwnership(
  facts: readonly BasicExtractedFactV2[],
): readonly string[] {
  const errors: string[] = [];
  const methodsByPath = new Map<string, Set<string>>();

  for (const [index, fact] of facts.entries()) {
    const owner = classifyBasicV2FieldPath(fact.fieldPath);
    const method = fact.extractionMethod as string;
    if (owner === null || !ownsMethod(owner, method)) {
      errors.push(
        `extractedFacts.facts[${index}].extractionMethod is not allowed for ${fact.fieldPath}`,
      );
    }
    const methods = methodsByPath.get(fact.fieldPath) ?? new Set<string>();
    methods.add(method);
    methodsByPath.set(fact.fieldPath, methods);
  }

  for (const [fieldPath, methods] of methodsByPath) {
    if (methods.has("deterministic") && methods.has("manual")) {
      errors.push(
        `${fieldPath} must not combine deterministic and manual final facts`,
      );
    }
  }
  return Object.freeze(errors.sort(compareText));
}

function ownsMethod(
  owner: BasicV2FieldOwner,
  method: string,
): method is BasicExtractionMethodV2 {
  if (owner === "source-backed") {
    return method === "deterministic" || method === "manual";
  }
  if (owner === "derived") return method === "deterministic";
  return method === "manual";
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
