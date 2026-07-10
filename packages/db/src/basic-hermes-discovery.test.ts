import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  BASIC_HERMES_DISCOVERY_MAX_QUERIES,
  BASIC_HERMES_DISCOVERY_MAX_RESULTS,
  BASIC_HERMES_DISCOVERY_SCHEMA_VERSION,
  BASIC_HERMES_DISCOVERY_TIMEOUT_MS,
  type BasicHermesDiscoveryCandidate,
  type BasicHermesDiscoveryRequest,
} from "./collection/basic-hermes-llama-contracts.js";
import { BasicCollectionBridgeError } from "./collection/basic-collection-bridge-error.js";
import { runBasicHermesDiscovery } from "./collection/basic-hermes-discovery.js";

const REQUEST: BasicHermesDiscoveryRequest = {
  countryCode: "ID",
  runId: "run-hermes-1",
  queries: ["Indonesia solar policy"],
  maxResults: 10,
};

function candidate(overrides: Partial<BasicHermesDiscoveryCandidate> = {}) {
  return {
    discoveryId: "candidate-1",
    provider: "searxng" as const,
    query: REQUEST.queries[0]!,
    title: "Solar policy",
    snippet: "A transient search result",
    url: "https://example.com/result",
    discoveredAt: "2026-07-10T09:40:00.000Z",
    discoveryOnly: true as const,
    ...overrides,
  };
}

function response(candidates: readonly BasicHermesDiscoveryCandidate[]) {
  return {
    schemaVersion: BASIC_HERMES_DISCOVERY_SCHEMA_VERSION,
    runId: REQUEST.runId,
    countryCode: REQUEST.countryCode,
    candidates,
  };
}

function portReturning(value: unknown) {
  return { discover: async () => value };
}

function expectFailure(result: Awaited<ReturnType<typeof runBasicHermesDiscovery>>) {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected bridge failure");
  return result.error;
}

