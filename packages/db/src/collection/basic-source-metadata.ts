import { expectUtcRfc3339Timestamp } from "../seed/basic-country-validation-utils.js";
import {
  BASIC_RAW_CAPTURE_MAX_BYTES,
  BASIC_RAW_CAPTURE_SCHEMA_VERSION,
  type BasicRawCaptureInput,
  type BasicRawCaptureManifest,
  type BasicSourceRequest,
  type BasicSourceTransportResponse,
} from "./basic-source-adapter-contracts.js";

const REQUEST_KEYS = ["method", "url", "accept", "allowedOrigins", "allowedQueryParameters"] as const;
const CAPTURE_INPUT_KEYS = ["repoRoot", "countryCode", "runId", "adapterId", "adapterVersion", "sourceId", "request"] as const;
const TRANSPORT_RESPONSE_KEYS = ["status", "finalUrl", "contentType", "retrievedAt", "redirectChain", "body"] as const;
const MANIFEST_KEYS = ["schemaVersion", "countryCode", "runId", "adapterId", "adapterVersion", "sourceId", "request", "response"] as const;
const MANIFEST_RESPONSE_KEYS = ["status", "finalUrl", "redirectChain", "contentType", "retrievedAt", "byteLength", "contentSha256"] as const;
const SHA256 = /^[a-f0-9]{64}$/;

export function snapshotBasicSourceRequest(value: unknown): BasicSourceRequest {
  const properties = exactDataProperties(value, REQUEST_KEYS);
  const method = properties?.get("method");
  const url = properties?.get("url");
  const accept = properties?.get("accept");
  const allowedOrigins = snapshotDenseStringArray(
    properties?.get("allowedOrigins"),
  );
  const allowedQueryParameters = snapshotDenseStringArray(
    properties?.get("allowedQueryParameters"),
  );
  if (
    method !== "GET" ||
    typeof url !== "string" ||
    typeof accept !== "string" ||
    allowedOrigins === null ||
    allowedQueryParameters === null
  ) {
    throw new Error("basic source request metadata is invalid");
  }
  return Object.freeze({ method, url, accept, allowedOrigins, allowedQueryParameters });
}

export function snapshotBasicRawCaptureInput(
  value: unknown,
): BasicRawCaptureInput {
  const properties = exactDataProperties(value, CAPTURE_INPUT_KEYS);
  if (properties === null) {
    throw new Error("raw capture input is invalid");
  }
  const repoRoot = properties.get("repoRoot");
  const countryCode = properties.get("countryCode");
  const runId = properties.get("runId");
  const adapterId = properties.get("adapterId");
  const adapterVersion = properties.get("adapterVersion");
  const sourceId = properties.get("sourceId");
  if (![
    repoRoot, countryCode, runId, adapterId, adapterVersion, sourceId,
  ].every((item) => typeof item === "string")) {
    throw new Error("raw capture input is invalid");
  }
  let request: BasicSourceRequest;
  try {
    request = snapshotBasicSourceRequest(properties.get("request"));
  } catch {
    throw new Error("raw capture request is invalid");
  }
  return Object.freeze({
    repoRoot: repoRoot as string, countryCode: countryCode as string,
    runId: runId as string, adapterId: adapterId as string,
    adapterVersion: adapterVersion as string, sourceId: sourceId as string, request,
  });
}

export function snapshotBasicSourceTransportResponse(
  value: unknown,
): BasicSourceTransportResponse {
  const properties = exactDataProperties(value, TRANSPORT_RESPONSE_KEYS);
  const status = properties?.get("status");
  const finalUrl = properties?.get("finalUrl");
  const contentType = properties?.get("contentType");
  const retrievedAt = properties?.get("retrievedAt");
  const redirectChain = snapshotDenseStringArray(
    properties?.get("redirectChain"),
  );
  if (
    !Number.isSafeInteger(status) ||
    typeof finalUrl !== "string" ||
    typeof contentType !== "string" ||
    !isUtcRfc3339Timestamp(retrievedAt) ||
    redirectChain === null ||
    properties === null
  ) {
    throw new Error("raw capture response is invalid");
  }
  return Object.freeze({
    status: status as number, finalUrl, contentType, retrievedAt, redirectChain,
    body: properties.get("body") as AsyncIterable<Uint8Array>,
  });
}

export function createBasicRawCaptureManifest(
  input: BasicRawCaptureInput,
  response: BasicSourceTransportResponse,
  contentSha256: string,
  byteLength: number,
): BasicRawCaptureManifest {
  const request = Object.freeze({
    method: input.request.method,
    url: input.request.url,
    accept: input.request.accept,
    allowedOrigins: sortedSnapshot(input.request.allowedOrigins),
    allowedQueryParameters: sortedSnapshot(input.request.allowedQueryParameters),
  });
  const responseMetadata = Object.freeze({
    status: response.status,
    finalUrl: response.finalUrl,
    redirectChain: Object.freeze(Array.from(response.redirectChain)),
    contentType: response.contentType,
    retrievedAt: response.retrievedAt,
    byteLength,
    contentSha256,
  });
  return Object.freeze({
    schemaVersion: BASIC_RAW_CAPTURE_SCHEMA_VERSION,
    countryCode: input.countryCode,
    runId: input.runId,
    adapterId: input.adapterId,
    adapterVersion: input.adapterVersion,
    sourceId: input.sourceId,
    request,
    response: responseMetadata,
  });
}

