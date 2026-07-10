import { createHash, randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, readFile, readdir, rm, stat, unlink } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

import { hasExactOwnKeys, SAFE_RUN_ID } from "../seed/basic-country-validation-utils.js";
import { BASIC_RAW_CAPTURE_MAX_BYTES, BASIC_RAW_CAPTURE_SCHEMA_VERSION, type BasicRawCaptureInput, type BasicRawCaptureManifest, type BasicSourceTransport, type BasicSourceTransportResponse } from "./basic-source-adapter-contracts.js";
import { isBasicSourceRequestAllowed, isBasicSourceResponseAllowed } from "./basic-source-transport.js";

export type { BasicRawCaptureInput } from "./basic-source-adapter-contracts.js";

export interface BasicRawCaptureResult {
  sourceId: string; contentSha256: string; byteLength: number; reused: boolean;
  body: Uint8Array; finalUrl: string; contentType: string; retrievedAt: string;
}

const SAFE_COUNTRY_CODE = /^[A-Z]{2}$/;
const SAFE_SOURCE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const PUBLICATION_RETRY_ATTEMPTS = 400;
const PUBLICATION_RETRY_MS = 5;

export async function captureBasicRawSource(input: BasicRawCaptureInput, transport: BasicSourceTransport): Promise<BasicRawCaptureResult> {
  const sourceDirectory = await prepareSourceDirectory(input);
  const cached = await readVerifiedCapture(sourceDirectory, input);
  if (cached !== null) {
    return resultFromCache(cached);
  }

  const response = await transport.execute(input.request);
  if (!isBasicSourceResponseAllowed(response, input.request)) {
    throw new Error("raw capture response is invalid");
  }
  const body = await collectBody(response.body);
  const contentSha256 = sha256(body);

  const lockPath = await acquireLock(sourceDirectory);
  try {
    const concurrentCapture = await readVerifiedCapture(sourceDirectory, input);
    if (concurrentCapture !== null) {
      if (concurrentCapture.manifest.response.contentSha256 !== contentSha256) {
        throw new Error("raw capture already exists with different content");
      }
      return resultFromCache(concurrentCapture);
    }
    const manifest = createManifest(input, response, contentSha256, body.byteLength);
    await publishCapture(sourceDirectory, manifest, body);
    return {
      sourceId: input.sourceId,
      contentSha256,
      byteLength: body.byteLength,
      reused: false,
      body,
      finalUrl: response.finalUrl,
      contentType: response.contentType,
      retrievedAt: response.retrievedAt,
    };
  } finally {
    await unlink(lockPath).catch(() => undefined);
  }
}

async function prepareSourceDirectory(input: BasicRawCaptureInput): Promise<string> {
  if (!isAbsolute(input.repoRoot) || input.repoRoot.includes("\0") || input.adapterId.trim() === "" || input.adapterVersion.trim() === "" || !SAFE_COUNTRY_CODE.test(input.countryCode) || !SAFE_RUN_ID.test(input.runId) || !SAFE_SOURCE_ID.test(input.sourceId)) {
    throw new Error("raw capture path is not allowed");
  }
  if (!isBasicSourceRequestAllowed(input.request)) {
    throw new Error("raw capture request is invalid");
  }
  const sourceDirectory = resolve(input.repoRoot, ".cache", "basic-country", input.countryCode, input.runId, "raw", input.sourceId);
  if (relative(input.repoRoot, sourceDirectory).startsWith("..")) {
    throw new Error("raw capture path is not allowed");
  }
  const rootDetails = await lstat(resolve(input.repoRoot)).catch(() => null);
  if (rootDetails?.isSymbolicLink()) {
    throw new Error("raw capture path is not allowed");
  }
  await rejectSymlinkAncestors(input.repoRoot, sourceDirectory);
  await mkdir(sourceDirectory, { recursive: true, mode: 0o700 });
  await rejectSymlinks(resolve(input.repoRoot, ".cache", "basic-country"));
  return sourceDirectory;
}

