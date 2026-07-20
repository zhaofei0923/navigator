import { randomUUID } from "node:crypto";
import { renderBasicReviewHtml } from "../review/basic-review-html.js";
import { createBasicReviewModel } from "../review/basic-review-model.js";
import { loadApprovedPreviousBasicProfileVersioned } from "../review/basic-approved-publication-profile.js";
import {
  closeBasicCandidateHeldDirectories,
  createBasicCandidateExclusiveDirectory,
  ensureBasicCandidateDirectoryChild,
  openBasicCandidateDirectoryChild,
  requireBasicCandidateDirectoryEntries,
  requireBasicCandidateHeldChild,
  setBasicCandidateDirectoryMode,
  syncBasicCandidateDirectory,
  syncBasicCandidateParentDirectory,
  verifyBasicCandidateRegularFile,
  type BasicCandidateHeldDirectory,
} from "./basic-candidate-constrained-fs.js";
import { renameBasicCandidateDirectoryChildNoReplaceNative } from "./basic-candidate-native-fs.js";
import { locateBasicReviewCandidateSnapshot } from "./basic-review-candidate-snapshot.js";
import {
  cleanupBasicReviewPackTemporaryDirectory,
  type BasicReviewPackTemporaryFile,
} from "./basic-review-pack-temp-cleanup.js";
import {
  writeBasicReviewPackOwnedFile,
  type BasicReviewPackFileName,
  type BasicReviewPackFileOperation,
} from "./basic-review-pack-owned-file.js";

export interface BasicReviewPackIdentity {
  readonly countryCode: string;
  readonly runId: string;
}

const REVIEW_NAMES = Object.freeze(["index.html", "review.json"] as const);

export interface BasicReviewPackFilesystemHooks {
  readonly beforeAtomicPublish?: () => void | Promise<void>;
  readonly beforeReviewFileOperation?: (
    name: BasicReviewPackFileName,
    operation: BasicReviewPackFileOperation,
  ) => void | Promise<void>;
}

export async function generateBasicReviewPackFiles(
  root: BasicCandidateHeldDirectory,
  repoRoot: string,
  identity: BasicReviewPackIdentity,
  hooks: BasicReviewPackFilesystemHooks = {},
): Promise<void> {
  const located = await locateBasicReviewCandidateSnapshot(root, identity);
  try {
    const previousProfile = await readPreviousProfile(
      root, repoRoot, located.countryDirectory,
    );
    const model = createBasicReviewModel({
      candidate: located.candidate,
      previousProfile,
      candidateArtifactSha256: located.artifactSha256,
    });
    await located.verify();
    await writeReviewDirectory(root, identity, model, located.verify, hooks);
  } finally {
    await located.close();
  }
}

async function readPreviousProfile(
  root: BasicCandidateHeldDirectory,
  repoRoot: string,
  countryDirectory: string,
): Promise<ReturnType<typeof loadApprovedPreviousBasicProfileVersioned>> {
  let data: BasicCandidateHeldDirectory | null = null;
  let country: BasicCandidateHeldDirectory | null = null;
  try {
    data = await openBasicCandidateDirectoryChild(root, "data");
    try {
      country = await openBasicCandidateDirectoryChild(data, countryDirectory);
    } catch (error) {
      if (errorCode(error) === "ENOENT") return null;
      throw error;
    }
    return loadApprovedPreviousBasicProfileVersioned(repoRoot, countryDirectory);
  } finally {
    await closeBasicCandidateHeldDirectories([country, data]);
  }
}

