import { readdir } from "node:fs/promises";

import {
  requireBasicCandidateDirectoryEntries,
  requireBasicCandidateHeldChild,
  setBasicCandidateDirectoryMode,
  syncBasicCandidateDirectory,
  syncBasicCandidateParentDirectory,
  type BasicCandidateHeldDirectory,
} from "./basic-candidate-constrained-fs.js";
import { basicCandidateDirectoryPath } from "./basic-candidate-fs-paths.js";
import {
  removeBasicCandidateDirectoryNative,
  renameBasicCandidateDirectoryChildrenExchangeNative,
  unlinkBasicCandidateRegularFileNative,
} from "./basic-candidate-native-fs.js";
import {
  verifyBasicPublicationTemporaryFile,
  type BasicPublicationTemporaryFile,
} from "./basic-publication-owned-file.js";

const NAMES = Object.freeze([
  "collection-manifest.json", "country.json", "market-overview.json",
] as const);
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RECOVERY =
  /^recovery-([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;

export async function retainBasicRefreshPreviousCanonical(
  refreshCache: BasicCandidateHeldDirectory,
  transactionName: string,
  transaction: BasicCandidateHeldDirectory,
  previousCanonical: BasicCandidateHeldDirectory,
  recoveryName: string,
  recoveryPlaceholder: BasicCandidateHeldDirectory,
  verifyPreviousAt: (
    parent: BasicCandidateHeldDirectory,
    name: string,
  ) => Promise<void>,
): Promise<Readonly<{ verified: boolean }>> {
  const recoveryMatch = RECOVERY.exec(recoveryName);
  if (
    !UUID.test(transactionName) || recoveryMatch === null ||
    recoveryMatch[1] !== transactionName
  ) invalid();
  await requireBasicCandidateHeldChild(refreshCache, transactionName, transaction);
  await requireBasicCandidateHeldChild(transaction, "canonical", previousCanonical);
  await requireBasicCandidateHeldChild(refreshCache, recoveryName, recoveryPlaceholder);
  await requireBasicCandidateDirectoryEntries(transaction, ["canonical"]);
  await requireBasicCandidateDirectoryEntries(recoveryPlaceholder, []);
  await verifyPreviousAt(transaction, "canonical");
  await setBasicCandidateDirectoryMode(previousCanonical, 0o700);

  const exchange = renameBasicCandidateDirectoryChildrenExchangeNative(
    transaction.handle.fd,
    "canonical",
    refreshCache.handle.fd,
    recoveryName,
    previousCanonical.identity.dev,
    previousCanonical.identity.ino,
    recoveryPlaceholder.identity.dev,
    recoveryPlaceholder.identity.ino,
  );
  await requireBasicCandidateHeldChild(refreshCache, recoveryName, previousCanonical);
  await requireBasicCandidateHeldChild(transaction, "canonical", recoveryPlaceholder);
  await verifyPreviousAt(refreshCache, recoveryName);
  await requireBasicCandidateDirectoryEntries(recoveryPlaceholder, []);
  await requireBasicCandidateDirectoryEntries(transaction, ["canonical"]);
  await syncBasicCandidateParentDirectory(transaction);
  await syncBasicCandidateParentDirectory(refreshCache);

  removeBasicCandidateDirectoryNative(
    transaction.handle.fd,
    "canonical",
    recoveryPlaceholder.identity.dev,
    recoveryPlaceholder.identity.ino,
  );
  await requireBasicCandidateDirectoryEntries(transaction, []);
  await syncBasicCandidateParentDirectory(transaction);
  await requireBasicCandidateHeldChild(refreshCache, transactionName, transaction);
  removeBasicCandidateDirectoryNative(
    refreshCache.handle.fd,
    transactionName,
    transaction.identity.dev,
    transaction.identity.ino,
  );
  await syncBasicCandidateParentDirectory(refreshCache);
  const entries = await readdir(basicCandidateDirectoryPath(refreshCache));
  if (entries.includes(transactionName) || !entries.includes(recoveryName)) invalid();
  await verifyPreviousAt(refreshCache, recoveryName);
  return Object.freeze({ verified: exchange.verified });
}

export async function cleanupBasicRefreshUncommittedTargetTransaction(
  refreshCache: BasicCandidateHeldDirectory,
  transactionName: string,
  transaction: BasicCandidateHeldDirectory,
  canonical: BasicCandidateHeldDirectory | null,
  files: readonly BasicPublicationTemporaryFile[],
): Promise<void> {
  if (
    !UUID.test(transactionName) || files.length > NAMES.length ||
    files.some((file, index) => file.name !== NAMES[index]) ||
    (canonical === null && files.length !== 0)
  ) invalid();
  await requireBasicCandidateHeldChild(refreshCache, transactionName, transaction);
  if (canonical !== null) {
    await requireBasicCandidateHeldChild(transaction, "canonical", canonical);
    await requireBasicCandidateDirectoryEntries(canonical, files.map(({ name }) => name));
    for (const file of files) await verifyBasicPublicationTemporaryFile(canonical, file);
    await requireBasicCandidateHeldChild(transaction, "canonical", canonical);
    for (const file of files) {
      unlinkBasicCandidateRegularFileNative(
        canonical.handle.fd,
        file.name,
        file.identity.dev,
        file.identity.ino,
      );
    }
    await requireBasicCandidateDirectoryEntries(canonical, []);
    await syncBasicCandidateDirectory(canonical);
    await requireBasicCandidateHeldChild(transaction, "canonical", canonical);
    removeBasicCandidateDirectoryNative(
      transaction.handle.fd,
      "canonical",
      canonical.identity.dev,
      canonical.identity.ino,
    );
  }
  await requireBasicCandidateDirectoryEntries(transaction, []);
  await syncBasicCandidateDirectory(transaction);
  await requireBasicCandidateHeldChild(refreshCache, transactionName, transaction);
  removeBasicCandidateDirectoryNative(
    refreshCache.handle.fd,
    transactionName,
    transaction.identity.dev,
    transaction.identity.ino,
  );
  if ((await readdir(basicCandidateDirectoryPath(refreshCache))).includes(transactionName)) {
    invalid();
  }
}

function invalid(): never {
  throw new Error("basic refresh cache cleanup failed");
}
