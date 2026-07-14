import { isProxy } from "node:util/types";

import { validateBasicCountryBundle } from "../seed/basic-country-validator.js";
import type { BasicCanonicalData, JsonRecord } from "../seed/basic-country-types.js";
import type { BasicCollectionJsonValue } from "./basic-collection-contracts.js";
import { validateBasicCollectionAuditBundleV2 } from "./basic-collection-v2-validator.js";
import type { BasicCollectionAuditArtifactName } from "./basic-offline-audit-artifacts.js";
import { snapshotBasicBoundedJsonValue } from "./basic-bounded-json.js";
import {
  deepFreezeBasicOfflineValue,
  deeplyEqualBasicOfflineValue,
  isRecord,
} from "./basic-offline-value.js";
import {
  BASIC_COUNTRY_PUBLICATION_JSON_MAX_BYTES,
  type BasicApprovedCountryPublicationV2,
  type BasicCountryPublicationApprovalReceipt,
  type BasicCountryPublicationBlockerCode,
  type BasicCountryPublicationManifestV2,
  type BasicCountryPublicationValidationInput,
  type BasicCountryPublicationValidationResult,
} from "./basic-publication-contracts.js";
import { equalSha256Hex, sha256Hex } from "./basic-publication-digests.js";
import { materializeBasicCanonicalFromApprovedCandidateV2 } from "./basic-publication-materializer.js";
import {
  parseBasicCountryPublicationApproval,
  parseBasicCountryPublicationManifestV2,
} from "./basic-publication-parser.js";

const CANDIDATE_ARTIFACT_NAMES = Object.freeze([
  "source-register.json",
  "extracted-facts.json",
  "market-overview.draft.json",
  "review-report.json",
] as const satisfies readonly BasicCollectionAuditArtifactName[]);
const CANONICAL_ARTIFACT_NAMES = Object.freeze([
  "collection-manifest.json",
  "country.json",
  "market-overview.json",
] as const);
const COUNTRY_MAPPING_KEYS = Object.freeze([
  "code",
  "name",
  "summary",
  "region",
  "flagEmoji",
  "updatedAt",
] as const);
const COUNTRY_COVERAGE_KEYS = Object.freeze(["coverageLevel", "moduleCoverage"] as const);
const COVERAGE_MODULE_KEYS = Object.freeze([
  "policy",
  "risk",
  "opportunities",
  "projects",
  "partners",
  "chineseCompanies",
  "entryStrategy",
  "reports",
] as const);
const CANONICAL_KEYS = Object.freeze([
  "country",
  "marketOverview",
  ...COVERAGE_MODULE_KEYS,
  "knowledge",
] as const);
const PUBLICATION_SNAPSHOT_BUDGETS = Object.freeze({
  maximumObjectProperties: 256,
  maximumTotalNodes: 65_536,
});
const HIGH_SURROGATE_START = 0xd800;
const HIGH_SURROGATE_END = 0xdbff;
const LOW_SURROGATE_START = 0xdc00;
const LOW_SURROGATE_END = 0xdfff;
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(
  Uint8Array.prototype,
) as object;
const TYPED_ARRAY_BUFFER_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "buffer",
)?.get;
const TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "byteLength",
)?.get;

export function createBasicCountryPublicationFailure(
  blockerCode: BasicCountryPublicationBlockerCode,
): BasicCountryPublicationValidationResult {
  return Object.freeze({ valid: false, blockerCode, data: null });
}

