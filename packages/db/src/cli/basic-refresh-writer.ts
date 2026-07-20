import { randomUUID } from "node:crypto";

import { BASIC_COUNTRY_PUBLICATION_JSON_MAX_BYTES } from "../collection/basic-publication-contracts.js";
import { parseBasicStrictJsonText } from "../collection/basic-strict-json.js";

import {
  closeBasicCandidateHeldDirectories,
  createBasicCandidateExclusiveDirectory,
  ensureBasicCandidateDirectoryChild,
  openBasicCandidateDirectoryChild,
  readBasicCandidateBoundedRegularFileSnapshot,
  requireBasicCandidateDirectoryEntries,
  requireBasicCandidateHeldChild,
  setBasicCandidateDirectoryMode,
  syncBasicCandidateDirectory,
  syncBasicCandidateParentDirectory,
  verifyBasicCandidateRegularFile,
  type BasicCandidateHeldDirectory,
  type BasicCandidateRegularFileIdentity,
} from "./basic-candidate-constrained-fs.js";
import { renameBasicCandidateDirectoryChildrenExchangeNative } from "./basic-candidate-native-fs.js";
import {
  getActiveBasicPublicationSnapshotState,
  isActiveBasicPublicationSnapshot,
  type ActiveBasicPublicationSnapshot,
} from "./basic-active-publication-snapshot.js";
import {
  getApprovedBasicPublicationSnapshotState,
  isApprovedBasicPublicationSnapshot,
  type ApprovedBasicPublicationSnapshot,
} from "./basic-publication-snapshot.js";
import {
  writeBasicPublicationOwnedFile,
  type BasicPublicationFileName,
  type BasicPublicationTemporaryFile,
} from "./basic-publication-owned-file.js";
import {
  cleanupBasicRefreshUncommittedTargetTransaction,
  retainBasicRefreshPreviousCanonical,
} from "./basic-refresh-cache-cleanup.js";

const NAMES = Object.freeze([
  "collection-manifest.json", "country.json", "market-overview.json",
] as const satisfies readonly BasicPublicationFileName[]);

export async function writeRefreshedBasicPublication(
  active: ActiveBasicPublicationSnapshot,
  target: ApprovedBasicPublicationSnapshot,
): Promise<Readonly<{ committed: true; postCommitVerified: boolean }>> {
  let data: BasicCandidateHeldDirectory | null = null;
  let cache: BasicCandidateHeldDirectory | null = null;
  let refreshCache: BasicCandidateHeldDirectory | null = null;
  let transaction: BasicCandidateHeldDirectory | null = null;
  let canonical: BasicCandidateHeldDirectory | null = null;
  let recovery: BasicCandidateHeldDirectory | null = null;
  let transactionName: string | null = null;
  let recoveryName: string | null = null;
  const targetFiles: BasicPublicationTemporaryFile[] = [];
  let committed = false;
  let preCommitFailed = false;
  let postCommitVerified = true;
  try {
    if (
      !isActiveBasicPublicationSnapshot(active) ||
      !isApprovedBasicPublicationSnapshot(target)
    ) invalid();
    const activeState = getActiveBasicPublicationSnapshotState(active);
    const targetState = getApprovedBasicPublicationSnapshotState(target);
    requireSameRoot(activeState.root, targetState.root);

    data = await openBasicCandidateDirectoryChild(activeState.root, "data");
    await requireBasicCandidateHeldChild(activeState.root, "data", data);
    const ensuredCache = await ensureBasicCandidateDirectoryChild(
      activeState.root, ".cache", 0o700,
    );
    cache = ensuredCache.directory;
    await setBasicCandidateDirectoryMode(cache, 0o700);
    await requireBasicCandidateHeldChild(activeState.root, ".cache", cache);
    const ensuredRefreshCache = await ensureBasicCandidateDirectoryChild(
      cache, "basic-country-refresh", 0o700,
    );
    refreshCache = ensuredRefreshCache.directory;
    await setBasicCandidateDirectoryMode(refreshCache, 0o700);
    await requireBasicCandidateHeldChild(cache, "basic-country-refresh", refreshCache);
    transactionName = randomUUID();
    transaction = await createBasicCandidateExclusiveDirectory(
      refreshCache, transactionName, 0o700,
    );
    await setBasicCandidateDirectoryMode(transaction, 0o700);
    canonical = await createBasicCandidateExclusiveDirectory(
      transaction, "canonical", 0o700,
    );
    await setBasicCandidateDirectoryMode(canonical, 0o700);

    const identities = new Map<BasicPublicationFileName, Awaited<
      ReturnType<typeof writeBasicPublicationOwnedFile>
    >>();
    for (const name of NAMES) {
      identities.set(name, await writeBasicPublicationOwnedFile(
        canonical,
        name,
        targetState.serialized[name],
        (file) => targetFiles.push(file),
      ));
    }
    await syncBasicCandidateDirectory(canonical);
    if (
      active.countryDirectory !== target.countryDirectory ||
      active.countryCode !== target.countryCode ||
      active.runId === target.runId ||
      !isStrictlyNewer(target.decidedAt, active.decidedAt)
    ) invalid();
    await requireBasicCandidateHeldChild(activeState.root, "data", data);
    await requireBasicCandidateHeldChild(activeState.root, ".cache", cache);
    await requireBasicCandidateHeldChild(cache, "basic-country-refresh", refreshCache);
    await requireBasicCandidateHeldChild(refreshCache, transactionName, transaction);
    await requireBasicCandidateHeldChild(data, active.countryDirectory, activeState.canonical);
    await requireBasicCandidateHeldChild(transaction, "canonical", canonical);
    await validateMaterializedTarget(
      canonical,
      identities,
      targetState.serialized,
      targetState.validateMaterialized,
    );
    await activeState.verify();
    await targetState.verify();

    const exchange = renameBasicCandidateDirectoryChildrenExchangeNative(
      transaction.handle.fd,
      "canonical",
      data.handle.fd,
      active.countryDirectory,
      canonical.identity.dev,
      canonical.identity.ino,
      activeState.canonical.identity.dev,
      activeState.canonical.identity.ino,
    );
    committed = exchange.committed;
    await setBasicCandidateDirectoryMode(activeState.canonical, 0o700);
    await syncBasicCandidateDirectory(activeState.canonical);
    if (!exchange.verified) postCommitVerified = false;

    await requireBasicCandidateHeldChild(data, active.countryDirectory, canonical);
    await requireBasicCandidateHeldChild(transaction, "canonical", activeState.canonical);
    await requireBasicCandidateHeldChild(activeState.root, "data", data);
    await requireBasicCandidateHeldChild(activeState.root, ".cache", cache);
    await requireBasicCandidateHeldChild(cache, "basic-country-refresh", refreshCache);
    await requireBasicCandidateHeldChild(refreshCache, transactionName, transaction);
    await verifyTargetFiles(canonical, identities, targetState.serialized);
    await activeState.verifyCanonicalAt(transaction, "canonical");
    await syncBasicCandidateParentDirectory(data);
    await syncBasicCandidateParentDirectory(transaction);

    recoveryName = `recovery-${transactionName}`;
    recovery = await createBasicCandidateExclusiveDirectory(
      refreshCache,
      recoveryName,
      0o700,
    );
    await setBasicCandidateDirectoryMode(recovery, 0o700);
    const retention = await retainBasicRefreshPreviousCanonical(
      refreshCache,
      transactionName,
      transaction,
      activeState.canonical,
      recoveryName,
      recovery,
      activeState.verifyCanonicalAt,
    );
    if (!retention.verified) postCommitVerified = false;
  } catch {
    if (committed) postCommitVerified = false;
    else preCommitFailed = true;
  } finally {
    if (
      !committed && refreshCache !== null && transactionName !== null &&
      transaction !== null
    ) {
      try {
        await cleanupBasicRefreshUncommittedTargetTransaction(
          refreshCache, transactionName, transaction, canonical, targetFiles,
        );
      } catch {
        preCommitFailed = true;
      }
    }
    try {
      await closeBasicCandidateHeldDirectories([
        recovery, canonical, transaction, refreshCache, cache, data,
      ]);
    } catch {
      if (committed) postCommitVerified = false;
      else preCommitFailed = true;
    }
  }
  if (!committed || preCommitFailed) throw new Error("basic refresh write failed");
  return Object.freeze({ committed: true, postCommitVerified });
}

