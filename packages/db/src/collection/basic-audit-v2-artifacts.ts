import type { BasicCollectionAuditArtifactName } from "./basic-offline-audit-artifacts.js";
import {
  type BasicCollectionAuditArtifactsV2,
  type BasicCollectionAuditSerializedArtifactsV2,
  type ReadonlyDeep,
} from "./basic-collection-v2-contracts.js";
import { validateBasicCollectionAuditBundleV2 } from "./basic-collection-v2-validator.js";

const ARTIFACT_NAMES = Object.freeze([
  "source-register.json",
  "extracted-facts.json",
  "market-overview.draft.json",
  "review-report.json",
] as const satisfies readonly BasicCollectionAuditArtifactName[]);
const VALIDATION_ERROR = "Basic audit v2 artifact validation failed";
const SERIALIZATION_ERROR = "Basic audit v2 artifact serialization failed";

export function createBasicCollectionAuditArtifactsV2(
  value: unknown,
): BasicCollectionAuditArtifactsV2 {
  try {
    const validation = validateBasicCollectionAuditBundleV2(value);
    if (!validation.valid) throw new Error(VALIDATION_ERROR);
    return Object.freeze({
      "source-register.json": cloneAndFreeze(validation.data.sourceRegister),
      "extracted-facts.json": cloneAndFreeze(validation.data.extractedFacts),
      "market-overview.draft.json": cloneAndFreeze(validation.data.marketOverviewDraft),
      "review-report.json": cloneAndFreeze(validation.data.reviewReport),
    });
  } catch {
    throw new Error(VALIDATION_ERROR);
  }
}

export function serializeBasicCollectionAuditArtifactsV2(
  artifacts: BasicCollectionAuditArtifactsV2,
): BasicCollectionAuditSerializedArtifactsV2 {
  try {
    if (!hasExactArtifactKeys(artifacts)) throw new Error(SERIALIZATION_ERROR);
    const encoder = new TextEncoder();
    const output = {} as Record<BasicCollectionAuditArtifactName, Uint8Array>;
    for (const name of ARTIFACT_NAMES) {
      const descriptor = Object.getOwnPropertyDescriptor(artifacts, name);
      if (
        descriptor === undefined || !descriptor.enumerable ||
        !Object.hasOwn(descriptor, "value")
      ) throw new Error(SERIALIZATION_ERROR);
      output[name] = encoder.encode(`${JSON.stringify(descriptor.value)}\n`);
    }
    return Object.freeze(output);
  } catch {
    throw new Error(SERIALIZATION_ERROR);
  }
}

function hasExactArtifactKeys(value: unknown): value is BasicCollectionAuditArtifactsV2 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const keys = Reflect.ownKeys(value);
  return keys.length === ARTIFACT_NAMES.length &&
    keys.every((key, index) => key === ARTIFACT_NAMES[index]);
}

function cloneAndFreeze<T>(value: T): ReadonlyDeep<T> {
  if (value === null || typeof value !== "object") return value as ReadonlyDeep<T>;
  if (Array.isArray(value)) {
    const result: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !Object.hasOwn(descriptor, "value")) {
        throw new Error(VALIDATION_ERROR);
      }
      Object.defineProperty(result, index, {
        value: cloneAndFreeze(descriptor.value),
        enumerable: true,
        writable: false,
        configurable: false,
      });
    }
    return Object.freeze(result) as ReadonlyDeep<T>;
  }
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !Object.hasOwn(descriptor, "value")) {
      throw new Error(VALIDATION_ERROR);
    }
    Object.defineProperty(result, key, {
      value: cloneAndFreeze(descriptor.value),
      enumerable: true,
      writable: false,
      configurable: false,
    });
  }
  return Object.freeze(result) as ReadonlyDeep<T>;
}