export function validateApprovedBasicCountryPublicationV2(
  input: BasicCountryPublicationValidationInput,
): BasicCountryPublicationValidationResult {
  try {
    const manifestInput = readInputValue(input, "manifest");
    const manifestSnapshot = manifestInput.valid
      ? snapshotPublicationJson(manifestInput.value)
      : { valid: false } as const;
    if (!manifestSnapshot.valid) {
      return createBasicCountryPublicationFailure("MANIFEST_INVALID");
    }
    const manifestResult = parseBasicCountryPublicationManifestV2(
      manifestSnapshot.data,
    );
    if (manifestResult.data === null) {
      return createBasicCountryPublicationFailure("MANIFEST_INVALID");
    }
    const approvalInput = readInputValue(input, "approvalReceipt");
    const approvalSnapshot = approvalInput.valid
      ? snapshotPublicationJson(approvalInput.value)
      : { valid: false } as const;
    if (!approvalSnapshot.valid) {
      return createBasicCountryPublicationFailure("APPROVAL_RECEIPT_INVALID");
    }
    const approvalResult = parseBasicCountryPublicationApproval(
      approvalSnapshot.data,
    );
    if (approvalResult.data === null) {
      return createBasicCountryPublicationFailure("APPROVAL_RECEIPT_INVALID");
    }
    const manifest = manifestResult.data;
    const suppliedApprovalReceipt = approvalResult.data;
    const candidateInput = readInputValue(input, "candidate");
    const candidateSnapshot = candidateInput.valid
      ? snapshotPublicationJson(candidateInput.value)
      : { valid: false } as const;
    const countryDirectory = readInputValue(input, "countryDirectory");

    if (
      !countryDirectory.valid ||
      hasPublicationIdentityMismatch(
        countryDirectory.value,
        manifest,
        suppliedApprovalReceipt,
        candidateSnapshot.valid ? candidateSnapshot.data : null,
      )
    ) {
      return createBasicCountryPublicationFailure("PUBLICATION_IDENTITY_MISMATCH");
    }

    const approvalBytesInput = readInputValue(input, "approvalReceiptBytes");
    const approvalReceiptBytes = approvalBytesInput.valid
      ? snapshotBytes(approvalBytesInput.value)
      : null;
    if (
      approvalReceiptBytes === null ||
      !equalSha256Hex(
        manifest.approvalReceiptSha256,
        sha256Hex(approvalReceiptBytes),
      )
    ) {
      return createBasicCountryPublicationFailure("APPROVAL_RECEIPT_HASH_MISMATCH");
    }
    const approvalJson = decodePublicationJson(approvalReceiptBytes);
    if (!approvalJson.valid) {
      return createBasicCountryPublicationFailure("APPROVAL_RECEIPT_INVALID");
    }
    const byteApprovalResult = parseBasicCountryPublicationApproval(
      approvalJson.data,
    );
    if (byteApprovalResult.data === null) {
      return createBasicCountryPublicationFailure("APPROVAL_RECEIPT_INVALID");
    }
    const approvalReceipt = byteApprovalResult.data;
    if (!deeplyEqualBasicOfflineValue(approvalReceipt, suppliedApprovalReceipt)) {
      return createBasicCountryPublicationFailure("APPROVAL_RECEIPT_HASH_MISMATCH");
    }

    const candidateBytesInput = readInputValue(input, "candidateArtifactBytes");
    const candidateArtifactBytes = candidateBytesInput.valid
      ? snapshotCandidateArtifactBytes(candidateBytesInput.value)
      : null;
    if (
      candidateArtifactBytes === null ||
      CANDIDATE_ARTIFACT_NAMES.some((name) =>
        !equalSha256Hex(
          approvalReceipt.artifactSha256[name],
          sha256Hex(candidateArtifactBytes[name]),
        ))
    ) {
      return createBasicCountryPublicationFailure("CANDIDATE_ARTIFACT_HASH_MISMATCH");
    }

    const byteCandidateSnapshot = reconstructCandidateFromArtifactBytes(
      candidateArtifactBytes,
      approvalReceipt,
    );
    if (!byteCandidateSnapshot.valid) {
      return createBasicCountryPublicationFailure("CANDIDATE_NOT_READY");
    }
    if (
      hasPublicationIdentityMismatch(
        countryDirectory.value,
        manifest,
        approvalReceipt,
        byteCandidateSnapshot.data,
      )
    ) {
      return createBasicCountryPublicationFailure("PUBLICATION_IDENTITY_MISMATCH");
    }
    const candidateValidation = validateBasicCollectionAuditBundleV2(
      byteCandidateSnapshot.data,
    );
    if (!candidateValidation.valid) {
      return createBasicCountryPublicationFailure("CANDIDATE_NOT_READY");
    }
    const suppliedCandidateValidation = validateBasicCollectionAuditBundleV2(
      candidateSnapshot.valid ? candidateSnapshot.data : null,
    );
    if (
      !suppliedCandidateValidation.valid ||
      !deeplyEqualBasicOfflineValue(
        candidateValidation.data,
        suppliedCandidateValidation.data,
      )
    ) {
      return createBasicCountryPublicationFailure("CANDIDATE_ARTIFACT_HASH_MISMATCH");
    }
    if (!isReadyCandidate(candidateValidation)) {
      return createBasicCountryPublicationFailure("CANDIDATE_NOT_READY");
    }
    const candidate = candidateValidation.data;
    if (!hasValidApprovalTimestamps(approvalReceipt, candidate)) {
      return createBasicCountryPublicationFailure("APPROVAL_TIMESTAMP_INVALID");
    }

    let expectedCanonical: BasicCanonicalData;
    try {
      expectedCanonical = materializeBasicCanonicalFromApprovedCandidateV2(
        candidate,
        manifest,
      );
    } catch {
      return createBasicCountryPublicationFailure("CANONICAL_MAPPING_DRIFT");
    }
    const canonicalInput = readInputValue(input, "canonical");
    const canonicalSnapshot = canonicalInput.valid
      ? snapshotPublicationJson(canonicalInput.value)
      : { valid: false } as const;
    if (
      !canonicalSnapshot.valid ||
      !isRecord(canonicalSnapshot.data) ||
      !hasExactKeys(canonicalSnapshot.data, CANONICAL_KEYS) ||
      !hasExactCanonicalMapping(canonicalSnapshot.data, expectedCanonical)
    ) {
      return createBasicCountryPublicationFailure("CANONICAL_MAPPING_DRIFT");
    }
    if (!hasExactBasicCoverage(canonicalSnapshot.data, expectedCanonical)) {
      return createBasicCountryPublicationFailure("BASIC_COVERAGE_VIOLATION");
    }
    if (!hasClosedAiBoundary(canonicalSnapshot.data)) {
      return createBasicCountryPublicationFailure("AI_BOUNDARY_VIOLATION");
    }

    const canonical = canonicalSnapshot.data as unknown as BasicCanonicalData;
    const projectedBundle = createProjectedBundle(
      approvalReceipt.countryDirectory,
      manifest,
      candidate,
      canonical,
    );
    const canonicalValidation = validateBasicCountryBundle(projectedBundle);
    if (
      !canonicalValidation.valid ||
      canonicalValidation.summary.coverageLevel !== "BASIC"
    ) {
      return createBasicCountryPublicationFailure("BASIC_COVERAGE_VIOLATION");
    }
    if (!deeplyEqualBasicOfflineValue(canonical, expectedCanonical)) {
      return createBasicCountryPublicationFailure("CANONICAL_MAPPING_DRIFT");
    }
    const canonicalNames = readInputValue(input, "canonicalArtifactNames");
    if (
      !canonicalNames.valid ||
      !hasExactCanonicalArtifactNames(canonicalNames.value)
    ) {
      return createBasicCountryPublicationFailure("PUBLICATION_READ_FAILED");
    }

    const data: BasicApprovedCountryPublicationV2 = {
      countryDirectory: approvalReceipt.countryDirectory,
      manifest,
      approvalReceipt,
      candidate,
      canonical,
    };
    return deepFreezeBasicOfflineValue({
      valid: true as const,
      blockerCode: null,
      data,
    });
  } catch {
    return createBasicCountryPublicationFailure("PUBLICATION_READ_FAILED");
  }
}

