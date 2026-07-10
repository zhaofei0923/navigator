import { isProxy } from "node:util/types";

import {
  CREDIBILITIES,
  INDUSTRY_TAGS,
  TECH_TAGS,
} from "@navigator/shared-types/schema";
import type { BasicCollectionJsonValue } from "./basic-collection-contracts.js";

const JSON_INVALID = Symbol("json-invalid");
const MAX_JSON_DEPTH = 64;

function localizedTextSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["zh", "en"],
    properties: {
      zh: { type: "string" },
      en: { type: "string" },
    },
  };
}

export function deepFreezeBasicLlamaValue<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreezeBasicLlamaValue(child);
  Object.freeze(value);
  return value;
}

export type BasicLlamaJsonSnapshot =
  | { valid: true; data: BasicCollectionJsonValue }
  | { valid: false };

export function snapshotBasicLlamaJson(value: unknown): BasicLlamaJsonSnapshot {
  const data = snapshotJsonAt(value, 0, new Set<object>());
  return data === JSON_INVALID ? { valid: false } : { valid: true, data };
}

function snapshotJsonAt(
  value: unknown,
  depth: number,
  ancestors: Set<object>,
): BasicCollectionJsonValue | typeof JSON_INVALID {
  try {
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number") return Number.isFinite(value) ? value : JSON_INVALID;
    if (typeof value !== "object" || depth >= MAX_JSON_DEPTH || isProxy(value)) return JSON_INVALID;
    if (ancestors.has(value)) return JSON_INVALID;
    ancestors.add(value);
    const result = Array.isArray(value)
      ? snapshotArray(value, depth, ancestors)
      : snapshotRecord(value, depth, ancestors);
    ancestors.delete(value);
    return result;
  } catch {
    return JSON_INVALID;
  }
}

function snapshotArray(
  value: unknown[],
  depth: number,
  ancestors: Set<object>,
): BasicCollectionJsonValue[] | typeof JSON_INVALID {
  if (Object.getPrototypeOf(value) !== Array.prototype) return JSON_INVALID;
  const length = Object.getOwnPropertyDescriptor(value, "length");
  if (length === undefined || !Object.hasOwn(length, "value") ||
      typeof length.value !== "number" || !Number.isSafeInteger(length.value) ||
      length.value < 0 || Reflect.ownKeys(value).length !== length.value + 1) return JSON_INVALID;
  const result: BasicCollectionJsonValue[] = [];
  for (let index = 0; index < length.value; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) return JSON_INVALID;
    const child = snapshotJsonAt(descriptor.value, depth + 1, ancestors);
    if (child === JSON_INVALID) return JSON_INVALID;
    result.push(child);
  }
  return result;
}

function snapshotRecord(
  value: object,
  depth: number,
  ancestors: Set<object>,
): Record<string, BasicCollectionJsonValue> | typeof JSON_INVALID {
  if (Object.getPrototypeOf(value) !== Object.prototype) return JSON_INVALID;
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) return JSON_INVALID;
  const result: Record<string, BasicCollectionJsonValue> = {};
  for (const key of keys) {
    if (typeof key !== "string") return JSON_INVALID;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) return JSON_INVALID;
    const child = snapshotJsonAt(descriptor.value, depth + 1, ancestors);
    if (child === JSON_INVALID) return JSON_INVALID;
    Object.defineProperty(result, key, { value: child, enumerable: true, writable: true, configurable: true });
  }
  return result;
}

const schema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [
    "overview",
    "population",
    "gdp",
    "gdpGrowth",
    "energyDemand",
    "renewableTarget",
    "keyIndicators",
    "source",
    "sourceUrl",
    "collectedAt",
    "updatedAt",
    "credibility",
    "reviewStatus",
    "aiUsable",
    "countryCode",
    "industryTags",
    "techTags",
  ],
  properties: {
    overview: localizedTextSchema(),
    population: { type: ["number", "null"] },
    gdp: { type: ["number", "null"] },
    gdpGrowth: { type: ["number", "null"] },
    energyDemand: localizedTextSchema(),
    renewableTarget: localizedTextSchema(),
    keyIndicators: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "value", "unit", "year"],
        properties: {
          label: localizedTextSchema(),
          value: { type: "string" },
          unit: { type: "string" },
          year: { type: "number" },
        },
      },
    },
    source: { type: "string" },
    sourceUrl: { type: ["string", "null"] },
    collectedAt: { type: "string" },
    updatedAt: { type: "string" },
    credibility: { type: "string", enum: [...CREDIBILITIES] },
    reviewStatus: { const: "draft" },
    aiUsable: { const: false },
    countryCode: { type: "string", pattern: "^[A-Z]{2}$" },
    industryTags: {
      type: "array",
      items: { type: "string", enum: [...INDUSTRY_TAGS] },
    },
    techTags: {
      type: "array",
      items: { type: "string", enum: [...TECH_TAGS] },
    },
  },
};

deepFreezeBasicLlamaValue(schema);

export const BASIC_LLAMA_DRAFT_JSON_SCHEMA: Readonly<Record<string, unknown>> =
  schema;
