import { createHash } from "node:crypto";

import type {
  BasicCollectionJsonValue,
  BasicExtractedFact,
  BasicFactEvidence,
} from "./basic-collection-contracts.js";

export interface BasicHermesSourcedObservation {
  sourceId: string;
  fieldPath: string;
  locator: string;
  rawValue: BasicCollectionJsonValue;
  normalizedValue: BasicCollectionJsonValue;
  unit: string | null;
  year: number | null;
  uncertainty: string | null;
  untrusted: boolean;
}

export function materializeBasicHermesFacts(
  observations: readonly BasicHermesSourcedObservation[],
): BasicExtractedFact[] {
  const grouped = new Map<string, BasicHermesSourcedObservation[]>();
  for (const observation of observations) {
    const values = grouped.get(observation.fieldPath) ?? [];
    values.push(observation);
    grouped.set(observation.fieldPath, values);
  }
  return Array.from(grouped, ([fieldPath, values]) => materialize(fieldPath, values))
    .sort((left, right) => compare(left.fieldPath, right.fieldPath));
}

function materialize(fieldPath: string, values: readonly BasicHermesSourcedObservation[]): BasicExtractedFact {
  const tuples = new Map<string, Set<string>>();
  for (const value of values) {
    const source = tuples.get(value.sourceId) ?? new Set<string>();
    source.add(tuple(value));
    tuples.set(value.sourceId, source);
  }
  if (Array.from(tuples.values()).some((source) => source.size !== 1)) {
    throw new Error("Hermes evidence has multiple source tuples");
  }
  const distinct = new Set(Array.from(tuples.values(), (source) => source.values().next().value));
  const evidence = values.map(toEvidence).sort(compareEvidence);
  const uncertainty = Array.from(new Set(values.map((value) => value.uncertainty).filter(isText)))
    .sort(compare).join(" | ") || null;
  return {
    factId: factId(fieldPath), fieldPath,
    status: distinct.size > 1 ? "conflict" : values.some((value) => value.untrusted) ? "untrusted" : "candidate",
    evidence, extractionMethod: "hermes", uncertainty,
  };
}

function toEvidence(value: BasicHermesSourcedObservation): BasicFactEvidence {
  return { sourceId: value.sourceId, locator: value.locator, rawValue: value.rawValue, normalizedValue: value.normalizedValue, unit: value.unit, year: value.year };
}

export function factId(fieldPath: string): string {
  return `fact-${createHash("sha256").update(fieldPath, "utf8").digest("hex").slice(0, 16)}`;
}

function tuple(value: BasicHermesSourcedObservation): string {
  return `${json(value.normalizedValue)}\0${json(value.unit)}\0${json(value.year)}`;
}

function json(value: BasicCollectionJsonValue | string | number | null): string {
  if (value === null) return "null";
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : JSON.stringify(value);
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(json).join(",")}]`;
  return `{${Object.keys(value).sort(compare).map((key) => `${JSON.stringify(key)}:${json(value[key]!)}`).join(",")}}`;
}

function compareEvidence(left: BasicFactEvidence, right: BasicFactEvidence): number {
  return compare(left.sourceId, right.sourceId) || compare(left.locator, right.locator) ||
    compare(json(left.rawValue), json(right.rawValue)) || compare(json(left.normalizedValue), json(right.normalizedValue)) ||
    compare(json(left.unit), json(right.unit)) || compare(json(left.year), json(right.year));
}
function compare(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function isText(value: string | null): value is string { return value !== null && value.trim() !== ""; }
