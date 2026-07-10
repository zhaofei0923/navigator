import type {
  BasicDeterministicSourceAdapter,
  BasicSourceAdapterRunInput,
  BasicSourceTransport,
} from "./basic-source-adapter-contracts.js";

const RUN_INPUT_KEYS = [
  "repoRoot",
  "countryCode",
  "runId",
  "adapters",
  "transport",
] as const;
const MAX_TRANSPORT_PROTOTYPE_DEPTH = 16;

export function snapshotBasicSourceAdapterRunInput(
  value: unknown,
): BasicSourceAdapterRunInput {
  const properties = exactDataProperties(value, RUN_INPUT_KEYS);
  const repoRoot = properties?.get("repoRoot");
  const countryCode = properties?.get("countryCode");
  const runId = properties?.get("runId");
  const adapters = snapshotAdapters(properties?.get("adapters"));
  const transport = snapshotTransport(properties?.get("transport"));
  if (
    typeof repoRoot !== "string" ||
    typeof countryCode !== "string" ||
    typeof runId !== "string" ||
    adapters === null ||
    transport === null
  ) {
    throw new Error("source adapter run input is invalid");
  }
  return Object.freeze({
    repoRoot,
    countryCode,
    runId,
    adapters,
    transport,
  });
}

function snapshotAdapters(
  value: unknown,
): readonly BasicDeterministicSourceAdapter[] | null {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
      return null;
    }
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (
      lengthDescriptor === undefined ||
      lengthDescriptor.enumerable ||
      !Object.hasOwn(lengthDescriptor, "value") ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0
    ) {
      return null;
    }
    const length = lengthDescriptor.value as number;
    if (Reflect.ownKeys(value).length !== length + 1) return null;
    const snapshot: BasicDeterministicSourceAdapter[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !Object.hasOwn(descriptor, "value")
      ) {
        return null;
      }
      snapshot.push(descriptor.value as BasicDeterministicSourceAdapter);
    }
    return Object.freeze(snapshot);
  } catch {
    return null;
  }
}

function snapshotTransport(value: unknown): BasicSourceTransport | null {
  try {
    if (
      (typeof value !== "object" && typeof value !== "function") ||
      value === null
    ) {
      return null;
    }
    const originalTransport = value;
    const execute = readDataMethod(originalTransport, "execute");
    if (execute === null) return null;
    return Object.freeze({
      execute(request: Parameters<BasicSourceTransport["execute"]>[0]) {
        return Reflect.apply(execute, originalTransport, [request]) as ReturnType<
          BasicSourceTransport["execute"]
        >;
      },
    });
  } catch {
    return null;
  }
}

function readDataMethod(
  value: object | Function,
  key: string,
): BasicSourceTransport["execute"] | null {
  let owner: object | null = value;
  const visited = new Set<object>();
  for (
    let depth = 0;
    owner !== null && depth < MAX_TRANSPORT_PROTOTYPE_DEPTH;
    depth += 1
  ) {
    if (
      owner === Object.prototype ||
      owner === Function.prototype ||
      visited.has(owner)
    ) {
      return null;
    }
    visited.add(owner);
    const descriptor = Object.getOwnPropertyDescriptor(owner, key);
    if (descriptor !== undefined) {
      return Object.hasOwn(descriptor, "value") &&
        typeof descriptor.value === "function"
        ? (descriptor.value as BasicSourceTransport["execute"])
        : null;
    }
    owner = Object.getPrototypeOf(owner) as object | null;
  }
  return null;
}

function exactDataProperties(
  value: unknown,
  expectedKeys: readonly string[],
): ReadonlyMap<string, unknown> | null {
  try {
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype
    ) {
      return null;
    }
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.length !== expectedKeys.length ||
      ownKeys.some(
        (key) => typeof key !== "string" || !expectedKeys.includes(key),
      )
    ) {
      return null;
    }
    const properties = new Map<string, unknown>();
    for (const key of expectedKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !Object.hasOwn(descriptor, "value")
      ) {
        return null;
      }
      properties.set(key, descriptor.value);
    }
    return properties;
  } catch {
    return null;
  }
}
