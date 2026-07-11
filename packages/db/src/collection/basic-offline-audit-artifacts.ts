import type {
  BasicCollectionReviewReport,
  BasicExtractedFacts,
  BasicMarketOverviewDraft,
  BasicSourceRegister,
} from "./basic-collection-contracts.js";
import { validateBasicCollectionAuditBundle } from "./basic-collection-validator.js";

export type BasicCollectionAuditArtifactName =
  | "source-register.json"
  | "extracted-facts.json"
  | "market-overview.draft.json"
  | "review-report.json";

type ReadonlyDeep<T> = T extends readonly (infer U)[]
  ? ReadonlyArray<ReadonlyDeep<U>>
  : T extends object
    ? { readonly [K in keyof T]: ReadonlyDeep<T[K]> }
    : T;

export type BasicCollectionAuditArtifacts = Readonly<{
  "source-register.json": ReadonlyDeep<BasicSourceRegister>;
  "extracted-facts.json": ReadonlyDeep<BasicExtractedFacts>;
  "market-overview.draft.json": ReadonlyDeep<BasicMarketOverviewDraft>;
  "review-report.json": ReadonlyDeep<BasicCollectionReviewReport>;
}>;

const ARTIFACT_VALIDATION_ERROR = "P1-6D artifact validation failed";

export function createBasicCollectionAuditArtifacts(
  value: unknown,
): BasicCollectionAuditArtifacts {
  try {
    const validation = validateBasicCollectionAuditBundle(value);
    if (!validation.valid) {
      throw new Error(ARTIFACT_VALIDATION_ERROR);
    }

    return Object.freeze({
      "source-register.json": cloneAndFreeze(validation.data.sourceRegister),
      "extracted-facts.json": cloneAndFreeze(validation.data.extractedFacts),
      "market-overview.draft.json": cloneAndFreeze(
        validation.data.marketOverviewDraft,
      ),
      "review-report.json": cloneAndFreeze(validation.data.reviewReport),
    });
  } catch {
    throw new Error(ARTIFACT_VALIDATION_ERROR);
  }
}

function cloneAndFreeze<T>(value: T): ReadonlyDeep<T> {
  if (value === null || typeof value !== "object") {
    return value as ReadonlyDeep<T>;
  }

  if (Array.isArray(value)) {
    const clone: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, index);
      if (descriptor === undefined || !Object.hasOwn(descriptor, "value")) {
        throw new Error("snapshot must contain data properties");
      }
      Object.defineProperty(clone, index, {
        value: cloneAndFreeze(descriptor.value),
        enumerable: true,
        writable: false,
        configurable: false,
      });
    }
    return Object.freeze(clone) as ReadonlyDeep<T>;
  }

  const clone: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !Object.hasOwn(descriptor, "value")) {
      throw new Error("snapshot must contain data properties");
    }
    Object.defineProperty(clone, key, {
      value: cloneAndFreeze(descriptor.value),
      enumerable: true,
      writable: false,
      configurable: false,
    });
  }
  return Object.freeze(clone) as ReadonlyDeep<T>;
}
