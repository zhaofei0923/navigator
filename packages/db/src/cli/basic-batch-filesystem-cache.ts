import { createHash, randomUUID } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import {
  link,
  mkdir,
  open,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { validateBasicBatchConfig } from "./basic-batch-config.js";

export interface BasicBatchCache {
  getOrCapture(
    sourceId: string,
    capture: () => Promise<Uint8Array>,
  ): Promise<Uint8Array>;
}

const SAFE_SOURCE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_CAPTURE_BYTES = 64 * 1024 * 1024;
const MAX_REFERENCE_BYTES = 64 * 1024;
const MAX_COUNTRY_INPUT_BYTES = 1024 * 1024;
const CACHE_ERROR = "basic batch cache is invalid";
const INPUT_ERROR = "basic batch input is invalid";
const pendingByCache = new WeakMap<object, Map<string, Promise<Uint8Array>>>();

class MissingRegularFileError extends Error {}

export function createFilesystemBasicBatchCache(
  repoRoot: string,
  batchId: string,
): BasicBatchCache {
  const validated = validateBasicBatchConfig({ countries: ["XZ"], batchId });
  const root = resolve(repoRoot, ".cache", "basic-country", "batches", validated.batchId);
  const cache = Object.freeze({
    getOrCapture(sourceId: string, capture: () => Promise<Uint8Array>): Promise<Uint8Array> {
      if (!SAFE_SOURCE_ID.test(sourceId) || typeof capture !== "function") {
        return Promise.reject(new Error(CACHE_ERROR));
      }
      let pending = pendingByCache.get(cache);
      if (pending === undefined) {
        pending = new Map();
        pendingByCache.set(cache, pending);
      }
      const existing = pending.get(sourceId);
      if (existing !== undefined) return existing;
      const operation = loadOrCapture(resolve(repoRoot), root, sourceId, capture);
      pending.set(sourceId, operation);
      void operation.finally(() => {
        if (pending?.get(sourceId) === operation) pending.delete(sourceId);
      }).catch(() => undefined);
      return operation;
    },
  });
  return cache;
}

export async function readBasicBatchGlobalInput(
  repoRoot: string,
  pathname: string,
): Promise<Uint8Array> {
  return readInput(repoRoot, pathname, MAX_CAPTURE_BYTES);
}

export async function readOptionalBasicBatchGlobalInput(
  repoRoot: string,
  pathname: string,
): Promise<Uint8Array | null> {
  try {
    const root = resolve(repoRoot);
    const target = resolve(pathname);
    assertContained(root, target);
    const parent = await openSafeDirectoryHierarchy(root, dirname(target), false);
    try {
      return await readRegularFileBounded(
        childPath(parent, basename(target)),
        MAX_CAPTURE_BYTES,
        true,
      );
    } finally {
      await parent.close();
    }
  } catch (error) {
    if (error instanceof MissingRegularFileError) return null;
    throw new Error(INPUT_ERROR);
  }
}

export async function readBasicBatchCountryInput(
  repoRoot: string,
  pathname: string,
): Promise<Uint8Array> {
  return readInput(repoRoot, pathname, MAX_COUNTRY_INPUT_BYTES);
}

async function readInput(
  repoRoot: string,
  pathname: string,
  maximumBytes: number,
): Promise<Uint8Array> {
  try {
    const root = resolve(repoRoot);
    const target = resolve(pathname);
    assertContained(root, target);
    const parent = await openSafeDirectoryHierarchy(root, dirname(target), false);
    try {
      return await readRegularFileBounded(childPath(parent, basename(target)), maximumBytes, false);
    } finally {
      await parent.close();
    }
  } catch {
    throw new Error(INPUT_ERROR);
  }
}

async function loadOrCapture(
  repoRoot: string,
  root: string,
  sourceId: string,
  capture: () => Promise<Uint8Array>,
): Promise<Uint8Array> {
  try {
    assertContained(repoRoot, root);
    const batchDirectory = await openSafeDirectoryHierarchy(repoRoot, root, true);
    let objects: FileHandle | undefined;
    let refs: FileHandle | undefined;
    try {
      await assertPrivateCacheDirectory(batchDirectory);
      objects = await openOrCreateChildDirectory(batchDirectory, "objects");
      refs = await openOrCreateChildDirectory(batchDirectory, "refs");
      await assertPrivateCacheDirectory(objects);
      await assertPrivateCacheDirectory(refs);
      const cached = await tryLoadCached(refs, objects, sourceId);
      if (cached !== null) return cached;

      const captured = await capture();
      if (
        !(captured instanceof Uint8Array) || captured.byteLength === 0 ||
        captured.byteLength > MAX_CAPTURE_BYTES
      ) invalidCache();
      const bytes = new Uint8Array(captured);
      const digest = sha256(bytes);
      await publishImmutableFile(objects, digest, bytes, true);

      const referenceBytes = new TextEncoder().encode(`${JSON.stringify({
        sourceId,
        sha256: digest,
        byteLength: bytes.byteLength,
      })}\n`);
      const wonReference = await publishImmutableFile(
        refs,
        `${sourceId}.json`,
        referenceBytes,
        false,
      );
      if (wonReference) return bytes;

      const winner = await tryLoadCached(refs, objects, sourceId);
      if (winner === null) invalidCache();
      return winner;
    } finally {
      await Promise.all([
        batchDirectory.close(),
        objects?.close() ?? Promise.resolve(),
        refs?.close() ?? Promise.resolve(),
      ]);
    }
  } catch {
    throw new Error(CACHE_ERROR);
  }
}

async function tryLoadCached(
  refs: FileHandle,
  objects: FileHandle,
  sourceId: string,
): Promise<Uint8Array | null> {
  let refBytes: Uint8Array;
  try {
    refBytes = await readRegularFileBounded(
      childPath(refs, `${sourceId}.json`),
      MAX_REFERENCE_BYTES,
      true,
    );
  } catch (error) {
    if (error instanceof MissingRegularFileError) return null;
    throw error;
  }
  const rawReference = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(refBytes)) as unknown;
  const reference = parseReference(rawReference, sourceId);
  const bytes = await readRegularFileBounded(
    childPath(objects, reference.sha256),
    MAX_CAPTURE_BYTES,
    false,
  );
  if (bytes.byteLength !== reference.byteLength || sha256(bytes) !== reference.sha256) invalidCache();
  return bytes;
}