function snapshotPublicationJson(
  value: unknown,
): ReturnType<typeof snapshotBasicBoundedJsonValue> {
  return snapshotBasicBoundedJsonValue(
    value,
    () => undefined,
    PUBLICATION_SNAPSHOT_BUDGETS,
  );
}

function decodePublicationJson(
  bytes: Uint8Array,
): ReturnType<typeof snapshotBasicBoundedJsonValue> {
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const value: unknown = JSON.parse(decoded);
    const snapshot = snapshotPublicationJson(value);
    return snapshot.valid && hasOnlyUnicodeScalarStrings(snapshot.data)
      ? snapshot
      : { valid: false };
  } catch {
    return { valid: false };
  }
}

function hasOnlyUnicodeScalarStrings(value: BasicCollectionJsonValue): boolean {
  const pending: BasicCollectionJsonValue[] = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) return false;
    if (typeof current === "string") {
      if (!isUnicodeScalarString(current)) return false;
      continue;
    }
    if (Array.isArray(current)) {
      for (const item of current) pending.push(item);
      continue;
    }
    if (current === null || typeof current !== "object") continue;
    for (const [key, item] of Object.entries(current)) {
      if (!isUnicodeScalarString(key)) return false;
      pending.push(item);
    }
  }
  return true;
}

