import {
  SAFE_COUNTRY_DIRECTORY,
  SAFE_RUN_ID,
  expectUtcRfc3339Timestamp,
} from "../seed/basic-country-validation-utils.js";
import type { BasicCollectionJsonValue } from "./basic-collection-contracts.js";
import type { BasicCollectionAuditArtifactName } from "./basic-offline-audit-artifacts.js";
import { snapshotBasicBoundedJsonValue } from "./basic-bounded-json.js";
import { hasOnlyUnicodeScalarJsonStrings } from "./basic-strict-json.js";
import {
  BASIC_COUNTRY_CANONICAL_MAPPING_VERSION,
  BASIC_COUNTRY_PUBLICATION_APPROVAL_SCHEMA_VERSION,
  BASIC_COUNTRY_PUBLICATION_MANIFEST_SCHEMA_VERSION,
  type BasicCountryPublicationApprovalReceipt,
  type BasicCountryPublicationManifestV2,
} from "./basic-publication-contracts.js";
import { deepFreezeBasicOfflineValue } from "./basic-offline-value.js";

type JsonRecord = Record<string, BasicCollectionJsonValue>;
type MaybeJsonValue = BasicCollectionJsonValue | undefined;
type ParseResult<T> = Readonly<{ data: T | null; errors: readonly string[] }>;

const APPROVAL_KEYS = [
  "schemaVersion",
  "countryDirectory",
  "countryCode",
  "runId",
  "submission",
  "decision",
  "reviewerId",
  "decidedAt",
  "authorizedPublication",
  "artifactSha256",
] as const;
const MANIFEST_KEYS = [
  "schemaVersion",
  "activeRunId",
  "mappingVersion",
  "auditBundlePath",
  "approvalReceiptPath",
  "approvalReceiptSha256",
] as const;
const SUBMISSION_KEYS = ["fromReviewStatus", "toReviewStatus", "submittedAt"] as const;
const AUTHORIZATION_KEYS = [
  "coverageLevel",
  "fromReviewStatus",
  "toReviewStatus",
  "aiUsable",
] as const;
const ARTIFACT_NAMES = [
  "source-register.json",
  "extracted-facts.json",
  "market-overview.draft.json",
  "review-report.json",
] as const satisfies readonly BasicCollectionAuditArtifactName[];
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_STRING_BYTES = 65_536;
const PUBLICATION_PARSER_BUDGETS = Object.freeze({
  maximumObjectProperties: 256,
  maximumTotalNodes: 65_536,
});

export function parseBasicCountryPublicationApproval(
  value: unknown,
): ParseResult<BasicCountryPublicationApprovalReceipt> {
  const snapshot = snapshotPublicationParserValue(value);
  if (!snapshot.valid) return frozenResult(null, ["approvalReceipt must be a bounded JSON value"]);
  const errors: string[] = [];
  const receipt = exactRecord(snapshot.data, APPROVAL_KEYS, "approvalReceipt", errors);
  if (receipt === null) return frozenResult(null, errors);

  const submission = parseSubmission(receipt.submission, errors);
  const authorizedPublication = parseAuthorization(receipt.authorizedPublication, errors);
  const artifactSha256 = parseArtifactHashes(receipt.artifactSha256, errors);
  const data: BasicCountryPublicationApprovalReceipt = {
    schemaVersion: exactLiteral(
      receipt.schemaVersion,
      BASIC_COUNTRY_PUBLICATION_APPROVAL_SCHEMA_VERSION,
      "schemaVersion",
      errors,
    ),
    countryDirectory: countryDirectory(receipt.countryDirectory, "countryDirectory", errors),
    countryCode: countryCode(receipt.countryCode, "countryCode", errors),
    runId: runId(receipt.runId, "runId", errors),
    submission,
    decision: exactLiteral(receipt.decision, "approved", "decision", errors),
    reviewerId: reviewerId(receipt.reviewerId, "reviewerId", errors),
    decidedAt: timestamp(receipt.decidedAt, "decidedAt", errors),
    authorizedPublication,
    artifactSha256,
  };
  return frozenResult(errors.length === 0 ? data : null, errors);
}

