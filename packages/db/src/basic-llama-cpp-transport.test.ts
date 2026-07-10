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
          cancel() {},
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
    { name: "resolving cancel", cancel: () => Promise.resolve() },
    { name: "throwing cancel", cancel: () => { throw new Error(SECRET); } },
    { name: "rejecting cancel", cancel: () => Promise.reject(new Error(SECRET)) },
  ])("cancels a non-cooperative pending read on timeout with $name", async ({ cancel }) => {
    vi.useFakeTimers();
    let cancelCalls = 0;
    const body = bodyWithReader({
      read: () => new Promise(() => {}),
      cancel: () => { cancelCalls += 1; return cancel(); },
      releaseLock() {},
    });
    const pending = completeBody(body, 10);
    const outcome = pending.then(() => "settled", () => "settled");
    await vi.advanceTimersByTimeAsync(10);
    const error = await rejectWith(pending);
    expect(error.message).toBe("P1-6C bridge failed: LLAMA_TIMEOUT");
    expect(error.message).not.toContain(SECRET);
    expect(cancelCalls).toBe(1);
    await vi.runAllTimersAsync();
    await outcome;
  });

  test.each([
    { name: "resolving cancel", cancel: () => Promise.resolve() },
    { name: "throwing cancel", cancel: () => { throw new Error(SECRET); } },
    { name: "rejecting cancel", cancel: () => Promise.reject(new Error(SECRET)) },
  ])("cancels and releases an overflowing response with $name", async ({ cancel }) => {
    let cancelCalls = 0;
    let releaseCalls = 0;
    const body = bodyWithReader(readerForResults(
      [{ value: new Uint8Array(BASIC_LLAMA_DRAFT_MAX_RESPONSE_BYTES + 1), done: false }],
      () => { cancelCalls += 1; return cancel(); },
      () => { releaseCalls += 1; },
    ));
    const error = await rejectWith(completeBody(body));
    expect(error.message).toBe("P1-6C bridge failed: LLAMA_RESPONSE_INVALID");
    expect(error.message).not.toContain(SECRET);
    expect(cancelCalls).toBe(1);
    expect(releaseCalls).toBe(1);
    await Promise.resolve();
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

  test.each([
    { name: "getReader accessor", body: () => ({ get getReader() { throw new Error(SECRET); } }) },
    { name: "getReader value", body: () => ({ getReader: 7 }) },
    { name: "getReader invocation", body: () => ({ getReader() { throw new Error(SECRET); } }) },
    { name: "reader value", body: () => ({ getReader() { return null; } }) },
    { name: "read accessor", body: () => bodyWithReader({ get read() { throw new Error(SECRET); }, cancel() {}, releaseLock() {} }) },
    { name: "missing cancel", body: () => bodyWithReader(jsonReader({ cancel: undefined })) },
    { name: "cancel accessor", body: () => bodyWithReader({ ...jsonReader(), get cancel() { throw new Error(SECRET); } }) },
    { name: "missing releaseLock", body: () => bodyWithReader(jsonReader({ releaseLock: undefined })) },
    { name: "releaseLock accessor", body: () => bodyWithReader({ ...jsonReader(), get releaseLock() { throw new Error(SECRET); } }) },
  ] as readonly { name: string; body: () => unknown }[])("maps malformed $name shape to response invalid without provider text", async ({ body }) => {
    const error = await rejectWith(completeBody(body() as unknown as ReadableStream<Uint8Array>));
    expect(error.message).toBe("P1-6C bridge failed: LLAMA_RESPONSE_INVALID");
    expect(error.message).not.toContain(SECRET);
  });

  test.each([
    { name: "primitive result", results: () => [validChunk(), 7] },
    { name: "result accessor", results: () => [validChunk(), { value: undefined, get done() { throw new Error(SECRET); } }] },
    { name: "non-boolean done", results: () => [validChunk(), { value: undefined, done: "yes" }] },
    { name: "done result with value", results: () => [validChunk(), { value: bytes(SECRET), done: true }] },
    { name: "non-Uint8Array chunk", results: () => [{ value: SECRET, done: false }] },
    { name: "extra result key", results: () => [validChunk(), { value: undefined, done: true, extra: SECRET }] },
    { name: "missing result value", results: () => [validChunk(), { done: true }] },
  ])("maps malformed $name to response invalid without provider text", async ({ results }) => {
    const error = await rejectWith(completeBody(bodyWithReader(readerForResults(results()))));
    expect(error.message).toBe("P1-6C bridge failed: LLAMA_RESPONSE_INVALID");
    expect(error.message).not.toContain(SECRET);
  });

  test.each([
    { name: "synchronous read throw", read: () => { throw new Error(SECRET); } },
    { name: "rejected read promise", read: () => Promise.reject(new Error(SECRET)) },
  ])("maps a correctly captured $name to unavailable", async ({ read }) => {
    const error = await rejectWith(completeBody(bodyWithReader({ read, cancel() {}, releaseLock() {} })));
    expect(error.message).toBe("P1-6C bridge failed: LLAMA_UNAVAILABLE");
    expect(error.message).not.toContain(SECRET);
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

  test("rejects option, request, schema, and fetch proxies before invoking traps", async () => {
    const options = trackedProxy({ baseUrl: URL, model: "qwen35b", fetchImpl: createFetch([]) });
    expectInputError(() => createBasicLlamaCppDraftTransport(options.proxy));
    expectNoTrapCalls(options.calls);

    const transport = createBasicLlamaCppDraftTransport({ baseUrl: URL, model: "qwen35b", fetchImpl: createFetch([]) });
    const request = trackedProxy({ ...REQUEST });
    expect((await rejectWith(transport.complete(request.proxy))).message).toBe("P1-6C bridge failed: INPUT_INVALID");
    expectNoTrapCalls(request.calls);

    const schema = trackedProxy({ type: "object" });
    const schemaRequest = { ...REQUEST, response_format: { type: "json_schema" as const, schema: schema.proxy } };
    expect((await rejectWith(transport.complete(schemaRequest))).message).toBe("P1-6C bridge failed: INPUT_INVALID");
    expectNoTrapCalls(schema.calls);

    const fetchImpl = trackedProxy(async () => jsonResponse({}));
    expectInputError(() => createBasicLlamaCppDraftTransport({ baseUrl: URL, model: "qwen35b", fetchImpl: fetchImpl.proxy }));
    expectNoTrapCalls(fetchImpl.calls);
  });

  test.each([
    { name: "headers", create: () => {
      const tracked = trackedProxy({ get: () => "application/json" });
      return { response: { status: 200, redirected: false, headers: tracked.proxy, body: stream([bytes("{}")]) }, tracked };
    } },
    { name: "headers.get method", create: () => {
      const tracked = trackedProxy(() => "application/json");
      return { response: { status: 200, redirected: false, headers: { get: tracked.proxy }, body: stream([bytes("{}")]) }, tracked };
    } },
    { name: "body", create: () => {
      const tracked = trackedProxy(stream([bytes("{}")]));
      return { response: { status: 200, redirected: false, headers: { get: () => "application/json" }, body: tracked.proxy }, tracked };
    } },
    { name: "getReader method", create: () => {
      const tracked = trackedProxy(() => jsonReader());
      return { response: response(200, { getReader: tracked.proxy } as unknown as ReadableStream<Uint8Array>), tracked };
    } },
    { name: "reader", create: () => {
      const tracked = trackedProxy(jsonReader());
      return { response: response(200, bodyWithReader(tracked.proxy)), tracked };
    } },
    { name: "read method", create: () => {
      const tracked = trackedProxy(async () => validDone());
      return { response: response(200, bodyWithReader({ read: tracked.proxy, cancel() {}, releaseLock() {} })), tracked };
    } },
    { name: "cancel method", create: () => {
      const tracked = trackedProxy(() => Promise.resolve());
      return { response: response(200, bodyWithReader(jsonReader({ cancel: tracked.proxy }))), tracked };
    } },
    { name: "releaseLock method", create: () => {
      const tracked = trackedProxy(() => undefined);
      return { response: response(200, bodyWithReader(jsonReader({ releaseLock: tracked.proxy }))), tracked };
    } },
  ])("rejects a proxied $name without invoking traps", async ({ create }) => {
    const { response: responseValue, tracked } = create();
    const error = await rejectWith(createBasicLlamaCppDraftTransport({
      baseUrl: URL,
      model: "qwen35b",
      fetchImpl: createFetch([responseValue as BasicLlamaCppFetchResponse]),
    }).complete(REQUEST));
    expect(error.message).toBe("P1-6C bridge failed: LLAMA_RESPONSE_INVALID");
    expect(error.message).not.toContain(SECRET);
    expectNoTrapCalls(tracked.calls);
  });

  test("rejects a proxied read result before reflection traps", async () => {
    const tracked = trackedReflectionProxy(validDone());
    const error = await rejectWith(completeBody(bodyWithReader(readerForResults([validChunk(), tracked.proxy]))));
    expect(error.message).toBe("P1-6C bridge failed: LLAMA_RESPONSE_INVALID");
    expectNoReflectionTrapCalls(tracked.calls);
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

  test.each([
    ["application/json", true],
    ["application/problem+json", true],
    ["application/vnd.llama+json; charset=utf-8", true],
    ["application/json; charset=\"utf-8\"", true],
    ["x+json", false],
    ["+json", false],
    ["application/+json", false],
    ["application/", false],
    ["/json", false],
    ["application /json", false],
    ["application/json; char set=utf-8", false],
    ["application/json;", false],
  ])("accepts only complete JSON media types: %s", async (contentType, accepted) => {
    const transport = createBasicLlamaCppDraftTransport({
      baseUrl: URL,
      model: "qwen35b",
      fetchImpl: createFetch([jsonResponse({ ok: true }, 200, { contentType })]),
    });

    if (accepted) {
      await expect(transport.complete(REQUEST)).resolves.toEqual({ ok: true });
    } else {
      await expect(transport.complete(REQUEST)).rejects.toMatchObject({
        message: "P1-6C bridge failed: LLAMA_RESPONSE_INVALID",
      });
    }
  });

  test("returns valid JSON null without interpreting provider semantics", async () => {
    await expect(createBasicLlamaCppDraftTransport({
      baseUrl: URL,
      model: "qwen35b",
      fetchImpl: createFetch([jsonResponse(null)]),
    }).complete(REQUEST)).resolves.toBeNull();
  });
});

interface TrapCalls {
  get: number;
  getOwnPropertyDescriptor: number;
  getPrototypeOf: number;
  ownKeys: number;
  apply: number;
}

function bodyWithReader(reader: unknown): ReadableStream<Uint8Array> {
  return { getReader() { return reader; } } as unknown as ReadableStream<Uint8Array>;
}

function jsonReader(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return { ...readerForResults([validChunk(), validDone()]), ...overrides };
}

function readerForResults(
  results: readonly unknown[],
  cancel: () => unknown = () => undefined,
  releaseLock: () => unknown = () => undefined,
): Record<string, unknown> {
  let index = 0;
  return { read: () => Promise.resolve(results[index++]), cancel, releaseLock };
}

function validChunk(): { value: Uint8Array; done: false } { return { value: bytes("{}"), done: false }; }
function validDone(): { value: undefined; done: true } { return { value: undefined, done: true }; }

function completeBody(body: ReadableStream<Uint8Array>, timeoutMs?: number): Promise<unknown> {
  const fetchImpl: BasicLlamaCppFetch = async () => response(200, body);
  return createBasicLlamaCppDraftTransport({
    baseUrl: URL,
    model: "qwen35b",
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    fetchImpl,
  }).complete(REQUEST);
}

function trackedProxy<T extends object>(target: T): { proxy: T; calls: TrapCalls } {
  const calls: TrapCalls = { get: 0, getOwnPropertyDescriptor: 0, getPrototypeOf: 0, ownKeys: 0, apply: 0 };
  const trapped = (name: keyof TrapCalls): never => { calls[name] += 1; throw new Error(SECRET); };
  return {
    proxy: new Proxy(target, {
      get: () => trapped("get"),
      getOwnPropertyDescriptor: () => trapped("getOwnPropertyDescriptor"),
      getPrototypeOf: () => trapped("getPrototypeOf"),
      ownKeys: () => trapped("ownKeys"),
      apply: () => trapped("apply"),
    }),
    calls,
  };
}

function trackedReflectionProxy<T extends object>(target: T): {
  proxy: T;
  calls: Pick<TrapCalls, "getOwnPropertyDescriptor" | "getPrototypeOf" | "ownKeys">;
} {
  const calls = { getOwnPropertyDescriptor: 0, getPrototypeOf: 0, ownKeys: 0 };
  const trapped = (name: keyof typeof calls): never => { calls[name] += 1; throw new Error(SECRET); };
  return {
    proxy: new Proxy(target, {
      getOwnPropertyDescriptor: () => trapped("getOwnPropertyDescriptor"),
      getPrototypeOf: () => trapped("getPrototypeOf"),
      ownKeys: () => trapped("ownKeys"),
    }),
    calls,
  };
}

function expectNoTrapCalls(calls: TrapCalls): void {
  expect(calls).toEqual({ get: 0, getOwnPropertyDescriptor: 0, getPrototypeOf: 0, ownKeys: 0, apply: 0 });
}

function expectNoReflectionTrapCalls(
  calls: Pick<TrapCalls, "getOwnPropertyDescriptor" | "getPrototypeOf" | "ownKeys">,
): void {
  expect(calls).toEqual({ getOwnPropertyDescriptor: 0, getPrototypeOf: 0, ownKeys: 0 });
}

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