function isUnicodeScalarString(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= HIGH_SURROGATE_START && codeUnit <= HIGH_SURROGATE_END) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= LOW_SURROGATE_START && next <= LOW_SURROGATE_END)) {
        return false;
      }
      index += 1;
      continue;
    }
    if (codeUnit >= LOW_SURROGATE_START && codeUnit <= LOW_SURROGATE_END) {
      return false;
    }
  }
  return true;
}

function reconstructCandidateFromArtifactBytes(
  artifacts: Readonly<Record<BasicCollectionAuditArtifactName, Uint8Array>>,
  receipt: BasicCountryPublicationApprovalReceipt,
): ReturnType<typeof snapshotBasicBoundedJsonValue> {
  const values = {} as Record<
    BasicCollectionAuditArtifactName,
    BasicCollectionJsonValue
  >;
  for (const name of CANDIDATE_ARTIFACT_NAMES) {
    const decoded = decodePublicationJson(artifacts[name]);
    if (!decoded.valid) return { valid: false };
    values[name] = decoded.data;
  }
  return snapshotPublicationJson({
    countryDirectory: receipt.countryDirectory,
    runId: receipt.runId,
    sourceRegister: values["source-register.json"],
    extractedFacts: values["extracted-facts.json"],
    marketOverviewDraft: values["market-overview.draft.json"],
    reviewReport: values["review-report.json"],
  });
}

function readInputValue(
  input: BasicCountryPublicationValidationInput,
  key: keyof BasicCountryPublicationValidationInput,
): Readonly<{ valid: true; value: unknown }> | Readonly<{ valid: false }> {
  try {
    if (typeof input !== "object" || input === null || isProxy(input)) {
      return { valid: false };
    }
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, "value")
    ) return { valid: false };
    return { valid: true, value: descriptor.value };
  } catch {
    return { valid: false };
  }
}

function hasPublicationIdentityMismatch(
  countryDirectory: unknown,
  manifest: BasicCountryPublicationManifestV2,
  receipt: BasicCountryPublicationApprovalReceipt,
  candidate: unknown,
): boolean {
  if (
    countryDirectory !== receipt.countryDirectory ||
    manifest.activeRunId !== receipt.runId ||
    manifest.auditBundlePath !==
      `data/staging/${receipt.countryDirectory}/${receipt.runId}` ||
    manifest.approvalReceiptPath !==
      `data/approvals/${receipt.countryDirectory}/${receipt.runId}.json`
  ) return true;

  if (!isRecord(candidate)) return false;
  const countryIdentities = [
    ownString(candidate, "countryDirectory"),
    nestedString(candidate, "sourceRegister", "countryCode"),
    nestedString(candidate, "extractedFacts", "countryCode"),
    nestedString(candidate, "marketOverviewDraft", "countryCode"),
    nestedString(candidate, "reviewReport", "countryCode"),
  ];
  const runIdentities = [
    ownString(candidate, "runId"),
    nestedString(candidate, "sourceRegister", "runId"),
    nestedString(candidate, "extractedFacts", "runId"),
    nestedString(candidate, "reviewReport", "runId"),
  ];
  return countryIdentities.some((value, index) =>
    value !== null && value !== (index === 0 ? receipt.countryDirectory : receipt.countryCode)) ||
    runIdentities.some((value) => value !== null && value !== receipt.runId);
}

