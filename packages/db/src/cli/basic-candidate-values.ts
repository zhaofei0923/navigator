import { isProxy } from "node:util/types";

export function exactBasicCandidateRecord<const Keys extends readonly string[]>(
  value: unknown,
  keys: Keys,
): Record<Keys[number], unknown> {
  const entries = exactBasicCandidateEntries(value, keys);
  if (entries === null) invalid();
  return Object.fromEntries(entries) as Record<Keys[number], unknown>;
}

export function exactBasicCandidateMap(
  value: unknown,
  keys: readonly string[],
): ReadonlyMap<string, unknown> | null {
  const entries = exactBasicCandidateEntries(value, keys);
  return entries === null ? null : new Map(entries);
}

export function snapshotBasicCandidateArray(
  value: unknown,
  maximumLength: number,
  allowEmpty: boolean,
): readonly unknown[] {
  if (
    typeof value !== "object" || value === null || isProxy(value) ||
    !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
  ) invalid();
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (
    lengthDescriptor === undefined || !Object.hasOwn(lengthDescriptor, "value") ||
    typeof lengthDescriptor.value !== "number" ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value > maximumLength ||
    (!allowEmpty && lengthDescriptor.value === 0) ||
    Reflect.ownKeys(value).length !== lengthDescriptor.value + 1
  ) invalid();
  const result: unknown[] = [];
  for (let index = 0; index < lengthDescriptor.value; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      descriptor === undefined || !descriptor.enumerable ||
      !Object.hasOwn(descriptor, "value")
    ) invalid();
    result.push(descriptor.value);
  }
  return result;
}

export function sameBasicCandidateBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength &&
    left.every((value, index) => value === right[index]);
}

export function sameBasicCandidateStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function compareBasicCandidateText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function exactBasicCandidateEntries(
  value: unknown,
  keys: readonly string[],
): readonly (readonly [string, unknown])[] | null {
  try {
    if (
      typeof value !== "object" || value === null || isProxy(value) ||
      Object.getPrototypeOf(value) !== Object.prototype
    ) return null;
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.length !== keys.length ||
      ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))
    ) return null;
    const result: Array<readonly [string, unknown]> = [];
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined || !descriptor.enumerable ||
        !Object.hasOwn(descriptor, "value")
      ) return null;
      result.push(Object.freeze([key, descriptor.value] as const));
    }
    return result;
  } catch {
    return null;
  }
}

function invalid(): never {
  throw new Error("invalid");
}
