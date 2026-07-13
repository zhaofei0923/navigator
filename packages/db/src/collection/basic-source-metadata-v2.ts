import { isAbsolute } from "node:path";
import { isProxy } from "node:util/types";

import {
  expectUtcRfc3339Timestamp,
  SAFE_RUN_ID,
} from "../seed/basic-country-validation-utils.js";
import {
  snapshotBasicOfflineValue,
} from "./basic-offline-value.js";
import {
  BASIC_RAW_CAPTURE_MAX_BYTES_V2,
  BASIC_RAW_CAPTURE_V2_SCHEMA_VERSION,
  BASIC_SOURCE_MAX_REDIRECTS_V2,
  type BasicRawCaptureInputV2,
  type BasicRawCaptureManifestV2,
  type BasicSourceAcceptV2,
  type BasicSourceRequestV2,
  type BasicSourceTransportResponseV2,
} from "./basic-source-v2-contracts.js";

const REQUEST_KEYS = [
  "method",
  "url",
  "accept",
  "allowedOrigins",
  "allowedQueryParameters",
] as const;
const CAPTURE_INPUT_KEYS = [
  "repoRoot",
  "countryCode",
  "runId",
  "catalogVersion",
  "catalogSha256",
  "adapterId",
  "adapterVersion",
  "sourceId",
  "request",
] as const;
const TRANSPORT_RESPONSE_KEYS = [
  "status",
  "finalUrl",
  "contentType",
  "retrievedAt",
  "redirectChain",
  "body",
] as const;
const MANIFEST_KEYS = [
  "schemaVersion",
  "countryCode",
  "runId",
  "catalogVersion",
  "catalogSha256",
  "adapterId",
  "adapterVersion",
  "sourceId",
  "request",
  "response",
] as const;
const MANIFEST_RESPONSE_KEYS = [
  "status",
  "finalUrl",
  "redirectChain",
  "contentType",
  "retrievedAt",
  "byteLength",
  "contentSha256",
] as const;
const ACCEPTS = [
  "application/json",
  "text/csv",
  "text/html",
  "application/pdf",
] as const;
const ISO2 = /^[A-Z]{2}$/;
const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_VERSION = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const CONTROL_CHARACTER = /[\u0000-\u001F\u007F]/;
const PRE_ENCODED = /%[0-9A-Fa-f]{2}/;
const MAX_ARRAY_ITEMS = 256;
const MAX_STRING_BYTES = 65_536;
const MAX_URL_BYTES = 8_192;
const REQUEST_ERROR = "basic source request metadata is invalid";
const INPUT_ERROR = "raw capture input is invalid";
const INPUT_REQUEST_ERROR = "raw capture request is invalid";
const RESPONSE_ERROR = "raw capture response is invalid";
const MANIFEST_ERROR = "raw capture manifest metadata is invalid";

export function snapshotBasicSourceRequestV2(
  value: unknown,
): BasicSourceRequestV2 {
  try {
    const snapshot = snapshotBasicOfflineValue(value);
    if (!snapshot.valid) invalid();
    return parseRequest(snapshot.data);
  } catch {
    throw new Error(REQUEST_ERROR);
  }
}

export function snapshotBasicRawCaptureInputV2(
  value: unknown,
): BasicRawCaptureInputV2 {
  let record: Record<string, unknown>;
  try {
    const snapshot = snapshotBasicOfflineValue(value);
    if (!snapshot.valid) invalid();
    record = exactRecord(snapshot.data, CAPTURE_INPUT_KEYS);
  } catch {
    throw new Error(INPUT_ERROR);
  }

  let request: BasicSourceRequestV2;
  try {
    request = parseRequest(record.request);
  } catch {
    throw new Error(INPUT_REQUEST_ERROR);
  }

  try {
    const repoRoot = text(record.repoRoot);
    if (!isAbsolute(repoRoot) || repoRoot.includes("\0")) invalid();
    return Object.freeze({
      repoRoot,
      countryCode: countryCode(record.countryCode),
      runId: runId(record.runId),
      catalogVersion: version(record.catalogVersion),
      catalogSha256: digest(record.catalogSha256),
      adapterId: safeId(record.adapterId),
      adapterVersion: version(record.adapterVersion),
      sourceId: safeId(record.sourceId),
      request,
    });
  } catch {
    throw new Error(INPUT_ERROR);
  }
}