function snapshotBytes(value: unknown): Uint8Array | null {
  try {
    if (
      typeof value !== "object" ||
      value === null ||
      isProxy(value) ||
      Object.getPrototypeOf(value) !== Uint8Array.prototype ||
      TYPED_ARRAY_BUFFER_GETTER === undefined ||
      TYPED_ARRAY_BYTE_LENGTH_GETTER === undefined
    ) return null;
    const bytes = value as Uint8Array;
    const buffer: unknown = Reflect.apply(TYPED_ARRAY_BUFFER_GETTER, bytes, []);
    const byteLength: unknown = Reflect.apply(
      TYPED_ARRAY_BYTE_LENGTH_GETTER,
      bytes,
      [],
    );
    if (
      typeof byteLength !== "number" ||
      !Number.isSafeInteger(byteLength) ||
      byteLength < 0 ||
      byteLength > BASIC_COUNTRY_PUBLICATION_JSON_MAX_BYTES ||
      typeof SharedArrayBuffer !== "undefined" && buffer instanceof SharedArrayBuffer ||
      !(buffer instanceof ArrayBuffer)
    ) return null;
    const copy = Uint8Array.prototype.slice.call(bytes) as Uint8Array;
    return copy.byteLength === byteLength ? copy : null;
  } catch {
    return null;
  }
}

function snapshotCandidateArtifactBytes(
  value: unknown,
): Readonly<Record<BasicCollectionAuditArtifactName, Uint8Array>> | null {
  try {
    if (
      typeof value !== "object" ||
      value === null ||
      isProxy(value) ||
      Object.getPrototypeOf(value) !== Object.prototype ||
      !hasExactKeys(value as JsonRecord, CANDIDATE_ARTIFACT_NAMES)
    ) return null;
    const output = {} as Record<BasicCollectionAuditArtifactName, Uint8Array>;
    for (const name of CANDIDATE_ARTIFACT_NAMES) {
      const descriptor = Object.getOwnPropertyDescriptor(value, name);
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !Object.hasOwn(descriptor, "value")
      ) return null;
      const bytes = snapshotBytes(descriptor.value);
      if (bytes === null) return null;
      output[name] = bytes;
    }
    return Object.freeze(output);
  } catch {
    return null;
  }
}

function isReadyCandidate(
  result: ReturnType<typeof validateBasicCollectionAuditBundleV2>,
): result is Extract<typeof result, { valid: true }> {
  return result.valid &&
    result.readyForHumanReview &&
    result.blockers.length === 0 &&
    result.data.reviewReport.status === "ready-for-human-review" &&
    result.data.reviewReport.publicationRecommendation === "request-human-review" &&
    result.data.reviewReport.humanDecision === null &&
    result.data.marketOverviewDraft.reviewStatus === "draft" &&
    result.data.marketOverviewDraft.aiUsable === false;
}

function hasValidApprovalTimestamps(
  receipt: BasicCountryPublicationApprovalReceipt,
  candidate: Extract<
    ReturnType<typeof validateBasicCollectionAuditBundleV2>,
    { valid: true }
  >["data"],
): boolean {
  const submittedAt = Date.parse(receipt.submission.submittedAt);
  const decidedAt = Date.parse(receipt.decidedAt);
  const latestCandidateAt = Math.max(
    Date.parse(candidate.marketOverviewDraft.collectedAt),
    ...candidate.sourceRegister.sources.map((source) => Date.parse(source.retrievedAt)),
  );
  return submittedAt >= latestCandidateAt && decidedAt >= submittedAt;
}

