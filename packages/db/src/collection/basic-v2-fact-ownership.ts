import {
  classifyBasicV2FieldPath,
  type BasicExtractedFactV2,
  type BasicExtractionMethodV2,
  type BasicV2FieldOwner,
} from "./basic-collection-v2-contracts.js";

const PDF_DOCUMENT_LOCATOR = /^pdf:page=(?:[1-9]\d*)#([\s\S]*)$/;
const RESERVED_DOCUMENT_LOCATION =
  /^(?:https?:\/\/|url(?:[:=\/])|search(?:[:=\/])|metadata(?:[:=\/])|capture(?:[:=\/]))/i;
const CONTROL_CHARACTER = /[\u0000-\u001F\u007F]/;

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
    if (owner === "source-backed" && method === "manual") {
      for (const [evidenceIndex, evidence] of fact.evidence.entries()) {
        if (!isReviewedDocumentLocator(evidence.locator)) {
          errors.push(
            `extractedFacts.facts[${index}].evidence[${evidenceIndex}].locator must be a reviewed HTML/PDF document locator`,
          );
        }
      }
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

function isReviewedDocumentLocator(value: string): boolean {
  const location = value.startsWith("html:")
    ? value.slice("html:".length)
    : PDF_DOCUMENT_LOCATOR.exec(value)?.[1];
  return location !== undefined &&
    isWellFormedUnicode(value) &&
    location.trim() !== "" &&
    location.trim() === location &&
    !CONTROL_CHARACTER.test(location) &&
    !RESERVED_DOCUMENT_LOCATION.test(location);
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xD800 && codeUnit <= 0xDBFF) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isInteger(next) || next < 0xDC00 || next > 0xDFFF) {
        return false;
      }
      index += 1;
    } else if (codeUnit >= 0xDC00 && codeUnit <= 0xDFFF) {
      return false;
    }
  }
  return true;
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
