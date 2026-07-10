import { isProxy } from "node:util/types";
import { BasicCollectionBridgeError } from "./basic-collection-bridge-error.js";
import {
  BASIC_LLAMA_DRAFT_MAX_REQUEST_BYTES,
  BASIC_LLAMA_DRAFT_MAX_RESPONSE_BYTES,
  BASIC_LLAMA_DRAFT_TIMEOUT_MS,
  type BasicDraftModelPort,
  type BasicLlamaCppDraftRequest,
  type BasicLlamaCppFetch,
  type BasicLlamaCppFetchResponse,
  type BasicLlamaCppTransportOptions,
} from "./basic-hermes-llama-contracts.js";
const OPTION_KEYS = ["baseUrl", "model", "timeoutMs", "fetchImpl"] as const;
const REQUEST_KEYS = ["messages", "stream", "temperature", "chat_template_kwargs", "response_format"] as const;
const MESSAGE_KEYS = ["role", "content"] as const;
const THINKING_KEYS = ["enable_thinking"] as const;
const RESPONSE_FORMAT_KEYS = ["type", "schema"] as const;
const READ_RESULT_KEYS = ["value", "done"] as const;
const MAX_JSON_DEPTH = 64;
const MAX_METHOD_PROTOTYPE_DEPTH = 16;
const RESPONSE_INVALID = Symbol("response-invalid");
const UNAVAILABLE = Symbol("unavailable");
const JSON_INVALID = Symbol("json-invalid");
type LlamaFailure = "LLAMA_UNAVAILABLE" | "LLAMA_RESPONSE_INVALID";
interface TransportSnapshot { url: string; model: string; timeoutMs: number; fetchImpl: BasicLlamaCppFetch; }
export function createBasicLlamaCppDraftTransport(options: BasicLlamaCppTransportOptions): BasicDraftModelPort {
  const snapshot = snapshotOptions(options);
  if (snapshot === null) throw bridgeError("INPUT_INVALID");
  return Object.freeze({
    complete(request: BasicLlamaCppDraftRequest): Promise<unknown> {
      const body = serializeRequest(request, snapshot.model);
      if (body === null) return Promise.reject(bridgeError("INPUT_INVALID"));
      return execute(snapshot, body);
    },
  });
}
function snapshotOptions(value: unknown): TransportSnapshot | null {
  const properties = exactProperties(value, OPTION_KEYS, ["baseUrl", "model", "fetchImpl"]);
  if (properties === null) return null;
  const baseUrl = properties.get("baseUrl");
  const model = properties.get("model");
  const fetchImpl = properties.get("fetchImpl");
  const timeoutMs = properties.get("timeoutMs") ?? BASIC_LLAMA_DRAFT_TIMEOUT_MS;
  if (
    typeof baseUrl !== "string" || typeof model !== "string" || typeof fetchImpl !== "function" || isProxy(fetchImpl) ||
    typeof timeoutMs !== "number" || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 ||
    !isSafeModelAlias(model)
  ) return null;
  const url = completionUrl(baseUrl);
  return url === null ? null : Object.freeze({ url, model, timeoutMs, fetchImpl: fetchImpl as BasicLlamaCppFetch });
}
function serializeRequest(value: unknown, model: string): string | null {
  const properties = exactProperties(value, REQUEST_KEYS, REQUEST_KEYS);
  const messages = properties === null ? null : tupleValues(properties.get("messages"), 1);
  const message = messages === null ? null : exactProperties(messages[0], MESSAGE_KEYS, MESSAGE_KEYS);
  const thinking = properties === null ? null : exactProperties(properties.get("chat_template_kwargs"), THINKING_KEYS, THINKING_KEYS);
  const responseFormat = properties === null ? null : exactProperties(properties.get("response_format"), RESPONSE_FORMAT_KEYS, RESPONSE_FORMAT_KEYS);
  if (
    properties === null || message === null || thinking === null || responseFormat === null ||
    message.get("role") !== "user" || typeof message.get("content") !== "string" ||
    properties.get("stream") !== false || properties.get("temperature") !== 0 ||
    thinking.get("enable_thinking") !== false || responseFormat.get("type") !== "json_schema"
  ) return null;
  const schema = snapshotJson(responseFormat.get("schema"), 0);
  if (schema === JSON_INVALID || typeof schema !== "object" || schema === null || Array.isArray(schema)) return null;
  try {
    const body = JSON.stringify({
      model,
      messages: [{ role: "user", content: message.get("content") }],
      stream: false,
      temperature: 0,
      chat_template_kwargs: { enable_thinking: false },
      response_format: { type: "json_schema", schema },
    });
    return new TextEncoder().encode(body).byteLength <= BASIC_LLAMA_DRAFT_MAX_REQUEST_BYTES ? body : null;
  } catch { return null; }
}
function execute(snapshot: TransportSnapshot, body: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    let settled = false;
    let cancelReader: (() => void) | null = null;
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const fail = (code: "LLAMA_TIMEOUT" | LlamaFailure) => settle(() => reject(bridgeError(code)));
    const timer = setTimeout(() => {
      try { controller.abort(); } catch { /* Timeout remains authoritative. */ }
      cancelReader?.();
      fail("LLAMA_TIMEOUT");
    }, snapshot.timeoutMs);
    let fetchResult: Promise<BasicLlamaCppFetchResponse>;
    try {
      fetchResult = Promise.resolve(snapshot.fetchImpl(snapshot.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body,
        redirect: "error",
        signal: controller.signal,
      }));
    } catch { fail("LLAMA_UNAVAILABLE"); return; }
    fetchResult.then(
      (response) => {
        if (settled) return;
        readResponse(response, controller, () => settled, (cancel) => { cancelReader = cancel; }).then(
          (result) => settle(() => resolve(result)),
          (failure: unknown) => {
            if (settled) return;
            fail(failure === UNAVAILABLE ? "LLAMA_UNAVAILABLE" : "LLAMA_RESPONSE_INVALID");
          },
        );
      },
      () => fail("LLAMA_UNAVAILABLE"),
    );
  });
}
async function readResponse(response: unknown, controller: AbortController, isSettled: () => boolean,
  registerCancel: (cancel: (() => void) | null) => void): Promise<unknown> {
  const body = readResponseMetadata(response);
  const bytes = await readBody(body, controller, isSettled, registerCancel);
  if (bytes === null || isSettled()) throw UNAVAILABLE;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    const reconstructed = snapshotJson(parsed, 0);
    if (reconstructed === JSON_INVALID) throw RESPONSE_INVALID;
    return reconstructed;
  } catch (error) { throw error === RESPONSE_INVALID ? error : RESPONSE_INVALID; }
}
function readResponseMetadata(response: unknown): ReadableStream<Uint8Array> {
  try {
    if (!isObjectLike(response) || isProxy(response)) throw RESPONSE_INVALID;
    const status: unknown = Reflect.get(response, "status");
    const redirected: unknown = Reflect.get(response, "redirected");
    const headers: unknown = Reflect.get(response, "headers");
    const body: unknown = Reflect.get(response, "body");
    if (typeof status !== "number" || !Number.isInteger(status) || status < 200 || status > 299 || redirected !== false || !isObjectLike(headers) || !isObjectLike(body) || isProxy(headers) || isProxy(body)) throw RESPONSE_INVALID;
    const get = dataMethod(headers, "get");
    if (get === null) throw RESPONSE_INVALID;
    const contentType: unknown = Reflect.apply(get, headers, ["content-type"]);
    if (typeof contentType !== "string" || !isJsonContentType(contentType)) throw RESPONSE_INVALID;
    return body as ReadableStream<Uint8Array>;
  } catch { throw RESPONSE_INVALID; }
}
async function readBody(body: ReadableStream<Uint8Array>, controller: AbortController, isSettled: () => boolean,
  registerCancel: (cancel: (() => void) | null) => void): Promise<Uint8Array | null> {
  const getReader = dataMethod(body, "getReader");
  if (getReader === null) throw RESPONSE_INVALID;
  let reader: unknown;
  try { reader = Reflect.apply(getReader, body, []); }
  catch { throw RESPONSE_INVALID; }
  if (!isObjectLike(reader) || isProxy(reader)) throw RESPONSE_INVALID;
  const read = dataMethod(reader, "read");
  const cancel = dataMethod(reader, "cancel");
  const releaseLock = dataMethod(reader, "releaseLock");
  if (read === null || cancel === null || releaseLock === null) throw RESPONSE_INVALID;
  const cancelCurrent = () => observeMethod(cancel, reader);
  registerCancel(cancelCurrent);
  try {
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (;;) {
      let pending: unknown;
      try { pending = Reflect.apply(read, reader, []); }
      catch { throw UNAVAILABLE; }
      if (!isObjectLike(pending) || isProxy(pending) || dataMethod(pending, "then") === null) throw RESPONSE_INVALID;
      let result: unknown;
      try { result = await Promise.resolve(pending); }
      catch { throw UNAVAILABLE; }
      if (isSettled()) return null;
      const properties = exactProperties(result, READ_RESULT_KEYS, READ_RESULT_KEYS);
      if (properties === null) throw RESPONSE_INVALID;
      const done = properties.get("done");
      const value = properties.get("value");
      if (typeof done !== "boolean") throw RESPONSE_INVALID;
      if (done) {
        if (value !== undefined) throw RESPONSE_INVALID;
        return joinChunks(chunks, length);
      }
      if (typeof value !== "object" || value === null || isProxy(value) || !(value instanceof Uint8Array)) throw RESPONSE_INVALID;
      length += value.byteLength;
      if (length > BASIC_LLAMA_DRAFT_MAX_RESPONSE_BYTES) {
        try { controller.abort(); } catch { /* The response limit remains authoritative. */ }
        cancelCurrent();
        throw RESPONSE_INVALID;
      }
      chunks.push(value);
    }
  } finally {
    registerCancel(null);
    observeMethod(releaseLock, reader);
  }
}
type DataMethod = (...args: unknown[]) => unknown;
function dataMethod(value: object, key: string): DataMethod | null {
  try {
    let owner: object | null = value;
    const visited = new Set<object>();
    for (let depth = 0; owner !== null && depth < MAX_METHOD_PROTOTYPE_DEPTH; depth += 1) {
      if (isProxy(owner) || visited.has(owner)) return null;
      visited.add(owner);
      const descriptor = Object.getOwnPropertyDescriptor(owner, key);
      if (descriptor !== undefined) {
        const method = Object.hasOwn(descriptor, "value") ? descriptor.value : null;
        return typeof method === "function" && !isProxy(method) ? method as DataMethod : null;
      }
      owner = Object.getPrototypeOf(owner) as object | null;
    }
    return null;
  } catch { return null; }
}

