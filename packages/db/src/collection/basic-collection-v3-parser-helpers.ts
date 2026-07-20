import type {
  BasicCollectionJsonValue,
} from "./basic-collection-contracts.js";
import type { BasicExtractedFactV2 } from "./basic-collection-v2-contracts.js";
import {
  parseBasicV3ProfileFactPath,
  type BasicExtractedFactV3,
} from "./basic-collection-v3-contracts.js";

const FACT_KEYS = [
  "factId", "fieldPath", "status", "evidence", "extractionMethod", "uncertainty",
] as const;
const EVIDENCE_KEYS = [
  "sourceId", "locator", "rawValue", "normalizedValue", "unit", "year",
] as const;

export function parseBasicV3ProfileFact(
  value: BasicCollectionJsonValue,
  index: number,
  errors: string[],
): BasicExtractedFactV3 | null {
  const label = `extractedFacts.facts[${index}]`;
  if (!isExactBasicCollectionRecord(value, FACT_KEYS)) {
    errors.push(`${label} must have exactly the v3 fact keys`);
    return null;
  }
  const factId = nonblank(value.factId, `${label}.factId`, errors);
  const fieldPath = nonblank(value.fieldPath, `${label}.fieldPath`, errors);
  if (parseBasicV3ProfileFactPath(fieldPath) === null) {
    errors.push(`${label}.fieldPath must be an allowed v3 profile fieldPath`);
  }
  if (value.status !== "candidate") {
    errors.push(`${label}.status must be candidate for a v3 profile fact`);
  }
  const evidence = parseProfileEvidence(value.evidence, label, errors);
  const extractionMethod = value.extractionMethod;
  if (extractionMethod !== "deterministic" && extractionMethod !== "manual") {
    errors.push(`${label}.extractionMethod must be deterministic or manual`);
  }
  const uncertainty = value.uncertainty === null
    ? null
    : nonblank(value.uncertainty, `${label}.uncertainty`, errors);
  return {
    factId,
    fieldPath,
    status: "candidate",
    evidence,
    extractionMethod: extractionMethod === "manual" ? "manual" : "deterministic",
    uncertainty,
  };
}

function parseProfileEvidence(
  value: BasicCollectionJsonValue,
  factLabel: string,
  errors: string[],
): BasicExtractedFactV2["evidence"] {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${factLabel}.evidence must contain at least one item for candidate`);
    return [];
  }
  return value.flatMap((item, index) => {
    const label = `${factLabel}.evidence[${index}]`;
    if (!isExactBasicCollectionRecord(item, EVIDENCE_KEYS)) {
      errors.push(`${label} must have exactly the v3 evidence keys`);
      return [];
    }
    return [{
      sourceId: nonblank(item.sourceId, `${label}.sourceId`, errors),
      locator: nonblank(item.locator, `${label}.locator`, errors),
      rawValue: item.rawValue,
      normalizedValue: item.normalizedValue,
      unit: item.unit === null ? null : nonblank(item.unit, `${label}.unit`, errors),
      year: nullableFiniteNumber(item.year, `${label}.year`, errors),
    }];
  });
}

export function validateBasicV3FactIdentitiesAndOrder(
  value: BasicCollectionJsonValue | undefined,
  errors: string[],
): void {
  if (!Array.isArray(value)) return;
  const factIds = new Map<string, number>();
  const paths = new Map<string, number>();
  let previousPath: string | undefined;
  for (const [index, item] of value.entries()) {
    const fact = basicCollectionRecord(item);
    if (fact === null || typeof fact.factId !== "string" || typeof fact.fieldPath !== "string") {
      continue;
    }
    const priorId = factIds.get(fact.factId);
    if (priorId !== undefined) {
      errors.push(`extractedFacts.facts[${index}].factId duplicates extractedFacts.facts[${priorId}].factId`);
    } else factIds.set(fact.factId, index);
    const priorPath = paths.get(fact.fieldPath);
    if (priorPath !== undefined) {
      errors.push(`extractedFacts.facts[${index}].fieldPath duplicates extractedFacts.facts[${priorPath}].fieldPath`);
    } else paths.set(fact.fieldPath, index);
    if (previousPath !== undefined && compareBasicCollectionText(previousPath, fact.fieldPath) > 0) {
      errors.push("extractedFacts.facts must be unique and sorted by fieldPath");
      previousPath = undefined;
    } else previousPath = fact.fieldPath;
  }
}

export function basicCollectionRecord(
  value: BasicCollectionJsonValue | undefined,
): Record<string, BasicCollectionJsonValue> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
}

export function isExactBasicCollectionRecord<
  const Keys extends readonly string[],
>(
  value: BasicCollectionJsonValue,
  keys: Keys,
): value is Record<Keys[number], BasicCollectionJsonValue> {
  const candidate = basicCollectionRecord(value);
  if (candidate === null) return false;
  const actual = Object.keys(candidate);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

export function compareBasicCollectionText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function nonblank(
  value: BasicCollectionJsonValue,
  label: string,
  errors: string[],
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${label} must be a non-empty string`);
    return "";
  }
  return value;
}

function nullableFiniteNumber(
  value: BasicCollectionJsonValue,
  label: string,
  errors: string[],
): number | null {
  if (value === null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  errors.push(`${label} must be a finite number or null`);
  return null;
}
