import { afterEach, describe, expect, test, vi } from "vitest";

import { BasicCollectionBridgeError } from "./collection/basic-collection-bridge-error.js";
import {
  BASIC_LLAMA_DRAFT_MAX_REQUEST_BYTES,
  BASIC_LLAMA_DRAFT_MAX_RESPONSE_BYTES,
  BASIC_LLAMA_DRAFT_TIMEOUT_MS,
  type BasicLlamaCppDraftRequest,
  type BasicLlamaCppFetch,
  type BasicLlamaCppFetchResponse,
} from "./collection/basic-hermes-llama-contracts.js";
import { createBasicLlamaCppDraftTransport } from "./collection/basic-llama-cpp-transport.js";

const REQUEST: BasicLlamaCppDraftRequest = {
  messages: [{ role: "user", content: "{\"protocol\":\"basic-country-draft/v1\"}" }],
  stream: false,
  temperature: 0,
  chat_template_kwargs: { enable_thinking: false },
  response_format: {
    type: "json_schema",
    schema: { type: "object", additionalProperties: false },
  },
};
const SECRET = "LLAMA_PROVIDER_SECRET_9e91";
const URL = "http://127.0.0.1:8080/v1";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Basic llama.cpp draft transport", () => {
  test("posts the exact OpenAI-compatible request with an injected fetch", async () => {
    const fetchImpl: BasicLlamaCppFetch = async (url, init) => {
      expect(url).toBe("http://127.0.0.1:8080/v1/chat/completions");
      expect(init).toMatchObject({
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        redirect: "error",
      });
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(Object.keys(init)).toEqual(["method", "headers", "body", "redirect", "signal"]);
      expect(Object.keys(init.headers)).toEqual(["Content-Type", "Accept"]);
      expect(init.body).toBe(JSON.stringify({ model: "qwen35b", ...REQUEST }));
      expect(init.body).not.toContain("system");
      expect(init.body).not.toContain("tools");
      return jsonResponse({ choices: [] });
    };

    const result = await createBasicLlamaCppDraftTransport({ baseUrl: URL, model: "qwen35b", fetchImpl })
      .complete(REQUEST);

    expect(result).toEqual({ choices: [] });
  });

  test.each(["http://127.0.0.1:8080/v1", "http://[::1]:8080/v1"])(
    "accepts the exact loopback base URL %s",
    async (baseUrl) => {
      const fetchImpl = createFetch([jsonResponse({ ok: true })]);
      await expect(createBasicLlamaCppDraftTransport({ baseUrl, model: "qwen35b", fetchImpl }).complete(REQUEST))
        .resolves.toEqual({ ok: true });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    },
  );

  test.each([
    "http://localhost:8080/v1",
    "http://10.0.0.1:8080/v1",
    "http://192.168.1.1:8080/v1",
    "http://8.8.8.8:8080/v1",
    "https://127.0.0.1:8080/v1",
    "http://user:pass@127.0.0.1:8080/v1",
    "http://127.0.0.1:8080/v1?token=x",
    "http://127.0.0.1:8080/v1#fragment",
    "http://127.0.0.1:8080/v1/",
    "http://127.0.0.1:8080/v1/chat/completions",
    "http://127.0.0.1:8080",
  ])("rejects unsafe base URL %s", (baseUrl) => {
    const error = expectInputError(() => createBasicLlamaCppDraftTransport({
      baseUrl,
      model: "qwen35b",
      fetchImpl: createFetch([]),
    }));
    expect(error.message).not.toContain(baseUrl);
  });

  test.each(["", " ", "../model", "/tmp/model", "model\\weights", "model/name", ".hidden"])(
    "rejects an unsafe model alias %j",
    (model) => {
      expectInputError(() => createBasicLlamaCppDraftTransport({ baseUrl: URL, model, fetchImpl: createFetch([]) }));
    },
  );

  test("rejects an oversized UTF-8 request before fetch", async () => {
    const fetchImpl = createFetch([]);
    const oversized = requestWithContent("x".repeat(BASIC_LLAMA_DRAFT_MAX_REQUEST_BYTES));

    await expect(createBasicLlamaCppDraftTransport({ baseUrl: URL, model: "qwen35b", fetchImpl }).complete(oversized))
      .rejects.toMatchObject({ name: "BasicCollectionBridgeError", message: "P1-6C bridge failed: INPUT_INVALID" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("redacts hostile request schemas as input invalid before fetch", async () => {
    const fetchImpl = createFetch([]);
    const unsafeRequest = {
      ...REQUEST,
      response_format: { type: "json_schema", schema: new Proxy({}, { ownKeys() { throw new Error(SECRET); } }) },
    } as unknown as BasicLlamaCppDraftRequest;

    const error = await rejectWith(createBasicLlamaCppDraftTransport({ baseUrl: URL, model: "qwen35b", fetchImpl }).complete(unsafeRequest));
    expect(error.message).toBe("P1-6C bridge failed: INPUT_INVALID");
    expect(error.message).not.toContain(SECRET);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("aborts on timeout and ignores a late fetch response", async () => {
    vi.useFakeTimers();
    let resolveFetch: ((response: BasicLlamaCppFetchResponse) => void) | undefined;
    let signal: AbortSignal | undefined;
    const fetchImpl: BasicLlamaCppFetch = (_url, init) => new Promise((resolve) => {
      signal = init.signal;
      resolveFetch = resolve;
    });
    const pending = createBasicLlamaCppDraftTransport({ baseUrl: URL, model: "qwen35b", fetchImpl }).complete(REQUEST);
    const outcome = pending.then(() => "settled", () => "settled");

    await vi.advanceTimersByTimeAsync(BASIC_LLAMA_DRAFT_TIMEOUT_MS);
    await expect(pending).rejects.toMatchObject({ message: "P1-6C bridge failed: LLAMA_TIMEOUT" });
    expect(signal?.aborted).toBe(true);
    let lateAccesses = 0;
    resolveFetch?.({ get status() { lateAccesses += 1; throw new Error(SECRET); } } as unknown as BasicLlamaCppFetchResponse);
    await vi.runAllTimersAsync();
    expect(lateAccesses).toBe(0);
    await outcome;
  });

  test("maps synchronous fetch throws and rejected fetches to unavailable without provider text", async () => {
    const syncTransport = createBasicLlamaCppDraftTransport({
      baseUrl: URL,
      model: "qwen35b",
      fetchImpl: () => { throw new Error(SECRET); },
    });
    const rejectedTransport = createBasicLlamaCppDraftTransport({
      baseUrl: URL,
      model: "qwen35b",
      fetchImpl: async () => { throw new Error(SECRET); },
    });

    for (const transport of [syncTransport, rejectedTransport]) {
      const error = await rejectWith(transport.complete(REQUEST));
      expect(error.message).toBe("P1-6C bridge failed: LLAMA_UNAVAILABLE");
      expect(error.message).not.toContain(SECRET);
    }
  });

  test("ignores a late stream read result after timeout", async () => {
    vi.useFakeTimers();
    let resolveRead: ((value: unknown) => void) | undefined;
    let resultAccesses = 0;
    const body = {
      getReader() {
        return {
          read: () => new Promise((resolve) => { resolveRead = resolve; }),
          releaseLock() {},
        };
      },
    } as unknown as ReadableStream<Uint8Array>;
    const transport = createBasicLlamaCppDraftTransport({
      baseUrl: URL,
      model: "qwen35b",
      timeoutMs: 10,
      fetchImpl: async () => ({ status: 200, redirected: false, headers: { get: () => "application/json" }, body }),
    });
    const pending = transport.complete(REQUEST);
    const outcome = pending.then(() => "settled", () => "settled");
    await vi.advanceTimersByTimeAsync(10);
    await expect(pending).rejects.toMatchObject({ message: "P1-6C bridge failed: LLAMA_TIMEOUT" });
    resolveRead?.({ get done() { resultAccesses += 1; throw new Error(SECRET); } });
    await vi.runAllTimersAsync();
    expect(resultAccesses).toBe(0);
    await outcome;
  });

  test.each([
    [jsonResponse({ error: SECRET }, 500), "status"],
    [jsonResponse({ error: SECRET }, 200, { redirected: true }), "redirect"],
    [jsonResponse({ error: SECRET }, 200, { contentType: "text/plain" }), "MIME"],
    [{ status: 200, redirected: false, headers: { get: () => "application/json" }, body: null }, "null body"],
  ] as const)("rejects an invalid %s response", async (response, _description) => {
    const error = await rejectWith(createBasicLlamaCppDraftTransport({
      baseUrl: URL,
      model: "qwen35b",
      fetchImpl: createFetch([response]),
    }).complete(REQUEST));
    expect(error.message).toBe("P1-6C bridge failed: LLAMA_RESPONSE_INVALID");
    expect(error.message).not.toContain(SECRET);
  });

  test("maps stream errors to unavailable and response overflow to invalid", async () => {
    const streamFailure = response(200, streamError(SECRET));
    const overflow = response(200, stream([new Uint8Array(BASIC_LLAMA_DRAFT_MAX_RESPONSE_BYTES + 1)]));
    for (const [responseValue, code] of [[streamFailure, "LLAMA_UNAVAILABLE"], [overflow, "LLAMA_RESPONSE_INVALID"]] as const) {
      const error = await rejectWith(createBasicLlamaCppDraftTransport({
        baseUrl: URL,
        model: "qwen35b",
        fetchImpl: createFetch([responseValue]),
      }).complete(REQUEST));
      expect(error.message).toBe(`P1-6C bridge failed: ${code}`);
      expect(error.message).not.toContain(SECRET);
    }
  });

  test("aborts the request when the streamed response exceeds its cap", async () => {
    let signal: AbortSignal | undefined;
    const error = await rejectWith(createBasicLlamaCppDraftTransport({
      baseUrl: URL,
      model: "qwen35b",
      fetchImpl: async (_url, init) => {
        signal = init.signal;
        return response(200, stream([new Uint8Array(BASIC_LLAMA_DRAFT_MAX_RESPONSE_BYTES + 1)]));
      },
    }).complete(REQUEST));
    expect(error.message).toBe("P1-6C bridge failed: LLAMA_RESPONSE_INVALID");
    expect(signal?.aborted).toBe(true);
  });

  test.each([
    [response(200, stream([new Uint8Array([0xc3])])), "invalid UTF-8"],
    [response(200, stream([bytes("{")])), "invalid JSON"],
    [{ status: 200, redirected: false, headers: { get: () => "application/json" }, body: {} }, "malformed body"],
  ] as const)("rejects %s without leaking provider data", async (responseValue, _description) => {
    const error = await rejectWith(createBasicLlamaCppDraftTransport({
      baseUrl: URL,
      model: "qwen35b",
      fetchImpl: createFetch([responseValue as unknown as BasicLlamaCppFetchResponse]),
    }).complete(REQUEST));
    expect(error.message).toBe("P1-6C bridge failed: LLAMA_RESPONSE_INVALID");
    expect(error.message).not.toContain(SECRET);
  });

  test("redacts hostile reader and read-result failures as unavailable", async () => {
    const readerGetter = {
      status: 200,
      redirected: false,
      headers: { get: () => "application/json" },
      body: { getReader() { throw new Error(SECRET); } },
    } as unknown as BasicLlamaCppFetchResponse;
    const readResult = {
      status: 200,
      redirected: false,
      headers: { get: () => "application/json" },
      body: { getReader() { return { read: async () => new Proxy({}, { get() { throw new Error(SECRET); } }), releaseLock() {} }; } },
    } as unknown as BasicLlamaCppFetchResponse;
    for (const responseValue of [readerGetter, readResult]) {
      const error = await rejectWith(createBasicLlamaCppDraftTransport({
        baseUrl: URL,
        model: "qwen35b",
        fetchImpl: createFetch([responseValue]),
      }).complete(REQUEST));
      expect(error.message).toBe("P1-6C bridge failed: LLAMA_UNAVAILABLE");
      expect(error.message).not.toContain(SECRET);
    }
  });

  test("redacts hostile response, headers, and body getter failures", async () => {
    const responseGetter = { get status() { throw new Error(SECRET); } };
    const headersGetter = { status: 200, redirected: false, headers: { get get() { throw new Error(SECRET); } }, body: stream([bytes("{}")]) };
    const bodyGetter = { status: 200, redirected: false, headers: { get: () => "application/json" }, get body() { throw new Error(SECRET); } };
    for (const responseValue of [responseGetter, headersGetter, bodyGetter]) {
      const error = await rejectWith(createBasicLlamaCppDraftTransport({
        baseUrl: URL,
        model: "qwen35b",
        fetchImpl: createFetch([responseValue as unknown as BasicLlamaCppFetchResponse]),
      }).complete(REQUEST));
      expect(error.message).toBe("P1-6C bridge failed: LLAMA_RESPONSE_INVALID");
      expect(error.message).not.toContain(SECRET);
    }
  });

  test("snapshots endpoint, model, fetch, and timeout before caller mutation", async () => {
    const firstFetch = createFetch([jsonResponse({ from: "first" })]);
    const secondFetch = createFetch([jsonResponse({ from: "second" })]);
    const options = { baseUrl: URL, model: "qwen35b", timeoutMs: 10, fetchImpl: firstFetch };
    const transport = createBasicLlamaCppDraftTransport(options);
    options.baseUrl = `http://127.0.0.1:9000/v1/${SECRET}`;
    options.model = SECRET;
    options.timeoutMs = 1;
    options.fetchImpl = secondFetch;

    await expect(transport.complete(REQUEST)).resolves.toEqual({ from: "first" });
    expect(firstFetch).toHaveBeenCalledWith("http://127.0.0.1:8080/v1/chat/completions", expect.objectContaining({
      body: expect.stringContaining('"model":"qwen35b"'),
    }));
    expect(secondFetch).not.toHaveBeenCalled();
  });

  test("uses the captured timeout after caller mutation", async () => {
    vi.useFakeTimers();
    const options = {
      baseUrl: URL,
      model: "qwen35b",
      timeoutMs: 10,
      fetchImpl: () => new Promise<BasicLlamaCppFetchResponse>(() => {}),
    };
    const transport = createBasicLlamaCppDraftTransport(options);
    options.timeoutMs = 1;
    const pending = transport.complete(REQUEST);
    const outcome = pending.then(() => "settled", () => "settled");

    await vi.advanceTimersByTimeAsync(1);
    expect(await Promise.race([outcome, Promise.resolve("pending")])).toBe("pending");
    await vi.advanceTimersByTimeAsync(9);
    await expect(pending).rejects.toMatchObject({ message: "P1-6C bridge failed: LLAMA_TIMEOUT" });
    await outcome;
  });

  test("rejects hostile options without reading getters or using global fetch", () => {
    vi.stubGlobal("fetch", () => { throw new Error("global fetch must not run"); });
    const options = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(options, "baseUrl", { enumerable: true, get() { throw new Error(SECRET); } });
    Object.defineProperty(options, "model", { enumerable: true, value: "qwen35b" });
    Object.defineProperty(options, "fetchImpl", { enumerable: true, value: createFetch([]) });

    const error = expectInputError(() => createBasicLlamaCppDraftTransport(options as never));
    expect(error.message).not.toContain(SECRET);
  });

  test("never falls back to global fetch", async () => {
    vi.stubGlobal("fetch", () => { throw new Error("global fetch must not run"); });
    await expect(createBasicLlamaCppDraftTransport({
      baseUrl: URL,
      model: "qwen35b",
      fetchImpl: createFetch([jsonResponse({ ok: true })]),
    }).complete(REQUEST)).resolves.toEqual({ ok: true });
  });

  test("accepts structured JSON media types", async () => {
    await expect(createBasicLlamaCppDraftTransport({
      baseUrl: URL,
      model: "qwen35b",
      fetchImpl: createFetch([jsonResponse({ ok: true }, 200, { contentType: "application/vnd.llama+json; charset=utf-8" })]),
    }).complete(REQUEST)).resolves.toEqual({ ok: true });
  });

  test("returns valid JSON null without interpreting provider semantics", async () => {
    await expect(createBasicLlamaCppDraftTransport({
      baseUrl: URL,
      model: "qwen35b",
      fetchImpl: createFetch([jsonResponse(null)]),
    }).complete(REQUEST)).resolves.toBeNull();
  });
});

function createFetch(responses: readonly BasicLlamaCppFetchResponse[]): ReturnType<typeof vi.fn<BasicLlamaCppFetch>> {
  let index = 0;
  return vi.fn<BasicLlamaCppFetch>(async () => {
    const responseValue = responses[index];
    index += 1;
    if (responseValue === undefined) throw new Error("unexpected fetch");
    return responseValue;
  });
}

function jsonResponse(value: unknown, status = 200, options: { redirected?: boolean; contentType?: string } = {}): BasicLlamaCppFetchResponse {
  return response(status, stream([bytes(JSON.stringify(value))]), options);
}

function response(status: number, body: ReadableStream<Uint8Array>, options: { redirected?: boolean; contentType?: string } = {}): BasicLlamaCppFetchResponse {
  return { status, redirected: options.redirected ?? false, headers: { get: () => options.contentType ?? "application/json" }, body };
}

function stream(chunks: readonly Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); } });
}

function streamError(message: string): ReadableStream<Uint8Array> {
  return new ReadableStream({ start(controller) { controller.error(new Error(message)); } });
}

function bytes(value: string): Uint8Array { return new TextEncoder().encode(value); }

function requestWithContent(content: string): BasicLlamaCppDraftRequest {
  return { ...REQUEST, messages: [{ role: "user", content }] };
}

async function rejectWith(promise: Promise<unknown>): Promise<BasicCollectionBridgeError> {
  try { await promise; throw new Error("expected rejection"); }
  catch (error: unknown) {
    expect(error).toBeInstanceOf(BasicCollectionBridgeError);
    return error as BasicCollectionBridgeError;
  }
}

function expectInputError(action: () => unknown): BasicCollectionBridgeError {
  try { action(); throw new Error("expected input error"); }
  catch (error: unknown) {
    expect(error).toBeInstanceOf(BasicCollectionBridgeError);
    const bridgeError = error as BasicCollectionBridgeError;
    expect(bridgeError.message).toBe("P1-6C bridge failed: INPUT_INVALID");
    return bridgeError;
  }
}
