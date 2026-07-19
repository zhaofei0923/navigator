import type { JsonValue } from "@navigator/shared-types/country-runtime";

interface SerializedReadonlyCacheValue {
  readonly bytes: number;
  readonly serialized: string;
}

export function serializeReadonlyCacheSuccess(
  response: unknown,
): SerializedReadonlyCacheValue {
  const value = extractSuccessValue(response);
  try {
    const snapshot = snapshotJson(value, new WeakSet<object>());
    const serialized = JSON.stringify(snapshot);
    if (typeof serialized !== "string") throw invalidValueError();
    return { bytes: Buffer.byteLength(serialized, "utf8"), serialized };
  } catch {
    throw invalidValueError();
  }
}

export function cloneReadonlyCacheValue<T extends JsonValue>(
  serialized: string,
): T {
  return JSON.parse(serialized) as T;
}

function extractSuccessValue(response: unknown): unknown {
  try {
    if (
      response === null ||
      typeof response !== "object" ||
      Array.isArray(response) ||
      !isPlainObject(response)
    ) {
      throw invalidValueError();
    }
    const descriptors = safeDescriptors(response);
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.length !== 2 ||
      !keys.includes("status") ||
      !keys.includes("value")
    ) {
      throw invalidValueError();
    }
    for (const key of keys) {
      const descriptor = descriptors[key as keyof typeof descriptors];
      if (
        typeof key !== "string" ||
        descriptor === undefined ||
        !("value" in descriptor) ||
        descriptor.enumerable !== true
      ) {
        throw invalidValueError();
      }
    }
    const status = descriptors.status;
    const value = descriptors.value;
    if (
      status === undefined ||
      !("value" in status) ||
      status.value !== 200 ||
      value === undefined ||
      !("value" in value)
    ) {
      throw invalidValueError();
    }
    return value.value;
  } catch {
    throw invalidValueError();
  }
}

function snapshotJson(value: unknown, ancestors: WeakSet<object>): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "object" || ancestors.has(value)) {
    throw invalidValueError();
  }

  ancestors.add(value);
  try {
    return Array.isArray(value)
      ? snapshotJsonArray(value, ancestors)
      : snapshotJsonObject(value, ancestors);
  } finally {
    ancestors.delete(value);
  }
}

function snapshotJsonArray(
  value: unknown[],
  ancestors: WeakSet<object>,
): JsonValue[] {
  if (Object.getPrototypeOf(value) !== Array.prototype) throw invalidValueError();
  const descriptors = safeDescriptors(value);
  const length = descriptors.length?.value;
  if (!Number.isSafeInteger(length) || Number(length) < 0) {
    throw invalidValueError();
  }
  const ownKeys = Reflect.ownKeys(descriptors);
  if (ownKeys.some((key) => typeof key !== "string")) throw invalidValueError();
  if (ownKeys.length !== Number(length) + 1) throw invalidValueError();

  const snapshot: JsonValue[] = [];
  for (let index = 0; index < Number(length); index += 1) {
    const descriptor = descriptors[String(index)];
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true
    ) {
      throw invalidValueError();
    }
    snapshot.push(snapshotJson(descriptor.value, ancestors));
  }
  return snapshot;
}

function snapshotJsonObject(
  value: object,
  ancestors: WeakSet<object>,
): Record<string, JsonValue> {
  if (!isPlainObject(value)) throw invalidValueError();
  const descriptors = safeDescriptors(value);
  const snapshot = Object.create(null) as Record<string, JsonValue>;
  for (const key of Reflect.ownKeys(descriptors)) {
    const descriptor = descriptors[key as keyof typeof descriptors];
    if (
      typeof key !== "string" ||
      descriptor === undefined ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true
    ) {
      throw invalidValueError();
    }
    snapshot[key] = snapshotJson(descriptor.value, ancestors);
  }
  return snapshot;
}

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function safeDescriptors(value: object): PropertyDescriptorMap {
  try {
    return Object.getOwnPropertyDescriptors(value);
  } catch {
    throw invalidValueError();
  }
}

function invalidValueError(): Error {
  return new Error("READ_CACHE_VALUE_INVALID");
}