export function parseBasicRawCaptureManifest(
  value: unknown,
): BasicRawCaptureManifest | null {
  const manifest = exactDataProperties(value, MANIFEST_KEYS);
  const request = exactDataProperties(manifest?.get("request"), REQUEST_KEYS);
  const response = exactDataProperties(
    manifest?.get("response"),
    MANIFEST_RESPONSE_KEYS,
  );
  if (manifest === null || request === null || response === null) return null;
  const allowedOrigins = snapshotDenseStringArray(request.get("allowedOrigins"));
  const allowedQueryParameters = snapshotDenseStringArray(
    request.get("allowedQueryParameters"),
  );
  const redirectChain = snapshotDenseStringArray(response.get("redirectChain"));
  const byteLength = response.get("byteLength");
  const status = response.get("status");
  const retrievedAt = response.get("retrievedAt");
  const contentSha256 = response.get("contentSha256");
  const strings = [
    manifest.get("countryCode"), manifest.get("runId"), manifest.get("adapterId"),
    manifest.get("adapterVersion"), manifest.get("sourceId"), request.get("url"),
    request.get("accept"), response.get("finalUrl"), response.get("contentType"),
  ];
  if (
    manifest.get("schemaVersion") !== BASIC_RAW_CAPTURE_SCHEMA_VERSION ||
    request.get("method") !== "GET" ||
    !strings.every((item) => typeof item === "string") ||
    allowedOrigins === null ||
    allowedQueryParameters === null ||
    redirectChain === null ||
    !Number.isSafeInteger(status) ||
    !Number.isSafeInteger(byteLength) ||
    (byteLength as number) < 0 ||
    (byteLength as number) > BASIC_RAW_CAPTURE_MAX_BYTES ||
    !isUtcRfc3339Timestamp(retrievedAt) ||
    typeof contentSha256 !== "string" ||
    !SHA256.test(contentSha256)
  ) {
    return null;
  }
  return freezeParsedManifest(
    manifest,
    request,
    response,
    allowedOrigins,
    allowedQueryParameters,
    redirectChain,
  );
}

function freezeParsedManifest(
  manifest: ReadonlyMap<string, unknown>,
  request: ReadonlyMap<string, unknown>,
  response: ReadonlyMap<string, unknown>,
  allowedOrigins: readonly string[],
  allowedQueryParameters: readonly string[],
  redirectChain: readonly string[],
): BasicRawCaptureManifest {
  return Object.freeze({
    schemaVersion: BASIC_RAW_CAPTURE_SCHEMA_VERSION,
    countryCode: manifest.get("countryCode") as string,
    runId: manifest.get("runId") as string,
    adapterId: manifest.get("adapterId") as string,
    adapterVersion: manifest.get("adapterVersion") as string,
    sourceId: manifest.get("sourceId") as string,
    request: Object.freeze({
      method: "GET" as const, url: request.get("url") as string,
      accept: request.get("accept") as string, allowedOrigins, allowedQueryParameters,
    }),
    response: Object.freeze({
      status: response.get("status") as number,
      finalUrl: response.get("finalUrl") as string, redirectChain,
      contentType: response.get("contentType") as string,
      retrievedAt: response.get("retrievedAt") as string,
      byteLength: response.get("byteLength") as number,
      contentSha256: response.get("contentSha256") as string,
    }),
  });
}

function exactDataProperties(
  value: unknown,
  expectedKeys: readonly string[],
): ReadonlyMap<string, unknown> | null {
  try {
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype
    ) {
      return null;
    }
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.length !== expectedKeys.length ||
      ownKeys.some(
        (key) => typeof key !== "string" || !expectedKeys.includes(key),
      )
    ) {
      return null;
    }
    const properties = new Map<string, unknown>();
    for (const key of expectedKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !Object.hasOwn(descriptor, "value")
      ) {
        return null;
      }
      properties.set(key, descriptor.value);
    }
    return properties;
  } catch {
    return null;
  }
}

function snapshotDenseStringArray(value: unknown): readonly string[] | null {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
      return null;
    }
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (
      lengthDescriptor === undefined ||
      lengthDescriptor.enumerable ||
      !Object.hasOwn(lengthDescriptor, "value") ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0
    ) {
      return null;
    }
    const length = lengthDescriptor.value as number;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== length + 1) return null;
    const snapshot: string[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !Object.hasOwn(descriptor, "value") ||
        typeof descriptor.value !== "string"
      ) {
        return null;
      }
      snapshot.push(descriptor.value);
    }
    return Object.freeze(snapshot);
  } catch {
    return null;
  }
}

function sortedSnapshot(values: readonly string[]): readonly string[] { return Object.freeze(Array.from(values).sort()); }
function isUtcRfc3339Timestamp(value: unknown): value is string {
  const errors: string[] = [];
  expectUtcRfc3339Timestamp(value, "timestamp", errors);
  return errors.length === 0;
}
