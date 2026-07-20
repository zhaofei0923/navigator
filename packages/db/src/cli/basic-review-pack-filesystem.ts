import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";

import { parseBasicProfile, type BasicProfile } from "@navigator/shared-types/basic-profile";

import { parseBasicStrictJsonText } from "../collection/basic-strict-json.js";
import {
  BASIC_COLLECTION_AUDIT_V3_SCHEMA_VERSION,
  type BasicCollectionAuditBundleV3,
} from "../collection/basic-collection-v3-contracts.js";
import { validateBasicCollectionAuditArtifactValuesVersioned } from "../collection/basic-collection-versioned-loader.js";
import type { BasicCollectionAuditArtifactName } from "../collection/basic-offline-audit-artifacts.js";
import { renderBasicReviewHtml } from "../review/basic-review-html.js";
import { createBasicReviewModel } from "../review/basic-review-model.js";
import { SAFE_COUNTRY_DIRECTORY } from "../seed/basic-country-validation-utils.js";
import {
  cleanupBasicCandidateTemporaryDirectory,
  closeBasicCandidateHeldDirectories,
  createBasicCandidateExclusiveDirectory,
  ensureBasicCandidateDirectoryChild,
  openBasicCandidateDirectoryChild,
  readBasicCandidateBoundedRegularFile,
  requireBasicCandidateDirectoryEntries,
  requireBasicCandidateHeldChild,
  setBasicCandidateDirectoryMode,
  syncBasicCandidateDirectory,
  syncBasicCandidateParentDirectory,
  verifyBasicCandidateRegularFile,
  writeBasicCandidateExclusiveFile,
  type BasicCandidateHeldDirectory,
} from "./basic-candidate-constrained-fs.js";
import { renameBasicCandidateDirectoryChildNoReplaceNative } from "./basic-candidate-native-fs.js";

export interface BasicReviewPackIdentity {
  readonly countryCode: string;
  readonly runId: string;
}

const ARTIFACT_NAMES = Object.freeze([
  "source-register.json",
  "extracted-facts.json",
  "market-overview.draft.json",
  "review-report.json",
] as const satisfies readonly BasicCollectionAuditArtifactName[]);
const REVIEW_NAMES = Object.freeze(["index.html", "review.json"] as const);
const MAX_JSON_BYTES = 2 * 1024 * 1024;

export async function generateBasicReviewPackFiles(
  root: BasicCandidateHeldDirectory,
  identity: BasicReviewPackIdentity,
): Promise<void> {
  const located = await locateCandidate(root, identity);
  const previousProfile = await readPreviousProfile(root, located.countryDirectory);
  const model = createBasicReviewModel({ candidate: located.candidate, previousProfile });
  await writeReviewDirectory(root, identity, model);
}

async function locateCandidate(
  root: BasicCandidateHeldDirectory,
  input: BasicReviewPackIdentity,
): Promise<Readonly<{ countryDirectory: string; candidate: BasicCollectionAuditBundleV3 }>> {
  let data: BasicCandidateHeldDirectory | null = null;
  let staging: BasicCandidateHeldDirectory | null = null;
  try {
    data = await openBasicCandidateDirectoryChild(root, "data");
    staging = await openBasicCandidateDirectoryChild(data, "staging");
    const stagingPath = `/proc/self/fd/${staging.handle.fd}/`;
    const entries = (await readdir(stagingPath)).sort();
    if (entries.some((entry) => !SAFE_COUNTRY_DIRECTORY.test(entry))) throw new Error("invalid");
    const matches: Array<Readonly<{
      countryDirectory: string;
      candidate: BasicCollectionAuditBundleV3;
    }>> = [];
    for (const countryDirectory of entries) {
      const candidate = await tryReadCandidate(staging, countryDirectory, input.runId);
      if (candidate !== null && candidate.sourceRegister.countryCode === input.countryCode) {
        matches.push(Object.freeze({ countryDirectory, candidate }));
      }
    }
    if (!sameStrings(entries, (await readdir(stagingPath)).sort()) || matches.length !== 1) {
      throw new Error("invalid");
    }
    return matches[0]!;
  } finally {
    await closeBasicCandidateHeldDirectories([staging, data]);
  }
}

