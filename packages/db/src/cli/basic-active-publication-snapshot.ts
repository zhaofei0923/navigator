import { parseBasicProfile, type BasicProfile } from "@navigator/shared-types/basic-profile";

import { BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION } from "../collection/basic-collection-v2-contracts.js";
import { BASIC_COLLECTION_AUDIT_V3_SCHEMA_VERSION } from "../collection/basic-collection-v3-contracts.js";
import { validateBasicCollectionAuditArtifactValuesVersioned } from "../collection/basic-collection-versioned-loader.js";
import type { BasicCollectionAuditArtifactName } from "../collection/basic-offline-audit-artifacts.js";
import {
  BASIC_COUNTRY_PUBLICATION_JSON_MAX_BYTES,
  BASIC_COUNTRY_PUBLICATION_MANIFEST_SCHEMA_VERSION,
  BASIC_COUNTRY_PUBLICATION_MANIFEST_V3_SCHEMA_VERSION,
} from "../collection/basic-publication-contracts.js";
import {
  parseBasicCountryPublicationManifestV2,
  parseBasicCountryPublicationManifestV3,
} from "../collection/basic-publication-parser.js";
import { validateApprovedBasicCountryPublicationV2 } from "../collection/basic-publication-validator.js";
import { validateApprovedBasicCountryPublicationV3 } from "../collection/basic-publication-validator-v3.js";
import { parseBasicStrictJsonText } from "../collection/basic-strict-json.js";
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

const CANONICAL_NAMES = Object.freeze([
  "collection-manifest.json", "country.json", "market-overview.json",
] as const satisfies readonly BasicPublicationFileName[]);
const CANDIDATE_NAMES = Object.freeze([
  "source-register.json", "extracted-facts.json",
  "market-overview.draft.json", "review-report.json",
] as const satisfies readonly BasicCollectionAuditArtifactName[]);

type FileSnapshot = Readonly<{
  bytes: Uint8Array;
  identity: BasicCandidateRegularFileIdentity;
  value: unknown;
}>;

export interface ActiveBasicPublicationSnapshot {
  readonly countryDirectory: string;
  readonly countryCode: string;
  readonly runId: string;
  readonly decidedAt: string;
  readonly close: () => Promise<void>;
}

export type ActiveBasicPublicationSnapshotState = Readonly<{
  root: BasicCandidateHeldDirectory;
  data: BasicCandidateHeldDirectory;
  canonical: BasicCandidateHeldDirectory;
  canonicalFiles: Readonly<Record<BasicPublicationFileName, FileSnapshot>>;
  profile: BasicProfile | null;
  verify: () => Promise<void>;
}>;

const AUTHENTICATED = new WeakSet<object>();
const STATES = new WeakMap<object, ActiveBasicPublicationSnapshotState>();

export function isActiveBasicPublicationSnapshot(
  value: unknown,
): value is ActiveBasicPublicationSnapshot {
  return typeof value === "object" && value !== null && AUTHENTICATED.has(value);
}

export function getActiveBasicPublicationSnapshotState(
  value: ActiveBasicPublicationSnapshot,
): ActiveBasicPublicationSnapshotState {
  const state = STATES.get(value);
  if (state === undefined) invalid();
  return Object.freeze({
    ...state,
    canonicalFiles: Object.freeze(Object.fromEntries(CANONICAL_NAMES.map((name) => [
      name,
      Object.freeze({ ...state.canonicalFiles[name], bytes: state.canonicalFiles[name].bytes.slice() }),
    ])) as Record<BasicPublicationFileName, FileSnapshot>),
  });
}

