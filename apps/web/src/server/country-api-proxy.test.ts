import { afterEach, describe, expect, test, vi } from "vitest";

import type { ApiCountryQuery } from "@navigator/shared-types/country-query";

import { proxyCountryApi } from "./country-api-proxy.js";

const environment = {
  NODE_ENV: "development",
  API_INTERNAL_BASE_URL: "http://127.0.0.1:3100/api/v1",
} as const;

const query: ApiCountryQuery = {
  errors: {},
  filters: {
    coverageLevel: undefined,
    industryTags: [],
    locale: "en",
    page: 2,
    pageSize: 100,
    region: undefined,
    techTags: [],
  },
  textMode: "raw",
};

const INTERNAL_ERROR_BODY = {
  error: { code: "INTERNAL_ERROR", message: "Internal server error" },
  success: false,
};

const PROTECTION_TIMEOUT = Symbol("protection-timeout");

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("proxyCountryApi", () => {
  test("forwards only the explicit GET headers and a normalized target", async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe("GET");
      expect(init?.redirect).toBe("manual");
      const headers = new Headers(init?.headers);
      expect(Object.fromEntries(headers.entries())).toEqual({
        "accept-language": "en-US,en;q=0.9",
        traceparent: "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01",
        "x-request-id": "request_1234567890",
      });
      expect(headers.has("authorization")).toBe(false);
      expect(headers.has("cookie")).toBe(false);
      expect(headers.has("host")).toBe(false);
      expect(headers.has("x-forwarded-for")).toBe(false);

      return new Response(JSON.stringify({ data: { code: "ID" }, success: true }), {
        status: 206,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "x-request-id": "upstream-request-id",
          "X-Navigator-Cache": "stale",
          "X-Navigator-Data-Stale": "1",
        },
      });
    });
    const request = new Request("https://navigator.test/api/v1/countries/ID", {
      headers: {
        accept: "text/html",
        "accept-language": "en-US,en;q=0.9",
        authorization: "Bearer secret",
        cookie: "session=secret",
        host: "attacker.test",
        traceparent: "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01",
        "x-forwarded-for": "203.0.113.10",
        "x-request-id": "request_1234567890",
      },
    });

    const response = await proxyCountryApi(
      request,
      { kind: "detail", code: "ID", query },
      { environment, fetcher },
    );

    expect(fetcher).toHaveBeenCalledWith(
      "http://127.0.0.1:3100/api/v1/countries/ID?locale=en&page=2&pageSize=100&textMode=raw",
      expect.any(Object),
    );
    expect(response.status).toBe(206);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("x-request-id")).toBe("upstream-request-id");
    expect(response.headers.get("x-navigator-cache")).toBe("stale");
    expect(response.headers.get("x-navigator-data-stale")).toBe("1");
    expect(await response.json()).toEqual({ data: { code: "ID" }, success: true });
  });

  test("preserves the exact valid JSON bytes without rounding large integers", async () => {
    const upstreamBody = [
      "{",
      '  "largeInteger": 9007199254740993,',
      '  "formatted" : [ 1,  2 ]',
      "}",
      "",
    ].join("\n");
    const fetcher = vi.fn(async () =>
      new Response(upstreamBody, {
        status: 207,
        headers: {
          "content-type": "application/json; charset=utf-8",
          traceparent: "00-cccccccccccccccccccccccccccccccc-dddddddddddddddd-01",
          "x-request-id": "exact-body-request-id",
          "X-Navigator-Cache": "hit",
          "X-Navigator-Data-Stale": "0",
        },
      }),
    );

    const response = await proxyCountryApi(
      new Request("https://navigator.test/api/v1/countries"),
      { kind: "list", query },
      { environment, fetcher },
    );

    expect(response.status).toBe(207);
    expect(response.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(response.headers.get("traceparent")).toBe(
      "00-cccccccccccccccccccccccccccccccc-dddddddddddddddd-01",
    );
    expect(response.headers.get("x-request-id")).toBe("exact-body-request-id");
    expect(response.headers.get("x-navigator-cache")).toBe("hit");
    expect(response.headers.get("x-navigator-data-stale")).toBe("0");
    expect(await response.text()).toBe(upstreamBody);
  });

  test("encodes every path segment instead of allowing path injection", async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ success: true }), {
        headers: { "content-type": "application/json" },
      }),
    );

    await proxyCountryApi(
      new Request("https://navigator.test/api/v1/countries/example"),
      { kind: "detail", code: "../health?target=https://evil.test", query },
      { environment, fetcher },
    );

    expect(fetcher).toHaveBeenCalledWith(
      "http://127.0.0.1:3100/api/v1/countries/..%2Fhealth%3Ftarget%3Dhttps%3A%2F%2Fevil.test?locale=en&page=2&pageSize=100&textMode=raw",
      expect.any(Object),
    );
  });

  test("does not let an exact dot segment escape the fixed country path", async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ success: false }), {
        headers: { "content-type": "application/json" },
      }),
    );

    await proxyCountryApi(
      new Request("https://navigator.test/api/v1/countries/example"),
      { kind: "detail", code: "..", query },
      { environment, fetcher },
    );

    expect(fetcher).toHaveBeenCalledWith(
      "http://127.0.0.1:3100/api/v1/countries/%252E%252E?locale=en&page=2&pageSize=100&textMode=raw",
      expect.any(Object),
    );
  });

  test.each([
    ["redirect", new Response(null, { status: 302, headers: { location: "https://evil.test" } })],
    ["non-JSON", new Response("secret upstream text", { headers: { "content-type": "text/plain" } })],
    ["invalid JSON", new Response("{ database secret", { headers: { "content-type": "application/json" } })],
    [
      "oversized JSON",
      new Response(JSON.stringify("x".repeat(2 * 1024 * 1024)), {
        headers: { "content-type": "application/json" },
      }),
    ],
  ])("maps a %s upstream response to the fixed safe 500", async (_name, upstream) => {
    const response = await proxyCountryApi(
      new Request("https://navigator.test/api/v1/countries"),
      { kind: "list", query },
      { environment, fetcher: vi.fn(async () => upstream) },
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toMatch(/^application\/json\b/i);
    expect(await response.json()).toEqual(INTERNAL_ERROR_BODY);
  });

  test.each([
    {
      name: "redirect",
      status: 302,
      headers: { "content-type": "application/json" },
    },
    {
      name: "non-JSON",
      status: 200,
      headers: { "content-type": "text/plain" },
    },
    {
      name: "declared oversized",
      status: 200,
      headers: {
        "content-length": String(2 * 1024 * 1024 + 1),
        "content-type": "application/json",
      },
    },
  ])("aborts and cancels a $name streaming upstream without awaiting cancel", async ({
    status,
    headers,
  }) => {
    vi.useFakeTimers();
    let cancelled = false;
    let forwardedSignal: AbortSignal | null = null;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("partial"));
      },
      cancel() {
        cancelled = true;
        return new Promise<void>(() => undefined);
      },
    });
    const upstream = new Response(stream, { status, headers });
    const fetcher = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) => {
        forwardedSignal = init?.signal ?? null;
        return upstream;
      },
    );

    const responseOrTimeout = Promise.race([
      proxyCountryApi(
        new Request("https://navigator.test/api/v1/countries"),
        { kind: "list", query },
        { environment, fetcher },
      ),
      new Promise<typeof PROTECTION_TIMEOUT>((resolve) => {
        setTimeout(() => resolve(PROTECTION_TIMEOUT), 100);
      }),
    ]);
    await vi.advanceTimersByTimeAsync(100);
    const response = await responseOrTimeout;

    expect(response).not.toBe(PROTECTION_TIMEOUT);
    if (!(response instanceof Response)) {
      throw new Error("PROXY_CLEANUP_TIMEOUT");
    }
    expect(cancelled).toBe(true);
    expect((forwardedSignal as AbortSignal | null)?.aborted).toBe(true);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual(INTERNAL_ERROR_BODY);
  });

  test("maps connection failures without leaking the origin or exception", async () => {
    const response = await proxyCountryApi(
      new Request("https://navigator.test/api/v1/countries"),
      { kind: "list", query },
      {
        environment,
        fetcher: vi.fn(async () => {
          throw new Error("connect ECONNREFUSED http://db-secret.internal:3100");
        }),
      },
    );
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(500);
    expect(serialized).toBe(JSON.stringify(INTERNAL_ERROR_BODY));
    expect(serialized).not.toMatch(/ECONNREFUSED|db-secret|127\.0\.0\.1|3100/);
  });

  test("aborts an upstream request after exactly five seconds", async () => {
    vi.useFakeTimers();
    let forwardedSignal: AbortSignal | null = null;
    const fetcher = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
      forwardedSignal = init?.signal ?? null;
      return new Promise<Response>((_resolve, reject) => {
        forwardedSignal?.addEventListener("abort", () => reject(new Error("origin timeout")));
      });
    });
    const responsePromise = proxyCountryApi(
      new Request("https://navigator.test/api/v1/countries"),
      { kind: "list", query },
      { environment, fetcher },
    );

    await vi.advanceTimersByTimeAsync(4_999);
    expect((forwardedSignal as AbortSignal | null)?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const response = await responsePromise;

    expect((forwardedSignal as AbortSignal | null)?.aborted).toBe(true);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual(INTERNAL_ERROR_BODY);
  });

  test("rejects non-GET input before contacting the upstream", async () => {
    const fetcher = vi.fn();
    const response = await proxyCountryApi(
      new Request("https://navigator.test/api/v1/countries", { method: "POST" }),
      { kind: "list", query },
      { environment, fetcher },
    );

    expect(fetcher).not.toHaveBeenCalled();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual(INTERNAL_ERROR_BODY);
  });
});
