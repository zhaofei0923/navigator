import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import {
  createBasicRawCaptureManifestV2,
  parseBasicRawCaptureManifestV2,
  snapshotBasicRawCaptureInputV2,
  snapshotBasicSourceTransportResponseV2,
} from "./basic-source-metadata-v2.js";
import {
  isBasicSourceRequestAllowedV2,
  isBasicSourceResponseAllowedV2,
} from "./basic-source-transport-v2.js";
import {
  BASIC_RAW_CAPTURE_MAX_BYTES_V2,
  type BasicRawCaptureInputV2,
  type BasicRawCaptureManifestV2,
  type BasicRawCaptureResultV2,
  type BasicSourceTransportResponseV2,
  type BasicSourceTransportV2,
} from "./basic-source-v2-contracts.js";

export type {
  BasicRawCaptureInputV2,
  BasicRawCaptureResultV2,
} from "./basic-source-v2-contracts.js";

type CapturePathsV2 = {
  basicCountryRoot: string;
  rawDirectory: string;
  sourceDirectory: string;
};
type VerifiedCaptureV2 = {
  manifest: BasicRawCaptureManifestV2;
  body: Uint8Array;
};
const STABLE_CAPTURE_ERRORS = new Set([
  "raw capture input is invalid",
  "raw capture path is not allowed",
  "raw capture request is invalid",
  "raw capture is incomplete",
  "raw capture manifest is invalid",
  "raw capture manifest metadata is invalid",
  "raw capture payload is invalid",
  "raw capture transport failed",
  "raw capture response is invalid",
  "raw capture publication failed",
  "raw capture already exists with different content",
  "source response body is invalid",
  "source response body exceeds the capture limit",
  "source response body read failed",
]);

export async function captureBasicRawSourceV2(
  value: BasicRawCaptureInputV2,
  transport: BasicSourceTransportV2,
): Promise<BasicRawCaptureResultV2> {
  try {
    return await captureBasicRawSourceV2Internal(value, transport);
  } catch (error) {
    const message = error instanceof Error &&
      STABLE_CAPTURE_ERRORS.has(error.message)
      ? error.message
      : "raw capture operation failed";
    throw new Error(message);
  }
}

async function captureBasicRawSourceV2Internal(
  value: BasicRawCaptureInputV2,
  transport: BasicSourceTransportV2,
): Promise<BasicRawCaptureResultV2> {
  const input = snapshotCaptureInput(value);
  validateCaptureInput(input);
  const paths = capturePaths(input);
  await prepareRawDirectory(input.repoRoot, paths);
  const cached = await readVerifiedCapture(paths.sourceDirectory, input);
  if (cached !== null) return resultFromCache(cached);

  let transportResponse: BasicSourceTransportResponseV2;
  try {
    transportResponse = await transport.execute(input.request);
  } catch {
    throw new Error("raw capture transport failed");
  }
  const response = snapshotBasicSourceTransportResponseV2(transportResponse);
  if (!isBasicSourceResponseAllowedV2(response, input.request)) {
    throw new Error("raw capture response is invalid");
  }
  const body = await collectBody(response.body);
  const contentSha256 = sha256(body);
  const manifest = createBasicRawCaptureManifestV2(
    input,
    response,
    contentSha256,
    body.byteLength,
  );
  if (!(await publishCapture(
    paths.rawDirectory,
    paths.sourceDirectory,
    manifest,
    body,
  ))) {
    const winner = await readVerifiedCapture(paths.sourceDirectory, input);
    if (winner === null) throw new Error("raw capture publication failed");
    if (winner.manifest.response.contentSha256 !== contentSha256) {
      throw new Error("raw capture already exists with different content");
    }
    return resultFromCache(winner);
  }
  return captureResult(input.sourceId, response, body, contentSha256, false);
}

function snapshotCaptureInput(value: unknown): BasicRawCaptureInputV2 {
  try {
    return snapshotBasicRawCaptureInputV2(value);
  } catch {
    throw new Error("raw capture input is invalid");
  }
}

function validateCaptureInput(input: BasicRawCaptureInputV2): void {
  if (
    !isAbsolute(input.repoRoot) ||
    input.repoRoot.includes("\0")
  ) throw new Error("raw capture path is not allowed");
  if (!isBasicSourceRequestAllowedV2(input.request)) {
    throw new Error("raw capture request is invalid");
  }
}

