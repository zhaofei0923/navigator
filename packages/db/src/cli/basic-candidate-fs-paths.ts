import { constants } from "node:fs";

import { parseBasicCandidatePathComponent } from "./basic-candidate-paths.js";
import type { BasicCandidateHeldDirectory } from "./basic-candidate-fs-identity.js";

export function basicCandidateDirectoryFlags(): number {
  return constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
}

export function basicCandidateReadFlags(): number {
  return constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
}

export function basicCandidateWriteFlags(): number {
  return constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW;
}

export function basicCandidateDirectoryPath(
  directory: BasicCandidateHeldDirectory,
): string {
  return `/proc/self/fd/${directory.handle.fd}`;
}

export function basicCandidateChildPath(
  directory: BasicCandidateHeldDirectory,
  name: unknown,
): string {
  return `${basicCandidateDirectoryPath(directory)}/${parseBasicCandidatePathComponent(name)}`;
}
