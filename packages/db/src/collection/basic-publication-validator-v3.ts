import { validateBasicCountryBundle } from "../seed/basic-country-validator.js";
import type { BasicCanonicalData, JsonRecord } from "../seed/basic-country-types.js";
import { validateBasicCollectionAuditBundleV3 } from "./basic-collection-v3-validator.js";
import {
  deepFreezeBasicOfflineValue,
  deeplyEqualBasicOfflineValue,
  isRecord,
} from "./basic-offline-value.js";
import {
  type BasicCountryPublicationApprovalReceipt,
  type BasicCountryPublicationBlockerCode,
  type BasicCountryPublicationManifestV3,
  type BasicCountryPublicationValidationInputV3,
  type BasicCountryPublicationValidationResultV3,
} from "./basic-publication-contracts.js";
import { equalSha256Hex, sha256Hex } from "./basic-publication-digests.js";
import { materializeBasicCanonicalFromApprovedCandidateV3 } from "./basic-publication-materializer-v3.js";
import {
  parseBasicCountryPublicationApproval,
  parseBasicCountryPublicationManifestV3,
} from "./basic-publication-parser.js";
import {
  BASIC_PUBLICATION_V3_CANDIDATE_NAMES,
  decodeBasicPublicationV3Json,
  hasExactBasicPublicationV3Keys,
  readBasicPublicationV3InputValue,
  reconstructBasicPublicationV3Candidate,
  snapshotBasicPublicationV3ArtifactBytes,
  snapshotBasicPublicationV3Bytes,
  snapshotBasicPublicationV3Json,
} from "./basic-publication-validator-v3-input.js";

const CANONICAL_NAMES = Object.freeze([
  "collection-manifest.json",
  "country.json",
  "market-overview.json",
] as const);
const CANONICAL_KEYS = Object.freeze([
  "country", "marketOverview", "policy", "risk", "opportunities", "projects",
  "partners", "chineseCompanies", "entryStrategy", "reports", "knowledge",
] as const);
const DEEP_MODULE_KEYS = Object.freeze([
  "policy", "risk", "opportunities", "projects", "partners",
  "chineseCompanies", "entryStrategy", "reports",
] as const);
const COUNTRY_COVERAGE_KEYS = Object.freeze(["coverageLevel", "moduleCoverage"] as const);