describe("Basic Hermes discovery bridge", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", () => {
      throw new Error("network access is forbidden in discovery tests");
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("exports the documented discovery limits and reconstructs stable frozen output", async () => {
    expect(BASIC_HERMES_DISCOVERY_TIMEOUT_MS).toBe(300_000);
    expect(BASIC_HERMES_DISCOVERY_MAX_QUERIES).toBe(20);
    expect(BASIC_HERMES_DISCOVERY_MAX_RESULTS).toBe(50);

    const input = response([
      candidate({
        discoveryId: "b",
        url: "https://example.com:443/z/../b",
        title: "B",
      }),
      candidate({
        discoveryId: "a",
        url: "https://example.com/a",
        title: "A",
      }),
    ]);
    const result = await runBasicHermesDiscovery(REQUEST, portReturning(input));

    expect(result).toEqual({ ok: true, data: {
      ...input,
      candidates: [input.candidates[1], { ...input.candidates[0], url: "https://example.com/b" }],
    } });
    if (!result.ok) return;
    expect(result.data.candidates.map(({ discoveryId }) => discoveryId)).toEqual(["a", "b"]);
    expect(result.data.candidates[1]?.url).toBe("https://example.com/b");
    expect(Object.isFrozen(result.data)).toBe(true);
    expect(Object.isFrozen(result.data.candidates)).toBe(true);
    expect(Object.isFrozen(result.data.candidates[0])).toBe(true);
    expect(() => {
      result.data.candidates[0]!.title = "changed";
    }).toThrow();
  });

  test("snapshots the request and calls an inherited method with Reflect.apply without reading bind", async () => {
    const seen: { request?: BasicHermesDiscoveryRequest; signal?: AbortSignal } = {};
    class HermesPort {
      discover(request: BasicHermesDiscoveryRequest, signal: AbortSignal) {
        seen.request = request;
        seen.signal = signal;
        return Promise.resolve(response([candidate()]));
      }
    }
    const port = new HermesPort() as HermesPort & { bind?: unknown };
    Object.defineProperty(port, "bind", {
      get() {
        throw new Error("bind must not be read");
      },
      enumerable: true,
    });
    const mutableRequest = { ...REQUEST, queries: [...REQUEST.queries] };
    const resultPromise = runBasicHermesDiscovery(mutableRequest, port);
    mutableRequest.queries[0] = "MUTATED";
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    expect(seen.request).toEqual(REQUEST);
    expect(Object.isFrozen(seen.request)).toBe(true);
    expect(seen.signal).toBeInstanceOf(AbortSignal);
  });

  test.each(["extra key", "symbol key", "accessor key", "sparse queries"] as const)(
    "rejects a caller request with an %s before calling the port",
    async (kind) => {
      const unsafe = { ...REQUEST, queries: [...REQUEST.queries] } as Record<PropertyKey, unknown>;
      if (kind === "extra key") unsafe.extra = "untrusted";
      if (kind === "symbol key") unsafe[Symbol("untrusted")] = true;
      if (kind === "accessor key") Object.defineProperty(unsafe, "runId", {
        get: () => REQUEST.runId,
        enumerable: true,
      });
      if (kind === "sparse queries") delete (unsafe.queries as unknown[])[0];
      let calls = 0;

      const error = expectFailure(await runBasicHermesDiscovery(unsafe, {
        discover: async () => {
          calls += 1;
          return response([]);
        },
      }));

      expect(error.code).toBe("INPUT_INVALID");
      expect(calls).toBe(0);
    },
  );

  test("reconstructs the provider response before later mutation", async () => {
    const mutable = response([candidate()]);
    const result = await runBasicHermesDiscovery(REQUEST, portReturning(mutable));
    mutable.candidates[0]!.title = "mutated provider value";
    mutable.candidates[0]!.url = "https://mutated.example/";

    expect(result).toMatchObject({ ok: true, data: { candidates: [{
      title: "Solar policy",
      url: "https://example.com/result",
    }] } });
  });

  test.each([
    ["wrong identity", response([candidate()]), { runId: "other-run" }],
    ["duplicate id", response([candidate(), candidate({ url: "https://example.com/other" })]), {}],
    ["duplicate canonical url", response([candidate(), candidate({ discoveryId: "candidate-2", url: "https://example.com:443/result" })]), {}],
  ] as const)("rejects %s", async (_label, value, change) => {
    const result = await runBasicHermesDiscovery(REQUEST, portReturning({ ...value, ...change }));
    expect(expectFailure(result).code).toMatch(/HERMES_RESPONSE_INVALID|SEARXNG_RECORD_INVALID/);
  });

  test.each([
    "missing key",
    "extra key",
    "inherited key",
    "symbol key",
    "accessor key",
    "sparse array",
    "custom array",
  ] as const)("fails closed for %s response structures", async (kind) => {
    const value = response([candidate()]) as Record<string, unknown>;
    if (kind === "missing key") delete value.countryCode;
    if (kind === "extra key") value.extra = "nope";
    if (kind === "inherited key") Object.setPrototypeOf(value, { countryCode: REQUEST.countryCode });
    if (kind === "symbol key") Object.defineProperty(value, Symbol("secret"), { value: "nope" });
    if (kind === "accessor key") Object.defineProperty(value, "runId", { get: () => REQUEST.runId, enumerable: true });
    if (kind === "sparse array") delete (value.candidates as unknown[])[0];
    if (kind === "custom array") Object.setPrototypeOf(value.candidates, { custom: true });

    const error = expectFailure(await runBasicHermesDiscovery(REQUEST, portReturning(value)));
    expect(error.code).toBe("HERMES_RESPONSE_INVALID");
  });

  test.each([
    "http://example.com/result",
    "https://user:secret@example.com/result",
    "https://127.0.0.1/result",
    "https://10.0.0.4/result",
    "https://169.254.1.4/result",
    "https://224.0.0.1/result",
    "https://0.0.0.0/result",
    "https://[::1]/result",
  ])("rejects unsafe discovery URL %s without leaking it", async (url) => {
    const result = await runBasicHermesDiscovery(REQUEST, portReturning(response([candidate({ url })])));
    const error = expectFailure(result);
    expect(error.code).toBe("DISCOVERY_URL_FORBIDDEN");
    expect(JSON.stringify(result)).not.toContain(url);
  });

  test("rejects invalid query and result limits", async () => {
    const tooManyQueries = { ...REQUEST, queries: Array.from({ length: 21 }, (_, index) => `q-${index}`) };
    const tooManyResults = response(Array.from({ length: 51 }, (_, index) => candidate({ discoveryId: `candidate-${index}` })));

    expect(expectFailure(await runBasicHermesDiscovery(tooManyQueries, portReturning(response([])))).code).toBe("INPUT_INVALID");
    expect(expectFailure(await runBasicHermesDiscovery(REQUEST, portReturning(tooManyResults))).code).toBe("HERMES_RESPONSE_INVALID");
  });

  test("rejects malformed candidate fields and query identity", async () => {
    const malformed = candidate({ provider: "other" as "searxng" });
    const wrongQuery = candidate({ query: "different query" });
    const nonDiscovery = candidate({ discoveryOnly: false as true });
    const invalidTimestamp = candidate({ discoveredAt: "not-a-timestamp" });

    expect(expectFailure(await runBasicHermesDiscovery(REQUEST, portReturning(response([malformed])))).code).toBe("SEARXNG_RECORD_INVALID");
    expect(expectFailure(await runBasicHermesDiscovery(REQUEST, portReturning(response([wrongQuery])))).code).toBe("SEARXNG_RECORD_INVALID");
    expect(expectFailure(await runBasicHermesDiscovery(REQUEST, portReturning(response([nonDiscovery])))).code).toBe("SEARXNG_RECORD_INVALID");
    expect(expectFailure(await runBasicHermesDiscovery(REQUEST, portReturning(response([invalidTimestamp])))).code).toBe("SEARXNG_RECORD_INVALID");
  });

  test("rejects unsafe ports and bounded prototype cycles", async () => {
    const target = Object.create(null);
    let cyclicPrototype: object;
    cyclicPrototype = new Proxy(target, { getPrototypeOf: () => cyclicPrototype });
    expect(expectFailure(await runBasicHermesDiscovery(REQUEST, cyclicPrototype))).toEqual({
      code: "INPUT_INVALID",
      phase: "input",
      retryable: false,
    });
  });

  test("rejects alternating and over-depth port prototype lookups", async () => {
    const target = Object.create(null);
    let left: object;
    let right: object;
    left = new Proxy(target, { getPrototypeOf: () => right });
    right = new Proxy(target, { getPrototypeOf: () => left });
    let deep: object = Object.create(null);
    for (let index = 0; index <= 16; index += 1) deep = Object.create(deep);

    for (const port of [left, deep]) {
      expect(expectFailure(await runBasicHermesDiscovery(REQUEST, port))).toEqual({
        code: "INPUT_INVALID",
        phase: "input",
        retryable: false,
      });
    }
  });

  test("maps sync throws and rejected promises to sanitized unavailable failures", async () => {
    const secret = "PROVIDER_SECRET_4af1";
    const syncResult = await runBasicHermesDiscovery(REQUEST, { discover: () => { throw new Error(secret); } });
    const rejection = await runBasicHermesDiscovery(REQUEST, { discover: async () => { throw new Error(secret); } });

    expect(expectFailure(syncResult)).toEqual({ code: "HERMES_UNAVAILABLE", phase: "hermes", retryable: true });
    expect(expectFailure(rejection)).toEqual({ code: "HERMES_UNAVAILABLE", phase: "hermes", retryable: true });
    expect(JSON.stringify(syncResult)).not.toContain(secret);
  });

  test("aborts at the default timeout, ignores a late response, and clears the timer", async () => {
    vi.useFakeTimers();
    try {
      let resolveDiscovery: ((value: unknown) => void) | undefined;
      let signal: AbortSignal | undefined;
      const pending = runBasicHermesDiscovery(REQUEST, {
        discover: (_request: BasicHermesDiscoveryRequest, receivedSignal: AbortSignal) => {
          signal = receivedSignal;
          return new Promise((resolve) => {
            resolveDiscovery = resolve;
          });
        },
      });
      await vi.advanceTimersByTimeAsync(BASIC_HERMES_DISCOVERY_TIMEOUT_MS);
      const result = await pending;

      expect(expectFailure(result)).toEqual({ code: "HERMES_TIMEOUT", phase: "hermes", retryable: true });
      expect(signal?.aborted).toBe(true);
      resolveDiscovery?.(response([candidate({ title: "late secret" })]));
      await vi.runAllTicks();
      expect(JSON.stringify(result)).not.toContain("late secret");
    } finally {
      vi.useRealTimers();
    }
  });

  test("exposes only sanitized bridge errors and keeps discovery candidates transient", async () => {
    const error = new BasicCollectionBridgeError("HERMES_UNAVAILABLE", new Error("secret"));
    expect(error.message).toBe("P1-6C bridge failed: HERMES_UNAVAILABLE");
    expect("cause" in error).toBe(false);
    const result = await runBasicHermesDiscovery(REQUEST, portReturning(response([candidate()])));
    expect(JSON.stringify(result)).not.toMatch(/source|fact|model|review|canonical|ai|repo|path/i);
  });
});