async function readVerifiedCapture(
  sourceDirectory: string,
  input: BasicRawCaptureInput,
): Promise<{ manifest: BasicRawCaptureManifest; body: Uint8Array } | null> {
  let sawUnlockedPartial = false;
  for (let attempt = 0; attempt < PUBLICATION_RETRY_ATTEMPTS; attempt += 1) {
    const entries = await readdir(sourceDirectory);
    const stableEntries = entries.filter((entry) => !entry.startsWith(".tmp-"));
    const hasManifest = stableEntries.includes("capture.json");
    if (!hasManifest) {
      if (stableEntries.length === 0) {
        return null;
      }
      if (await hasActivePublicationLock(sourceDirectory)) {
        sawUnlockedPartial = false;
        await delay(PUBLICATION_RETRY_MS);
        continue;
      }
      if (!sawUnlockedPartial) {
        sawUnlockedPartial = true;
        continue;
      }
      throw new Error("raw capture is incomplete");
    }
    const manifest = parseManifest(await readJson(join(sourceDirectory, "capture.json")));
    if (manifest === null || manifest.schemaVersion !== BASIC_RAW_CAPTURE_SCHEMA_VERSION || !matchesInput(manifest, input) || !isBasicSourceResponseAllowed(manifest.response, input.request)) {
      throw new Error("raw capture manifest is invalid");
    }
    const payloadName = `${manifest.response.contentSha256}.bin`;
    if (stableEntries.length !== 2 || !stableEntries.includes(payloadName)) {
      throw new Error("raw capture payload is invalid");
    }
    const payloadPath = join(sourceDirectory, payloadName);
    const payloadStats = await stat(payloadPath).catch(() => null);
    if (payloadStats === null || payloadStats.size !== manifest.response.byteLength || payloadStats.size > BASIC_RAW_CAPTURE_MAX_BYTES) {
      throw new Error("raw capture payload is invalid");
    }
    const body = new Uint8Array(await readFile(payloadPath).catch(() => Buffer.alloc(0)));
    if (body.byteLength !== manifest.response.byteLength || sha256(body) !== manifest.response.contentSha256) {
      throw new Error("raw capture payload is invalid");
    }
    return { manifest, body };
  }
  throw new Error("raw capture publication did not complete");
}

function resultFromCache(cached: { manifest: BasicRawCaptureManifest; body: Uint8Array }): BasicRawCaptureResult {
  const { manifest, body } = cached;
  return {
    sourceId: manifest.sourceId,
    contentSha256: manifest.response.contentSha256,
    byteLength: manifest.response.byteLength,
    reused: true,
    body,
    finalUrl: manifest.response.finalUrl,
    contentType: manifest.response.contentType,
    retrievedAt: manifest.response.retrievedAt,
  };
}

async function collectBody(body: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const hash = createHash("sha256");
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    for await (const chunk of body) {
      if (!(chunk instanceof Uint8Array)) {
        throw new Error("source response body is invalid");
      }
      byteLength += chunk.byteLength;
      if (byteLength > BASIC_RAW_CAPTURE_MAX_BYTES) {
        throw new Error("source response body exceeds the capture limit");
      }
      hash.update(chunk);
      chunks.push(chunk);
    }
  } catch (error) {
    if (isCaptureBodyError(error)) {
      throw error;
    }
    throw new Error("source response body read failed");
  }
  const captured = new Uint8Array(Buffer.concat(chunks));
  if (hash.digest("hex") !== sha256(captured)) {
    throw new Error("source response body is invalid");
  }
  return captured;
}

function createManifest(
  input: BasicRawCaptureInput,
  response: BasicSourceTransportResponse,
  contentSha256: string,
  byteLength: number,
): BasicRawCaptureManifest {
  return {
    schemaVersion: BASIC_RAW_CAPTURE_SCHEMA_VERSION,
    countryCode: input.countryCode,
    runId: input.runId,
    adapterId: input.adapterId,
    adapterVersion: input.adapterVersion,
    sourceId: input.sourceId,
    request: { ...input.request, allowedOrigins: sorted(input.request.allowedOrigins), allowedQueryParameters: sorted(input.request.allowedQueryParameters) },
    response: { status: response.status, finalUrl: response.finalUrl, redirectChain: [...response.redirectChain], contentType: response.contentType, retrievedAt: response.retrievedAt, byteLength, contentSha256 },
  };
}

async function publishCapture(sourceDirectory: string, manifest: BasicRawCaptureManifest, body: Uint8Array): Promise<void> {
  const payloadPath = join(sourceDirectory, `${manifest.response.contentSha256}.bin`);
  await publishNoClobber(payloadPath, body);
  await publishNoClobber(join(sourceDirectory, "capture.json"), Buffer.from(JSON.stringify(manifest)));
}

async function publishNoClobber(targetPath: string, content: Uint8Array): Promise<void> {
  const temporaryPath = join(resolve(targetPath, ".."), `.tmp-${randomUUID()}`);
  const file = await open(temporaryPath, "wx", 0o600);
  try {
    await file.writeFile(content);
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    await linkNoClobber(temporaryPath, targetPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function linkNoClobber(temporaryPath: string, targetPath: string): Promise<void> {
  try {
    await link(temporaryPath, targetPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error("raw capture is incomplete");
    }
    throw error;
  }
}

async function acquireLock(sourceDirectory: string): Promise<string> {
  const lockPath = join(sourceDirectory, ".tmp-capture.lock");
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      const lock = await open(lockPath, "wx", 0o600);
      await lock.close();
      return lockPath;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 5));
    }
  }
  throw new Error("raw capture lock is unavailable");
}