async function publishImmutableFile(
  directory: FileHandle,
  name: string,
  bytes: Uint8Array,
  verifyExisting: boolean,
): Promise<boolean> {
  const target = childPath(directory, name);
  const temporary = childPath(directory, `.${name}.${process.pid}.${randomUUID()}.tmp`);
  const handle = await open(
    temporary,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    let offset = 0;
    while (offset < bytes.byteLength) {
      const { bytesWritten } = await handle.write(bytes, offset, bytes.byteLength - offset, offset);
      if (bytesWritten <= 0) invalidCache();
      offset += bytesWritten;
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await link(temporary, target);
    return true;
  } catch (error) {
    if (!isCode(error, "EEXIST")) throw error;
    if (verifyExisting) {
      const existing = await readRegularFileBounded(target, bytes.byteLength, false);
      if (existing.byteLength !== bytes.byteLength || !equalBytes(existing, bytes)) invalidCache();
    }
    return false;
  } finally {
    await unlink(temporary).catch((error: unknown) => {
      if (!isCode(error, "ENOENT")) throw error;
    });
  }
}

async function openSafeDirectoryHierarchy(
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

async function openDirectory(pathname: string): Promise<FileHandle> {
  const handle = await open(
    pathname,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    const opened = await handle.stat();
    if (!opened.isDirectory()) throw new Error(CACHE_ERROR);
    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function openOrCreateChildDirectory(
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

async function assertPrivateCacheDirectory(handle: FileHandle): Promise<void> {
  const metadata = await handle.stat();
  const currentUid = typeof process.getuid === "function" ? process.getuid() : null;
  if (
    (currentUid !== null && metadata.uid !== currentUid) ||
    (metadata.mode & 0o077) !== 0
  ) throw new Error(CACHE_ERROR);
}

async function readRegularFileBounded(
  pathname: string,
  maximumBytes: number,
  missingAllowed: boolean,
): Promise<Uint8Array> {
  let handle;
  try {
    handle = await open(pathname, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (missingAllowed && isCode(error, "ENOENT")) throw new MissingRegularFileError();
    throw error;
  }
  try {
    const before = await handle.stat({ bigint: true });
    if (
      !before.isFile() || before.size <= 0n || before.size > BigInt(maximumBytes) ||
      before.size > BigInt(Number.MAX_SAFE_INTEGER)
    ) throw new Error(CACHE_ERROR);
    const bytes = new Uint8Array(Number(before.size));
    let offset = 0;
    while (offset < bytes.byteLength) {
      const result = await handle.read(bytes, offset, bytes.byteLength - offset, offset);
      if (result.bytesRead <= 0) throw new Error(CACHE_ERROR);
      offset += result.bytesRead;
    }
    const trailing = new Uint8Array(1);
    if ((await handle.read(trailing, 0, 1, offset)).bytesRead !== 0) throw new Error(CACHE_ERROR);
    const after = await handle.stat({ bigint: true });
    if (!sameFileSnapshot(before, after)) throw new Error(CACHE_ERROR);
    return bytes;
  } finally {
    await handle.close();
  }
}

function sameFileSnapshot(
  before: BigIntStats,
  after: BigIntStats,
): boolean {
  return before.dev === after.dev && before.ino === after.ino && before.size === after.size &&
    before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs;
}

function childPath(directory: FileHandle, name: string): string {
  if (name.length === 0 || name.includes("/") || name.includes("\\") || name === "." || name === "..") {
    throw new Error(CACHE_ERROR);
  }
  return `/proc/self/fd/${directory.fd}/${name}`;
}

function parseReference(value: unknown, sourceId: string) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalidCache();
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !== "byteLength,sha256,sourceId" ||
    record.sourceId !== sourceId || typeof record.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(record.sha256) || typeof record.byteLength !== "number" ||
    !Number.isSafeInteger(record.byteLength) || record.byteLength <= 0 ||
    record.byteLength > MAX_CAPTURE_BYTES
  ) invalidCache();
  return { sha256: record.sha256, byteLength: record.byteLength };
}

function assertContained(root: string, target: string): void {
  const pathFromRoot = relative(root, target);
  if (pathFromRoot === "" || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== ".." && !isAbsolute(pathFromRoot))) {
    return;
  }
  throw new Error(CACHE_ERROR);
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function invalidCache(): never {
  throw new Error(CACHE_ERROR);
}
