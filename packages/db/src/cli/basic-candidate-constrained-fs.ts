import { constants, type BigIntStats } from "node:fs";
import {
  mkdir,
  open,
  readdir,
  rename,
  rmdir,
  unlink,
  type FileHandle,
} from "node:fs/promises";

import {
  parseBasicCandidatePathComponent,
  parseBasicCandidateRepositoryRoot,
} from "./basic-candidate-paths.js";

const FILE_TYPE_MASK = 0o170000n;
const REGULAR_FILE_TYPE = 0o100000n;

export type BasicCandidateDirectoryIdentity = Readonly<{
  dev: bigint;
  ino: bigint;
  type: bigint;
}>;

export type BasicCandidateRegularFileIdentity = Readonly<{
  dev: bigint;
  ino: bigint;
  type: bigint;
  mode: bigint;
  size: bigint;
  mtimeNs: bigint;
  ctimeNs: bigint;
}>;

export type BasicCandidateHeldDirectory = Readonly<{
  handle: FileHandle;
  identity: BasicCandidateDirectoryIdentity;
}>;

export async function openBasicCandidateTrustedDirectory(
  value: unknown,
): Promise<BasicCandidateHeldDirectory> {
  const pathname = parseBasicCandidateRepositoryRoot(value);
  await requireDescriptorRelativeLinux();
  let directory: BasicCandidateHeldDirectory | null = null;
  try {
    directory = await openDirectory("/");
    for (const segment of pathname === "/" ? [] : pathname.split("/").slice(1)) {
      const child = await openDirectory(childPath(directory, segment));
      await closeBasicCandidateHeldDirectories([directory]);
      directory = child;
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
  return openDirectory(childPath(parent, name));
}

export async function ensureBasicCandidateDirectoryChild(
  parent: BasicCandidateHeldDirectory,
  name: unknown,
  mode: number,
): Promise<Readonly<{ directory: BasicCandidateHeldDirectory; created: boolean }>> {
  const pathname = childPath(parent, name);
  try {
    return Object.freeze({ directory: await openDirectory(pathname), created: false });
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
  let created = false;
  try {
    await mkdir(pathname, { mode });
    created = true;
  } catch (error) {
    if (errorCode(error) !== "EEXIST") throw error;
  }
  return Object.freeze({ directory: await openDirectory(pathname), created });
}

export async function createBasicCandidateExclusiveDirectory(
  parent: BasicCandidateHeldDirectory,
  name: unknown,
  mode: number,
): Promise<BasicCandidateHeldDirectory> {
  const pathname = childPath(parent, name);
  await mkdir(pathname, { mode });
  return openDirectory(pathname);
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
    if (!sameDirectoryIdentity(probe.identity, expected.identity)) invalid();
  } finally {
    await closeBasicCandidateHeldDirectories([probe]);
  }
}

export async function requireBasicCandidateDirectoryEntries(
  directory: BasicCandidateHeldDirectory,
  expected: readonly string[],
): Promise<void> {
  const entries = (await readdir(directoryPath(directory))).sort(compareText);
  const sorted = [...expected].sort(compareText);
  if (!sameStrings(entries, sorted)) invalid();
}

export async function renameBasicCandidateDirectoryChild(
  parent: BasicCandidateHeldDirectory,
  oldName: unknown,
  newName: unknown,
): Promise<void> {
  await rename(childPath(parent, oldName), childPath(parent, newName));
}

export async function writeBasicCandidateExclusiveFile(
  directory: BasicCandidateHeldDirectory,
  name: unknown,
  content: Uint8Array,
): Promise<BasicCandidateRegularFileIdentity> {
  const handle = await open(childPath(directory, name), writeFlags(), 0o600);
  try {
    await handle.chmod(0o600);
    await handle.writeFile(content);
    await handle.sync();
    const details = await handle.stat({ bigint: true });
    if (
      !details.isFile() || Number(details.mode & 0o777n) !== 0o600 ||
      details.size !== BigInt(content.byteLength)
    ) invalid();
    return regularFileIdentity(details);
  } finally {
    await closeHandle(handle);
  }
}

export async function verifyBasicCandidateRegularFile(
  directory: BasicCandidateHeldDirectory,
  name: unknown,
  expectedIdentity: BasicCandidateRegularFileIdentity,
  expectedContent: Uint8Array,
): Promise<void> {
  const handle = await open(childPath(directory, name), readFlags());
  try {
    const before = await handle.stat({ bigint: true });
    if (!sameRegularFileIdentity(before, expectedIdentity)) invalid();
    const content = new Uint8Array(await handle.readFile());
    if (!sameBytes(content, expectedContent)) invalid();
    const after = await handle.stat({ bigint: true });
    if (!sameRegularFileIdentity(after, expectedIdentity)) invalid();
  } finally {
    await closeHandle(handle);
  }
}

export async function readBasicCandidateBoundedRegularFile(
  directory: BasicCandidateHeldDirectory,
  name: unknown,
  maximumBytes: number,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) invalid();
  const handle = await open(childPath(directory, name), readFlags());
  try {
    const before = await handle.stat({ bigint: true });
    if (!isBoundedRegularFile(before, maximumBytes)) invalid();
    const content = new Uint8Array(await handle.readFile());
    if (content.byteLength > maximumBytes) invalid();
    const after = await handle.stat({ bigint: true });
    if (!sameStableRegularFile(before, after) || !isBoundedRegularFile(after, maximumBytes)) {
      invalid();
    }
    return content;
  } finally {
    await closeHandle(handle);
  }
}

export async function syncBasicCandidateDirectory(
  directory: BasicCandidateHeldDirectory,
): Promise<void> {
  try {
    await directory.handle.sync();
  } catch (error) {
    if (!isExplicitUnsupportedDirectorySync(error)) throw error;
  }
}

export async function clearBasicCandidateFixedEntries(
  directory: BasicCandidateHeldDirectory,
  names: readonly string[],
): Promise<void> {
  for (const name of names) {
    try {
      await unlink(childPath(directory, name));
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
    }
  }
}

export async function cleanupBasicCandidateTemporaryDirectory(
  parent: BasicCandidateHeldDirectory,
  name: unknown,
  temporary: BasicCandidateHeldDirectory,
  fixedEntries: readonly string[],
): Promise<void> {
  try {
    await requireBasicCandidateHeldChild(parent, name, temporary);
    await clearBasicCandidateFixedEntries(temporary, fixedEntries);
    await syncBasicCandidateDirectory(temporary);
    await requireBasicCandidateHeldChild(parent, name, temporary);
    if ((await readdir(directoryPath(temporary))).length !== 0) return;
    await rmdir(childPath(parent, name));
    await syncBasicCandidateDirectory(parent);
  } catch {
    // A retained private temporary directory is safer than broad cleanup.
  }
}

export async function closeBasicCandidateHeldDirectories(
  directories: readonly (BasicCandidateHeldDirectory | null | undefined)[],
): Promise<void> {
  const seen = new Set<FileHandle>();
  for (const directory of [...directories].reverse()) {
    if (directory === null || directory === undefined || seen.has(directory.handle)) continue;
    seen.add(directory.handle);
    await closeHandle(directory.handle);
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
    descriptor = await open("/proc/self/fd", directoryFlags());
    if (!(await descriptor.stat({ bigint: true })).isDirectory()) invalid();
  } finally {
    await closeHandle(descriptor);
  }
}

async function openDirectory(pathname: string): Promise<BasicCandidateHeldDirectory> {
  let handle: FileHandle | null = null;
  try {
    handle = await open(pathname, directoryFlags());
    const details = await handle.stat({ bigint: true });
    if (!details.isDirectory()) invalid();
    return Object.freeze({ handle, identity: directoryIdentity(details) });
  } catch (error) {
    await closeHandle(handle);
    throw error;
  }
}

function directoryFlags(): number {
  return constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
}

function readFlags(): number {
  return constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
}

function writeFlags(): number {
  return constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW;
}

function directoryPath(directory: BasicCandidateHeldDirectory): string {
  return `/proc/self/fd/${directory.handle.fd}`;
}

function childPath(directory: BasicCandidateHeldDirectory, name: unknown): string {
  return `${directoryPath(directory)}/${parseBasicCandidatePathComponent(name)}`;
}

function directoryIdentity(details: BigIntStats): BasicCandidateDirectoryIdentity {
  if (!details.isDirectory()) invalid();
  return Object.freeze({
    dev: details.dev,
    ino: details.ino,
    type: details.mode & FILE_TYPE_MASK,
  });
}

function regularFileIdentity(details: BigIntStats): BasicCandidateRegularFileIdentity {
  if (!details.isFile()) invalid();
  return Object.freeze({
    dev: details.dev,
    ino: details.ino,
    type: details.mode & FILE_TYPE_MASK,
    mode: details.mode & 0o777n,
    size: details.size,
    mtimeNs: details.mtimeNs,
    ctimeNs: details.ctimeNs,
  });
}

function sameDirectoryIdentity(
  left: BasicCandidateDirectoryIdentity,
  right: BasicCandidateDirectoryIdentity,
): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.type === right.type;
}

