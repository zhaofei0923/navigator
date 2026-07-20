import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { writeBasicCandidateArtifactsV3 } from "./cli/basic-candidate-artifact-writer.js";
import { closeBasicCandidateWorkspace, openBasicCandidateWorkspace } from "./cli/basic-candidate-workspace.js";
import { createFilesystemBasicBatchCache, prepareBasicBatch } from "./cli/prepare-basic-batch.js";
import { publishBasicCountry } from "./cli/publish-basic-country.js";
import { writeBasicReviewPack } from "./cli/write-basic-review-pack.js";
import { BASIC_GLOBAL_SOURCE_IDS } from "./collection/adapters/basic-global-source-pack.js";
import { sha256Hex } from "./collection/basic-publication-digests.js";
import { validateApprovedBasicCountryPublicationV3 } from "./collection/basic-publication-validator-v3.js";
import {
  artifactBytes, assertCapturedProvenance, assertTamperRejected, CANONICAL_FILES, CANDIDATE_FILES,
  candidateFromArtifacts, canonicalFromFiles, createSyntheticCandidate, isGlobalSourceId,
  loadStrictFixture, snapshot,
} from "./basic-v2-automation-fixture-support.js";

const roots = new Set<string>();

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.clear();
});

describe("strict synthetic BASIC v2 automation fixture flow", () => {
  test("keeps a three-country v3 batch isolated through human-approved publication", async () => {
    const fixture = loadStrictFixture();
    const root = createRepo();
    const cache = createFilesystemBasicBatchCache(root, fixture.batchId);
    const captured: string[] = [];
    const preparationErrors: string[] = [];
    const batch = await prepareBasicBatch({
      config: { batchId: fixture.batchId, countries: fixture.countries.map(({ countryCode }) => countryCode) },
      globalSourceIds: BASIC_GLOBAL_SOURCE_IDS,
      async captureGlobalSource(sourceId) {
        if (!isGlobalSourceId(sourceId)) throw new Error("unexpected global source");
        captured.push(sourceId);
        return new TextEncoder().encode(fixture.globalSnapshots[sourceId]);
      },
      cache,
      async prepareCountry(countryCode, captures) {
        const country = fixture.countries.find((entry) => entry.countryCode === countryCode);
        if (country === undefined) throw new Error("missing strict fixture country");
        assertTamperRejected(fixture, countryCode, captures);
        try {
          const workspace = await openBasicCandidateWorkspace(root);
          try {
            await writeBasicCandidateArtifactsV3({ workspace, candidate: createSyntheticCandidate(
              fixture, country.countryCode, country.countryDirectory, country.runId, captures,
            ) });
          } finally {
            await closeBasicCandidateWorkspace(workspace);
          }
        } catch (error) {
          preparationErrors.push(error instanceof Error ? error.message : String(error));
          throw error;
        }
        return { countryCode, status: "ready" as const };
      },
    });

    expect(captured.sort()).toEqual([...BASIC_GLOBAL_SOURCE_IDS].sort());
    expect(preparationErrors).toEqual([]);
    expect(batch.results).toEqual(fixture.countries.map(({ countryCode }) => ({ countryCode, status: "ready" })));
    await expect(cache.getOrCapture("global-solar-atlas", async () => {
      throw new Error("warm cache must not capture");
    })).resolves.toEqual(new TextEncoder().encode(fixture.globalSnapshots["global-solar-atlas"]));

    for (const country of fixture.countries) {
      const candidateDirectory = join(root, "data", "staging", country.countryDirectory, country.runId);
      expect(readdirSync(candidateDirectory).sort()).toEqual([...CANDIDATE_FILES].sort());
      const candidateBytes = artifactBytes(candidateDirectory, CANDIDATE_FILES);
      const candidateBeforeReview = snapshot(candidateBytes);
      assertCapturedProvenance(fixture, candidateBytes);
      await expect(writeBasicReviewPack({ repoRoot: root, countryCode: country.countryCode, runId: country.runId }))
        .resolves.toEqual({ status: "written", relativeDirectory: `.cache/basic-country/${country.countryCode}/${country.runId}/review` });
      expect(snapshot(artifactBytes(candidateDirectory, CANDIDATE_FILES))).toEqual(candidateBeforeReview);

      const candidate = candidateFromArtifacts(candidateBytes, country.countryDirectory);
      const receipt = suppliedApprovalReceipt(fixture.approval, country, candidateBytes);
      const receiptBytes = encode(receipt);
      const receiptBeforePublication = snapshot({ receipt: receiptBytes });
      const approvalDirectory = join(root, "data", "approvals", country.countryDirectory);
      mkdirSync(approvalDirectory, { recursive: true, mode: 0o700 });
      writeFileSync(join(approvalDirectory, `${country.runId}.json`), receiptBytes, { mode: 0o600 });
      await expect(publishBasicCountry({ repoRoot: root, countryCode: country.countryCode, countryDirectory: country.countryDirectory, runId: country.runId, approvalFile: `data/approvals/${country.countryDirectory}/${country.runId}.json` }))
        .resolves.toMatchObject({ status: "published", postCommitVerified: true });

      expect(snapshot(artifactBytes(candidateDirectory, CANDIDATE_FILES))).toEqual(candidateBeforeReview);
      expect(snapshot({ receipt: new Uint8Array(readFileSync(join(approvalDirectory, `${country.runId}.json`))) })).toEqual(receiptBeforePublication);
      const canonicalDirectory = join(root, "data", country.countryDirectory);
      expect(readdirSync(canonicalDirectory).sort()).toEqual([...CANONICAL_FILES].sort());
      const canonical = canonicalFromFiles(canonicalDirectory);
      expect(validateApprovedBasicCountryPublicationV3({ countryDirectory: country.countryDirectory, manifest: canonical.collectionManifest, approvalReceipt: receipt, approvalReceiptBytes: receiptBytes, candidate, candidateArtifactBytes: candidateBytes, canonical: canonical.data, canonicalArtifactNames: CANONICAL_FILES }))
        .toMatchObject({ valid: true, blockerCode: null });
      expect(canonical.data.country.coverageLevel).toBe("BASIC");
      expect(canonical.data.marketOverview.aiUsable).toBe(false);
      expect(canonical.data.knowledge).toEqual([]);
      expect(canonical.data.country.moduleCoverage.filter((coverage: { moduleKey: string }) => coverage.moduleKey !== "market-overview"))
        .toEqual(Array.from({ length: 9 }, () => expect.objectContaining({ status: "BUILDING", dataCount: 0 })));
    }
    expect(readdirSync(join(root, "data")).sort()).toEqual(["approvals", "staging", ...fixture.countries.map(({ countryDirectory }) => countryDirectory)].sort());
    expect(existsSync(join(root, "data", "knowledge-chunks.json"))).toBe(false);
  });
});

