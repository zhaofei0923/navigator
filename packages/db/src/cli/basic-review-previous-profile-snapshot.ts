import { parseBasicProfile, type BasicProfile } from "@navigator/shared-types/basic-profile";

import { BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION } from "../collection/basic-collection-v2-contracts.js";
import { validateBasicCollectionAuditArtifactValuesVersioned } from "../collection/basic-collection-versioned-loader.js";
import type { BasicCollectionAuditArtifactName } from "../collection/basic-offline-audit-artifacts.js";
import {
  BASIC_COUNTRY_PUBLICATION_JSON_MAX_BYTES,
} from "../collection/basic-publication-contracts.js";
import { parseBasicCountryPublicationManifestV2 } from "../collection/basic-publication-parser.js";
import { validateApprovedBasicCountryPublicationV2 } from "../collection/basic-publication-validator.js";
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

const CANONICAL_NAMES = Object.freeze([
  "collection-manifest.json", "country.json", "market-overview.json",
] as const);
const CANDIDATE_NAMES = Object.freeze([
  "source-register.json",
  "extracted-facts.json",
  "market-overview.draft.json",
  "review-report.json",
] as const satisfies readonly BasicCollectionAuditArtifactName[]);

type FileSnapshot = Readonly<{
  bytes: Uint8Array;
  identity: BasicCandidateRegularFileIdentity;
  value: unknown;
}>;

export interface BasicReviewPreviousProfileSnapshot {
  readonly profile: BasicProfile | null;
  readonly verify: () => Promise<void>;
  readonly close: () => Promise<void>;
}

export async function snapshotBasicReviewPreviousProfile(
  root: BasicCandidateHeldDirectory,
  countryDirectory: string,
): Promise<BasicReviewPreviousProfileSnapshot> {
  let data: BasicCandidateHeldDirectory | null = null;
  let country: BasicCandidateHeldDirectory | null = null;
  try {
    data = await openBasicCandidateDirectoryChild(root, "data");
    try {
      country = await openBasicCandidateDirectoryChild(data, countryDirectory);
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
      const heldData = data;
      data = null;
      return absentSnapshot(root, heldData, countryDirectory);
    }
    const snapshot = await presentSnapshot(root, data, country, countryDirectory);
    data = null;
    country = null;
    return snapshot;
  } catch {
    invalid();
  } finally {
    await closeBasicCandidateHeldDirectories([country, data]);
  }
}

