import { randomUUID } from "node:crypto";

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
import { cleanupBasicRefreshTransaction } from "./basic-refresh-cache-cleanup.js";

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
  let transactionName: string | null = null;
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
    await verifyTargetFiles(canonical, identities, targetState.serialized);
    await requireBasicCandidateHeldChild(transaction, "canonical", canonical);
    await requireBasicCandidateHeldChild(refreshCache, transactionName, transaction);

    await activeState.verify();
    await targetState.verify();
    if (
      active.countryDirectory !== target.countryDirectory ||
      active.countryCode !== target.countryCode ||
      active.runId === target.runId ||
      !isStrictlyNewer(target.decidedAt, active.decidedAt)
    ) invalid();
    await requireBasicCandidateHeldChild(activeState.root, "data", data);
    await requireBasicCandidateHeldChild(data, active.countryDirectory, activeState.canonical);
    await requireBasicCandidateHeldChild(transaction, "canonical", canonical);

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
    if (!exchange.verified) postCommitVerified = false;

    await requireBasicCandidateHeldChild(data, active.countryDirectory, canonical);
    await requireBasicCandidateHeldChild(transaction, "canonical", activeState.canonical);
    await requireBasicCandidateHeldChild(activeState.root, "data", data);
    await requireBasicCandidateHeldChild(activeState.root, ".cache", cache);
    await requireBasicCandidateHeldChild(cache, "basic-country-refresh", refreshCache);
    await requireBasicCandidateHeldChild(refreshCache, transactionName, transaction);
    await verifyTargetFiles(canonical, identities, targetState.serialized);
    await verifyActiveFiles(activeState.canonical, activeState.canonicalFiles);
    await syncBasicCandidateParentDirectory(data);
    await syncBasicCandidateParentDirectory(transaction);

    await cleanupBasicRefreshTransaction(
      refreshCache,
      transactionName,
      transaction,
      activeState.canonical,
      NAMES.map((name) => Object.freeze({
        name,
        identity: activeState.canonicalFiles[name].identity,
        content: activeState.canonicalFiles[name].bytes,
      })),
    );
    await syncBasicCandidateParentDirectory(refreshCache);
  } catch {
    if (committed) postCommitVerified = false;
    else preCommitFailed = true;
  } finally {
    if (
      !committed && refreshCache !== null && transactionName !== null &&
      transaction !== null
    ) {
      try {
        await cleanupBasicRefreshTransaction(
          refreshCache, transactionName, transaction, canonical, targetFiles,
        );
      } catch {
        preCommitFailed = true;
      }
    }
    try {
      await closeBasicCandidateHeldDirectories([
        canonical, transaction, refreshCache, cache, data,
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

async function verifyActiveFiles(
  directory: BasicCandidateHeldDirectory,
  files: ReturnType<typeof getActiveBasicPublicationSnapshotState>["canonicalFiles"],
): Promise<void> {
  await requireBasicCandidateDirectoryEntries(directory, NAMES);
  for (const name of NAMES) {
    const file = files[name];
    await verifyBasicCandidateRegularFile(directory, name, file.identity, file.bytes);
  }
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