export function parseBasicCountryPublicationManifestV2(
  value: unknown,
): ParseResult<BasicCountryPublicationManifestV2> {
  const snapshot = snapshotPublicationParserValue(value);
  if (!snapshot.valid) return frozenResult(null, ["manifest must be a bounded JSON value"]);
  const errors: string[] = [];
  const manifest = exactRecord(snapshot.data, MANIFEST_KEYS, "manifest", errors);
  if (manifest === null) return frozenResult(null, errors);

  const data: BasicCountryPublicationManifestV2 = {
    schemaVersion: exactLiteral(
      manifest.schemaVersion,
      BASIC_COUNTRY_PUBLICATION_MANIFEST_SCHEMA_VERSION,
      "schemaVersion",
      errors,
    ),
    activeRunId: runId(manifest.activeRunId, "activeRunId", errors),
    mappingVersion: exactLiteral(
      manifest.mappingVersion,
      BASIC_COUNTRY_CANONICAL_MAPPING_VERSION,
      "mappingVersion",
      errors,
    ),
    auditBundlePath: safeRelativePath(manifest.auditBundlePath, "auditBundlePath", errors),
    approvalReceiptPath: safeRelativePath(
      manifest.approvalReceiptPath,
      "approvalReceiptPath",
      errors,
    ),
    approvalReceiptSha256: sha256(manifest.approvalReceiptSha256, "approvalReceiptSha256", errors),
  };
  return frozenResult(errors.length === 0 ? data : null, errors);
}

function snapshotPublicationParserValue(
  value: unknown,
): ReturnType<typeof snapshotBasicBoundedJsonValue> {
  const snapshot = snapshotBasicBoundedJsonValue(
    value,
    () => undefined,
    PUBLICATION_PARSER_BUDGETS,
  );
  return snapshot.valid && hasOnlyUnicodeScalarJsonStrings(snapshot.data)
    ? snapshot
    : { valid: false };
}

function parseSubmission(
  value: MaybeJsonValue,
  errors: string[],
): BasicCountryPublicationApprovalReceipt["submission"] {
  const submission = exactRecord(value, SUBMISSION_KEYS, "submission", errors);
  if (submission === null) {
    return { fromReviewStatus: "draft", toReviewStatus: "pending", submittedAt: "" };
  }
  return {
    fromReviewStatus: exactLiteral(submission.fromReviewStatus, "draft", "submission.fromReviewStatus", errors),
    toReviewStatus: exactLiteral(submission.toReviewStatus, "pending", "submission.toReviewStatus", errors),
    submittedAt: timestamp(submission.submittedAt, "submission.submittedAt", errors),
  };
}

function parseAuthorization(
  value: MaybeJsonValue,
  errors: string[],
): BasicCountryPublicationApprovalReceipt["authorizedPublication"] {
  const authorization = exactRecord(value, AUTHORIZATION_KEYS, "authorizedPublication", errors);
  if (authorization === null) {
    return {
      coverageLevel: "BASIC",
      fromReviewStatus: "pending",
      toReviewStatus: "published",
      aiUsable: false,
    };
  }
  return {
    coverageLevel: exactLiteral(authorization.coverageLevel, "BASIC", "authorizedPublication.coverageLevel", errors),
    fromReviewStatus: exactLiteral(authorization.fromReviewStatus, "pending", "authorizedPublication.fromReviewStatus", errors),
    toReviewStatus: exactLiteral(authorization.toReviewStatus, "published", "authorizedPublication.toReviewStatus", errors),
    aiUsable: exactLiteral(authorization.aiUsable, false, "authorizedPublication.aiUsable", errors),
  };
}

