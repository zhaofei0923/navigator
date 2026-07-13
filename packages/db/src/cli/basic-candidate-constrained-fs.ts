import { constants } from "node:fs";
import {
  open,
  readdir,
  type FileHandle,
} from "node:fs/promises";

import {
  parseBasicCandidatePathComponent,
  parseBasicCandidateRepositoryRoot,
} from "./basic-candidate-paths.js";
import {
  closeBasicCandidateNativeDirectory,
  createBasicCandidateExclusiveDirectoryNative,
  ensureBasicCandidateDirectoryNative,
  type BasicCandidateNativeDirectory,
} from "./basic-candidate-native-fs.js";
import {
  basicCandidateDirectoryIdentity,
  basicCandidateRegularFileIdentity,
  isBoundedBasicCandidateRegularFile,
  sameBasicCandidateDirectoryIdentity,
  sameBasicCandidateRegularFileIdentity,
  sameStableBasicCandidateRegularFile,
  type BasicCandidateHeldDirectory,
  type BasicCandidateRegularFileIdentity,
} from "./basic-candidate-fs-identity.js";
import {
  closeBasicCandidateHandle,
  closeBasicCandidateHeldDirectories,
} from "./basic-candidate-fs-handles.js";
import {
  basicCandidateChildPath,
  basicCandidateDirectoryFlags,
  basicCandidateDirectoryPath,
  basicCandidateReadFlags,
  basicCandidateWriteFlags,
} from "./basic-candidate-fs-paths.js";
import {
  compareBasicCandidateText,
  sameBasicCandidateBytes,
  sameBasicCandidateStrings,
} from "./basic-candidate-values.js";

export type {
  BasicCandidateDirectoryIdentity,
  BasicCandidateHeldDirectory,
  BasicCandidateRegularFileIdentity,
} from "./basic-candidate-fs-identity.js";
export { closeBasicCandidateHeldDirectories } from "./basic-candidate-fs-handles.js";

export async function openBasicCandidateTrustedDirectory(
  value: unknown,
): Promise<BasicCandidateHeldDirectory> {
  const pathname = parseBasicCandidateRepositoryRoot(value);
  await requireDescriptorRelativeLinux();
  let directory: BasicCandidateHeldDirectory | null = null;
  try {
    directory = await openDirectory("/");
    for (const segment of pathname === "/" ? [] : pathname.split("/").slice(1)) {
      const child = await openDirectory(basicCandidateChildPath(directory, segment));
      const parent = directory;
      directory = child;
      await closeBasicCandidateHeldDirectories([parent]);
    }
    return directory;
  } catch (error) {
    await closeBasicCandidateHeldDirectories([directory]);
    throw error;
  }
}

export async function openBasicCandidateDirectoryChild(
  parent: BasicCandidateHeldDirectory,
  name: unknown,
): Promise<BasicCandidateHeldDirectory> {
  return openDirectory(basicCandidateChildPath(parent, name));
}

export async function ensureBasicCandidateDirectoryChild(
  parent: BasicCandidateHeldDirectory,
  name: unknown,
  mode: number,
): Promise<Readonly<{ directory: BasicCandidateHeldDirectory; created: boolean }>> {
  if (mode !== 0o700) invalid();
  const ensured = ensureBasicCandidateDirectoryNative(
    parent.handle.fd,
    parseBasicCandidatePathComponent(name),
  );
  const directory = await duplicateNativeDirectory(ensured);
  return Object.freeze({ directory, created: ensured.created });
}

export async function createBasicCandidateExclusiveDirectory(
  parent: BasicCandidateHeldDirectory,
  name: unknown,
  mode: number,
): Promise<BasicCandidateHeldDirectory> {
  if (mode !== 0o700) invalid();
  const component = parseBasicCandidatePathComponent(name);
  const created = createBasicCandidateExclusiveDirectoryNative(
    parent.handle.fd,
    component,
  );
  return duplicateNativeDirectory(created);
}

async function duplicateNativeDirectory(
  created: BasicCandidateNativeDirectory,
): Promise<BasicCandidateHeldDirectory> {
  let failed = false;
  let directory: BasicCandidateHeldDirectory | null = null;
  try {
    directory = await openDirectory(`/proc/self/fd/${created.fd}/`);
    if (
      directory.identity.dev !== created.dev ||
      directory.identity.ino !== created.ino
    ) invalid();
  } catch {
    failed = true;
  }
  try {
    closeBasicCandidateNativeDirectory(created);
  } catch {
    failed = true;
  }
  if (failed || directory === null) {
    try {
      await closeBasicCandidateHeldDirectories([directory]);
    } catch {
      // All close attempts already ran; expose only the fixed boundary error.
    }
    invalid();
  }
  return directory;
}

export async function setBasicCandidateDirectoryMode(
  directory: BasicCandidateHeldDirectory,
  mode: number,
): Promise<void> {
  await directory.handle.chmod(mode);
  const details = await directory.handle.stat({ bigint: true });
  if (!details.isDirectory() || Number(details.mode & 0o777n) !== mode) invalid();
}

export async function requireBasicCandidateHeldChild(
  parent: BasicCandidateHeldDirectory,
  name: unknown,
  expected: BasicCandidateHeldDirectory,
): Promise<void> {
  let probe: BasicCandidateHeldDirectory | null = null;
  try {
    probe = await openBasicCandidateDirectoryChild(parent, name);
    if (!sameBasicCandidateDirectoryIdentity(probe.identity, expected.identity)) invalid();
  } finally {
    await closeBasicCandidateHeldDirectories([probe]);
  }
}

