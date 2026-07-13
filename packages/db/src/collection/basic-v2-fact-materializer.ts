import { createHash } from "node:crypto";
import { isProxy } from "node:util/types";

import type {
  BasicCollectionJsonValue,
} from "./basic-collection-contracts.js";
import {
  snapshotBasicBoundedArrayEntries,
  snapshotBasicBoundedJsonValue,
} from "./basic-bounded-json.js";
import type {
  BasicExtractedFactV2,
  BasicExtractionMethodV2,
  BasicFactEvidenceV2,
  BasicSourcedObservationV2,
  BasicV2FieldOwner,
} from "./basic-collection-v2-contracts.js";
import { classifyBasicV2FieldPath } from "./basic-collection-v2-contracts.js";

export type { BasicSourcedObservationV2 } from "./basic-collection-v2-contracts.js";

const OBSERVATION_KEYS = [
  "sourceId",
  "fieldPath",
  "locator",
  "rawValue",
  "normalizedValue",
  "unit",
  "year",
  "uncertainty",
] as const;
const MAX_JSON_ARRAY_LENGTH = 256;
const MAX_JSON_STRING_BYTES = 65_536;

export function materializeBasicSourceFactsV2(
  observations: readonly BasicSourcedObservationV2[],
  extractionMethod: BasicExtractionMethodV2,
): readonly BasicExtractedFactV2[] {
  try {
    if (
      extractionMethod !== "deterministic" &&
      extractionMethod !== "manual"
    ) {
      invalid();
    }
    return materializeFacts(
      observations,
      extractionMethod,
      ["source-backed", "hybrid-name"],
    );
  } catch {
    invalid();
  }
}

export function materializeBasicEditorialObservationsV2(
  observations: readonly BasicSourcedObservationV2[],
): readonly BasicExtractedFactV2[] {
  return materializeFacts(observations, "manual", ["editorial"]);
}

function materializeFacts(
  observations: readonly BasicSourcedObservationV2[],
  extractionMethod: BasicExtractionMethodV2,
  allowedOwners: readonly BasicV2FieldOwner[],
): readonly BasicExtractedFactV2[] {
  try {
    const values = snapshotBasicBoundedArrayEntries(
      observations,
      MAX_JSON_ARRAY_LENGTH,
    );
    if (!values.valid) invalid();
    const grouped = new Map<string, BasicSourcedObservationV2[]>();
    for (const value of values.data) {
      const observation = snapshotObservation(value);
      const fieldOwner = classifyBasicV2FieldPath(observation.fieldPath);
      if (fieldOwner === null || !allowedOwners.includes(fieldOwner)) invalid();
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
  } catch {
    invalid();
  }
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
    rawValue: item.rawValue,
    normalizedValue: item.normalizedValue,
    unit: item.unit,
    year: item.year,
  });
}

function snapshotObservation(value: unknown): BasicSourcedObservationV2 {
  const observation = snapshotExactDataRecord(value, OBSERVATION_KEYS);
  const sourceId = observation.sourceId;
  const fieldPath = observation.fieldPath;
  const locator = observation.locator;
  const unit = observation.unit;
  const year = observation.year;
  const uncertainty = observation.uncertainty;
  if (
    typeof sourceId !== "string" ||
    typeof fieldPath !== "string" ||
    typeof locator !== "string" ||
    !(unit === null || typeof unit === "string") ||
    !(year === null || typeof year === "number" && Number.isFinite(year)) ||
    !(uncertainty === null || typeof uncertainty === "string") ||
    !boundedString(sourceId) || !boundedString(fieldPath) || !boundedString(locator) ||
    !(unit === null || boundedString(unit)) ||
    !(uncertainty === null || boundedString(uncertainty))
  ) {
    invalid();
  }
  return Object.freeze({
    sourceId,
    fieldPath,
    locator,
    rawValue: snapshotJson(observation.rawValue),
    normalizedValue: snapshotJson(observation.normalizedValue),
    unit,
    year,
    uncertainty,
  });
}

function snapshotExactDataRecord(
  value: unknown,
  keys: readonly string[],
): Readonly<Record<string, unknown>> {
  if (
    typeof value !== "object" ||
    value === null ||
    isProxy(value) ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    invalid();
  }
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))
  ) {
    invalid();
  }
  const snapshot: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, "value")
    ) {
      invalid();
    }
    Object.defineProperty(snapshot, key, {
      value: descriptor.value,
      enumerable: true,
      writable: false,
      configurable: false,
    });
  }
  return Object.freeze(snapshot);
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

function snapshotJson(value: unknown): BasicCollectionJsonValue {
  const snapshot = snapshotBasicBoundedJsonValue(value);
  if (!snapshot.valid) invalid();
  return snapshot.data;
}

function boundedString(value: string): boolean {
  return Buffer.byteLength(value, "utf8") <= MAX_JSON_STRING_BYTES;
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
