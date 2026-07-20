import type { BigIntStats } from "node:fs";
import { open } from "node:fs/promises";

import {
  verifyBasicCandidateRegularFile,
  type BasicCandidateHeldDirectory,
  type BasicCandidateRegularFileIdentity,
} from "./basic-candidate-constrained-fs.js";
import {
  basicCandidateRegularFileIdentity,
} from "./basic-candidate-fs-identity.js";
import { closeBasicCandidateHandle } from "./basic-candidate-fs-handles.js";
import {
  basicCandidateChildPath,
  basicCandidateReadFlags,
  basicCandidateWriteFlags,
} from "./basic-candidate-fs-paths.js";

export type BasicReviewPackFileName = "index.html" | "review.json";
export type BasicReviewPackFileOperation = "write" | "sync";

export type BasicReviewPackTemporaryFile = Readonly<{
  name: BasicReviewPackFileName;
  identity: BasicCandidateRegularFileIdentity;
  content: Uint8Array | null;
}>;

type MutableTemporaryFile = {
  name: BasicReviewPackFileName;
  identity: BasicCandidateRegularFileIdentity;
  content: Uint8Array | null;
};

export async function writeBasicReviewPackOwnedFile(
  directory: BasicCandidateHeldDirectory,
  name: BasicReviewPackFileName,
  content: Uint8Array,
  registerOwned: (file: BasicReviewPackTemporaryFile) => void,
  beforeOperation?: (
    name: BasicReviewPackFileName,
    operation: BasicReviewPackFileOperation,
  ) => void | Promise<void>,
): Promise<BasicCandidateRegularFileIdentity> {
  const handle = await open(
    basicCandidateChildPath(directory, name), basicCandidateWriteFlags(), 0o600,
  );
  try {
    const created = await handle.stat({ bigint: true });
    const owned: MutableTemporaryFile = {
      name,
      identity: basicCandidateRegularFileIdentity(created),
      content: null,
    };
    registerOwned(owned);
    await handle.chmod(0o600);
    await beforeOperation?.(name, "write");
    await handle.writeFile(content);
    await beforeOperation?.(name, "sync");
    await handle.sync();
    const details = await handle.stat({ bigint: true });
    if (
      !details.isFile() || Number(details.mode & 0o777n) !== 0o600 ||
      details.size !== BigInt(content.byteLength) ||
      details.dev !== created.dev || details.ino !== created.ino
    ) invalid();
    const completedIdentity = basicCandidateRegularFileIdentity(details);
    owned.identity = completedIdentity;
    owned.content = content;
    return completedIdentity;
  } finally {
    await closeBasicCandidateHandle(handle);
  }
}

export async function verifyBasicReviewPackTemporaryFile(
  directory: BasicCandidateHeldDirectory,
  file: BasicReviewPackTemporaryFile,
): Promise<void> {
  if (file.content !== null) {
    await verifyBasicCandidateRegularFile(
      directory, file.name, file.identity, file.content,
    );
    return;
  }
  const handle = await open(
    basicCandidateChildPath(directory, file.name), basicCandidateReadFlags(),
  );
  try {
    const before = await handle.stat({ bigint: true });
    requireCreatedIdentity(before, file.identity);
    const after = await handle.stat({ bigint: true });
    requireCreatedIdentity(after, file.identity);
  } finally {
    await closeBasicCandidateHandle(handle);
  }
}

function requireCreatedIdentity(
  details: BigIntStats,
  expected: BasicCandidateRegularFileIdentity,
): void {
  const actual = basicCandidateRegularFileIdentity(details);
  if (
    actual.dev !== expected.dev || actual.ino !== expected.ino ||
    actual.nlink !== 1n || expected.nlink !== 1n || actual.type !== expected.type
  ) invalid();
}

function invalid(): never {
  throw new Error("basic review pack owned file is invalid");
}
