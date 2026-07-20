import type { BigIntStats } from "node:fs";
import { open } from "node:fs/promises";

import {
  verifyBasicCandidateRegularFile,
  type BasicCandidateHeldDirectory,
  type BasicCandidateRegularFileIdentity,
} from "./basic-candidate-constrained-fs.js";
import { basicCandidateRegularFileIdentity } from "./basic-candidate-fs-identity.js";
import { closeBasicCandidateHandle } from "./basic-candidate-fs-handles.js";
import {
  basicCandidateChildPath,
  basicCandidateReadFlags,
  basicCandidateWriteFlags,
} from "./basic-candidate-fs-paths.js";

export type BasicPublicationFileName =
  | "collection-manifest.json"
  | "country.json"
  | "market-overview.json";
export type BasicPublicationFileOperation = "write" | "sync";

export type BasicPublicationTemporaryFile = Readonly<{
  name: BasicPublicationFileName;
  identity: BasicCandidateRegularFileIdentity;
  content: Uint8Array | null;
}>;

type MutableFile = {
  name: BasicPublicationFileName;
  identity: BasicCandidateRegularFileIdentity;
  content: Uint8Array | null;
};

export async function writeBasicPublicationOwnedFile(
  directory: BasicCandidateHeldDirectory,
  name: BasicPublicationFileName,
  content: Uint8Array,
  registerOwned: (file: BasicPublicationTemporaryFile) => void,
  beforeOperation?: (
    name: BasicPublicationFileName,
    operation: BasicPublicationFileOperation,
  ) => void | Promise<void>,
): Promise<BasicCandidateRegularFileIdentity> {
  const handle = await open(
    basicCandidateChildPath(directory, name),
    basicCandidateWriteFlags(),
    0o600,
  );
  try {
    const created = await handle.stat({ bigint: true });
    const owned: MutableFile = {
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
    const identity = basicCandidateRegularFileIdentity(details);
    owned.identity = identity;
    owned.content = content;
    return identity;
  } finally {
    await closeBasicCandidateHandle(handle);
  }
}

export async function verifyBasicPublicationTemporaryFile(
  directory: BasicCandidateHeldDirectory,
  file: BasicPublicationTemporaryFile,
): Promise<void> {
  if (file.content !== null) {
    await verifyBasicCandidateRegularFile(
      directory,
      file.name,
      file.identity,
      file.content,
    );
    return;
  }
  const handle = await open(
    basicCandidateChildPath(directory, file.name),
    basicCandidateReadFlags(),
  );
  try {
    requireCreatedIdentity(await handle.stat({ bigint: true }), file.identity);
    requireCreatedIdentity(await handle.stat({ bigint: true }), file.identity);
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
  throw new Error("basic publication owned file is invalid");
}