function capturePaths(input: BasicRawCaptureInputV2): CapturePathsV2 {
  const basicCountryRoot = resolve(input.repoRoot, ".cache", "basic-country");
  const rawDirectory = resolve(
    basicCountryRoot,
    input.countryCode,
    input.runId,
    "raw-v2",
  );
  const sourceDirectory = resolve(rawDirectory, input.sourceId);
  const relativeSource = relative(input.repoRoot, sourceDirectory);
  if (
    relativeSource === ".." ||
    relativeSource.startsWith(`..${sep}`) ||
    isAbsolute(relativeSource)
  ) throw new Error("raw capture path is not allowed");
  return { basicCountryRoot, rawDirectory, sourceDirectory };
}

async function prepareRawDirectory(
  repoRoot: string,
  paths: CapturePathsV2,
): Promise<void> {
  const rootDetails = await lstat(repoRoot).catch(() => null);
  if (rootDetails === null || rootDetails.isSymbolicLink()) {
    throw new Error("raw capture path is not allowed");
  }
  await rejectSymlinkAncestors(repoRoot, paths.rawDirectory);
  await mkdir(paths.rawDirectory, { recursive: true, mode: 0o700 });
  await rejectSymlinks(paths.basicCountryRoot);
}

async function readVerifiedCapture(
  sourceDirectory: string,
  input: BasicRawCaptureInputV2,
): Promise<VerifiedCaptureV2 | null> {
  const sourceDetails = await lstat(sourceDirectory).catch((error: unknown) => {
    if (errorCode(error) === "ENOENT") return null;
    throw new Error("raw capture is incomplete");
  });
  if (sourceDetails === null) return null;
  if (sourceDetails.isSymbolicLink()) {
    throw new Error("raw capture path is not allowed");
  }
  if (!sourceDetails.isDirectory()) throw new Error("raw capture is incomplete");
  const entries = await readdir(sourceDirectory);
  if (!entries.includes("capture.json")) {
    throw new Error("raw capture is incomplete");
  }
  const manifestPath = join(sourceDirectory, "capture.json");
  await requireRegularFile(manifestPath, "raw capture manifest is invalid");
  const manifest = parseBasicRawCaptureManifestV2(await readJson(manifestPath));
  if (
    manifest === null ||
    !matchesInput(manifest, input) ||
    !isBasicSourceResponseAllowedV2(manifest.response, input.request)
  ) throw new Error("raw capture manifest is invalid");
  const payloadName = `${manifest.response.contentSha256}.bin`;
  if (entries.length !== 2 || !entries.includes(payloadName)) {
    throw new Error("raw capture payload is invalid");
  }
  const payloadPath = join(sourceDirectory, payloadName);
  const details = await requireRegularFile(
    payloadPath,
    "raw capture payload is invalid",
  );
  if (
    details.size !== manifest.response.byteLength ||
    details.size > BASIC_RAW_CAPTURE_MAX_BYTES_V2
  ) throw new Error("raw capture payload is invalid");
  let body: Uint8Array;
  try {
    body = new Uint8Array(await readFile(payloadPath));
  } catch {
    throw new Error("raw capture payload is invalid");
  }
  if (
    body.byteLength !== manifest.response.byteLength ||
    sha256(body) !== manifest.response.contentSha256
  ) throw new Error("raw capture payload is invalid");
  return { manifest, body };
}

async function publishCapture(
  rawDirectory: string,
  sourceDirectory: string,
  manifest: BasicRawCaptureManifestV2,
  body: Uint8Array,
): Promise<boolean> {
  const temporaryDirectory = join(
    rawDirectory,
    `.tmp-${manifest.sourceId}-${randomUUID()}`,
  );
  await mkdir(temporaryDirectory, { mode: 0o700 });
  let published = false;
  try {
    await writeSyncedFile(
      join(temporaryDirectory, `${manifest.response.contentSha256}.bin`),
      body,
    );
    await writeSyncedFile(
      join(temporaryDirectory, "capture.json"),
      Buffer.from(JSON.stringify(manifest)),
    );
    await syncDirectoryIfSupported(temporaryDirectory);
    try {
      await rename(temporaryDirectory, sourceDirectory);
      published = true;
      return true;
    } catch (error) {
      if (isPublicationConflict(error)) return false;
      throw new Error("raw capture publication failed");
    }
  } finally {
    if (!published) {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }
}

async function writeSyncedFile(
  pathname: string,
  content: Uint8Array,
): Promise<void> {
  const file = await open(pathname, "wx", 0o600);
  try {
    await file.writeFile(content);
    await file.sync();
  } finally {
    await file.close();
  }
}

async function syncDirectoryIfSupported(pathname: string): Promise<void> {
  let directory: Awaited<ReturnType<typeof open>> | undefined;
  try {
    directory = await open(pathname, "r");
    await directory.sync();
  } catch (error) {
    if (!isUnsupportedDirectorySync(error)) {
      throw new Error("raw capture publication failed");
    }
  } finally {
    await directory?.close().catch(() => undefined);
  }
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
      const snapshot = new Uint8Array(chunk);
      byteLength += snapshot.byteLength;
      if (byteLength > BASIC_RAW_CAPTURE_MAX_BYTES_V2) {
        throw new Error("source response body exceeds the capture limit");
      }
      hash.update(snapshot);
      chunks.push(snapshot);
    }
  } catch (error) {
    if (isCaptureBodyError(error)) throw error;
    throw new Error("source response body read failed");
  }
  const captured = new Uint8Array(Buffer.concat(chunks));
  if (hash.digest("hex") !== sha256(captured)) {
    throw new Error("source response body is invalid");
  }
  return captured;
}