async function verifyTargetFiles(
  directory: BasicCandidateHeldDirectory,
  identities: ReadonlyMap<BasicPublicationFileName, Awaited<
    ReturnType<typeof writeBasicPublicationOwnedFile>
  >>,
  serialized: Readonly<Record<BasicPublicationFileName, Uint8Array>>,
): Promise<void> {
  await requireBasicCandidateDirectoryEntries(directory, NAMES);
  for (const name of NAMES) {
    const identity = identities.get(name);
    if (identity === undefined) invalid();
    await verifyBasicCandidateRegularFile(directory, name, identity, serialized[name]);
  }
}

async function validateMaterializedTarget(
  directory: BasicCandidateHeldDirectory,
  identities: ReadonlyMap<BasicPublicationFileName, BasicCandidateRegularFileIdentity>,
  serialized: Readonly<Record<BasicPublicationFileName, Uint8Array>>,
  validate: (input: Readonly<{
    manifest: unknown;
    country: unknown;
    marketOverview: unknown;
  }>) => void,
): Promise<void> {
  await requireBasicCandidateDirectoryEntries(directory, NAMES);
  const values = {} as Record<BasicPublicationFileName, unknown>;
  for (const name of NAMES) {
    const expected = identities.get(name);
    if (expected === undefined) invalid();
    const snapshot = await readBasicCandidateBoundedRegularFileSnapshot(
      directory,
      name,
      BASIC_COUNTRY_PUBLICATION_JSON_MAX_BYTES,
    );
    if (!sameRegularFileIdentity(snapshot.identity, expected)) invalid();
    const text = new TextDecoder("utf-8", { fatal: true }).decode(snapshot.bytes);
    values[name] = parseBasicStrictJsonText(text);
  }
  validate({
    manifest: values["collection-manifest.json"],
    country: values["country.json"],
    marketOverview: values["market-overview.json"],
  });
  await verifyTargetFiles(directory, identities, serialized);
}

function sameRegularFileIdentity(
  left: BasicCandidateRegularFileIdentity,
  right: BasicCandidateRegularFileIdentity,
): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.nlink === right.nlink &&
    left.type === right.type && left.mode === right.mode && left.size === right.size &&
    left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}

function requireSameRoot(
  left: BasicCandidateHeldDirectory,
  right: BasicCandidateHeldDirectory,
): void {
  if (
    left.identity.dev !== right.identity.dev ||
    left.identity.ino !== right.identity.ino ||
    left.identity.type !== right.identity.type
  ) invalid();
}

function isStrictlyNewer(target: string, active: string): boolean {
  const targetTime = Date.parse(target);
  const activeTime = Date.parse(active);
  return Number.isFinite(targetTime) && Number.isFinite(activeTime) && targetTime > activeTime;
}

function invalid(): never {
  throw new Error("basic refresh write failed");
}
