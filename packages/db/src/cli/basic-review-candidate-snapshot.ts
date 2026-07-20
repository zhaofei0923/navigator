import { createHash } from "node:crypto";
import { open, readdir, type FileHandle } from "node:fs/promises";

import { parseBasicStrictJsonText } from "../collection/basic-strict-json.js";
import {
  BASIC_COLLECTION_AUDIT_V3_SCHEMA_VERSION,
  type BasicCollectionAuditBundleV3,
} from "../collection/basic-collection-v3-contracts.js";
import { validateBasicCollectionAuditArtifactValuesVersioned } from "../collection/basic-collection-versioned-loader.js";
import type { BasicCollectionAuditArtifactName } from "../collection/basic-offline-audit-artifacts.js";
import { SAFE_COUNTRY_DIRECTORY } from "../seed/basic-country-validation-utils.js";
import {
  closeBasicCandidateHeldDirectories,
  openBasicCandidateDirectoryChild,
  requireBasicCandidateDirectoryEntries,
  requireBasicCandidateHeldChild,
  verifyBasicCandidateRegularFile,
  type BasicCandidateHeldDirectory,
  type BasicCandidateRegularFileIdentity,
} from "./basic-candidate-constrained-fs.js";
import { closeBasicCandidateHandle } from "./basic-candidate-fs-handles.js";
import {
  basicCandidateRegularFileIdentity,
  isBoundedBasicCandidateRegularFile,
  sameBasicCandidateRegularFileIdentity,
} from "./basic-candidate-fs-identity.js";
import { basicCandidateChildPath, basicCandidateReadFlags } from "./basic-candidate-fs-paths.js";

export const BASIC_REVIEW_CANDIDATE_ARTIFACT_NAMES = Object.freeze([
  "source-register.json",
  "extracted-facts.json",
  "market-overview.draft.json",
  "review-report.json",
] as const satisfies readonly BasicCollectionAuditArtifactName[]);

const MAX_JSON_BYTES = 2 * 1024 * 1024;

interface ArtifactSnapshot {
  readonly bytes: Uint8Array;
  readonly identity: BasicCandidateRegularFileIdentity;
  readonly sha256: string;
  readonly value: unknown;
}

interface CandidateLeafSnapshot {
  readonly countryDirectory: string;
  readonly candidate: BasicCollectionAuditBundleV3;
  readonly country: BasicCandidateHeldDirectory;
  readonly run: BasicCandidateHeldDirectory;
  readonly artifacts: Readonly<Record<BasicCollectionAuditArtifactName, ArtifactSnapshot>>;
  readonly close: () => Promise<void>;
}

export interface BasicReviewCandidateSnapshot {
  readonly countryDirectory: string;
  readonly candidate: BasicCollectionAuditBundleV3;
  readonly artifactSha256: Readonly<Record<BasicCollectionAuditArtifactName, string>>;
  readonly verify: () => Promise<void>;
  readonly close: () => Promise<void>;
}

export async function locateBasicReviewCandidateSnapshot(
  root: BasicCandidateHeldDirectory,
  identity: Readonly<{ countryCode: string; runId: string }>,
): Promise<BasicReviewCandidateSnapshot> {
  let data: BasicCandidateHeldDirectory | null = null;
  let staging: BasicCandidateHeldDirectory | null = null;
  const matches: CandidateLeafSnapshot[] = [];
  try {
    data = await openBasicCandidateDirectoryChild(root, "data");
    staging = await openBasicCandidateDirectoryChild(data, "staging");
    const stagingPath = `/proc/self/fd/${staging.handle.fd}`;
    const entries = (await readdir(stagingPath)).sort(compareText);
    if (entries.some((entry) => !SAFE_COUNTRY_DIRECTORY.test(entry))) invalid();

    for (const countryDirectory of entries) {
      const snapshot = await trySnapshotCandidate(staging, countryDirectory, identity.runId);
      if (snapshot === null) continue;
      if (snapshot.candidate.sourceRegister.countryCode === identity.countryCode) {
        matches.push(snapshot);
      } else {
        await snapshot.close();
      }
    }
    if (!sameStrings(entries, (await readdir(stagingPath)).sort(compareText)) || matches.length !== 1) {
      invalid();
    }
    const match = matches[0]!;
    const heldData = data;
    const heldStaging = staging;
    data = null;
    staging = null;
    const snapshot = createCandidateSnapshot(root, heldData, heldStaging, match);
    try {
      await snapshot.verify();
      return snapshot;
    } catch (error) {
      await snapshot.close();
      throw error;
    }
  } catch (error) {
    await Promise.allSettled(matches.map(({ close }) => close()));
    throw error;
  } finally {
    await closeBasicCandidateHeldDirectories([staging, data]);
  }
}

