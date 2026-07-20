import { randomUUID } from "node:crypto";

import {
  closeBasicCandidateHeldDirectories,
  createBasicCandidateExclusiveDirectory,
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
import {
  writeBasicPublicationOwnedFile,
  type BasicPublicationFileName,
  type BasicPublicationTemporaryFile,
} from "./basic-publication-owned-file.js";
import { cleanupBasicPublicationTemporaryDirectory } from "./basic-publication-temp-cleanup.js";
import {
  getApprovedBasicPublicationSnapshotState,
  isApprovedBasicPublicationSnapshot,
  type ApprovedBasicPublicationSnapshot,
} from "./basic-publication-snapshot.js";

const NAMES = Object.freeze([
  "collection-manifest.json", "country.json", "market-overview.json",
] as const satisfies readonly BasicPublicationFileName[]);

export async function writeApprovedBasicPublication(
  input: ApprovedBasicPublicationSnapshot,
): Promise<Readonly<{ committed: true; postCommitVerified: boolean }>> {
  let data: BasicCandidateHeldDirectory | null = null;
  let temporary: BasicCandidateHeldDirectory | null = null;
  let temporaryName: string | null = null;
  const files: BasicPublicationTemporaryFile[] = [];
  let committed = false;
  let preCommitFailed = false;
  let postCommitVerified = true;
  try {
    if (!isApprovedBasicPublicationSnapshot(input)) throw new Error("invalid");
    const authenticated = getApprovedBasicPublicationSnapshotState(input);
    data = await openBasicCandidateDirectoryChild(authenticated.root, "data");
    await requireBasicCandidateHeldChild(authenticated.root, "data", data);
    temporaryName = `.publication-${input.countryDirectory}-${randomUUID()}.tmp`;
    temporary = await createBasicCandidateExclusiveDirectory(data, temporaryName, 0o700);
    await setBasicCandidateDirectoryMode(temporary, 0o700);
    const identities = new Map<BasicPublicationFileName, Awaited<
      ReturnType<typeof writeBasicPublicationOwnedFile>
    >>();
    for (const name of NAMES) {
      identities.set(name, await writeBasicPublicationOwnedFile(
        temporary,
        name,
        authenticated.serialized[name],
        (file) => files.push(file),
      ));
    }
    await syncBasicCandidateDirectory(temporary);
    await verifyFiles(temporary, identities, authenticated.serialized);
    await requireBasicCandidateHeldChild(data, temporaryName, temporary);
    await requireBasicCandidateHeldChild(authenticated.root, "data", data);
    await authenticated.verify();
    const renameResult = renameBasicCandidateDirectoryChildNoReplaceNative(
      data.handle.fd,
      temporaryName,
      input.countryDirectory,
      temporary.identity.dev,
      temporary.identity.ino,
    );
    committed = renameResult.committed;
    if (!renameResult.verified) postCommitVerified = false;
    await requireBasicCandidateHeldChild(data, input.countryDirectory, temporary);
    await syncBasicCandidateParentDirectory(data);
    await requireBasicCandidateHeldChild(authenticated.root, "data", data);
    await requireBasicCandidateHeldChild(data, input.countryDirectory, temporary);
    await verifyFiles(temporary, identities, authenticated.serialized);
  } catch {
    if (committed) postCommitVerified = false;
    else preCommitFailed = true;
  } finally {
    try {
      if (
        !committed && data !== null && temporary !== null &&
        temporaryName !== null
      ) {
        try {
          await cleanupBasicPublicationTemporaryDirectory(
            data,
            temporaryName,
            temporary,
            files,
          );
        } catch {
          preCommitFailed = true;
        }
      }
    } finally {
      try {
        await closeBasicCandidateHeldDirectories([temporary, data]);
      } catch {
        if (committed) postCommitVerified = false;
        else preCommitFailed = true;
      }
    }
  }
  if (!committed || preCommitFailed) {
    throw new Error("basic publication write failed");
  }
  return Object.freeze({ committed: true, postCommitVerified });
}

async function verifyFiles(
  directory: BasicCandidateHeldDirectory,
  identities: ReadonlyMap<BasicPublicationFileName, Awaited<
    ReturnType<typeof writeBasicPublicationOwnedFile>
  >>,
  serialized: Readonly<Record<BasicPublicationFileName, Uint8Array>>,
): Promise<void> {
  await requireBasicCandidateDirectoryEntries(directory, NAMES);
  for (const name of NAMES) {
    const identity = identities.get(name);
    if (identity === undefined) throw new Error("invalid");
    await verifyBasicCandidateRegularFile(
      directory,
      name,
      identity,
      serialized[name],
    );
  }
}
