import { parseBasicStrictJsonText } from "../collection/basic-strict-json.js";
import { validateBasicCollectionAuditArtifactValuesVersioned } from "../collection/basic-collection-versioned-loader.js";
import type { BasicCollectionAuditBundleV3 } from "../collection/basic-collection-v3-contracts.js";
import { BASIC_COLLECTION_AUDIT_V3_SCHEMA_VERSION } from "../collection/basic-collection-v3-contracts.js";
import type { BasicCollectionAuditArtifactName } from "../collection/basic-offline-audit-artifacts.js";
import {
  BASIC_COUNTRY_CANONICAL_MAPPING_V3_VERSION,
  BASIC_COUNTRY_PUBLICATION_JSON_MAX_BYTES,
  BASIC_COUNTRY_PUBLICATION_MANIFEST_V3_SCHEMA_VERSION,
  type BasicCountryPublicationApprovalReceipt,
  type BasicCountryPublicationManifestV3,
} from "../collection/basic-publication-contracts.js";
import { sha256Hex } from "../collection/basic-publication-digests.js";
import { materializeBasicCanonicalFromApprovedCandidateV3 } from "../collection/basic-publication-materializer-v3.js";
import { parseBasicCountryPublicationApproval } from "../collection/basic-publication-parser.js";
import { validateApprovedBasicCountryPublicationV3 } from "../collection/basic-publication-validator-v3.js";
import {
  closeBasicCandidateHeldDirectories,
  openBasicCandidateDirectoryChild,
  readBasicCandidateBoundedRegularFileSnapshot,
  requireBasicCandidateDirectoryEntries,
  requireBasicCandidateHeldChild,
  verifyBasicCandidateRegularFile,
  type BasicCandidateHeldDirectory,
  type BasicCandidateRegularFileIdentity,
} from "./basic-candidate-constrained-fs.js";
import type { BasicPublicationFileName } from "./basic-publication-owned-file.js";

const CANDIDATE_NAMES = Object.freeze([
  "source-register.json", "extracted-facts.json",
  "market-overview.draft.json", "review-report.json",
] as const satisfies readonly BasicCollectionAuditArtifactName[]);
const CANONICAL_NAMES = Object.freeze([
  "collection-manifest.json", "country.json", "market-overview.json",
] as const satisfies readonly BasicPublicationFileName[]);

type Snapshot = Readonly<{
  identity: BasicCandidateRegularFileIdentity;
  bytes: Uint8Array;
  value: unknown;
}>;

export interface ApprovedBasicPublicationSnapshot {
  readonly countryDirectory: string;
  readonly countryCode: string;
  readonly runId: string;
  readonly decidedAt: string;
  readonly close: () => Promise<void>;
}

const AUTHENTICATED_SNAPSHOTS = new WeakSet<object>();
const SNAPSHOT_STATES = new WeakMap<object, Readonly<{
  root: BasicCandidateHeldDirectory;
  serialized: Readonly<Record<BasicPublicationFileName, Uint8Array>>;
  verify: () => Promise<void>;
}>>();

export function isApprovedBasicPublicationSnapshot(
  value: unknown,
): value is ApprovedBasicPublicationSnapshot {
  return typeof value === "object" && value !== null &&
    AUTHENTICATED_SNAPSHOTS.has(value);
}

export function getApprovedBasicPublicationSnapshotState(
  value: ApprovedBasicPublicationSnapshot,
): Readonly<{
  root: BasicCandidateHeldDirectory;
  serialized: Readonly<Record<BasicPublicationFileName, Uint8Array>>;
  verify: () => Promise<void>;
}> {
  const state = SNAPSHOT_STATES.get(value);
  if (state === undefined) invalid();
  return Object.freeze({
    root: state.root,
    serialized: Object.freeze(Object.fromEntries(CANONICAL_NAMES.map((name) => [
      name,
      state.serialized[name].slice(),
    ])) as Record<BasicPublicationFileName, Uint8Array>),
    verify: state.verify,
  });
}