async function trySnapshotCandidate(
  staging: BasicCandidateHeldDirectory,
  countryDirectory: string,
  runId: string,
): Promise<CandidateLeafSnapshot | null> {
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
    await requireBasicCandidateDirectoryEntries(run, BASIC_REVIEW_CANDIDATE_ARTIFACT_NAMES);
    const artifacts = Object.fromEntries(await Promise.all(
      BASIC_REVIEW_CANDIDATE_ARTIFACT_NAMES.map(async (name) => [
        name, await readArtifactSnapshot(run!, name),
      ] as const),
    )) as Readonly<Record<BasicCollectionAuditArtifactName, ArtifactSnapshot>>;
    await requireBasicCandidateDirectoryEntries(run, BASIC_REVIEW_CANDIDATE_ARTIFACT_NAMES);
    const values = Object.fromEntries(BASIC_REVIEW_CANDIDATE_ARTIFACT_NAMES.map((name) => [
      name, artifacts[name].value,
    ])) as Readonly<Record<BasicCollectionAuditArtifactName, unknown>>;
    const candidate = validateBasicCollectionAuditArtifactValuesVersioned(
      countryDirectory, runId, values,
    );
    if (candidate.sourceRegister.schemaVersion !== BASIC_COLLECTION_AUDIT_V3_SCHEMA_VERSION) {
      invalid();
    }

    const heldCountry = country;
    const heldRun = run;
    country = null;
    run = null;
    let closed = false;
    const close = async (): Promise<void> => {
      if (closed) return;
      closed = true;
      await closeBasicCandidateHeldDirectories([heldRun, heldCountry]);
    };
    return Object.freeze({
      countryDirectory,
      candidate: candidate as BasicCollectionAuditBundleV3,
      country: heldCountry,
      run: heldRun,
      artifacts,
      close,
    });
  } finally {
    await closeBasicCandidateHeldDirectories([run, country]);
  }
}

function createCandidateSnapshot(
  root: BasicCandidateHeldDirectory,
  data: BasicCandidateHeldDirectory,
  staging: BasicCandidateHeldDirectory,
  leaf: CandidateLeafSnapshot,
): BasicReviewCandidateSnapshot {
  let closed = false;
  const verify = async (): Promise<void> => {
    if (closed) invalid();
    await requireBasicCandidateHeldChild(root, "data", data);
    await requireBasicCandidateHeldChild(data, "staging", staging);
    await requireBasicCandidateHeldChild(staging, leaf.countryDirectory, leaf.country);
    await requireBasicCandidateHeldChild(leaf.country, leaf.candidate.runId, leaf.run);
    await requireBasicCandidateDirectoryEntries(leaf.run, BASIC_REVIEW_CANDIDATE_ARTIFACT_NAMES);
    for (const name of BASIC_REVIEW_CANDIDATE_ARTIFACT_NAMES) {
      const artifact = leaf.artifacts[name];
      await verifyBasicCandidateRegularFile(leaf.run, name, artifact.identity, artifact.bytes);
      if (sha256(artifact.bytes) !== artifact.sha256) invalid();
    }
  };
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    try {
      await leaf.close();
    } finally {
      await closeBasicCandidateHeldDirectories([staging, data]);
    }
  };
  return Object.freeze({
    countryDirectory: leaf.countryDirectory,
    candidate: leaf.candidate,
    artifactSha256: Object.freeze(Object.fromEntries(
      BASIC_REVIEW_CANDIDATE_ARTIFACT_NAMES.map((name) => [name, leaf.artifacts[name].sha256]),
    )) as Readonly<Record<BasicCollectionAuditArtifactName, string>>,
    verify,
    close,
  });
}

async function readArtifactSnapshot(
  run: BasicCandidateHeldDirectory,
  name: BasicCollectionAuditArtifactName,
): Promise<ArtifactSnapshot> {
  let handle: FileHandle | null = null;
  try {
    handle = await open(basicCandidateChildPath(run, name), basicCandidateReadFlags());
    const before = await handle.stat({ bigint: true });
    if (!isBoundedBasicCandidateRegularFile(before, MAX_JSON_BYTES)) invalid();
    const identity = basicCandidateRegularFileIdentity(before);
    const bytes = new Uint8Array(await handle.readFile());
    if (bytes.byteLength > MAX_JSON_BYTES || BigInt(bytes.byteLength) !== identity.size) invalid();
    const after = await handle.stat({ bigint: true });
    if (!sameBasicCandidateRegularFileIdentity(after, identity)) invalid();
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return Object.freeze({ bytes, identity, sha256: sha256(bytes), value: parseBasicStrictJsonText(text) });
  } finally {
    await closeBasicCandidateHandle(handle);
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | null)?.code;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function invalid(): never {
  throw new Error("BASIC review candidate snapshot is invalid");
}
