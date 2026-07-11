import { isProxy } from "node:util/types";

import type { BasicCollectionJsonValue } from "./basic-collection-contracts.js";

const INVALID = Symbol("invalid offline value");
const MAX_DEPTH = 64;

export type BasicOfflineSnapshotResult =
  | { valid: true; data: BasicCollectionJsonValue }
  | { valid: false };

export function snapshotBasicOfflineValue(value: unknown): BasicOfflineSnapshotResult {
  const data = snapshotAt(value, 0, new Set<object>());
  return data === INVALID ? { valid: false } : { valid: true, data };
}

function snapshotAt(
  value: unknown,
  depth: number,
  ancestors: Set<object>,
): BasicCollectionJsonValue | typeof INVALID {
  try {
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number") return Number.isFinite(value) ? value : INVALID;
    if (typeof value !== "object" || depth >= MAX_DEPTH || isProxy(value) || ancestors.has(value)) return INVALID;
    ancestors.add(value);
    const result = Array.isArray(value)
      ? snapshotArray(value, depth, ancestors)
      : snapshotRecord(value, depth, ancestors);
    ancestors.delete(value);
    return result;
  } catch {
    return INVALID;
  }
}

function snapshotArray(
  value: unknown[],
  depth: number,
  ancestors: Set<object>,
): BasicCollectionJsonValue[] | typeof INVALID {
  if (Object.getPrototypeOf(value) !== Array.prototype) return INVALID;
  const length = Object.getOwnPropertyDescriptor(value, "length");
  if (length === undefined || !Object.hasOwn(length, "value") ||
      typeof length.value !== "number" || !Number.isSafeInteger(length.value) ||
      length.value < 0 || Reflect.ownKeys(value).length !== length.value + 1) return INVALID;
  const result: BasicCollectionJsonValue[] = [];
  for (let index = 0; index < length.value; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) return INVALID;
    const child = snapshotAt(descriptor.value, depth + 1, ancestors);
    if (child === INVALID) return INVALID;
    result.push(child);
  }
  return result;
}

function snapshotRecord(
  value: object,
  depth: number,
  ancestors: Set<object>,
): Record<string, BasicCollectionJsonValue> | typeof INVALID {
  if (Object.getPrototypeOf(value) !== Object.prototype) return INVALID;
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) return INVALID;
  const result: Record<string, BasicCollectionJsonValue> = {};
  for (const key of keys) {
    if (typeof key !== "string") return INVALID;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) return INVALID;
    const child = snapshotAt(descriptor.value, depth + 1, ancestors);
    if (child === INVALID) return INVALID;
    Object.defineProperty(result, key, { value: child, enumerable: true, writable: true, configurable: true });
  }
  return result;
}

export function deepFreezeBasicOfflineValue<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreezeBasicOfflineValue(child);
  return Object.freeze(value);
}

export function deeplyEqualBasicOfflineValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
      left.every((item, index) => deeplyEqualBasicOfflineValue(item, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && deeplyEqualBasicOfflineValue(left[key], right[key]));
}

export function isRecord(value: unknown): value is Record<string, BasicCollectionJsonValue> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