function captureResult(
  sourceId: string,
  response: Pick<
    BasicSourceTransportResponseV2,
    "finalUrl" | "contentType" | "retrievedAt" | "redirectChain"
  >,
  body: Uint8Array,
  contentSha256: string,
  reused: boolean,
): BasicRawCaptureResultV2 {
  return Object.freeze({
    sourceId,
    contentSha256,
    byteLength: body.byteLength,
    reused,
    body,
    finalUrl: response.finalUrl,
    redirectChain: Object.freeze(Array.from(response.redirectChain)),
    contentType: response.contentType,
    retrievedAt: response.retrievedAt,
  });
}

function resultFromCache(
  capture: VerifiedCaptureV2,
): BasicRawCaptureResultV2 {
  return captureResult(
    capture.manifest.sourceId,
    capture.manifest.response,
    capture.body,
    capture.manifest.response.contentSha256,
    true,
  );
}

function matchesInput(
  manifest: BasicRawCaptureManifestV2,
  input: BasicRawCaptureInputV2,
): boolean {
  return manifest.countryCode === input.countryCode &&
    manifest.runId === input.runId &&
    manifest.catalogVersion === input.catalogVersion &&
    manifest.catalogSha256 === input.catalogSha256 &&
    manifest.sourceId === input.sourceId &&
    manifest.adapterId === input.adapterId &&
    manifest.adapterVersion === input.adapterVersion &&
    manifest.request.method === input.request.method &&
    manifest.request.url === input.request.url &&
    manifest.request.accept === input.request.accept &&
    sameStrings(
      manifest.request.allowedOrigins,
      input.request.allowedOrigins,
    ) &&
    sameStrings(
      manifest.request.allowedQueryParameters,
      input.request.allowedQueryParameters,
    );
}

async function readJson(pathname: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(pathname, "utf8")) as unknown;
  } catch {
    throw new Error("raw capture manifest is invalid");
  }
}

async function requireRegularFile(pathname: string, message: string) {
  const details = await lstat(pathname).catch(() => null);
  if (
    details === null ||
    details.isSymbolicLink() ||
    !details.isFile()
  ) throw new Error(message);
  return details;
}

async function rejectSymlinkAncestors(
  root: string,
  target: string,
): Promise<void> {
  let current = root;
  for (const segment of relative(root, target).split(sep)) {
    current = join(current, segment);
    if ((await lstat(current).catch(() => null))?.isSymbolicLink()) {
      throw new Error("raw capture path is not allowed");
    }
  }
}

async function rejectSymlinks(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) {
      throw new Error("raw capture path is not allowed");
    }
    if (entry.isDirectory()) await rejectSymlinks(join(directory, entry.name));
  }
}

function sameStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | null)?.code;
}

function isPublicationConflict(error: unknown): boolean {
  return ["EEXIST", "ENOTEMPTY"].includes(errorCode(error) ?? "");
}

function isUnsupportedDirectorySync(error: unknown): boolean {
  return ["EBADF", "EINVAL", "EISDIR", "ENOTSUP", "EPERM"].includes(
    errorCode(error) ?? "",
  );
}

function isCaptureBodyError(error: unknown): error is Error {
  return error instanceof Error && [
    "source response body is invalid",
    "source response body exceeds the capture limit",
  ].includes(error.message);
}