export async function requireBasicCandidateDirectoryEntries(
  directory: BasicCandidateHeldDirectory,
  expected: readonly string[],
): Promise<void> {
  const entries = (await readdir(basicCandidateDirectoryPath(directory)))
    .sort(compareBasicCandidateText);
  const sorted = [...expected].sort(compareBasicCandidateText);
  if (!sameBasicCandidateStrings(entries, sorted)) invalid();
}

export async function writeBasicCandidateExclusiveFile(
  directory: BasicCandidateHeldDirectory,
  name: unknown,
  content: Uint8Array,
): Promise<BasicCandidateRegularFileIdentity> {
  const handle = await open(basicCandidateChildPath(directory, name), basicCandidateWriteFlags(), 0o600);
  try {
    await handle.chmod(0o600);
    await handle.writeFile(content);
    await handle.sync();
    const details = await handle.stat({ bigint: true });
    if (
      !details.isFile() || Number(details.mode & 0o777n) !== 0o600 ||
      details.size !== BigInt(content.byteLength)
    ) invalid();
    return basicCandidateRegularFileIdentity(details);
  } finally {
    await closeBasicCandidateHandle(handle);
  }
}

export async function verifyBasicCandidateRegularFile(
  directory: BasicCandidateHeldDirectory,
  name: unknown,
  expectedIdentity: BasicCandidateRegularFileIdentity,
  expectedContent: Uint8Array,
): Promise<void> {
  const handle = await open(basicCandidateChildPath(directory, name), basicCandidateReadFlags());
  try {
    const before = await handle.stat({ bigint: true });
    if (!sameBasicCandidateRegularFileIdentity(before, expectedIdentity)) invalid();
    const content = new Uint8Array(await handle.readFile());
    if (!sameBasicCandidateBytes(content, expectedContent)) invalid();
    const after = await handle.stat({ bigint: true });
    if (!sameBasicCandidateRegularFileIdentity(after, expectedIdentity)) invalid();
  } finally {
    await closeBasicCandidateHandle(handle);
  }
}

export async function readBasicCandidateBoundedRegularFile(
  directory: BasicCandidateHeldDirectory,
  name: unknown,
  maximumBytes: number,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) invalid();
  const handle = await open(basicCandidateChildPath(directory, name), basicCandidateReadFlags());
  try {
    const before = await handle.stat({ bigint: true });
    if (!isBoundedBasicCandidateRegularFile(before, maximumBytes)) invalid();
    const content = new Uint8Array(await handle.readFile());
    if (content.byteLength > maximumBytes) invalid();
    const after = await handle.stat({ bigint: true });
    if (
      !sameStableBasicCandidateRegularFile(before, after) ||
      !isBoundedBasicCandidateRegularFile(after, maximumBytes)
    ) {
      invalid();
    }
    return content;
  } finally {
    await closeBasicCandidateHandle(handle);
  }
}

export async function syncBasicCandidateDirectory(
  directory: BasicCandidateHeldDirectory,
): Promise<void> {
  await directory.handle.sync();
}

export async function syncBasicCandidateParentDirectory(
  directory: BasicCandidateHeldDirectory,
): Promise<void> {
  try {
    await syncBasicCandidateDirectory(directory);
  } catch (error) {
    if (!isExplicitUnsupportedDirectorySync(error)) throw error;
  }
}

export async function cleanupBasicCandidateTemporaryDirectory(
  parent: BasicCandidateHeldDirectory,
  name: unknown,
  temporary: BasicCandidateHeldDirectory,
): Promise<void> {
  try {
    await requireBasicCandidateHeldChild(parent, name, temporary);
    await syncBasicCandidateDirectory(temporary);
  } catch {
    // The private orphan is retained whenever the name no longer proves identity.
  }
}

async function requireDescriptorRelativeLinux(): Promise<void> {
  if (
    process.platform !== "linux" || typeof constants.O_NOFOLLOW !== "number" ||
    typeof constants.O_DIRECTORY !== "number" || typeof constants.O_EXCL !== "number" ||
    typeof constants.O_NONBLOCK !== "number"
  ) invalid();
  let descriptor: FileHandle | null = null;
  try {
    descriptor = await open("/proc/self/fd", basicCandidateDirectoryFlags());
    if (!(await descriptor.stat({ bigint: true })).isDirectory()) invalid();
  } finally {
    await closeBasicCandidateHandle(descriptor);
  }
}

async function openDirectory(pathname: string): Promise<BasicCandidateHeldDirectory> {
  let handle: FileHandle | null = null;
  try {
    handle = await open(pathname, basicCandidateDirectoryFlags());
    const details = await handle.stat({ bigint: true });
    if (!details.isDirectory()) invalid();
    return Object.freeze({ handle, identity: basicCandidateDirectoryIdentity(details) });
  } catch (error) {
    await closeBasicCandidateHandle(handle);
    throw error;
  }
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | null)?.code;
}

function isExplicitUnsupportedDirectorySync(error: unknown): boolean {
  return ["ENOTSUP", "EOPNOTSUPP"].includes(errorCode(error) ?? "");
}

function invalid(): never {
  throw new Error("basic candidate constrained filesystem is invalid");
}
