import { createHash } from "node:crypto";

import type {
  BasicCollectionJsonValue,
  BasicExtractedFact,
  BasicFactEvidence,
} from "./basic-collection-contracts.js";
import type { BasicDeterministicObservation } from "./basic-source-adapter-contracts.js";

export interface BasicSourcedObservation extends BasicDeterministicObservation {
  sourceId: string;
}

export function materializeBasicSourceFacts(
  observations: readonly BasicSourcedObservation[],
): BasicExtractedFact[] {
  const grouped = new Map<string, BasicSourcedObservation[]>();
  for (const observation of observations) {
    const group = grouped.get(observation.fieldPath) ?? [];
    group.push(observation);
    grouped.set(observation.fieldPath, group);
  }
  return Array.from(grouped.keys())
    .sort(compareText)
    .map((fieldPath) => materializeField(fieldPath, grouped.get(fieldPath) ?? []));
}

function materializeField(
  fieldPath: string,
  observations: readonly BasicSourcedObservation[],
): BasicExtractedFact {
  const tuplesBySource = new Map<string, Set<string>>();
  for (const observation of observations) {
    const tuples = tuplesBySource.get(observation.sourceId) ?? new Set<string>();
    tuples.add(tupleKey(observation));
    tuplesBySource.set(observation.sourceId, tuples);
  }
  if (Array.from(tuplesBySource.values()).some((tuples) => tuples.size !== 1)) {
    throw new Error("source adapter materialization is invalid");
  }
  const sourceTuples = new Set(
    Array.from(tuplesBySource.values(), (tuples) => tuples.values().next().value),
  );
  const evidence = observations.map(toEvidence).sort(compareEvidence);
  const uncertainties = Array.from(
    new Set(observations.map(({ uncertainty }) => uncertainty).filter(isText)),
  ).sort(compareText);
  return {
    factId: `fact-${createHash("sha256").update(fieldPath, "utf8").digest("hex").slice(0, 16)}`,
    fieldPath,
    status: sourceTuples.size === 1 ? "candidate" : "conflict",
    evidence,
    extractionMethod: "deterministic",
    uncertainty: uncertainties.length === 0 ? null : uncertainties.join(" | "),
  };
}

function toEvidence(item: BasicSourcedObservation): BasicFactEvidence {
  return {
    sourceId: item.sourceId,
    locator: item.locator,
    rawValue: item.rawValue,
    normalizedValue: item.normalizedValue,
    unit: item.unit,
    year: item.year,
  };
}

function tupleKey(item: BasicSourcedObservation): string {
  return `${canonicalJson(item.normalizedValue)}\0${canonicalJson(item.unit)}\0${canonicalJson(item.year)}`;
}

function canonicalJson(value: BasicCollectionJsonValue): string {
  if (value === null) return "null";
  if (typeof value === "number") {
    return Object.is(value, -0) ? "-0" : JSON.stringify(value);
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort(compareText)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key]!)}`)
    .join(",")}}`;
}

function compareEvidence(left: BasicFactEvidence, right: BasicFactEvidence): number {
  return (
    compareText(left.sourceId, right.sourceId) ||
    compareText(left.locator, right.locator) ||
    compareText(canonicalJson(left.rawValue), canonicalJson(right.rawValue)) ||
    compareText(
      canonicalJson(left.normalizedValue),
      canonicalJson(right.normalizedValue),
    ) ||
    compareNullableText(left.unit, right.unit) ||
    compareNullableNumber(left.year, right.year)
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareNullableText(left: string | null, right: string | null): number {
  return left === null
    ? right === null
      ? 0
      : -1
    : right === null
      ? 1
      : compareText(left, right);
}

function compareNullableNumber(left: number | null, right: number | null): number {
  if (left === null) return right === null ? 0 : -1;
  if (right === null) return 1;
  if (Object.is(left, right)) return 0;
  if (Object.is(left, -0)) return -1;
  if (Object.is(right, -0)) return 1;
  return left - right;
}

function isText(value: string | null): value is string {
  return value !== null && value.trim() !== "";
}