function observeMethod(method: DataMethod, target: object): void {
  try { Promise.resolve(Reflect.apply(method, target, [])).then(() => undefined, () => undefined); }
  catch { /* Cleanup cannot replace the timeout or response failure. */ }
}

function isObjectLike(value: unknown): value is object {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

function exactProperties(value: unknown, allowedKeys: readonly string[],
  requiredKeys: readonly string[]): ReadonlyMap<string, unknown> | null {
  try {
    if (typeof value !== "object" || value === null || isProxy(value) || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string" || !allowedKeys.includes(key)) || requiredKeys.some((key) => !keys.includes(key))) return null;
    const result = new Map<string, unknown>();
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) return null;
      result.set(key as string, descriptor.value);
    }
    return result;
  } catch { return null; }
}

function tupleValues(value: unknown, length: number): readonly unknown[] | null {
  try {
    if (typeof value !== "object" || value === null || isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length !== length || Reflect.ownKeys(value).length !== length + 1) return null;
    const result: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) return null;
      result.push(descriptor.value);
    }
    return result;
  } catch { return null; }
}

function snapshotJson(value: unknown, depth: number): unknown {
  try {
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number") return Number.isFinite(value) ? value : JSON_INVALID;
    if (depth >= MAX_JSON_DEPTH || typeof value !== "object") return JSON_INVALID;
    if (isProxy(value)) return JSON_INVALID;
    if (Array.isArray(value)) {
      const values = tupleValues(value, value.length);
      if (values === null) return JSON_INVALID;
      const result: unknown[] = [];
      for (const item of values) { const snapshot = snapshotJson(item, depth + 1); if (snapshot === JSON_INVALID) return JSON_INVALID; result.push(snapshot); }
      return Object.freeze(result);
    }
    const properties = exactProperties(value, Reflect.ownKeys(value).filter((key): key is string => typeof key === "string"), []);
    if (properties === null) return JSON_INVALID;
    const result: Record<string, unknown> = {};
    for (const [key, item] of properties) {
      const snapshot = snapshotJson(item, depth + 1);
      if (snapshot === JSON_INVALID) return JSON_INVALID;
      Object.defineProperty(result, key, { value: snapshot, enumerable: true, writable: false, configurable: false });
    }
    return Object.freeze(result);
  } catch { return JSON_INVALID; }
}

function completionUrl(baseUrl: string): string | null {
  const match = /^http:\/\/(?:127\.0\.0\.1|\[::1\]):([1-9][0-9]{0,4})\/v1$/.exec(baseUrl);
  return match !== null && Number(match[1]) <= 65_535 ? `${baseUrl}/chat/completions` : null;
}
function isSafeModelAlias(value: string): boolean { return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value); }
function isJsonContentType(value: string): boolean {
  const mediaType = value.split(";", 1)[0]?.trim().toLowerCase();
  return mediaType === "application/json" || mediaType?.endsWith("+json") === true;
}
function joinChunks(chunks: readonly Uint8Array[], length: number): Uint8Array {
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}
function bridgeError(code: "INPUT_INVALID" | "LLAMA_TIMEOUT" | LlamaFailure): BasicCollectionBridgeError {
  return new BasicCollectionBridgeError(code);
}