export function validateApprovedBasicCountryPublicationV3(
  input: BasicCountryPublicationValidationInputV3,
): BasicCountryPublicationValidationResultV3 {
  try {
    const manifestValue = readBasicPublicationV3InputValue(input, "manifest");
    const manifestSnapshot = snapshotBasicPublicationV3Json(manifestValue);
    if (!manifestSnapshot.valid) return failure("MANIFEST_INVALID");
    const manifestParsed = parseBasicCountryPublicationManifestV3(manifestSnapshot.data);
    if (manifestParsed.data === null) return failure("MANIFEST_INVALID");

    const suppliedApprovalValue = readBasicPublicationV3InputValue(input, "approvalReceipt");
    const suppliedApprovalSnapshot = snapshotBasicPublicationV3Json(suppliedApprovalValue);
    if (!suppliedApprovalSnapshot.valid) return failure("APPROVAL_RECEIPT_INVALID");
    const suppliedApprovalParsed = parseBasicCountryPublicationApproval(
      suppliedApprovalSnapshot.data,
    );
    if (suppliedApprovalParsed.data === null) return failure("APPROVAL_RECEIPT_INVALID");

    const manifest = manifestParsed.data;
    const suppliedApproval = suppliedApprovalParsed.data;
    const suppliedCandidateSnapshot = snapshotBasicPublicationV3Json(
      readBasicPublicationV3InputValue(input, "candidate"),
    );
    const countryDirectory = readBasicPublicationV3InputValue(input, "countryDirectory");
    if (
      hasIdentityMismatch(
        countryDirectory,
        manifest,
        suppliedApproval,
        suppliedCandidateSnapshot.valid ? suppliedCandidateSnapshot.data : null,
      )
    ) return failure("PUBLICATION_IDENTITY_MISMATCH");

    const approvalBytes = snapshotBasicPublicationV3Bytes(
      readBasicPublicationV3InputValue(input, "approvalReceiptBytes"),
    );
    if (approvalBytes === null) return failure("APPROVAL_RECEIPT_HASH_MISMATCH");
    const approvalHashMatches = equalSha256Hex(
      manifest.approvalReceiptSha256,
      sha256Hex(approvalBytes),
    );
    const decodedApproval = decodeBasicPublicationV3Json(approvalBytes);
    if (!decodedApproval.valid) {
      return failure(
        decodedApproval.malformedScalar || approvalHashMatches
          ? "APPROVAL_RECEIPT_INVALID"
          : "APPROVAL_RECEIPT_HASH_MISMATCH",
      );
    }
    if (!approvalHashMatches) return failure("APPROVAL_RECEIPT_HASH_MISMATCH");
    const byteApprovalParsed = parseBasicCountryPublicationApproval(decodedApproval.data);
    if (byteApprovalParsed.data === null) return failure("APPROVAL_RECEIPT_INVALID");
    const approval = byteApprovalParsed.data;
    if (!deeplyEqualBasicOfflineValue(approval, suppliedApproval)) {
      return failure("APPROVAL_RECEIPT_HASH_MISMATCH");
    }

    const candidateBytes = snapshotBasicPublicationV3ArtifactBytes(
      readBasicPublicationV3InputValue(input, "candidateArtifactBytes"),
    );
    if (
      candidateBytes === null ||
      BASIC_PUBLICATION_V3_CANDIDATE_NAMES.some((name) => !equalSha256Hex(
        approval.artifactSha256[name],
        sha256Hex(candidateBytes[name]),
      ))
    ) return failure("CANDIDATE_ARTIFACT_HASH_MISMATCH");

    const byteCandidate = reconstructBasicPublicationV3Candidate(
      candidateBytes,
      approval,
    );
    if (byteCandidate === null) return failure("CANDIDATE_NOT_READY");
    if (hasIdentityMismatch(countryDirectory, manifest, approval, byteCandidate)) {
      return failure("PUBLICATION_IDENTITY_MISMATCH");
    }
    const candidateValidation = validateBasicCollectionAuditBundleV3(byteCandidate);
    const suppliedCandidateValidation = validateBasicCollectionAuditBundleV3(
      suppliedCandidateSnapshot.valid ? suppliedCandidateSnapshot.data : null,
    );
    if (!candidateValidation.valid) return failure("CANDIDATE_NOT_READY");
    if (
      !suppliedCandidateValidation.valid ||
      !deeplyEqualBasicOfflineValue(
        candidateValidation.data,
        suppliedCandidateValidation.data,
      )
    ) return failure("CANDIDATE_ARTIFACT_HASH_MISMATCH");
    if (!ready(candidateValidation)) return failure("CANDIDATE_NOT_READY");
    const candidate = candidateValidation.data;
    if (!timestampsValid(approval, candidate)) {
      return failure("APPROVAL_TIMESTAMP_INVALID");
    }

    let expectedCanonical: BasicCanonicalData;
    try {
      expectedCanonical = materializeBasicCanonicalFromApprovedCandidateV3(
        candidate,
        manifest,
      );
    } catch {
      return failure("CANONICAL_MAPPING_DRIFT");
    }
    const canonicalSnapshot = snapshotBasicPublicationV3Json(
      readBasicPublicationV3InputValue(input, "canonical"),
    );
    if (
      !canonicalSnapshot.valid || !isRecord(canonicalSnapshot.data) ||
      !hasExactBasicPublicationV3Keys(canonicalSnapshot.data, CANONICAL_KEYS) ||
      !mappingMatches(canonicalSnapshot.data, expectedCanonical)
    ) return failure("CANONICAL_MAPPING_DRIFT");
    if (!coverageMatches(canonicalSnapshot.data, expectedCanonical)) {
      return failure("BASIC_COVERAGE_VIOLATION");
    }
    if (!aiBoundaryClosed(canonicalSnapshot.data)) {
      return failure("AI_BOUNDARY_VIOLATION");
    }

    const canonical = canonicalSnapshot.data as unknown as BasicCanonicalData;
    const projected = {
      countryDirectory: approval.countryDirectory,
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
    const canonicalValidation = validateBasicCountryBundle(projected);
    if (!canonicalValidation.valid || canonicalValidation.summary.coverageLevel !== "BASIC") {
      return failure("BASIC_COVERAGE_VIOLATION");
    }
    if (!deeplyEqualBasicOfflineValue(canonical, expectedCanonical)) {
      return failure("CANONICAL_MAPPING_DRIFT");
    }
    const namesSnapshot = snapshotBasicPublicationV3Json(
      readBasicPublicationV3InputValue(input, "canonicalArtifactNames"),
    );
    if (
      !namesSnapshot.valid || !Array.isArray(namesSnapshot.data) ||
      !deeplyEqualBasicOfflineValue(namesSnapshot.data, CANONICAL_NAMES)
    ) return failure("PUBLICATION_READ_FAILED");

    return deepFreezeBasicOfflineValue({
      valid: true as const,
      blockerCode: null,
      data: { countryDirectory: approval.countryDirectory, manifest, approvalReceipt: approval, candidate, canonical },
    });
  } catch {
    return failure("PUBLICATION_READ_FAILED");
  }
}

function failure(code: BasicCountryPublicationBlockerCode): BasicCountryPublicationValidationResultV3 {
  return Object.freeze({ valid: false, blockerCode: code, data: null });
}

function hasIdentityMismatch(
  countryDirectory: unknown,
  manifest: BasicCountryPublicationManifestV3,
  receipt: BasicCountryPublicationApprovalReceipt,
  candidate: unknown,
): boolean {
  if (
    countryDirectory !== receipt.countryDirectory ||
    manifest.activeRunId !== receipt.runId ||
    manifest.auditBundlePath !== `data/staging/${receipt.countryDirectory}/${receipt.runId}` ||
    manifest.approvalReceiptPath !== `data/approvals/${receipt.countryDirectory}/${receipt.runId}.json`
  ) return true;
  if (!isRecord(candidate)) return false;
  return candidate.countryDirectory !== receipt.countryDirectory ||
    candidate.runId !== receipt.runId ||
    !sameNestedIdentity(candidate, "sourceRegister", receipt) ||
    !sameNestedIdentity(candidate, "extractedFacts", receipt) ||
    !sameNestedIdentity(candidate, "marketOverviewDraft", receipt, false) ||
    !sameNestedIdentity(candidate, "reviewReport", receipt);
}

function sameNestedIdentity(
  candidate: JsonRecord,
  key: string,
  receipt: BasicCountryPublicationApprovalReceipt,
  requireRun = true,
): boolean {
  const nested = candidate[key];
  return isRecord(nested) && nested.countryCode === receipt.countryCode &&
    (!requireRun || nested.runId === receipt.runId);
}

function ready(result: ReturnType<typeof validateBasicCollectionAuditBundleV3>): result is Extract<ReturnType<typeof validateBasicCollectionAuditBundleV3>, { valid: true }> {
  return result.valid && result.readyForHumanReview && result.blockers.length === 0 &&
    result.data.reviewReport.status === "ready-for-human-review" &&
    result.data.reviewReport.publicationRecommendation === "request-human-review" &&
    result.data.reviewReport.humanDecision === null &&
    result.data.marketOverviewDraft.reviewStatus === "draft" &&
    result.data.marketOverviewDraft.aiUsable === false;
}

function timestampsValid(
  receipt: BasicCountryPublicationApprovalReceipt,
  candidate: Extract<ReturnType<typeof validateBasicCollectionAuditBundleV3>, { valid: true }>["data"],
): boolean {
  const submittedAt = Date.parse(receipt.submission.submittedAt);
  const decidedAt = Date.parse(receipt.decidedAt);
  const latest = Math.max(
    Date.parse(candidate.marketOverviewDraft.collectedAt),
    ...candidate.sourceRegister.sources.map((source) => Date.parse(source.retrievedAt)),
  );
  return submittedAt >= latest && decidedAt >= submittedAt;
}

function mappingMatches(actual: JsonRecord, expected: BasicCanonicalData): boolean {
  if (!isRecord(actual.country) || !isRecord(actual.marketOverview)) return false;
  return deeplyEqualBasicOfflineValue(
    withoutKeys(actual.country, COUNTRY_COVERAGE_KEYS),
    withoutKeys(expected.country, COUNTRY_COVERAGE_KEYS),
  ) && deeplyEqualBasicOfflineValue(
    withoutKeys(actual.marketOverview, ["aiUsable"]),
    withoutKeys(expected.marketOverview, ["aiUsable"]),
  );
}

function coverageMatches(actual: JsonRecord, expected: BasicCanonicalData): boolean {
  if (!isRecord(actual.country)) return false;
  const country = actual.country;
  return COUNTRY_COVERAGE_KEYS.every((key) =>
    deeplyEqualBasicOfflineValue(country[key], expected.country[key])) &&
    DEEP_MODULE_KEYS.every((key) =>
      deeplyEqualBasicOfflineValue(actual[key], expected[key]));
}

function aiBoundaryClosed(actual: JsonRecord): boolean {
  return isRecord(actual.marketOverview) && actual.marketOverview.aiUsable === false &&
    Array.isArray(actual.knowledge) && actual.knowledge.length === 0;
}

function withoutKeys(value: JsonRecord, excluded: readonly string[]): JsonRecord {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !excluded.includes(key)));
}
