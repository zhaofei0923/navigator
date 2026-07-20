import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createBasicCollectionAuditArtifactsV3, serializeBasicCollectionAuditArtifactsV3 } from "./collection/basic-audit-v3-artifacts.js";
import { createBasicCollectionAuditV3Fixture } from "./basic-collection-v3-test-fixture.js";
import type { BasicCollectionAuditBundleV3 } from "./collection/basic-collection-v3-contracts.js";
import type {
  BasicCountryPublicationApprovalReceipt,
  BasicCountryPublicationManifestV3,
  BasicCountryPublicationValidationInputV3,
} from "./collection/basic-publication-contracts.js";
import { sha256Hex } from "./collection/basic-publication-digests.js";
import { materializeBasicCanonicalFromApprovedCandidateV3 } from "./collection/basic-publication-materializer-v3.js";

export function createBasicCountryPublicationV3Fixture() {
  const candidate = createBasicCollectionAuditV3Fixture() as unknown as
    BasicCollectionAuditBundleV3;
  const candidateArtifactBytes = serializeBasicCollectionAuditArtifactsV3(
    createBasicCollectionAuditArtifactsV3(candidate),
  );
  const approvalReceipt: BasicCountryPublicationApprovalReceipt = {
    schemaVersion: "basic-country-publication-approval/v1",
    countryDirectory: candidate.countryDirectory,
    countryCode: candidate.sourceRegister.countryCode,
    runId: candidate.runId,
    submission: {
      fromReviewStatus: "draft",
      toReviewStatus: "pending",
      submittedAt: "2026-07-10T00:00:00Z",
    },
    decision: "approved",
    reviewerId: "synthetic-reviewer",
    decidedAt: "2026-07-11T00:00:00Z",
    authorizedPublication: {
      coverageLevel: "BASIC",
      fromReviewStatus: "pending",
      toReviewStatus: "published",
      aiUsable: false,
    },
    artifactSha256: Object.fromEntries(
      Object.entries(candidateArtifactBytes).map(([name, bytes]) => [
        name,
        sha256Hex(bytes),
      ]),
    ) as BasicCountryPublicationApprovalReceipt["artifactSha256"],
  };
  const approvalReceiptBytes = new TextEncoder().encode(
    `${JSON.stringify(approvalReceipt)}\n`,
  );
  const manifest: BasicCountryPublicationManifestV3 = {
    schemaVersion: "basic-country-publication-manifest/v3",
    activeRunId: candidate.runId,
    mappingVersion: "basic-country-canonical/v3",
    auditBundlePath:
      `data/staging/${candidate.countryDirectory}/${candidate.runId}`,
    approvalReceiptPath:
      `data/approvals/${candidate.countryDirectory}/${candidate.runId}.json`,
    approvalReceiptSha256: sha256Hex(approvalReceiptBytes),
  };
  const canonical = materializeBasicCanonicalFromApprovedCandidateV3(
    candidate,
    manifest,
  );
  const validationInput: BasicCountryPublicationValidationInputV3 = {
    countryDirectory: candidate.countryDirectory,
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
  return {
    candidate,
    candidateArtifactBytes,
    approvalReceipt,
    approvalReceiptBytes,
    manifest,
    canonical,
    validationInput,
  };
}

export function writeBasicCountryPublicationV3RepositoryFixture() {
  const publication = createBasicCountryPublicationV3Fixture();
  const root = mkdtempSync(join(tmpdir(), "basic-publication-v3-consumer-"));
  const countryDirectory = publication.approvalReceipt.countryDirectory;
  const runId = publication.approvalReceipt.runId;
  const canonicalDirectory = join(root, "data", countryDirectory);
  const candidateDirectory = join(root, "data", "staging", countryDirectory, runId);
  const approvalDirectory = join(root, "data", "approvals", countryDirectory);
  mkdirSync(canonicalDirectory, { recursive: true });
  mkdirSync(candidateDirectory, { recursive: true });
  mkdirSync(approvalDirectory, { recursive: true });
  writeJson(join(canonicalDirectory, "collection-manifest.json"), publication.manifest);
  writeJson(join(canonicalDirectory, "country.json"), publication.canonical.country);
  writeJson(
    join(canonicalDirectory, "market-overview.json"),
    publication.canonical.marketOverview,
  );
  writeFileSync(join(approvalDirectory, `${runId}.json`), publication.approvalReceiptBytes);
  for (const [name, bytes] of Object.entries(publication.candidateArtifactBytes)) {
    writeFileSync(join(candidateDirectory, name), bytes);
  }
  return Object.freeze({
    root,
    countryDirectory,
    publication,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  });
}

function writeJson(pathname: string, value: unknown): void {
  writeFileSync(pathname, `${JSON.stringify(value)}\n`, "utf8");
}
