import type { BasicCollectionAuditArtifactName } from "./basic-offline-audit-artifacts.js";
import type {
  BasicCollectionAuditArtifactsV3,
  BasicCollectionAuditSerializedArtifactsV3,
} from "./basic-collection-v3-contracts.js";
import { validateBasicCollectionAuditBundleV3 } from "./basic-collection-v3-validator.js";

const NAMES = [
  "source-register.json",
  "extracted-facts.json",
  "market-overview.draft.json",
  "review-report.json",
] as const satisfies readonly BasicCollectionAuditArtifactName[];
const SERIALIZED = new WeakMap<object, Readonly<Record<BasicCollectionAuditArtifactName, string>>>();

export function createBasicCollectionAuditArtifactsV3(
  value: unknown,
): BasicCollectionAuditArtifactsV3 {
  try {
    const validation = validateBasicCollectionAuditBundleV3(value);
    if (!validation.valid) invalid();
    const artifacts = Object.freeze({
      "source-register.json": cloneAndFreeze(validation.data.sourceRegister),
      "extracted-facts.json": cloneAndFreeze(validation.data.extractedFacts),
      "market-overview.draft.json": cloneAndFreeze(validation.data.marketOverviewDraft),
      "review-report.json": cloneAndFreeze(validation.data.reviewReport),
    });
    SERIALIZED.set(artifacts, Object.freeze(Object.fromEntries(
      NAMES.map((name) => [name, `${JSON.stringify(artifacts[name])}\n`]),
    ) as Record<BasicCollectionAuditArtifactName, string>));
    return artifacts;
  } catch {
    throw new Error("Basic audit v3 artifact validation failed");
  }
}

export function serializeBasicCollectionAuditArtifactsV3(
  artifacts: BasicCollectionAuditArtifactsV3,
): BasicCollectionAuditSerializedArtifactsV3 {
  try {
    const serialized = SERIALIZED.get(artifacts);
    if (serialized === undefined) invalid();
    const encoder = new TextEncoder();
    return Object.freeze(Object.fromEntries(
      NAMES.map((name) => [name, encoder.encode(serialized[name])]),
    ) as Record<BasicCollectionAuditArtifactName, Uint8Array>);
  } catch {
    throw new Error("Basic audit v3 artifact serialization failed");
  }
}

function cloneAndFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return Object.freeze(value.map(cloneAndFreeze)) as T;
  return Object.freeze(Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, cloneAndFreeze(item)]),
  )) as T;
}

function invalid(): never {
  throw new Error("invalid");
}
