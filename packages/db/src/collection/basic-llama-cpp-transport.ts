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
const MAX_JSON_DEPTH = 64;
const RESPONSE_INVALID = Symbol("response-invalid");
const UNAVAILABLE = Symbol("unavailable");
const JSON_INVALID = Symbol("json-invalid");

type LlamaFailure = "LLAMA_UNAVAILABLE" | "LLAMA_RESPONSE_INVALID";

interface TransportSnapshot {
  url: string;
  model: string;
  timeoutMs: number;
  fetchImpl: BasicLlamaCppFetch;
}

export function createBasicLlamaCppDraftTransport(
  options: BasicLlamaCppTransportOptions,
): BasicDraftModelPort {
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
    typeof baseUrl !== "string" || typeof model !== "string" || typeof fetchImpl !== "function" ||
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
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const fail = (code: "LLAMA_TIMEOUT" | LlamaFailure) => settle(() => reject(bridgeError(code)));
    const timer = setTimeout(() => {
      try { controller.abort(); } catch { /* Timeout remains authoritative. */ }
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
        readResponse(response, controller, () => settled).then(
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

async function readResponse(
  response: unknown,
  controller: AbortController,
  isSettled: () => boolean,
): Promise<unknown> {
  const body = readResponseMetadata(response);
  const bytes = await readBody(body, controller, isSettled);
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
    if ((typeof response !== "object" && typeof response !== "function") || response === null) throw RESPONSE_INVALID;
    const status: unknown = Reflect.get(response, "status");
    const redirected: unknown = Reflect.get(response, "redirected");
    const headers: unknown = Reflect.get(response, "headers");
    const body: unknown = Reflect.get(response, "body");
    if (typeof status !== "number" || !Number.isInteger(status) || status < 200 || status > 299 || redirected !== false || body === null || typeof body !== "object") throw RESPONSE_INVALID;
    if ((typeof headers !== "object" && typeof headers !== "function") || headers === null) throw RESPONSE_INVALID;
    const get: unknown = Reflect.get(headers, "get");
    if (typeof get !== "function") throw RESPONSE_INVALID;
    const contentType: unknown = Reflect.apply(get, headers, ["content-type"]);
    if (typeof contentType !== "string" || !isJsonContentType(contentType)) throw RESPONSE_INVALID;
    return body as ReadableStream<Uint8Array>;
  } catch { throw RESPONSE_INVALID; }
}

async function readBody(
  body: ReadableStream<Uint8Array>,
  controller: AbortController,
  isSettled: () => boolean,
): Promise<Uint8Array | null> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  try {
    const getReader: unknown = Reflect.get(body, "getReader");
    if (typeof getReader !== "function") throw RESPONSE_INVALID;
    reader = Reflect.apply(getReader, body, []) as ReadableStreamDefaultReader<Uint8Array>;
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (;;) {
      const result: unknown = await reader.read();
      if (isSettled()) return null;
      if ((typeof result !== "object" && typeof result !== "function") || result === null) throw UNAVAILABLE;
      const done: unknown = Reflect.get(result, "done");
      const value: unknown = Reflect.get(result, "value");
      if (typeof done !== "boolean") throw UNAVAILABLE;
      if (done) return joinChunks(chunks, length);
      if (!(value instanceof Uint8Array)) throw UNAVAILABLE;
      length += value.byteLength;
      if (length > BASIC_LLAMA_DRAFT_MAX_RESPONSE_BYTES) {
        try { controller.abort(); } catch { /* The response limit remains authoritative. */ }
        throw RESPONSE_INVALID;
      }
      chunks.push(value);
    }
  } catch (error) { throw error === RESPONSE_INVALID ? error : UNAVAILABLE; }
  finally {
    try { reader?.releaseLock(); } catch { /* Reader cleanup cannot alter the boundary failure. */ }
  }
}

function exactProperties(
  value: unknown,
  allowedKeys: readonly string[],
  requiredKeys: readonly string[],
): ReadonlyMap<string, unknown> | null {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
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
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length !== length || Reflect.ownKeys(value).length !== length + 1) return null;
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
