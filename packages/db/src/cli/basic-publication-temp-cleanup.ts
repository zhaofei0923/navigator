import { readdir } from "node:fs/promises";

import {
  requireBasicCandidateDirectoryEntries,
  requireBasicCandidateHeldChild,
  syncBasicCandidateDirectory,
  type BasicCandidateHeldDirectory,
} from "./basic-candidate-constrained-fs.js";
import { basicCandidateDirectoryPath } from "./basic-candidate-fs-paths.js";
import {
  removeBasicCandidateDirectoryNative,
  unlinkBasicCandidateRegularFileNative,
} from "./basic-candidate-native-fs.js";
import {
  verifyBasicPublicationTemporaryFile,
  type BasicPublicationTemporaryFile,
} from "./basic-publication-owned-file.js";

const EXPECTED_NAMES = Object.freeze([
  "collection-manifest.json", "country.json", "market-overview.json",
] as const);
const TEMPORARY_NAME =
  /^\.publication-[a-z0-9]+(?:-[a-z0-9]+)*-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/;

export async function cleanupBasicPublicationTemporaryDirectory(
  parent: BasicCandidateHeldDirectory,
  temporaryName: string,
  temporary: BasicCandidateHeldDirectory,
  files: readonly BasicPublicationTemporaryFile[],
): Promise<void> {
  if (
    !TEMPORARY_NAME.test(temporaryName) || files.length > EXPECTED_NAMES.length ||
    files.some((file, index) => file.name !== EXPECTED_NAMES[index])
  ) invalid();
  await requireBasicCandidateHeldChild(parent, temporaryName, temporary);
  await requireBasicCandidateDirectoryEntries(temporary, files.map(({ name }) => name));
  for (const file of files) await verifyBasicPublicationTemporaryFile(temporary, file);
  await requireBasicCandidateHeldChild(parent, temporaryName, temporary);
  for (const file of files) {
    unlinkBasicCandidateRegularFileNative(
      temporary.handle.fd,
      file.name,
      file.identity.dev,
      file.identity.ino,
    );
  }
  await requireBasicCandidateDirectoryEntries(temporary, []);
  await syncBasicCandidateDirectory(temporary);
  await requireBasicCandidateHeldChild(parent, temporaryName, temporary);
  removeBasicCandidateDirectoryNative(
    parent.handle.fd,
    temporaryName,
    temporary.identity.dev,
    temporary.identity.ino,
  );
  if ((await readdir(basicCandidateDirectoryPath(parent))).includes(temporaryName)) invalid();
}

function invalid(): never {
  throw new Error("basic publication temporary cleanup failed");
}