async function tryReadCandidate(
  staging: BasicCandidateHeldDirectory,
  countryDirectory: string,
  runId: string,
): Promise<BasicCollectionAuditBundleV3 | null> {
  let country: BasicCandidateHeldDirectory | null = null;
  let run: BasicCandidateHeldDirectory | null = null;
  try {
    country = await openBasicCandidateDirectoryChild(staging, countryDirectory);
    try {
      run = await openBasicCandidateDirectoryChild(country, runId);
    } catch (error) {
      if (errorCode(error) === "ENOENT") return null;
      throw error;
    }
    await requireBasicCandidateDirectoryEntries(run, ARTIFACT_NAMES);
    const artifacts = Object.fromEntries(await Promise.all(ARTIFACT_NAMES.map(async (name) => {
      const bytes = await readBasicCandidateBoundedRegularFile(run!, name, MAX_JSON_BYTES);
      return [name, parseBasicStrictJsonText(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      )] as const;
    }))) as Readonly<Record<BasicCollectionAuditArtifactName, unknown>>;
    await requireBasicCandidateDirectoryEntries(run, ARTIFACT_NAMES);
    const candidate = validateBasicCollectionAuditArtifactValuesVersioned(
      countryDirectory, runId, artifacts,
    );
    if (candidate.sourceRegister.schemaVersion !== BASIC_COLLECTION_AUDIT_V3_SCHEMA_VERSION) {
      throw new Error("invalid");
    }
    return candidate as BasicCollectionAuditBundleV3;
  } finally {
    await closeBasicCandidateHeldDirectories([run, country]);
  }
}

async function readPreviousProfile(
  root: BasicCandidateHeldDirectory,
  countryDirectory: string,
): Promise<BasicProfile | null> {
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
    let bytes: Uint8Array;
    try {
      bytes = await readBasicCandidateBoundedRegularFile(
        country, "market-overview.json", MAX_JSON_BYTES,
      );
    } catch (error) {
      if (errorCode(error) === "ENOENT") return null;
      throw error;
    }
    const value = parseBasicStrictJsonText(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("invalid");
    const profileValue = value.basicProfile;
    if (profileValue === undefined || profileValue === null) return null;
    const profile = parseBasicProfile(profileValue);
    if (profile === null) throw new Error("invalid");
    return profile;
  } finally {
    await closeBasicCandidateHeldDirectories([country, data]);
  }
}

async function writeReviewDirectory(
  root: BasicCandidateHeldDirectory,
  input: BasicReviewPackIdentity,
  model: ReturnType<typeof createBasicReviewModel>,
): Promise<void> {
  const held: BasicCandidateHeldDirectory[] = [];
  let temporary: BasicCandidateHeldDirectory | null = null;
  let parent: BasicCandidateHeldDirectory | null = null;
  let temporaryName: string | null = null;
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
    const htmlIdentity = await writeBasicCandidateExclusiveFile(temporary, "index.html", html);
    const jsonIdentity = await writeBasicCandidateExclusiveFile(temporary, "review.json", json);
    await syncBasicCandidateDirectory(temporary);
    await verifyReviewFiles(temporary, htmlIdentity, html, jsonIdentity, json);
    await requireReviewHierarchy(hierarchy);
    await requireBasicCandidateHeldChild(parent, temporaryName, temporary);
    renameBasicCandidateDirectoryChildNoReplaceNative(
      parent.handle.fd, temporaryName, "review", temporary.identity.dev, temporary.identity.ino,
    );
    published = true;
    await requireBasicCandidateHeldChild(parent, "review", temporary);
    await syncBasicCandidateParentDirectory(parent);
    await requireReviewHierarchy(hierarchy);
    await requireBasicCandidateHeldChild(parent, "review", temporary);
    await verifyReviewFiles(temporary, htmlIdentity, html, jsonIdentity, json);
  } finally {
    if (!published && parent !== null && temporary !== null && temporaryName !== null) {
      await cleanupBasicCandidateTemporaryDirectory(parent, temporaryName, temporary);
    }
    await closeBasicCandidateHeldDirectories([...held, temporary]);
  }
}

async function verifyReviewFiles(
  directory: BasicCandidateHeldDirectory,
  htmlIdentity: Awaited<ReturnType<typeof writeBasicCandidateExclusiveFile>>,
  html: Uint8Array,
  jsonIdentity: Awaited<ReturnType<typeof writeBasicCandidateExclusiveFile>>,
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

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
