import { isProxy } from "node:util/types";

import type { BasicCollectionJsonValue } from "./basic-collection-contracts.js";
import type { BasicCollectionAuditArtifactName } from "./basic-offline-audit-artifacts.js";
import { snapshotBasicBoundedJsonValue } from "./basic-bounded-json.js";
import {
  isBasicStrictJsonUnicodeScalarError,
  parseBasicStrictJsonText,
} from "./basic-strict-json.js";
import type { JsonRecord } from "../seed/basic-country-types.js";
import {
  BASIC_COUNTRY_PUBLICATION_JSON_MAX_BYTES,
  type BasicCountryPublicationApprovalReceipt,
  type BasicCountryPublicationValidationInputV3,
} from "./basic-publication-contracts.js";

export const BASIC_PUBLICATION_V3_CANDIDATE_NAMES = Object.freeze([
  "source-register.json", "extracted-facts.json",
  "market-overview.draft.json", "review-report.json",
] as const satisfies readonly BasicCollectionAuditArtifactName[]);

const SNAPSHOT_BUDGETS = Object.freeze({
  maximumObjectProperties: 256,
  maximumTotalNodes: 65_536,
});
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype) as object;
const BUFFER_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "buffer")?.get;
const BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteLength")?.get;

export type BasicPublicationV3JsonDecodeResult =
  | Readonly<{ valid: true; data: BasicCollectionJsonValue }>
  | Readonly<{ valid: false; malformedScalar: boolean }>;

export function snapshotBasicPublicationV3Json(value: unknown) {
  return snapshotBasicBoundedJsonValue(value, () => undefined, SNAPSHOT_BUDGETS);
}

export function readBasicPublicationV3InputValue(
  input: BasicCountryPublicationValidationInputV3,
  key: keyof BasicCountryPublicationValidationInputV3,
): unknown {
  if (typeof input !== "object" || input === null || isProxy(input)) invalid();
  const descriptor = Object.getOwnPropertyDescriptor(input, key);
  if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
    invalid();
  }
  return descriptor.value;
}

export function decodeBasicPublicationV3Json(
  bytes: Uint8Array,
): BasicPublicationV3JsonDecodeResult {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const snapshot = snapshotBasicPublicationV3Json(parseBasicStrictJsonText(text));
    return snapshot.valid
      ? { valid: true, data: snapshot.data }
      : { valid: false, malformedScalar: false };
  } catch (error) {
    return {
      valid: false,
      malformedScalar: isBasicStrictJsonUnicodeScalarError(error),
    };
  }
}

export function snapshotBasicPublicationV3Bytes(value: unknown): Uint8Array | null {
  try {
    if (
      typeof value !== "object" || value === null || isProxy(value) ||
      Object.getPrototypeOf(value) !== Uint8Array.prototype ||
      BUFFER_GETTER === undefined || BYTE_LENGTH_GETTER === undefined
    ) return null;
    const buffer: unknown = Reflect.apply(BUFFER_GETTER, value, []);
    const byteLength: unknown = Reflect.apply(BYTE_LENGTH_GETTER, value, []);
    if (
      typeof byteLength !== "number" || !Number.isSafeInteger(byteLength) ||
      byteLength < 0 || byteLength > BASIC_COUNTRY_PUBLICATION_JSON_MAX_BYTES ||
      !(buffer instanceof ArrayBuffer) ||
      typeof SharedArrayBuffer !== "undefined" && buffer instanceof SharedArrayBuffer
    ) return null;
    return Uint8Array.prototype.slice.call(value) as Uint8Array;
  } catch {
    return null;
  }
}

export function snapshotBasicPublicationV3ArtifactBytes(
  value: unknown,
): Readonly<Record<BasicCollectionAuditArtifactName, Uint8Array>> | null {
  if (
    typeof value !== "object" || value === null || isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    !hasExactBasicPublicationV3Keys(
      value as JsonRecord,
      BASIC_PUBLICATION_V3_CANDIDATE_NAMES,
    )
  ) return null;
  const output = {} as Record<BasicCollectionAuditArtifactName, Uint8Array>;
  for (const name of BASIC_PUBLICATION_V3_CANDIDATE_NAMES) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    const bytes = descriptor?.enumerable && Object.hasOwn(descriptor, "value")
      ? snapshotBasicPublicationV3Bytes(descriptor.value)
      : null;
    if (bytes === null) return null;
    output[name] = bytes;
  }
  return Object.freeze(output);
}

export function reconstructBasicPublicationV3Candidate(
  bytes: Readonly<Record<BasicCollectionAuditArtifactName, Uint8Array>>,
  receipt: BasicCountryPublicationApprovalReceipt,
): unknown | null {
  const values: Record<string, BasicCollectionJsonValue> = {};
  for (const name of BASIC_PUBLICATION_V3_CANDIDATE_NAMES) {
    const decoded = decodeBasicPublicationV3Json(bytes[name]);
    if (!decoded.valid) return null;
    values[name] = decoded.data;
  }
  return {
    countryDirectory: receipt.countryDirectory,
    runId: receipt.runId,
    sourceRegister: values["source-register.json"],
    extractedFacts: values["extracted-facts.json"],
    marketOverviewDraft: values["market-overview.draft.json"],
    reviewReport: values["review-report.json"],
  };
}

export function hasExactBasicPublicationV3Keys(
  value: JsonRecord,
  expected: readonly string[],
): boolean {
  const keys = Reflect.ownKeys(value);
  return keys.length === expected.length &&
    keys.every((key) => typeof key === "string" && expected.includes(key)) &&
    expected.every((key) => Object.hasOwn(value, key));
}

function invalid(): never {
  throw new Error("invalid basic publication v3 input");
}