export async function locateActiveBasicPublicationSnapshot(
  root: BasicCandidateHeldDirectory,
  countryDirectory: string,
): Promise<ActiveBasicPublicationSnapshot> {
  const held: BasicCandidateHeldDirectory[] = [];
  try {
    const data = await openOwned(root, "data", held);
    const canonical = await openOwned(data, countryDirectory, held);
    await requireBasicCandidateDirectoryEntries(canonical, CANONICAL_NAMES);
    const canonicalFiles = await readFiles(canonical, CANONICAL_NAMES);
    const manifestValue = canonicalFiles["collection-manifest.json"].value;
    const version = manifestVersion(manifestValue);
    const manifest = version === BASIC_COUNTRY_PUBLICATION_MANIFEST_SCHEMA_VERSION
      ? parseBasicCountryPublicationManifestV2(manifestValue).data
      : version === BASIC_COUNTRY_PUBLICATION_MANIFEST_V3_SCHEMA_VERSION
        ? parseBasicCountryPublicationManifestV3(manifestValue).data
        : null;
    if (manifest === null) invalid();
    const runId = manifest.activeRunId;
    if (
      manifest.auditBundlePath !== `data/staging/${countryDirectory}/${runId}` ||
      manifest.approvalReceiptPath !== `data/approvals/${countryDirectory}/${runId}.json`
    ) invalid();

    const staging = await openOwned(data, "staging", held);
    const stagingCountry = await openOwned(staging, countryDirectory, held);
    const run = await openOwned(stagingCountry, runId, held);
    const approvals = await openOwned(data, "approvals", held);
    const approvalCountry = await openOwned(approvals, countryDirectory, held);
    await requireBasicCandidateDirectoryEntries(run, CANDIDATE_NAMES);
    const approval = await readFile(approvalCountry, `${runId}.json`);
    const candidateFiles = await readFiles(run, CANDIDATE_NAMES);
    const candidate = validateBasicCollectionAuditArtifactValuesVersioned(
      countryDirectory,
      runId,
      Object.fromEntries(CANDIDATE_NAMES.map((name) => [name, candidateFiles[name].value])) as
        Readonly<Record<BasicCollectionAuditArtifactName, unknown>>,
    );
    const validationInput = {
      countryDirectory,
      manifest: manifestValue,
      approvalReceipt: approval.value,
      approvalReceiptBytes: approval.bytes,
      candidate,
      candidateArtifactBytes: Object.fromEntries(
        CANDIDATE_NAMES.map((name) => [name, candidateFiles[name].bytes]),
      ),
      canonical: {
        country: canonicalFiles["country.json"].value,
        marketOverview: canonicalFiles["market-overview.json"].value,
        policy: [], risk: [], opportunities: [], projects: [], partners: [],
        chineseCompanies: [], entryStrategy: null, reports: [], knowledge: [],
      },
      canonicalArtifactNames: CANONICAL_NAMES,
    };
    const validation = version === BASIC_COUNTRY_PUBLICATION_MANIFEST_SCHEMA_VERSION &&
      candidate.sourceRegister.schemaVersion === BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION
      ? validateApprovedBasicCountryPublicationV2(validationInput)
      : version === BASIC_COUNTRY_PUBLICATION_MANIFEST_V3_SCHEMA_VERSION &&
          candidate.sourceRegister.schemaVersion === BASIC_COLLECTION_AUDIT_V3_SCHEMA_VERSION
        ? validateApprovedBasicCountryPublicationV3(validationInput)
        : null;
    if (validation === null || !validation.valid) invalid();
    const publication = validation.data;
    const profileValue = publication.canonical.marketOverview.basicProfile;
    const profile = profileValue === undefined || profileValue === null
      ? null
      : parseBasicProfile(profileValue);
    if (profileValue !== undefined && profileValue !== null && profile === null) invalid();

    const hierarchy = Object.freeze([
      [root, "data", data],
      [data, countryDirectory, canonical],
      [data, "staging", staging],
      [staging, countryDirectory, stagingCountry],
      [stagingCountry, runId, run],
      [data, "approvals", approvals],
      [approvals, countryDirectory, approvalCountry],
    ] as const);
    let closed = false;
    const verify = async (): Promise<void> => {
      try {
        if (closed) invalid();
        for (const [parent, name, child] of hierarchy) {
          await requireBasicCandidateHeldChild(parent, name, child);
        }
        await requireBasicCandidateDirectoryEntries(canonical, CANONICAL_NAMES);
        await requireBasicCandidateDirectoryEntries(run, CANDIDATE_NAMES);
        await verifyFiles(canonical, canonicalFiles, CANONICAL_NAMES);
        await verifyBasicCandidateRegularFile(
          approvalCountry, `${runId}.json`, approval.identity, approval.bytes,
        );
        await verifyFiles(run, candidateFiles, CANDIDATE_NAMES);
      } catch {
        invalid();
      }
    };
    const result: ActiveBasicPublicationSnapshot = Object.freeze({
      countryDirectory,
      countryCode: publication.approvalReceipt.countryCode,
      runId,
      decidedAt: publication.approvalReceipt.decidedAt,
      async close(): Promise<void> {
        if (closed) return;
        closed = true;
        await closeBasicCandidateHeldDirectories([...held].reverse());
      },
    });
    const state = Object.freeze({ root, data, canonical, canonicalFiles, profile, verify });
    AUTHENTICATED.add(result);
    STATES.set(result, state);
    await verify();
    return result;
  } catch {
    try {
      await closeBasicCandidateHeldDirectories([...held].reverse());
    } catch {
      // Every descriptor close was attempted; expose only the fixed snapshot boundary.
    }
    invalid();
  }
}

async function openOwned(
  parent: BasicCandidateHeldDirectory,
  name: string,
  held: BasicCandidateHeldDirectory[],
): Promise<BasicCandidateHeldDirectory> {
  const child = await openBasicCandidateDirectoryChild(parent, name);
  held.push(child);
  await requireBasicCandidateHeldChild(parent, name, child);
  return child;
}

async function readFiles<Name extends string>(
  directory: BasicCandidateHeldDirectory,
  names: readonly Name[],
): Promise<Readonly<Record<Name, FileSnapshot>>> {
  return Object.freeze(Object.fromEntries(await Promise.all(names.map(async (name) => [
    name, await readFile(directory, name),
  ]))) as Record<Name, FileSnapshot>);
}

async function readFile(
  directory: BasicCandidateHeldDirectory,
  name: string,
): Promise<FileSnapshot> {
  const snapshot = await readBasicCandidateBoundedRegularFileSnapshot(
    directory, name, BASIC_COUNTRY_PUBLICATION_JSON_MAX_BYTES,
  );
  const text = new TextDecoder("utf-8", { fatal: true }).decode(snapshot.bytes);
  return Object.freeze({ ...snapshot, value: parseBasicStrictJsonText(text) });
}

async function verifyFiles<Name extends string>(
  directory: BasicCandidateHeldDirectory,
  files: Readonly<Record<Name, FileSnapshot>>,
  names: readonly Name[],
): Promise<void> {
  for (const name of names) {
    const file = files[name];
    await verifyBasicCandidateRegularFile(directory, name, file.identity, file.bytes);
  }
}

function manifestVersion(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const descriptor = Object.getOwnPropertyDescriptor(value, "schemaVersion");
  return descriptor !== undefined && Object.hasOwn(descriptor, "value")
    ? descriptor.value
    : null;
}

function invalid(): never {
  throw new Error("active BASIC publication snapshot failed");
}
