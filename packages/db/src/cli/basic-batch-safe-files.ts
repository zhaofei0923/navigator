import { constants, type BigIntStats } from "node:fs";
import { mkdir, open, type FileHandle } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";

export const BASIC_BATCH_CACHE_ERROR = "basic batch cache is invalid";

export class MissingRegularFileError extends Error {}

export async function openSafeDirectoryHierarchy(
  root: string,
  targetDirectory: string,
  create: boolean,
): Promise<FileHandle> {
  assertContained(root, targetDirectory);
  let current = await openDirectory(root);
  const pathFromRoot = relative(root, targetDirectory);
  try {
    for (const part of pathFromRoot.split(sep).filter(Boolean)) {
      const nextPath = childPath(current, part);
      if (create) {
        try {
          await mkdir(nextPath, { mode: 0o700 });
        } catch (error) {
          if (!isCode(error, "EEXIST")) throw error;
        }
      }
      const next = await openDirectory(nextPath);
      await current.close();
      current = next;
    }
    return current;
  } catch (error) {
    await current.close();
    throw error;
  }
}

export async function openOrCreateChildDirectory(
  parent: FileHandle,
  name: string,
): Promise<FileHandle> {
  const pathname = childPath(parent, name);
  try {
    await mkdir(pathname, { mode: 0o700 });
  } catch (error) {
    if (!isCode(error, "EEXIST")) throw error;
  }
  return openDirectory(pathname);
}

export async function assertPrivateCacheDirectory(handle: FileHandle): Promise<void> {
  const metadata = await handle.stat();
  const currentUid = typeof process.getuid === "function" ? process.getuid() : null;
  if (
    (currentUid !== null && metadata.uid !== currentUid) ||
    (metadata.mode & 0o077) !== 0
  ) throw new Error(BASIC_BATCH_CACHE_ERROR);
}

export async function readRegularFileBounded(
  pathname: string,
  maximumBytes: number,
  missingAllowed: boolean,
): Promise<Uint8Array> {
  let handle;
  try {
    handle = await open(
      pathname,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch (error) {
    if (missingAllowed && isCode(error, "ENOENT")) throw new MissingRegularFileError();
    throw error;
  }
  try {
    const before = await handle.stat({ bigint: true });
    if (
      !before.isFile() || before.size <= 0n || before.size > BigInt(maximumBytes) ||
      before.size > BigInt(Number.MAX_SAFE_INTEGER)
    ) throw new Error(BASIC_BATCH_CACHE_ERROR);
    const bytes = new Uint8Array(Number(before.size));
    let offset = 0;
    while (offset < bytes.byteLength) {
      const result = await handle.read(bytes, offset, bytes.byteLength - offset, offset);
      if (result.bytesRead <= 0) throw new Error(BASIC_BATCH_CACHE_ERROR);
      offset += result.bytesRead;
    }
    const trailing = new Uint8Array(1);
    if ((await handle.read(trailing, 0, 1, offset)).bytesRead !== 0) {
      throw new Error(BASIC_BATCH_CACHE_ERROR);
    }
    const after = await handle.stat({ bigint: true });
    if (!sameFileSnapshot(before, after)) throw new Error(BASIC_BATCH_CACHE_ERROR);
    return bytes;
  } finally {
    await handle.close();
  }
}

export function childPath(directory: FileHandle, name: string): string {
  if (name.length === 0 || name.includes("/") || name.includes("\\") || name === "." || name === "..") {
    throw new Error(BASIC_BATCH_CACHE_ERROR);
  }
  return `/proc/self/fd/${directory.fd}/${name}`;
}

export function assertContained(root: string, target: string): void {
  const pathFromRoot = relative(root, target);
  if (
    pathFromRoot === "" ||
    (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== ".." && !isAbsolute(pathFromRoot))
  ) return;
  throw new Error(BASIC_BATCH_CACHE_ERROR);
}

export function isCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

async function openDirectory(pathname: string): Promise<FileHandle> {
  const handle = await open(
    pathname,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    const opened = await handle.stat();
    if (!opened.isDirectory()) throw new Error(BASIC_BATCH_CACHE_ERROR);
    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
}

function sameFileSnapshot(before: BigIntStats, after: BigIntStats): boolean {
  return before.dev === after.dev && before.ino === after.ino && before.size === after.size &&
    before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs;
}