function hasExactCanonicalMapping(
  actual: JsonRecord,
  expected: BasicCanonicalData,
): boolean {
  if (!isRecord(actual.country) || !isRecord(actual.marketOverview)) return false;
  const expectedCountry = expected.country;
  const expectedMarket = expected.marketOverview;
  const actualCountryMapping = withoutKeys(actual.country, COUNTRY_COVERAGE_KEYS);
  const expectedCountryMapping = withoutKeys(expectedCountry, COUNTRY_COVERAGE_KEYS);
  const actualMarketMapping = withoutKeys(actual.marketOverview, ["aiUsable"] as const);
  const expectedMarketMapping = withoutKeys(expectedMarket, ["aiUsable"] as const);
  return hasExactKeys(actualCountryMapping, COUNTRY_MAPPING_KEYS) &&
    deeplyEqualBasicOfflineValue(actualCountryMapping, expectedCountryMapping) &&
    deeplyEqualBasicOfflineValue(actualMarketMapping, expectedMarketMapping);
}

function hasExactBasicCoverage(
  actual: JsonRecord,
  expected: BasicCanonicalData,
): boolean {
  if (!isRecord(actual.country)) return false;
  for (const key of COUNTRY_COVERAGE_KEYS) {
    if (!deeplyEqualBasicOfflineValue(actual.country[key], expected.country[key])) {
      return false;
    }
  }
  return COVERAGE_MODULE_KEYS.every((key) =>
    deeplyEqualBasicOfflineValue(actual[key], expected[key]));
}

function hasClosedAiBoundary(canonical: JsonRecord): boolean {
  return isRecord(canonical.marketOverview) &&
    canonical.marketOverview.aiUsable === false &&
    Array.isArray(canonical.knowledge) &&
    canonical.knowledge.length === 0;
}

function createProjectedBundle(
  countryDirectory: string,
  manifest: BasicCountryPublicationManifestV2,
  candidate: Extract<
    ReturnType<typeof validateBasicCollectionAuditBundleV2>,
    { valid: true }
  >["data"],
  canonical: BasicCanonicalData,
): JsonRecord {
  return {
    countryDirectory,
    canonical,
    audit: {
      manifest: {
        activeRunId: manifest.activeRunId,
        mappingVersion: manifest.mappingVersion,
        auditBundlePath: manifest.auditBundlePath,
      },
      run: {
        runId: candidate.runId,
        sourceRegister: candidate.sourceRegister,
        extractedFacts: candidate.extractedFacts,
        marketOverviewDraft: candidate.marketOverviewDraft,
        reviewReport: candidate.reviewReport,
      },
    },
  };
}

function hasExactCanonicalArtifactNames(value: unknown): boolean {
  const snapshot = snapshotPublicationJson(value);
  return snapshot.valid &&
    Array.isArray(snapshot.data) &&
    deeplyEqualBasicOfflineValue(snapshot.data, CANONICAL_ARTIFACT_NAMES);
}

function hasExactKeys(
  value: JsonRecord,
  expected: readonly string[],
): boolean {
  const keys = Reflect.ownKeys(value);
  return keys.length === expected.length &&
    keys.every((key) => typeof key === "string" && expected.includes(key)) &&
    expected.every((key) => Object.hasOwn(value, key));
}

function withoutKeys(
  value: JsonRecord,
  excluded: readonly string[],
): JsonRecord {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !excluded.includes(key)),
  );
}

function ownString(value: JsonRecord, key: string): string | null {
  const item = value[key];
  return typeof item === "string" ? item : null;
}

function nestedString(
  value: JsonRecord,
  parentKey: string,
  key: string,
): string | null {
  const parent = value[parentKey];
  return isRecord(parent) ? ownString(parent, key) : null;
}