function suppliedApprovalReceipt(
  approval: ReturnType<typeof loadStrictFixture>["approval"],
  country: ReturnType<typeof loadStrictFixture>["countries"][number],
  candidateArtifactBytes: Record<(typeof CANDIDATE_FILES)[number], Uint8Array>,
) {
  return {
    schemaVersion: "basic-country-publication-approval/v1" as const,
    countryDirectory: country.countryDirectory, countryCode: country.countryCode, runId: country.runId,
    submission: { fromReviewStatus: "draft" as const, toReviewStatus: "pending" as const, submittedAt: approval.submittedAt },
    decision: "approved" as const, reviewerId: approval.reviewerId, decidedAt: approval.decidedAt,
    authorizedPublication: { coverageLevel: "BASIC" as const, fromReviewStatus: "pending" as const, toReviewStatus: "published" as const, aiUsable: false },
    artifactSha256: Object.fromEntries(CANDIDATE_FILES.map((name) => [name, sha256Hex(candidateArtifactBytes[name])])),
  };
}

function encode(value: unknown): Uint8Array { return new TextEncoder().encode(`${JSON.stringify(value)}\n`); }
function createRepo(): string {
  const root = mkdtempSync(join(process.platform === "linux" ? "/tmp" : tmpdir(), "basic-v2-automation-"));
  roots.add(root);
  mkdirSync(join(root, "packages", "db"), { recursive: true });
  writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "navigator" }));
  writeFileSync(join(root, "packages", "db", "package.json"), JSON.stringify({ name: "@navigator/db" }));
  return root;
}
