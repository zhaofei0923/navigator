import type { BasicCollectionAuditArtifactName } from "./basic-offline-audit-artifacts.js";
import type { BasicCollectionAuditBundleV2 } from "./basic-collection-v2-contracts.js";
import type { BasicCollectionAuditBundleV3 } from "./basic-collection-v3-contracts.js";
import type { BasicCanonicalData } from "../seed/basic-country-types.js";

export const BASIC_COUNTRY_PUBLICATION_APPROVAL_SCHEMA_VERSION =
  "basic-country-publication-approval/v1" as const;
export const BASIC_COUNTRY_PUBLICATION_MANIFEST_SCHEMA_VERSION =
  "basic-country-publication-manifest/v2" as const;
export const BASIC_COUNTRY_CANONICAL_MAPPING_VERSION =
  "basic-country-canonical/v2" as const;
export const BASIC_COUNTRY_PUBLICATION_MANIFEST_V3_SCHEMA_VERSION =
  "basic-country-publication-manifest/v3" as const;
export const BASIC_COUNTRY_CANONICAL_MAPPING_V3_VERSION =
  "basic-country-canonical/v3" as const;
export const BASIC_COUNTRY_PUBLICATION_JSON_MAX_BYTES = 2 * 1024 * 1024;

export const BASIC_COUNTRY_PUBLICATION_BLOCKER_CODES = Object.freeze([
  "MANIFEST_INVALID",
  "APPROVAL_RECEIPT_INVALID",
  "APPROVAL_RECEIPT_HASH_MISMATCH",
  "CANDIDATE_ARTIFACT_HASH_MISMATCH",
  "PUBLICATION_IDENTITY_MISMATCH",
  "CANDIDATE_NOT_READY",
  "APPROVAL_TIMESTAMP_INVALID",
  "CANONICAL_MAPPING_DRIFT",
  "BASIC_COVERAGE_VIOLATION",
  "AI_BOUNDARY_VIOLATION",
  "PUBLICATION_READ_FAILED",
] as const);

export type BasicCountryPublicationBlockerCode =
  typeof BASIC_COUNTRY_PUBLICATION_BLOCKER_CODES[number];

export interface BasicCountryPublicationApprovalReceipt {
  readonly schemaVersion: typeof BASIC_COUNTRY_PUBLICATION_APPROVAL_SCHEMA_VERSION;
  readonly countryDirectory: string;
  readonly countryCode: string;
  readonly runId: string;
  readonly submission: Readonly<{
    fromReviewStatus: "draft";
    toReviewStatus: "pending";
    submittedAt: string;
  }>;
  readonly decision: "approved";
  readonly reviewerId: string;
  readonly decidedAt: string;
  readonly authorizedPublication: Readonly<{
    coverageLevel: "BASIC";
    fromReviewStatus: "pending";
    toReviewStatus: "published";
    aiUsable: false;
  }>;
  readonly artifactSha256: Readonly<Record<BasicCollectionAuditArtifactName, string>>;
}

export interface BasicCountryPublicationManifestV2 {
  readonly schemaVersion: typeof BASIC_COUNTRY_PUBLICATION_MANIFEST_SCHEMA_VERSION;
  readonly activeRunId: string;
  readonly mappingVersion: typeof BASIC_COUNTRY_CANONICAL_MAPPING_VERSION;
  readonly auditBundlePath: string;
  readonly approvalReceiptPath: string;
  readonly approvalReceiptSha256: string;
}

export interface BasicCountryPublicationManifestV3 {
  readonly schemaVersion: typeof BASIC_COUNTRY_PUBLICATION_MANIFEST_V3_SCHEMA_VERSION;
  readonly activeRunId: string;
  readonly mappingVersion: typeof BASIC_COUNTRY_CANONICAL_MAPPING_V3_VERSION;
  readonly auditBundlePath: string;
  readonly approvalReceiptPath: string;
  readonly approvalReceiptSha256: string;
}

export interface BasicCountryPublicationValidationInput {
  readonly countryDirectory: unknown;
  readonly manifest: unknown;
  readonly approvalReceipt: unknown;
  readonly approvalReceiptBytes: unknown;
  readonly candidate: unknown;
  readonly candidateArtifactBytes: unknown;
  readonly canonical: unknown;
  readonly canonicalArtifactNames: unknown;
}

export interface BasicApprovedCountryPublicationV2 {
  readonly countryDirectory: string;
  readonly manifest: BasicCountryPublicationManifestV2;
  readonly approvalReceipt: BasicCountryPublicationApprovalReceipt;
  readonly candidate: BasicCollectionAuditBundleV2;
  readonly canonical: BasicCanonicalData;
}

export interface BasicCountryPublicationValidationInputV3
  extends Omit<BasicCountryPublicationValidationInput, "candidate"> {
  readonly candidate: unknown;
}

export interface BasicApprovedCountryPublicationV3 {
  readonly countryDirectory: string;
  readonly manifest: BasicCountryPublicationManifestV3;
  readonly approvalReceipt: BasicCountryPublicationApprovalReceipt;
  readonly candidate: BasicCollectionAuditBundleV3;
  readonly canonical: BasicCanonicalData;
}

export type BasicApprovedCountryPublicationVersioned =
  | BasicApprovedCountryPublicationV2
  | BasicApprovedCountryPublicationV3;

export type BasicCountryPublicationVersionedValidationResult =
  | Readonly<{
      valid: true;
      blockerCode: null;
      data: BasicApprovedCountryPublicationVersioned;
    }>
  | Readonly<{
      valid: false;
      blockerCode: BasicCountryPublicationBlockerCode;
      data: null;
    }>;

export type BasicCountryPublicationValidationResultV3 =
  | Readonly<{
      valid: true;
      blockerCode: null;
      data: BasicApprovedCountryPublicationV3;
    }>
  | Readonly<{
      valid: false;
      blockerCode: BasicCountryPublicationBlockerCode;
      data: null;
    }>;

export type BasicCountryPublicationValidationResult =
  | Readonly<{
      valid: true;
      blockerCode: null;
      data: BasicApprovedCountryPublicationV2;
    }>
  | Readonly<{
      valid: false;
      blockerCode: BasicCountryPublicationBlockerCode;
      data: null;
    }>;