function parseArtifactHashes(
  value: MaybeJsonValue,
  errors: string[],
): BasicCountryPublicationApprovalReceipt["artifactSha256"] {
  const artifacts = exactRecord(value, ARTIFACT_NAMES, "artifactSha256", errors);
  if (artifacts === null) {
    return emptyArtifactHashes();
  }
  return Object.fromEntries(ARTIFACT_NAMES.map((name) => [
    name,
    sha256(artifacts[name], `artifactSha256.${name}`, errors),
  ])) as BasicCountryPublicationApprovalReceipt["artifactSha256"];
}

function exactRecord(
  value: MaybeJsonValue,
  keys: readonly string[],
  label: string,
  errors: string[],
): JsonRecord | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    errors.push(`${label} must have exactly ${keyList(keys)} own keys`);
    return null;
  }
  const actualKeys = Reflect.ownKeys(value);
  if (
    actualKeys.length !== keys.length ||
    actualKeys.some((key) => typeof key !== "string" || !keys.includes(key)) ||
    keys.some((key) => !Object.hasOwn(value, key))
  ) {
    errors.push(`${label} must have exactly ${keyList(keys)} own keys`);
    return null;
  }
  return value as JsonRecord;
}

function exactLiteral<T extends string | boolean>(
  value: MaybeJsonValue,
  expected: T,
  label: string,
  errors: string[],
): T {
  if (value === expected) return expected;
  errors.push(`${label} must equal the required literal`);
  return expected;
}

function text(value: MaybeJsonValue, label: string, errors: string[]): string {
  if (typeof value === "string") return value;
  errors.push(`${label} must be a string`);
  return "";
}

function countryDirectory(value: MaybeJsonValue, label: string, errors: string[]): string {
  const result = text(value, label, errors);
  if (!SAFE_COUNTRY_DIRECTORY.test(result)) errors.push(`${label} must be a safe slug`);
  return result;
}

function countryCode(value: MaybeJsonValue, label: string, errors: string[]): string {
  const result = text(value, label, errors);
  if (!/^[A-Z]{2}$/.test(result)) errors.push(`${label} must be an uppercase two-letter country code`);
  return result;
}

function runId(value: MaybeJsonValue, label: string, errors: string[]): string {
  const result = text(value, label, errors);
  if (!SAFE_RUN_ID.test(result)) errors.push(`${label} must be a safe run id`);
  return result;
}

function reviewerId(value: MaybeJsonValue, label: string, errors: string[]): string {
  const result = text(value, label, errors);
  if (result.trim() === "" || Buffer.byteLength(result, "utf8") > MAX_STRING_BYTES) {
    errors.push(`${label} must be a bounded non-blank identifier`);
  }
  return result;
}

function timestamp(value: MaybeJsonValue, label: string, errors: string[]): string {
  const result = text(value, label, errors);
  expectUtcRfc3339Timestamp(result, label, errors);
  return result;
}

function sha256(value: MaybeJsonValue, label: string, errors: string[]): string {
  const result = text(value, label, errors);
  if (!SHA256.test(result)) errors.push(`${label} must be a lowercase SHA-256 hash`);
  return result;
}

function safeRelativePath(value: MaybeJsonValue, label: string, errors: string[]): string {
  const result = text(value, label, errors);
  const segments = result.split("/");
  if (
    result === "" || result.startsWith("/") || result.includes("\\") || result.includes("\0") ||
    segments.some((segment) => segment === "" || segment === "." || segment === ".." || segment.includes(":"))
  ) errors.push(`${label} must be a safe normalized relative path`);
  return result;
}

function emptyArtifactHashes(): BasicCountryPublicationApprovalReceipt["artifactSha256"] {
  return Object.fromEntries(ARTIFACT_NAMES.map((name) => [name, ""])) as BasicCountryPublicationApprovalReceipt["artifactSha256"];
}

function frozenResult<T>(data: T | null, errors: readonly string[]): ParseResult<T> {
  return deepFreezeBasicOfflineValue({ data, errors: [...errors] });
}

function keyList(keys: readonly string[]): string {
  return keys.length === 1 ? keys[0]! : `${keys.slice(0, -1).join(", ")}, and ${keys.at(-1)}`;
}
