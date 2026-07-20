import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, open, unlink, type FileHandle } from "node:fs/promises";

import {
  assertContained,
  assertPrivateCacheDirectory,
  BASIC_BATCH_CACHE_ERROR,
  childPath,
  isCode,
  MissingRegularFileError,
  openOrCreateChildDirectory,
  openSafeDirectoryHierarchy,
  readRegularFileBounded,
} from "./basic-batch-safe-files.js";

const MAX_CAPTURE_BYTES = 64 * 1024 * 1024;
const MAX_REFERENCE_BYTES = 64 * 1024;

export class BasicBatchExpectedBlockError extends Error {
  constructor() {
    super("basic batch input is not configured");
    this.name = "BasicBatchExpectedBlockError";
  }
}

export async function loadOrCaptureBasicBatchSource(
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
  } catch (error) {
    if (error instanceof BasicBatchExpectedBlockError) throw error;
    throw new Error(BASIC_BATCH_CACHE_ERROR);
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

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function invalidCache(): never {
  throw new Error(BASIC_BATCH_CACHE_ERROR);
}
