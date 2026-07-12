import { isProxy } from "node:util/types";

import type { BasicCollectionJsonValue } from "./basic-collection-contracts.js";

const INVALID = Symbol("invalid bounded JSON");
const MAX_DEPTH = 64;
const MAX_ARRAY_LENGTH = 256;
const MAX_CONFIGURED_ARRAY_LENGTH = 2_048;
const MAX_STRING_BYTES = 65_536;

export type BasicBoundedJsonPath = readonly (string | number)[];
export type BasicBoundedArrayLimit = (
  path: BasicBoundedJsonPath,
) => number | undefined;

export type BasicBoundedJsonSnapshot =
  | Readonly<{ valid: true; data: BasicCollectionJsonValue }>
  | Readonly<{ valid: false }>;

export type BasicBoundedArrayEntriesSnapshot =
  | Readonly<{ valid: true; data: readonly unknown[] }>
  | Readonly<{ valid: false }>;

export function snapshotBasicBoundedJsonValue(
  value: unknown,
  arrayLimit: BasicBoundedArrayLimit = () => undefined,
): BasicBoundedJsonSnapshot {
  try {
    const data = snapshotAt(value, 0, [], new Set<object>(), arrayLimit);
    return data === INVALID ? { valid: false } : { valid: true, data };
  } catch {
    return { valid: false };
  }
}

export function snapshotBasicBoundedArrayEntries(
  value: unknown,
  maximum = MAX_ARRAY_LENGTH,
): BasicBoundedArrayEntriesSnapshot {
  try {
    const limit = boundedArrayLimit(maximum, MAX_ARRAY_LENGTH);
    if (limit === INVALID) return { valid: false };
    const entries = snapshotArrayEntries(value, limit);
    return entries === INVALID
      ? { valid: false }
      : { valid: true, data: Object.freeze(entries) };
  } catch {
    return { valid: false };
  }
}

function snapshotAt(
  value: unknown,
  depth: number,
  path: BasicBoundedJsonPath,
  ancestors: Set<object>,
  arrayLimit: BasicBoundedArrayLimit,
): BasicCollectionJsonValue | typeof INVALID {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : INVALID;
  if (typeof value === "string") return boundedString(value) ? value : INVALID;
  if (
    typeof value !== "object" || depth >= MAX_DEPTH || isProxy(value) ||
    ancestors.has(value)
  ) return INVALID;

  ancestors.add(value);
  try {
    return Array.isArray(value)
      ? snapshotArray(value, depth, path, ancestors, arrayLimit)
      : snapshotRecord(value, depth, path, ancestors, arrayLimit);
  } finally {
    ancestors.delete(value);
  }
}

function snapshotArray(
  value: object,
  depth: number,
  path: BasicBoundedJsonPath,
  ancestors: Set<object>,
  arrayLimit: BasicBoundedArrayLimit,
): BasicCollectionJsonValue | typeof INVALID {
  const configured = arrayLimit(path);
  const maximum = configured === undefined
    ? MAX_ARRAY_LENGTH
    : boundedArrayLimit(configured, MAX_CONFIGURED_ARRAY_LENGTH);
  if (maximum === INVALID) return INVALID;
  const entries = snapshotArrayEntries(value, maximum);
  if (entries === INVALID) return INVALID;

  const result: BasicCollectionJsonValue[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const child = snapshotAt(
      entries[index],
      depth + 1,
      [...path, index],
      ancestors,
      arrayLimit,
    );
    if (child === INVALID) return INVALID;
    result.push(child);
  }
  return Object.freeze(result) as unknown as BasicCollectionJsonValue;
}

function snapshotArrayEntries(
  value: unknown,
  maximum: number,
): unknown[] | typeof INVALID {
  if (
    !Array.isArray(value) || isProxy(value) ||
    Object.getPrototypeOf(value) !== Array.prototype
  ) return INVALID;
  const length = Object.getOwnPropertyDescriptor(value, "length");
  if (
    length === undefined || length.enumerable || !Object.hasOwn(length, "value") ||
    typeof length.value !== "number" || !Number.isSafeInteger(length.value) ||
    length.value < 0 || length.value > maximum ||
    Reflect.ownKeys(value).length !== length.value + 1
  ) return INVALID;

  const result: unknown[] = [];
  for (let index = 0; index < length.value; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      descriptor === undefined || !descriptor.enumerable ||
      !Object.hasOwn(descriptor, "value")
    ) return INVALID;
    result.push(descriptor.value);
  }
  return result;
}

function snapshotRecord(
  value: object,
  depth: number,
  path: BasicBoundedJsonPath,
  ancestors: Set<object>,
  arrayLimit: BasicBoundedArrayLimit,
): BasicCollectionJsonValue | typeof INVALID {
  if (Object.getPrototypeOf(value) !== Object.prototype) return INVALID;
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string" || !boundedString(key))) {
    return INVALID;
  }

  const result: Record<string, BasicCollectionJsonValue> = {};
  for (const key of (keys as string[]).sort(compareText)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined || !descriptor.enumerable ||
      !Object.hasOwn(descriptor, "value")
    ) return INVALID;
    const child = snapshotAt(
      descriptor.value,
      depth + 1,
      [...path, key],
      ancestors,
      arrayLimit,
    );
    if (child === INVALID) return INVALID;
    Object.defineProperty(result, key, {
      value: child,
      enumerable: true,
      writable: false,
      configurable: false,
    });
  }
  return Object.freeze(result);
}

function boundedArrayLimit(value: number, ceiling: number): number | typeof INVALID {
  return Number.isSafeInteger(value) && value >= 0
    ? Math.min(value, ceiling)
    : INVALID;
}

function boundedString(value: string): boolean {
  return Buffer.byteLength(value, "utf8") <= MAX_STRING_BYTES;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