async function writeReviewDirectory(
  root: BasicCandidateHeldDirectory,
  input: BasicReviewPackIdentity,
  model: ReturnType<typeof createBasicReviewModel>,
  verifyCandidate: () => Promise<void>,
  hooks: BasicReviewPackFilesystemHooks,
): Promise<void> {
  const held: BasicCandidateHeldDirectory[] = [];
  let temporary: BasicCandidateHeldDirectory | null = null;
  let parent: BasicCandidateHeldDirectory | null = null;
  let temporaryName: string | null = null;
  const temporaryFiles: BasicReviewPackTemporaryFile[] = [];
  let published = false;
  try {
    let current = root;
    const hierarchy: Array<Readonly<{
      parent: BasicCandidateHeldDirectory;
      name: string;
      child: BasicCandidateHeldDirectory;
    }>> = [];
    for (const [name, mode] of [
      [".cache", 0o755], ["basic-country", 0o755], [input.countryCode, 0o755],
      [input.runId, 0o755],
    ] as const) {
      const parentDirectory = current;
      const result = await ensureBasicCandidateDirectoryChild(current, name, mode);
      held.push(result.directory);
      hierarchy.push(Object.freeze({ parent: parentDirectory, name, child: result.directory }));
      await requireBasicCandidateHeldChild(parentDirectory, name, result.directory);
      if (result.created) await syncBasicCandidateParentDirectory(parentDirectory);
      current = result.directory;
    }
    parent = current;
    temporaryName = `.review-${randomUUID()}.tmp`;
    temporary = await createBasicCandidateExclusiveDirectory(parent, temporaryName, 0o700);
    await setBasicCandidateDirectoryMode(temporary, 0o700);
    const html = renderBasicReviewHtml(model);
    const json = new TextEncoder().encode(`${JSON.stringify(model)}\n`);
    const htmlIdentity = await writeBasicReviewPackOwnedFile(
      temporary, "index.html", html,
      (owned) => temporaryFiles.push(owned),
      hooks.beforeReviewFileOperation,
    );
    const jsonIdentity = await writeBasicReviewPackOwnedFile(
      temporary, "review.json", json,
      (owned) => temporaryFiles.push(owned),
      hooks.beforeReviewFileOperation,
    );
    await syncBasicCandidateDirectory(temporary);
    await verifyReviewFiles(temporary, htmlIdentity, html, jsonIdentity, json);
    await requireReviewHierarchy(hierarchy);
    await requireBasicCandidateHeldChild(parent, temporaryName, temporary);
    await hooks.beforeAtomicPublish?.();
    await verifyCandidate();
    const renameResult = renameBasicCandidateDirectoryChildNoReplaceNative(
      parent.handle.fd, temporaryName, "review", temporary.identity.dev, temporary.identity.ino,
    );
    published = renameResult.committed;
    await requireBasicCandidateHeldChild(parent, "review", temporary);
    await syncBasicCandidateParentDirectory(parent);
    await requireReviewHierarchy(hierarchy);
    await requireBasicCandidateHeldChild(parent, "review", temporary);
    await verifyReviewFiles(temporary, htmlIdentity, html, jsonIdentity, json);
  } finally {
    try {
      if (
        !published && parent !== null && temporary !== null &&
        temporaryName !== null
      ) {
        await cleanupBasicReviewPackTemporaryDirectory(
          parent, temporaryName, temporary, temporaryFiles,
        );
      }
    } finally {
      await closeBasicCandidateHeldDirectories([...held, temporary]);
    }
  }
}

async function verifyReviewFiles(
  directory: BasicCandidateHeldDirectory,
  htmlIdentity: Awaited<ReturnType<typeof writeBasicReviewPackOwnedFile>>,
  html: Uint8Array,
  jsonIdentity: Awaited<ReturnType<typeof writeBasicReviewPackOwnedFile>>,
  json: Uint8Array,
): Promise<void> {
  await requireBasicCandidateDirectoryEntries(directory, REVIEW_NAMES);
  await verifyBasicCandidateRegularFile(directory, "index.html", htmlIdentity, html);
  await verifyBasicCandidateRegularFile(directory, "review.json", jsonIdentity, json);
}

async function requireReviewHierarchy(
  hierarchy: readonly Readonly<{
    parent: BasicCandidateHeldDirectory;
    name: string;
    child: BasicCandidateHeldDirectory;
  }>[],
): Promise<void> {
  for (const entry of hierarchy) {
    await requireBasicCandidateHeldChild(entry.parent, entry.name, entry.child);
  }
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | null)?.code;
}