export function snapshotBasicSourceTransportResponseV2(
  value: unknown,
): BasicSourceTransportResponseV2 {
  try {
    const properties = exactDataProperties(value, TRANSPORT_RESPONSE_KEYS);
    if (properties === null) invalid();
    const status = properties.get("status");
    if (!Number.isSafeInteger(status)) invalid();
    const redirectChain = denseStringArray(
      properties.get("redirectChain"),
      BASIC_SOURCE_MAX_REDIRECTS_V2,
      true,
      urlText,
    );
    return Object.freeze({
      status: status as number,
      finalUrl: urlText(properties.get("finalUrl")),
      contentType: nonBlankText(properties.get("contentType")),
      retrievedAt: timestamp(properties.get("retrievedAt")),
      redirectChain,
      body: properties.get("body") as AsyncIterable<Uint8Array>,
    });
  } catch {
    throw new Error(RESPONSE_ERROR);
  }
}

export function createBasicRawCaptureManifestV2(
  input: BasicRawCaptureInputV2,
  response: BasicSourceTransportResponseV2,
  contentSha256: string,
  byteLength: number,
): BasicRawCaptureManifestV2 {
  try {
    const safeInput = snapshotBasicRawCaptureInputV2(input);
    const safeResponse = snapshotBasicSourceTransportResponseV2(response);
    const safeDigest = digest(contentSha256);
    if (
      !Number.isSafeInteger(byteLength) ||
      byteLength < 0 ||
      byteLength > BASIC_RAW_CAPTURE_MAX_BYTES_V2
    ) invalid();
    return freezeManifest({
      schemaVersion: BASIC_RAW_CAPTURE_V2_SCHEMA_VERSION,
      countryCode: safeInput.countryCode,
      runId: safeInput.runId,
      catalogVersion: safeInput.catalogVersion,
      catalogSha256: safeInput.catalogSha256,
      adapterId: safeInput.adapterId,
      adapterVersion: safeInput.adapterVersion,
      sourceId: safeInput.sourceId,
      request: safeInput.request,
      response: {
        status: safeResponse.status,
        finalUrl: safeResponse.finalUrl,
        redirectChain: safeResponse.redirectChain,
        contentType: safeResponse.contentType,
        retrievedAt: safeResponse.retrievedAt,
        byteLength,
        contentSha256: safeDigest,
      },
    });
  } catch {
    throw new Error(MANIFEST_ERROR);
  }
}

export function parseBasicRawCaptureManifestV2(
  value: unknown,
): BasicRawCaptureManifestV2 | null {
  try {
    const snapshot = snapshotBasicOfflineValue(value);
    if (!snapshot.valid) invalid();
    const manifest = exactRecord(snapshot.data, MANIFEST_KEYS);
    if (manifest.schemaVersion !== BASIC_RAW_CAPTURE_V2_SCHEMA_VERSION) invalid();
    const request = parseRequest(manifest.request);
    const response = exactRecord(manifest.response, MANIFEST_RESPONSE_KEYS);
    const status = response.status;
    const byteLength = response.byteLength;
    if (
      !Number.isSafeInteger(status) ||
      !Number.isSafeInteger(byteLength) ||
      (byteLength as number) < 0 ||
      (byteLength as number) > BASIC_RAW_CAPTURE_MAX_BYTES_V2
    ) invalid();
    return freezeManifest({
      schemaVersion: BASIC_RAW_CAPTURE_V2_SCHEMA_VERSION,
      countryCode: countryCode(manifest.countryCode),
      runId: runId(manifest.runId),
      catalogVersion: version(manifest.catalogVersion),
      catalogSha256: digest(manifest.catalogSha256),
      adapterId: safeId(manifest.adapterId),
      adapterVersion: version(manifest.adapterVersion),
      sourceId: safeId(manifest.sourceId),
      request,
      response: {
        status: status as number,
        finalUrl: urlText(response.finalUrl),
        redirectChain: stringArray(
          response.redirectChain,
          BASIC_SOURCE_MAX_REDIRECTS_V2,
          true,
          urlText,
        ),
        contentType: nonBlankText(response.contentType),
        retrievedAt: timestamp(response.retrievedAt),
        byteLength: byteLength as number,
        contentSha256: digest(response.contentSha256),
      },
    });
  } catch {
    return null;
  }
}