function matchesInput(manifest: BasicRawCaptureManifest, input: BasicRawCaptureInput): boolean {
  return manifest.countryCode === input.countryCode && manifest.runId === input.runId && manifest.sourceId === input.sourceId && manifest.adapterId === input.adapterId && manifest.adapterVersion === input.adapterVersion && manifest.request.method === input.request.method && manifest.request.url === input.request.url && manifest.request.accept === input.request.accept && sameStrings(manifest.request.allowedOrigins, sorted(input.request.allowedOrigins)) && sameStrings(manifest.request.allowedQueryParameters, sorted(input.request.allowedQueryParameters));
}

function parseManifest(value: unknown): BasicRawCaptureManifest | null {
  if (!hasExactOwnKeys(value, ["schemaVersion", "countryCode", "runId", "adapterId", "adapterVersion", "sourceId", "request", "response"])) return null;
  const request = value.request;
  const response = value.response;
  if (!hasExactOwnKeys(request, ["method", "url", "accept", "allowedOrigins", "allowedQueryParameters"]) || !hasExactOwnKeys(response, ["status", "finalUrl", "redirectChain", "contentType", "retrievedAt", "byteLength", "contentSha256"])) return null;
  const byteLength = response.byteLength;
  const contentSha256 = response.contentSha256;
  if (![value.countryCode, value.runId, value.adapterId, value.adapterVersion, value.sourceId, value.schemaVersion, request.method, request.url, request.accept, response.finalUrl, response.contentType, response.retrievedAt, response.contentSha256].every((item) => typeof item === "string")) return null;
  if (!stringArray(request.allowedOrigins) || !stringArray(request.allowedQueryParameters) || !stringArray(response.redirectChain) || !Number.isSafeInteger(response.status) || typeof byteLength !== "number" || !Number.isSafeInteger(byteLength) || byteLength < 0 || byteLength > BASIC_RAW_CAPTURE_MAX_BYTES || typeof contentSha256 !== "string" || !SHA256.test(contentSha256)) return null;
  return { schemaVersion: value.schemaVersion as typeof BASIC_RAW_CAPTURE_SCHEMA_VERSION, countryCode: value.countryCode as string, runId: value.runId as string, adapterId: value.adapterId as string, adapterVersion: value.adapterVersion as string, sourceId: value.sourceId as string, request: { method: request.method as "GET", url: request.url as string, accept: request.accept as string, allowedOrigins: [...request.allowedOrigins], allowedQueryParameters: [...request.allowedQueryParameters] }, response: { status: response.status as number, finalUrl: response.finalUrl as string, redirectChain: [...response.redirectChain], contentType: response.contentType as string, retrievedAt: response.retrievedAt as string, byteLength: response.byteLength as number, contentSha256: response.contentSha256 as string } };
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function sorted(values: readonly string[]): string[] { return [...values].sort(); }
function sameStrings(left: readonly string[], right: readonly string[]): boolean { return left.length === right.length && left.every((value, index) => value === right[index]); }
function sha256(value: Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
function isCaptureBodyError(error: unknown): error is Error { return error instanceof Error && ["source response body is invalid", "source response body exceeds the capture limit"].includes(error.message); }
function delay(milliseconds: number): Promise<void> { return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds)); }

async function hasActivePublicationLock(sourceDirectory: string): Promise<boolean> {
  const details = await lstat(join(sourceDirectory, ".tmp-capture.lock")).catch(() => null);
  if (details?.isSymbolicLink()) throw new Error("raw capture path is not allowed");
  return details?.isFile() === true;
}

async function readJson(pathname: string): Promise<unknown> {
  try { return JSON.parse(await readFile(pathname, "utf8")) as unknown; } catch { throw new Error("raw capture manifest is invalid"); }
}

async function rejectSymlinkAncestors(root: string, target: string): Promise<void> {
  let current = root;
  const segments = relative(root, target).split("/");
  for (const segment of segments) {
    current = join(current, segment);
    const details = await lstat(current).catch(() => null);
    if (details?.isSymbolicLink()) throw new Error("raw capture path is not allowed");
  }
}

async function rejectSymlinks(directory: string): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) throw new Error("raw capture path is not allowed");
    if (entry.isDirectory()) await rejectSymlinks(join(directory, entry.name));
  }
}
