import type { FileHandle } from "node:fs/promises";

import type { BasicCandidateHeldDirectory } from "./basic-candidate-fs-identity.js";

export async function closeBasicCandidateHeldDirectories(
  directories: readonly (BasicCandidateHeldDirectory | null | undefined)[],
): Promise<void> {
  const seen = new Set<FileHandle>();
  let failed = false;
  for (const directory of [...directories].reverse()) {
    if (directory === null || directory === undefined || seen.has(directory.handle)) continue;
    seen.add(directory.handle);
    try {
      await closeBasicCandidateHandle(directory.handle);
    } catch {
      failed = true;
    }
  }
  if (failed) invalid();
}

export async function closeBasicCandidateHandle(handle: FileHandle | null): Promise<void> {
  try {
    await handle?.close();
  } catch {
    invalid();
  }
}

function invalid(): never {
  throw new Error("basic candidate constrained filesystem is invalid");
}
