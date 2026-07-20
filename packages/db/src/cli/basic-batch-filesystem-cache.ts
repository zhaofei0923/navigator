import { basename, dirname, resolve } from "node:path";

import { validateBasicBatchConfig } from "./basic-batch-config.js";
import {
  BasicBatchExpectedBlockError,
  loadOrCaptureBasicBatchSource,
} from "./basic-batch-content-cache.js";
import {
  assertContained,
  BASIC_BATCH_CACHE_ERROR,
  childPath,
  isCode,
  MissingRegularFileError,
  openSafeDirectoryHierarchy,
  readRegularFileBounded,
} from "./basic-batch-safe-files.js";

export interface BasicBatchCache {
  getOrCapture(
    sourceId: string,
    capture: () => Promise<Uint8Array>,
  ): Promise<Uint8Array>;
}

const SAFE_SOURCE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_CAPTURE_BYTES = 64 * 1024 * 1024;
const MAX_COUNTRY_INPUT_BYTES = 1024 * 1024;
const MAX_MANUAL_CAPTURE_BYTES = 4 * 1024 * 1024;
const INPUT_ERROR = "basic batch input is invalid";
const pendingByCache = new WeakMap<object, Map<string, Promise<Uint8Array>>>();

export { BasicBatchExpectedBlockError };

export function createFilesystemBasicBatchCache(
  repoRoot: string,
  batchId: string,
): BasicBatchCache {
  const validated = validateBasicBatchConfig({ countries: ["XZ"], batchId });
  const root = resolve(repoRoot, ".cache", "basic-country", "batches", validated.batchId);
  const cache = Object.freeze({
    getOrCapture(sourceId: string, capture: () => Promise<Uint8Array>): Promise<Uint8Array> {
      if (!SAFE_SOURCE_ID.test(sourceId) || typeof capture !== "function") {
        return Promise.reject(new Error(BASIC_BATCH_CACHE_ERROR));
      }
      let pending = pendingByCache.get(cache);
      if (pending === undefined) {
        pending = new Map();
        pendingByCache.set(cache, pending);
      }
      const existing = pending.get(sourceId);
      if (existing !== undefined) return existing;
      const operation = loadOrCaptureBasicBatchSource(resolve(repoRoot), root, sourceId, capture);
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
  return readOptionalInput(repoRoot, pathname, MAX_CAPTURE_BYTES);
}

export async function readBasicBatchCountryInput(
  repoRoot: string,
  pathname: string,
): Promise<Uint8Array> {
  return readInput(repoRoot, pathname, MAX_COUNTRY_INPUT_BYTES);
}

export async function readOptionalBasicBatchCountryInput(
  repoRoot: string,
  pathname: string,
): Promise<Uint8Array | null> {
  return readOptionalInput(repoRoot, pathname, MAX_COUNTRY_INPUT_BYTES);
}

export async function readOptionalBasicBatchManualInput(
  repoRoot: string,
  pathname: string,
): Promise<Uint8Array | null> {
  return readOptionalInput(repoRoot, pathname, MAX_MANUAL_CAPTURE_BYTES);
}

async function readInput(
  repoRoot: string,
  pathname: string,
  maximumBytes: number,
): Promise<Uint8Array> {
  try {
    return await readContainedInput(repoRoot, pathname, maximumBytes, false);
  } catch {
    throw new Error(INPUT_ERROR);
  }
}

async function readOptionalInput(
  repoRoot: string,
  pathname: string,
  maximumBytes: number,
): Promise<Uint8Array | null> {
  try {
    return await readContainedInput(repoRoot, pathname, maximumBytes, true);
  } catch (error) {
    if (error instanceof MissingRegularFileError || isCode(error, "ENOENT")) return null;
    throw new Error(INPUT_ERROR);
  }
}

async function readContainedInput(
  repoRoot: string,
  pathname: string,
  maximumBytes: number,
  missingAllowed: boolean,
): Promise<Uint8Array> {
  const root = resolve(repoRoot);
  const target = resolve(pathname);
  assertContained(root, target);
  const parent = await openSafeDirectoryHierarchy(root, dirname(target), false);
  try {
    return await readRegularFileBounded(
      childPath(parent, basename(target)),
      maximumBytes,
      missingAllowed,
    );
  } finally {
    await parent.close();
  }
}