function sameRegularFileIdentity(
  details: BigIntStats,
  expected: BasicCandidateRegularFileIdentity,
): boolean {
  return details.isFile() && details.dev === expected.dev && details.ino === expected.ino &&
    (details.mode & FILE_TYPE_MASK) === REGULAR_FILE_TYPE &&
    (details.mode & 0o777n) === expected.mode && details.size === expected.size &&
    details.mtimeNs === expected.mtimeNs && details.ctimeNs === expected.ctimeNs;
}

function sameStableRegularFile(left: BigIntStats, right: BigIntStats): boolean {
  return left.isFile() && right.isFile() && left.dev === right.dev &&
    left.ino === right.ino && (left.mode & FILE_TYPE_MASK) === REGULAR_FILE_TYPE &&
    (right.mode & FILE_TYPE_MASK) === REGULAR_FILE_TYPE && left.size === right.size &&
    left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}

function isBoundedRegularFile(details: BigIntStats, maximumBytes: number): boolean {
  return details.isFile() && details.size >= 0n && details.size <= BigInt(maximumBytes);
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength &&
    left.every((value, index) => value === right[index]);
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | null)?.code;
}

function isExplicitUnsupportedDirectorySync(error: unknown): boolean {
  return ["ENOTSUP", "EOPNOTSUPP"].includes(errorCode(error) ?? "");
}

async function closeHandle(handle: FileHandle | null): Promise<void> {
  await handle?.close().catch(() => undefined);
}

function invalid(): never {
  throw new Error("basic candidate constrained filesystem is invalid");
}