function parseRequest(value: unknown): BasicSourceRequestV2 {
  const record = exactRecord(value, REQUEST_KEYS);
  if (record.method !== "GET" || !isAccept(record.accept)) invalid();
  const allowedOrigins = stringArray(
    record.allowedOrigins,
    MAX_ARRAY_ITEMS,
    false,
    exactOrigin,
  );
  const allowedQueryParameters = stringArray(
    record.allowedQueryParameters,
    MAX_ARRAY_ITEMS,
    true,
    queryName,
  );
  requireUnique(allowedOrigins);
  requireUnique(allowedQueryParameters);
  return Object.freeze({
    method: "GET",
    url: urlText(record.url),
    accept: record.accept,
    allowedOrigins,
    allowedQueryParameters,
  });
}

function freezeManifest(
  manifest: BasicRawCaptureManifestV2,
): BasicRawCaptureManifestV2 {
  return Object.freeze({
    schemaVersion: BASIC_RAW_CAPTURE_V2_SCHEMA_VERSION,
    countryCode: manifest.countryCode,
    runId: manifest.runId,
    catalogVersion: manifest.catalogVersion,
    catalogSha256: manifest.catalogSha256,
    adapterId: manifest.adapterId,
    adapterVersion: manifest.adapterVersion,
    sourceId: manifest.sourceId,
    request: Object.freeze({
      method: "GET",
      url: manifest.request.url,
      accept: manifest.request.accept,
      allowedOrigins: Object.freeze(Array.from(manifest.request.allowedOrigins)),
      allowedQueryParameters: Object.freeze(
        Array.from(manifest.request.allowedQueryParameters),
      ),
    }),
    response: Object.freeze({
      status: manifest.response.status,
      finalUrl: manifest.response.finalUrl,
      redirectChain: Object.freeze(Array.from(manifest.response.redirectChain)),
      contentType: manifest.response.contentType,
      retrievedAt: manifest.response.retrievedAt,
      byteLength: manifest.response.byteLength,
      contentSha256: manifest.response.contentSha256,
    }),
  });
}

function exactRecord<const Keys extends readonly string[]>(
  value: unknown,
  keys: Keys,
): Record<Keys[number], unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) invalid();
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some(
      (key) => typeof key !== "string" || !keys.includes(key),
    )
  ) invalid();
  return value as Record<Keys[number], unknown>;
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
      isProxy(value) ||
      Object.getPrototypeOf(value) !== Object.prototype
    ) return null;
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.length !== expectedKeys.length ||
      ownKeys.some(
        (key) => typeof key !== "string" || !expectedKeys.includes(key),
      )
    ) return null;
    const properties = new Map<string, unknown>();
    for (const key of expectedKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !Object.hasOwn(descriptor, "value")
      ) return null;
      properties.set(key, descriptor.value);
    }
    return properties;
  } catch {
    return null;
  }
}

function stringArray(
  value: unknown,
  maximum: number,
  allowEmpty: boolean,
  parse: (item: unknown) => string,
): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length > maximum ||
    (!allowEmpty && value.length === 0)
  ) invalid();
  return Object.freeze(value.map(parse));
}

