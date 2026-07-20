import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { createBasicCollectionAuditV3Fixture } from "../basic-collection-v3-test-fixture.js";
import type { BasicCollectionAuditBundleV3 } from "../collection/basic-collection-v3-contracts.js";
import {
  closeBasicCandidateWorkspace,
  getBasicCandidateWorkspaceRootDirectory,
  openBasicCandidateWorkspace,
} from "./basic-candidate-workspace.js";
import {
  generateBasicReviewPackFiles,
  type BasicReviewPackFilesystemHooks,
} from "./basic-review-pack-filesystem.js";
import { BASIC_REVIEW_CANDIDATE_ARTIFACT_NAMES } from "./basic-review-candidate-snapshot.js";

const roots = new Set<string>();

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.clear();
});

describe("BASIC review candidate binding", () => {
  test("publishes all four captured artifact SHA-256 values to JSON and HTML", async () => {
    const root = createRepo();
    const candidate = createBasicCollectionAuditV3Fixture() as BasicCollectionAuditBundleV3;
    writeCandidate(root, candidate);

    await generate(root, candidate);

    const reviewDirectory = join(
      root, ".cache", "basic-country", "XZ", candidate.runId, "review",
    );
    const reviewJson = JSON.parse(readFileSync(join(reviewDirectory, "review.json"), "utf8"));
    const reviewHtml = readFileSync(join(reviewDirectory, "index.html"), "utf8");
    const expected = Object.fromEntries(BASIC_REVIEW_CANDIDATE_ARTIFACT_NAMES.map((name) => {
      const bytes = readFileSync(join(
        root, "data", "staging", candidate.countryDirectory, candidate.runId, name,
      ));
      return [name, createHash("sha256").update(bytes).digest("hex")];
    }));
    expect(reviewJson.candidateArtifactSha256).toEqual(expected);
    for (const [name, hash] of Object.entries(expected)) {
      expect(reviewHtml).toContain(name);
      expect(reviewHtml).toContain(hash);
    }
  });

  test("fails closed when the held candidate run is replaced before atomic publication", async () => {
    const root = createRepo();
    const candidate = createBasicCollectionAuditV3Fixture() as BasicCollectionAuditBundleV3;
    const run = writeCandidate(root, candidate);

    await expect(generate(root, candidate, {
      beforeAtomicPublish: async () => {
        renameSync(run, `${run}.replaced`);
        writeCandidate(root, candidate);
      },
    })).rejects.toThrow();

    expect(existsSync(join(
      root, ".cache", "basic-country", "XZ", candidate.runId, "review",
    ))).toBe(false);
  });

  test("fails closed when one held candidate artifact changes before atomic publication", async () => {
    const root = createRepo();
    const candidate = createBasicCollectionAuditV3Fixture() as BasicCollectionAuditBundleV3;
    const run = writeCandidate(root, candidate);

    await expect(generate(root, candidate, {
      beforeAtomicPublish: async () => {
        const artifact = join(run, "source-register.json");
        writeFileSync(artifact, `${readFileSync(artifact, "utf8")} `);
      },
    })).rejects.toThrow();

    expect(existsSync(join(
      root, ".cache", "basic-country", "XZ", candidate.runId, "review",
    ))).toBe(false);
  });

  test.each([
    ["index.html", "write"],
    ["index.html", "sync"],
    ["review.json", "write"],
    ["review.json", "sync"],
  ] as const)(
    "cleans an owned temporary file after %s post-create %s failure",
    async (artifactName, operation) => {
      const root = createRepo();
      const candidate = createBasicCollectionAuditV3Fixture() as BasicCollectionAuditBundleV3;
      writeCandidate(root, candidate);
      await generate(root, candidate);
      const reviewParent = join(
        root, ".cache", "basic-country", "XZ", candidate.runId,
      );
      const review = join(reviewParent, "review");
      const reviewBefore = snapshotFiles(review, ["index.html", "review.json"]);
      const candidateDirectory = join(
        root, "data", "staging", candidate.countryDirectory, candidate.runId,
      );
      const candidateBefore = snapshotFiles(
        candidateDirectory, BASIC_REVIEW_CANDIDATE_ARTIFACT_NAMES,
      );
      let injected = false;

      await expect(generate(root, candidate, {
        beforeReviewFileOperation(name, stage) {
          if (name === artifactName && stage === operation) {
            injected = true;
            const temporaryName = readdirSync(reviewParent).find(
              (entry) => entry.startsWith(".review-") && entry.endsWith(".tmp"),
            );
            expect(temporaryName).toBeDefined();
            expect(readdirSync(join(reviewParent, temporaryName ?? "")))
              .toContain(artifactName);
            throw new Error("injected owned review file failure");
          }
        },
      })).rejects.toThrow("injected owned review file failure");

      expect(injected).toBe(true);
      expect(readdirSync(reviewParent)).toEqual(["review"]);
      expect(snapshotFiles(review, ["index.html", "review.json"]))
        .toEqual(reviewBefore);
      expect(snapshotFiles(candidateDirectory, BASIC_REVIEW_CANDIDATE_ARTIFACT_NAMES))
        .toEqual(candidateBefore);
    },
  );
});

async function generate(
  root: string,
  candidate: BasicCollectionAuditBundleV3,
  hooks: BasicReviewPackFilesystemHooks = {},
): Promise<void> {
  const workspace = await openBasicCandidateWorkspace(root);
  try {
    await generateBasicReviewPackFiles(
      getBasicCandidateWorkspaceRootDirectory(workspace),
      root,
      { countryCode: "XZ", runId: candidate.runId },
      hooks,
    );
  } finally {
    await closeBasicCandidateWorkspace(workspace);
  }
}

function snapshotFiles(
  directory: string,
  names: readonly string[],
): Readonly<Record<string, string>> {
  return Object.freeze(Object.fromEntries(names.map((name) => [
    name, readFileSync(join(directory, name)).toString("hex"),
  ])));
}

function createRepo(): string {
  const root = mkdtempSync(join(
    process.platform === "linux" ? "/tmp" : tmpdir(), "basic-review-binding-",
  ));
  roots.add(root);
  mkdirSync(join(root, "packages", "db"), { recursive: true });
  writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "navigator" }));
  writeFileSync(join(root, "packages", "db", "package.json"), JSON.stringify({
    name: "@navigator/db",
  }));
  mkdirSync(join(root, "data", "staging"), { recursive: true });
  return root;
}

function writeCandidate(root: string, bundle: BasicCollectionAuditBundleV3): string {
  const directory = join(root, "data", "staging", bundle.countryDirectory, bundle.runId);
  mkdirSync(directory, { recursive: true });
  const values = {
    "source-register.json": bundle.sourceRegister,
    "extracted-facts.json": bundle.extractedFacts,
    "market-overview.draft.json": bundle.marketOverviewDraft,
    "review-report.json": bundle.reviewReport,
  };
  for (const [name, value] of Object.entries(values)) {
    writeFileSync(join(directory, name), `${JSON.stringify(value)}\n`);
  }
  return directory;
}
