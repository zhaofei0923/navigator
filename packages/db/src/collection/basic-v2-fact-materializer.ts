import { createHash } from "node:crypto";

import type {
  BasicCollectionJsonValue,
} from "./basic-collection-contracts.js";
import type {
  BasicExtractedFactV2,
  BasicExtractionMethodV2,
  BasicFactEvidenceV2,
  BasicSourcedObservationV2,
} from "./basic-collection-v2-contracts.js";

export type { BasicSourcedObservationV2 } from "./basic-collection-v2-contracts.js";

export function materializeBasicSourceFactsV2(
  observations: readonly BasicSourcedObservationV2[],
  extractionMethod: BasicExtractionMethodV2,
): readonly BasicExtractedFactV2[] {
  if (
    extractionMethod !== "deterministic" &&
    extractionMethod !== "manual"
  ) {
    invalid();
  }

  const grouped = new Map<string, BasicSourcedObservationV2[]>();
  for (const observation of observations) {
    validateObservation(observation);
    const group = grouped.get(observation.fieldPath) ?? [];
    group.push(observation);
    grouped.set(observation.fieldPath, group);
  }

  return Object.freeze(
    Array.from(grouped.keys())
      .sort(compareText)
      .map((fieldPath) => materializeField(
        fieldPath,
        grouped.get(fieldPath) ?? [],
        extractionMethod,
      )),
  );
}

function materializeField(
  fieldPath: string,
  observations: readonly BasicSourcedObservationV2[],
  extractionMethod: BasicExtractionMethodV2,
): BasicExtractedFactV2 {
  const tuplesBySource = new Map<string, Set<string>>();
  for (const observation of observations) {
    const tuples = tuplesBySource.get(observation.sourceId) ?? new Set<string>();
    tuples.add(tupleKey(observation));
    tuplesBySource.set(observation.sourceId, tuples);
  }
  if (Array.from(tuplesBySource.values()).some((tuples) => tuples.size !== 1)) {
    invalid();
  }

  const sourceTuples = new Set(
    Array.from(tuplesBySource.values(), (tuples) => tuples.values().next().value),
  );
  const evidence = Object.freeze(observations.map(toEvidence).sort(compareEvidence));
  const uncertainties = Array.from(
    new Set(observations.map(({ uncertainty }) => uncertainty?.trim()).filter(isText)),
  ).sort(compareText);

  return Object.freeze({
    factId: `fact-${createHash("sha256").update(fieldPath, "utf8").digest("hex").slice(0, 16)}`,
    fieldPath,
    status: sourceTuples.size === 1 ? "candidate" : "conflict",
    evidence,
    extractionMethod,
    uncertainty: uncertainties.length === 0 ? null : uncertainties.join(" | "),
  });
}

function toEvidence(item: BasicSourcedObservationV2): BasicFactEvidenceV2 {
  return Object.freeze({
    sourceId: item.sourceId,
    locator: item.locator,
    rawValue: snapshotJson(item.rawValue),
    normalizedValue: snapshotJson(item.normalizedValue),
    unit: item.unit,
    year: item.year,
  });
}

function validateObservation(value: BasicSourcedObservationV2): void {
  if (
    typeof value !== "object" ||
    value === null ||
    typeof value.sourceId !== "string" ||
    typeof value.fieldPath !== "string" ||
    typeof value.locator !== "string" ||
    !(value.unit === null || typeof value.unit === "string") ||
    !(value.year === null || Number.isFinite(value.year)) ||
    !(value.uncertainty === null || typeof value.uncertainty === "string")
  ) {
    invalid();
  }
  snapshotJson(value.rawValue);
  snapshotJson(value.normalizedValue);
}

function tupleKey(item: BasicSourcedObservationV2): string {
  return `${canonicalJson(item.normalizedValue)}\0${canonicalJson(item.unit)}\0${canonicalJson(item.year)}`;
}

function canonicalJson(value: BasicCollectionJsonValue): string {
  if (value === null) return "null";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalid();
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

function snapshotJson(value: BasicCollectionJsonValue): BasicCollectionJsonValue {
  return snapshotJsonValue(value, new Set<object>());
}

function snapshotJsonValue(
  value: BasicCollectionJsonValue,
  ancestors: Set<object>,
): BasicCollectionJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalid();
    return value;
  }
  if (ancestors.has(value)) invalid();
  ancestors.add(value);
  const snapshot = Array.isArray(value)
    ? Object.freeze(value.map((item) => snapshotJsonValue(item, ancestors)))
    : Object.freeze(Object.fromEntries(
      Object.keys(value).map((key) => [key, snapshotJsonValue(value[key]!, ancestors)]),
    ));
  ancestors.delete(value);
  return snapshot as unknown as BasicCollectionJsonValue;
}

function compareEvidence(left: BasicFactEvidenceV2, right: BasicFactEvidenceV2): number {
  return (
    compareText(left.sourceId, right.sourceId) ||
    compareText(left.locator, right.locator) ||
    compareText(canonicalJson(left.rawValue), canonicalJson(right.rawValue)) ||
    compareText(canonicalJson(left.normalizedValue), canonicalJson(right.normalizedValue)) ||
    compareNullableText(left.unit, right.unit) ||
    compareNullableNumber(left.year, right.year)
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareNullableText(left: string | null, right: string | null): number {
  return left === null
    ? right === null ? 0 : -1
    : right === null ? 1 : compareText(left, right);
}

function compareNullableNumber(left: number | null, right: number | null): number {
  if (left === null) return right === null ? 0 : -1;
  if (right === null) return 1;
  if (Object.is(left, right)) return 0;
  if (Object.is(left, -0)) return -1;
  if (Object.is(right, -0)) return 1;
  return left - right;
}

function isText(value: string | null | undefined): value is string {
  return value !== undefined && value !== null && value.trim() !== "";
}

function invalid(): never {
  throw new Error("source fact materialization is invalid");
}
