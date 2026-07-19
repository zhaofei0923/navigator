import { describe, expect, test, vi } from "vitest";

import { createReadonlyResponseCache } from "./readonly-response-cache.js";

describe("readonly response cache options", () => {
  test.each([
    { maxEntries: 10, staleIfErrorSeconds: 0, ttlSeconds: 1 },
    { maxEntries: 10_000, staleIfErrorSeconds: 600, ttlSeconds: 300 },
  ])("accepts inclusive option boundaries", (options) => {
    expect(() => createReadonlyResponseCache(options)).not.toThrow();
  });

  test.each([
    ["ttl below minimum", { maxEntries: 10, staleIfErrorSeconds: 0, ttlSeconds: 0 }],
    ["ttl above maximum", { maxEntries: 10, staleIfErrorSeconds: 0, ttlSeconds: 301 }],
    ["fractional ttl", { maxEntries: 10, staleIfErrorSeconds: 0, ttlSeconds: 1.5 }],
    ["non-finite ttl", { maxEntries: 10, staleIfErrorSeconds: 0, ttlSeconds: Number.NaN }],
    ["stale below minimum", { maxEntries: 10, staleIfErrorSeconds: -1, ttlSeconds: 1 }],
    ["stale above maximum", { maxEntries: 10, staleIfErrorSeconds: 601, ttlSeconds: 1 }],
    ["fractional stale", { maxEntries: 10, staleIfErrorSeconds: 0.5, ttlSeconds: 1 }],
    ["entries below minimum", { maxEntries: 9, staleIfErrorSeconds: 0, ttlSeconds: 1 }],
    ["entries above maximum", { maxEntries: 10_001, staleIfErrorSeconds: 0, ttlSeconds: 1 }],
    ["fractional entries", { maxEntries: 10.5, staleIfErrorSeconds: 0, ttlSeconds: 1 }],
  ] as const)("rejects %s with one fixed error", (_label, options) => {
    expectFixedOptionsError(() => createReadonlyResponseCache(options));
  });

  test("rejects a non-function clock and malformed options", () => {
    expectFixedOptionsError(() =>
      createReadonlyResponseCache({
        maxEntries: 10,
        now: "not-a-clock" as never,
        staleIfErrorSeconds: 0,
        ttlSeconds: 1,
      }),
    );
    expectFixedOptionsError(() => createReadonlyResponseCache(null as never));
  });

  test.each([
    ["throws", () => { throw new Error("private-clock-error"); }],
    ["returns NaN", () => Number.NaN],
    ["returns Infinity", () => Number.POSITIVE_INFINITY],
  ] as const)("fails closed when the clock %s", async (_label, now) => {
    const cache = createReadonlyResponseCache({
      maxEntries: 10,
      now,
      staleIfErrorSeconds: 0,
      ttlSeconds: 1,
    });
    const loader = vi.fn(async () => ({ status: 200 as const, value: null }));

    await expect(cache.getOrLoad("clock", loader)).rejects.toMatchObject({
      message: "READ_CACHE_OPTIONS_INVALID",
    });
    expect(loader).not.toHaveBeenCalled();
  });
});

function expectFixedOptionsError(action: () => unknown): void {
  let captured: Error | undefined;
  try {
    action();
  } catch (error) {
    if (error instanceof Error) captured = error;
  }
  expect(captured?.message).toBe("READ_CACHE_OPTIONS_INVALID");
  expect(captured).not.toHaveProperty("cause");
}
