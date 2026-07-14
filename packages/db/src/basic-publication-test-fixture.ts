import { createBasicCollectionAuditArtifactsV2, serializeBasicCollectionAuditArtifactsV2 } from "./collection/basic-audit-v2-artifacts.js";
import { materializeBasicDerivedFacts } from "./collection/basic-derived-fact-materializer.js";
import { classifyBasicV2FieldPath, type BasicCollectionAuditBundleV2 } from "./collection/basic-collection-v2-contracts.js";
import { deepFreezeBasicOfflineValue } from "./collection/basic-offline-value.js";
import type {
  BasicCountryPublicationApprovalReceipt,
  BasicCountryPublicationManifestV2,
  BasicCountryPublicationValidationInput,
} from "./collection/basic-publication-contracts.js";
import { sha256Hex } from "./collection/basic-publication-digests.js";
import { createBasicCountryBundle } from "./seed/basic-country-template.js";
import type { BasicCanonicalData, JsonRecord } from "./seed/basic-country-types.js";
import { createBasicCollectionAuditV2Fixture } from "./basic-collection-test-fixture.js";

export function createBasicCountryPublicationFixture(): Readonly<{
  approvalReceipt: BasicCountryPublicationApprovalReceipt;
  approvalReceiptBytes: Uint8Array;
  manifest: BasicCountryPublicationManifestV2;
  candidate: BasicCollectionAuditBundleV2;
  candidateArtifactBytes: ReturnType<typeof serializeBasicCollectionAuditArtifactsV2>;
  canonical: BasicCanonicalData;
  validationInput: BasicCountryPublicationValidationInput;
}> {
  const candidate = createExampleLandCandidate();
  const candidateArtifactBytes = serializeBasicCollectionAuditArtifactsV2(
    createBasicCollectionAuditArtifactsV2(candidate),
  );
  const artifactSha256 = Object.fromEntries(
    Object.entries(candidateArtifactBytes).map(([name, bytes]) => [name, sha256Hex(bytes)]),
  ) as BasicCountryPublicationApprovalReceipt["artifactSha256"];
  const approvalReceipt: BasicCountryPublicationApprovalReceipt = {
    schemaVersion: "basic-country-publication-approval/v1",
    countryDirectory: "example-land",
    countryCode: "EX",
    runId: "run-001",
    submission: {
      fromReviewStatus: "draft",
      toReviewStatus: "pending",
      submittedAt: "2026-07-10T00:00:00Z",
    },
    decision: "approved",
    reviewerId: "reviewer-001",
    decidedAt: "2026-07-11T00:00:00Z",
    authorizedPublication: {
      coverageLevel: "BASIC",
      fromReviewStatus: "pending",
      toReviewStatus: "published",
      aiUsable: false,
    },
    artifactSha256,
  };
  const approvalReceiptBytes = new TextEncoder().encode(`${JSON.stringify(approvalReceipt)}\n`);
  const manifest: BasicCountryPublicationManifestV2 = {
    schemaVersion: "basic-country-publication-manifest/v2",
    activeRunId: "run-001",
    mappingVersion: "basic-country-canonical/v2",
    auditBundlePath: "data/staging/example-land/run-001",
    approvalReceiptPath: "data/approvals/example-land/run-001.json",
    approvalReceiptSha256: sha256Hex(approvalReceiptBytes),
  };
  const canonical = createExpectedCanonical(candidate, manifest);
  const validationInput: BasicCountryPublicationValidationInput = {
    countryDirectory: "example-land",
    manifest,
    approvalReceipt,
    approvalReceiptBytes,
    candidate,
    candidateArtifactBytes,
    canonical,
    canonicalArtifactNames: [
      "collection-manifest.json",
      "country.json",
      "market-overview.json",
    ],
  };
  return Object.freeze({
    approvalReceipt,
    approvalReceiptBytes,
    manifest,
    candidate,
    candidateArtifactBytes,
    canonical,
    validationInput,
  });
}

function createExpectedCanonical(
  candidate: BasicCollectionAuditBundleV2,
  manifest: BasicCountryPublicationManifestV2,
): BasicCanonicalData {
  const country: JsonRecord = {
    code: countryFact(candidate, "country.code"),
    name: countryFact(candidate, "country.name"),
    summary: countryFact(candidate, "country.summary"),
    region: countryFact(candidate, "country.region"),
    flagEmoji: countryFact(candidate, "country.flagEmoji"),
    updatedAt: countryFact(candidate, "country.updatedAt"),
  };
  const bundle = createBasicCountryBundle({
    countryDirectory: candidate.countryDirectory,
    country,
    marketOverview: {
      ...candidate.marketOverviewDraft,
      reviewStatus: "published",
      aiUsable: false,
    },
    manifest: {
      activeRunId: manifest.activeRunId,
      mappingVersion: manifest.mappingVersion,
      auditBundlePath: manifest.auditBundlePath,
    },
    auditRun: {
      runId: candidate.runId,
      sourceRegister: { ...candidate.sourceRegister },
      extractedFacts: { ...candidate.extractedFacts },
      marketOverviewDraft: { ...candidate.marketOverviewDraft },
      reviewReport: { ...candidate.reviewReport },
    },
  });
  return deepFreezeBasicOfflineValue(bundle.canonical);
}

function countryFact(
  candidate: BasicCollectionAuditBundleV2,
  fieldPath: string,
): unknown {
  const fact = candidate.extractedFacts.facts.find((item) => item.fieldPath === fieldPath);
  const value = fact?.evidence[0]?.normalizedValue;
  if (fact?.status !== "candidate" || value === undefined) {
    throw new Error("publication fixture country fact is missing");
  }
  return structuredClone(value);
}

function createExampleLandCandidate(): BasicCollectionAuditBundleV2 {
  const fixture = createBasicCollectionAuditV2Fixture();
  const sourceRegister = {
    ...fixture.sourceRegister,
    countryCode: "EX",
    sources: fixture.sourceRegister.sources.map((source) => source.sourceId === "source-2"
      ? { ...source, retrievedAt: "2026-07-09T12:00:00Z" }
      : source),
  };
  const candidateFacts = fixture.extractedFacts.facts
    .filter(({ fieldPath }) => classifyBasicV2FieldPath(fieldPath) !== "derived")
    .map((fact) => fact.fieldPath === "country.code"
      ? {
        ...fact,
        evidence: fact.evidence.map((evidence) => ({
          ...evidence,
          rawValue: "EX",
          normalizedValue: "EX",
        })),
      }
      : structuredClone(fact));
  const derived = materializeBasicDerivedFacts({
    countryCode: "EX",
    primarySourceId: "source-1",
    sourceRegister,
    candidateFacts,
  });

  return {
    countryDirectory: fixture.countryDirectory,
    runId: fixture.runId,
    sourceRegister: derived.sourceRegister,
    extractedFacts: {
      schemaVersion: fixture.extractedFacts.schemaVersion,
      runId: fixture.runId,
      countryCode: "EX",
      facts: [...candidateFacts, ...derived.facts].sort((left, right) =>
        left.fieldPath < right.fieldPath ? -1 : left.fieldPath > right.fieldPath ? 1 : 0),
    },
    marketOverviewDraft: {
      ...fixture.marketOverviewDraft,
      countryCode: "EX",
    },
    reviewReport: {
      ...fixture.reviewReport,
      countryCode: "EX",
    },
  };
}