export async function locateApprovedBasicPublicationSnapshot(
  root: BasicCandidateHeldDirectory,
  input: Readonly<{
    countryDirectory: string;
    countryCode: string;
    runId: string;
  }>,
): Promise<ApprovedBasicPublicationSnapshot> {
  const held: BasicCandidateHeldDirectory[] = [];
  try {
    const data = await openChild(root, "data", held);
    const approvals = await openChild(data, "approvals", held);
    const approvalCountry = await openChild(approvals, input.countryDirectory, held);
    const staging = await openChild(data, "staging", held);
    const stagingCountry = await openChild(staging, input.countryDirectory, held);
    const candidateDirectory = await openChild(stagingCountry, input.runId, held);
    await requireBasicCandidateDirectoryEntries(candidateDirectory, CANDIDATE_NAMES);

    const receipt = await readSnapshot(approvalCountry, `${input.runId}.json`);
    const receiptParsed = parseBasicCountryPublicationApproval(receipt.value);
    if (receiptParsed.data === null) invalid();
    const approval = receiptParsed.data;
    if (
      approval.countryDirectory !== input.countryDirectory ||
      approval.countryCode !== input.countryCode || approval.runId !== input.runId
    ) invalid();

    const candidateSnapshots = {} as Record<BasicCollectionAuditArtifactName, Snapshot>;
    for (const name of CANDIDATE_NAMES) {
      candidateSnapshots[name] = await readSnapshot(candidateDirectory, name);
    }
    const candidateValues = Object.fromEntries(CANDIDATE_NAMES.map((name) => [
      name,
      candidateSnapshots[name].value,
    ])) as Readonly<Record<BasicCollectionAuditArtifactName, unknown>>;
    const candidate = validateBasicCollectionAuditArtifactValuesVersioned(
      input.countryDirectory,
      input.runId,
      candidateValues,
    );
    if (
      candidate.sourceRegister.schemaVersion !== BASIC_COLLECTION_AUDIT_V3_SCHEMA_VERSION
    ) invalid();
    const v3Candidate = candidate as BasicCollectionAuditBundleV3;
    const candidateArtifactBytes = Object.fromEntries(CANDIDATE_NAMES.map((name) => [
      name,
      candidateSnapshots[name].bytes,
    ])) as Readonly<Record<BasicCollectionAuditArtifactName, Uint8Array>>;
    const manifest: BasicCountryPublicationManifestV3 = {
      schemaVersion: BASIC_COUNTRY_PUBLICATION_MANIFEST_V3_SCHEMA_VERSION,
      activeRunId: input.runId,
      mappingVersion: BASIC_COUNTRY_CANONICAL_MAPPING_V3_VERSION,
      auditBundlePath:
        `data/staging/${input.countryDirectory}/${input.runId}`,
      approvalReceiptPath:
        `data/approvals/${input.countryDirectory}/${input.runId}.json`,
      approvalReceiptSha256: sha256Hex(receipt.bytes),
    };
    const canonical = materializeBasicCanonicalFromApprovedCandidateV3(
      v3Candidate,
      manifest,
    );
    const validation = validateApprovedBasicCountryPublicationV3({
      countryDirectory: input.countryDirectory,
      manifest,
      approvalReceipt: approval,
      approvalReceiptBytes: receipt.bytes,
      candidate: v3Candidate,
      candidateArtifactBytes,
      canonical,
      canonicalArtifactNames: CANONICAL_NAMES,
    });
    if (!validation.valid) invalid();

    const serialized = Object.freeze({
      "collection-manifest.json": encode(manifest),
      "country.json": encode(canonical.country),
      "market-overview.json": encode(canonical.marketOverview),
    });
    let closed = false;
    const verify = async () => {
      if (closed) invalid();
      await requireHierarchy(root, held, input);
      await requireBasicCandidateDirectoryEntries(candidateDirectory, CANDIDATE_NAMES);
      await verifyBasicCandidateRegularFile(
        approvalCountry,
        `${input.runId}.json`,
        receipt.identity,
        receipt.bytes,
      );
      for (const name of CANDIDATE_NAMES) {
        const snapshot = candidateSnapshots[name];
        await verifyBasicCandidateRegularFile(
          candidateDirectory,
          name,
          snapshot.identity,
          snapshot.bytes,
        );
      }
    };
    const result: ApprovedBasicPublicationSnapshot = Object.freeze({
      countryDirectory: input.countryDirectory,
      countryCode: input.countryCode,
      runId: input.runId,
      decidedAt: approval.decidedAt,
      async close() {
        if (closed) return;
        closed = true;
        await closeBasicCandidateHeldDirectories(held);
      },
    });
    AUTHENTICATED_SNAPSHOTS.add(result);
    SNAPSHOT_STATES.set(result, Object.freeze({ root, serialized, verify }));
    return result;
  } catch {
    await closeBasicCandidateHeldDirectories(held);
    throw new Error("basic publication snapshot failed");
  }
}

async function openChild(
  parent: BasicCandidateHeldDirectory,
  name: string,
  held: BasicCandidateHeldDirectory[],
): Promise<BasicCandidateHeldDirectory> {
  const child = await openBasicCandidateDirectoryChild(parent, name);
  held.push(child);
  await requireBasicCandidateHeldChild(parent, name, child);
  return child;
}

async function readSnapshot(
  directory: BasicCandidateHeldDirectory,
  name: string,
): Promise<Snapshot> {
  const snapshot = await readBasicCandidateBoundedRegularFileSnapshot(
    directory,
    name,
    BASIC_COUNTRY_PUBLICATION_JSON_MAX_BYTES,
  );
  const text = new TextDecoder("utf-8", { fatal: true }).decode(snapshot.bytes);
  return Object.freeze({
    ...snapshot,
    value: parseBasicStrictJsonText(text),
  });
}

async function requireHierarchy(
  root: BasicCandidateHeldDirectory,
  held: readonly BasicCandidateHeldDirectory[],
  input: Readonly<{ countryDirectory: string; runId: string }>,
): Promise<void> {
  const names = [
    "data", "approvals", input.countryDirectory,
    "staging", input.countryDirectory, input.runId,
  ] as const;
  const parentIndexes = [-1, 0, 1, 0, 3, 4] as const;
  for (let index = 0; index < names.length; index += 1) {
    const parentIndex = parentIndexes[index]!;
    await requireBasicCandidateHeldChild(
      parentIndex === -1 ? root : held[parentIndex]!,
      names[index]!,
      held[index]!,
    );
  }
}

function encode(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value)}\n`);
}

function invalid(): never {
  throw new Error("basic publication snapshot failed");
}
