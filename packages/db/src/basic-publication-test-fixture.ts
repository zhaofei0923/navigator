import { createBasicCollectionAuditArtifactsV2, serializeBasicCollectionAuditArtifactsV2 } from "./collection/basic-audit-v2-artifacts.js";
import { materializeBasicDerivedFacts } from "./collection/basic-derived-fact-materializer.js";
import { classifyBasicV2FieldPath, type BasicCollectionAuditBundleV2 } from "./collection/basic-collection-v2-contracts.js";
import type {
  BasicCountryPublicationApprovalReceipt,
  BasicCountryPublicationManifestV2,
} from "./collection/basic-publication-contracts.js";
import { sha256Hex } from "./collection/basic-publication-digests.js";
import { createBasicCollectionAuditV2Fixture } from "./basic-collection-test-fixture.js";

export function createBasicCountryPublicationFixture(): Readonly<{
  approvalReceipt: BasicCountryPublicationApprovalReceipt;
  manifest: BasicCountryPublicationManifestV2;
  candidate: BasicCollectionAuditBundleV2;
}> {
  const candidate = createExampleLandCandidate();
  const artifacts = serializeBasicCollectionAuditArtifactsV2(
    createBasicCollectionAuditArtifactsV2(candidate),
  );
  const artifactSha256 = Object.fromEntries(
    Object.entries(artifacts).map(([name, bytes]) => [name, sha256Hex(bytes)]),
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
  return Object.freeze({ approvalReceipt, manifest, candidate });
}

function createExampleLandCandidate(): BasicCollectionAuditBundleV2 {
  const fixture = createBasicCollectionAuditV2Fixture();
  const sourceRegister = {
    ...fixture.sourceRegister,
    countryCode: "EX",
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