function denseStringArray(
  value: unknown,
  maximum: number,
  allowEmpty: boolean,
  parse: (item: unknown) => string,
): readonly string[] {
  try {
    if (
      !Array.isArray(value) ||
      isProxy(value) ||
      Object.getPrototypeOf(value) !== Array.prototype
    ) invalid();
    const length = Object.getOwnPropertyDescriptor(value, "length");
    if (
      length === undefined ||
      !Object.hasOwn(length, "value") ||
      !Number.isSafeInteger(length.value) ||
      length.value < 0 ||
      length.value > maximum ||
      (!allowEmpty && length.value === 0) ||
      Reflect.ownKeys(value).length !== length.value + 1
    ) invalid();
    const result: string[] = [];
    for (let index = 0; index < length.value; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !Object.hasOwn(descriptor, "value")
      ) invalid();
      result.push(parse(descriptor.value));
    }
    return Object.freeze(result);
  } catch {
    invalid();
  }
}

function text(value: unknown): string {
  if (
    typeof value !== "string" ||
    !isWellFormedUnicode(value) ||
    Buffer.byteLength(value, "utf8") > MAX_STRING_BYTES
  ) invalid();
  return value;
}

function nonBlankText(value: unknown): string {
  const result = text(value);
  if (result.trim() === "") invalid();
  return result;
}

function urlText(value: unknown): string {
  const result = nonBlankText(value);
  if (Buffer.byteLength(result, "utf8") > MAX_URL_BYTES) invalid();
  const parsed = new URL(result);
  if (result.trim() !== result || parsed.toString() !== result) invalid();
  return result;
}

function exactOrigin(value: unknown): string {
  const result = nonBlankText(value);
  if (
    Buffer.byteLength(result, "utf8") > MAX_URL_BYTES ||
    result.trim() !== result
  ) invalid();
  const parsed = new URL(result);
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.origin !== result
  ) invalid();
  return result;
}

function queryName(value: unknown): string {
  const result = nonBlankText(value);
  if (
    result.trim() !== result ||
    result.includes("{") ||
    result.includes("}") ||
    PRE_ENCODED.test(result) ||
    CONTROL_CHARACTER.test(result)
  ) invalid();
  return result;
}

function safeId(value: unknown): string {
  const result = text(value);
  if (!SAFE_ID.test(result)) invalid();
  return result;
}

function version(value: unknown): string {
  const result = text(value);
  if (!SAFE_VERSION.test(result)) invalid();
  return result;
}

function countryCode(value: unknown): string {
  const result = text(value);
  if (!ISO2.test(result)) invalid();
  return result;
}

function runId(value: unknown): string {
  const result = text(value);
  if (!SAFE_RUN_ID.test(result)) invalid();
  return result;
}

function digest(value: unknown): string {
  const result = text(value);
  if (!SHA256.test(result)) invalid();
  return result;
}

function timestamp(value: unknown): string {
  const errors: string[] = [];
  expectUtcRfc3339Timestamp(value, "timestamp", errors);
  if (errors.length > 0 || typeof value !== "string") invalid();
  return value;
}

function isAccept(value: unknown): value is BasicSourceAcceptV2 {
  return typeof value === "string" && ACCEPTS.includes(
    value as BasicSourceAcceptV2,
  );
}

function requireUnique(values: readonly string[]): void {
  if (new Set(values).size !== values.length) invalid();
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xD800 && codeUnit <= 0xDBFF) {
      if (index + 1 >= value.length) return false;
      const next = value.charCodeAt(index + 1);
      if (next < 0xDC00 || next > 0xDFFF) return false;
      index += 1;
    } else if (codeUnit >= 0xDC00 && codeUnit <= 0xDFFF) {
      return false;
    }
  }
  return true;
}

function invalid(): never {
  throw new Error("invalid metadata");
}