async function presentSnapshot(
  root: BasicCandidateHeldDirectory,
  data: BasicCandidateHeldDirectory,
  country: BasicCandidateHeldDirectory,
  countryDirectory: string,
): Promise<BasicReviewPreviousProfileSnapshot> {
  const owned: BasicCandidateHeldDirectory[] = [data, country];
  try {
    await requireBasicCandidateDirectoryEntries(country, CANONICAL_NAMES);
    const manifest = await readJson(country, "collection-manifest.json");
    const parsedManifest = parseBasicCountryPublicationManifestV2(manifest.value).data;
    if (parsedManifest === null) invalid();
    const runId = parsedManifest.activeRunId;
    if (
      parsedManifest.auditBundlePath !== `data/staging/${countryDirectory}/${runId}` ||
      parsedManifest.approvalReceiptPath !==
        `data/approvals/${countryDirectory}/${runId}.json`
    ) invalid();

    const staging = await openOwned(data, "staging", owned);
    const stagingCountry = await openOwned(staging, countryDirectory, owned);
    const run = await openOwned(stagingCountry, runId, owned);
    const approvals = await openOwned(data, "approvals", owned);
    const approvalCountry = await openOwned(approvals, countryDirectory, owned);
    await requireBasicCandidateDirectoryEntries(run, CANDIDATE_NAMES);

    const canonicalCountry = await readJson(country, "country.json");
    const canonicalMarket = await readJson(country, "market-overview.json");
    const approval = await readJson(approvalCountry, `${runId}.json`);
    const candidateFiles = Object.fromEntries(await Promise.all(
      CANDIDATE_NAMES.map(async (name) => [name, await readJson(run, name)] as const),
    )) as Readonly<Record<BasicCollectionAuditArtifactName, FileSnapshot>>;
    const candidate = validateBasicCollectionAuditArtifactValuesVersioned(
      countryDirectory,
      runId,
      Object.fromEntries(CANDIDATE_NAMES.map((name) => [name, candidateFiles[name].value])) as
        Readonly<Record<BasicCollectionAuditArtifactName, unknown>>,
    );
    if (candidate.sourceRegister.schemaVersion !== BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION) {
      invalid();
    }
    const result = validateApprovedBasicCountryPublicationV2({
      countryDirectory,
      manifest: manifest.value,
      approvalReceipt: approval.value,
      approvalReceiptBytes: approval.bytes,
      candidate,
      candidateArtifactBytes: Object.fromEntries(
        CANDIDATE_NAMES.map((name) => [name, candidateFiles[name].bytes]),
      ),
      canonical: {
        country: canonicalCountry.value,
        marketOverview: canonicalMarket.value,
        policy: [], risk: [], opportunities: [], projects: [], partners: [],
        chineseCompanies: [], entryStrategy: null, reports: [], knowledge: [],
      },
      canonicalArtifactNames: CANONICAL_NAMES,
    });
    if (!result.valid) invalid();
    const value = result.data.canonical.marketOverview.basicProfile;
    const profile = value === undefined || value === null ? null : parseBasicProfile(value);
    if (value !== undefined && value !== null && profile === null) invalid();

    const files = Object.freeze([
      [country, "collection-manifest.json", manifest],
      [country, "country.json", canonicalCountry],
      [country, "market-overview.json", canonicalMarket],
      [approvalCountry, `${runId}.json`, approval],
      ...CANDIDATE_NAMES.map((name) => [run, name, candidateFiles[name]] as const),
    ] as const);
    let closed = false;
    const verify = async (): Promise<void> => {
      try {
        if (closed) invalid();
        await requireBasicCandidateHeldChild(root, "data", data);
        await requireBasicCandidateHeldChild(data, countryDirectory, country);
        await requireBasicCandidateHeldChild(data, "staging", staging);
        await requireBasicCandidateHeldChild(staging, countryDirectory, stagingCountry);
        await requireBasicCandidateHeldChild(stagingCountry, runId, run);
        await requireBasicCandidateHeldChild(data, "approvals", approvals);
        await requireBasicCandidateHeldChild(approvals, countryDirectory, approvalCountry);
        await requireBasicCandidateDirectoryEntries(country, CANONICAL_NAMES);
        await requireBasicCandidateDirectoryEntries(run, CANDIDATE_NAMES);
        for (const [directory, name, file] of files) {
          await verifyBasicCandidateRegularFile(directory, name, file.identity, file.bytes);
        }
      } catch {
        invalid();
      }
    };
    const close = async (): Promise<void> => {
      if (closed) return;
      closed = true;
      await closeBasicCandidateHeldDirectories([...owned].reverse());
    };
    const snapshot = Object.freeze({ profile, verify, close });
    await snapshot.verify();
    return snapshot;
  } catch {
    await closeBasicCandidateHeldDirectories([...owned].reverse());
    invalid();
  }
}

function absentSnapshot(
  root: BasicCandidateHeldDirectory,
  data: BasicCandidateHeldDirectory,
  countryDirectory: string,
): BasicReviewPreviousProfileSnapshot {
  let closed = false;
  return Object.freeze({
    profile: null,
    async verify(): Promise<void> {
      try {
        if (closed) invalid();
        await requireBasicCandidateHeldChild(root, "data", data);
        let probe: BasicCandidateHeldDirectory | null = null;
        try {
          probe = await openBasicCandidateDirectoryChild(data, countryDirectory);
        } catch (error) {
          if (errorCode(error) === "ENOENT") return;
          invalid();
        } finally {
          await closeBasicCandidateHeldDirectories([probe]);
        }
        invalid();
      } catch {
        invalid();
      }
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await closeBasicCandidateHeldDirectories([data]);
    },
  });
}

async function openOwned(
  parent: BasicCandidateHeldDirectory,
  name: string,
  owned: BasicCandidateHeldDirectory[],
): Promise<BasicCandidateHeldDirectory> {
  const directory = await openBasicCandidateDirectoryChild(parent, name);
  owned.push(directory);
  return directory;
}

async function readJson(
  directory: BasicCandidateHeldDirectory,
  name: string,
): Promise<FileSnapshot> {
  const snapshot = await readBasicCandidateBoundedRegularFileSnapshot(
    directory,
    name,
    BASIC_COUNTRY_PUBLICATION_JSON_MAX_BYTES,
  );
  const text = new TextDecoder("utf-8", { fatal: true }).decode(snapshot.bytes);
  return Object.freeze({ ...snapshot, value: parseBasicStrictJsonText(text) });
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | null)?.code;
}

function invalid(): never {
  throw new Error("previous BASIC publication snapshot is invalid");
}
