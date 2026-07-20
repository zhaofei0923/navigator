import { readdir } from "node:fs/promises";

import {
  requireBasicCandidateDirectoryEntries,
  requireBasicCandidateHeldChild,
  syncBasicCandidateDirectory,
  verifyBasicCandidateRegularFile,
  type BasicCandidateHeldDirectory,
  type BasicCandidateRegularFileIdentity,
} from "./basic-candidate-constrained-fs.js";
import { basicCandidateDirectoryPath } from "./basic-candidate-fs-paths.js";
import {
  removeBasicCandidateDirectoryNative,
  unlinkBasicCandidateRegularFileNative,
} from "./basic-candidate-native-fs.js";

export type BasicReviewPackTemporaryFile = Readonly<{
  name: "index.html" | "review.json";
  identity: BasicCandidateRegularFileIdentity;
  content: Uint8Array;
}>;

const EXPECTED_NAMES = Object.freeze(["index.html", "review.json"] as const);
const PRIVATE_TEMPORARY_NAME =
  /^\.review-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/;

export function isBasicReviewPackTemporaryName(value: unknown): value is string {
  return typeof value === "string" && PRIVATE_TEMPORARY_NAME.test(value);
}

export async function cleanupBasicReviewPackTemporaryDirectory(
  parent: BasicCandidateHeldDirectory,
  temporaryName: string,
  temporary: BasicCandidateHeldDirectory,
  files: readonly BasicReviewPackTemporaryFile[],
): Promise<void> {
  if (
    !isBasicReviewPackTemporaryName(temporaryName) ||
    files.length > EXPECTED_NAMES.length ||
    files.some((file, index) => file.name !== EXPECTED_NAMES[index])
  ) invalid();

  await requireBasicCandidateHeldChild(parent, temporaryName, temporary);
  await requireBasicCandidateDirectoryEntries(
    temporary, files.map(({ name }) => name),
  );
  for (const file of files) {
    await verifyBasicCandidateRegularFile(
      temporary, file.name, file.identity, file.content,
    );
  }
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
  await requireBasicCandidateDirectoryEntries(temporary, []);
  const parentEntries = await readdir(basicCandidateDirectoryPath(parent));
  if (parentEntries.includes(temporaryName)) invalid();
}

function invalid(): never {
  throw new Error("basic review pack temporary cleanup failed");
}
