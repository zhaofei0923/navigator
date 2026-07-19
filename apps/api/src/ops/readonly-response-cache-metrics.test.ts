import { DatabaseUnavailableError } from "@navigator/db/country-read-runtime";
import { describe, expect, test, vi } from "vitest";

import {
  buildCountryDetailCacheKey,
  buildCountryListCacheKey,
  buildCountryModuleCacheKey,
} from "./cache-key.js";
import type { MetricsRecorder } from "./metrics-registry.js";
import { createReadonlyResponseCache } from "./readonly-response-cache.js";

describe("readonly response cache metrics", () => {
  test("records one fixed route and state for every caller including single-flight", async () => {
    const metrics = metricsRecorder();
    let resolveLoad: ((value: { status: 200; value: null }) => void) | undefined;
    const cache = createReadonlyResponseCache({
      maxEntries: 10,
      metrics,
      staleIfErrorSeconds: 300,
      ttlSeconds: 1,
    });
    const key = buildCountryDetailCacheKey("ID", { locale: "en" }, "localized");
    const loader = vi.fn(
      () =>
        new Promise<{ status: 200; value: null }>((resolve) => {
          resolveLoad = resolve;
        }),
    );

    const first = cache.getOrLoad(key, loader);
    const second = cache.getOrLoad(key, loader);
    resolveLoad?.({ status: 200, value: null });

    await expect(first).resolves.toMatchObject({ state: "miss" });
    await expect(second).resolves.toMatchObject({ state: "miss" });
    await expect(cache.getOrLoad(key, loader)).resolves.toMatchObject({
      state: "hit",
    });
    expect(loader).toHaveBeenCalledOnce();
    expect(metrics.recordCacheRequest.mock.calls).toEqual([
      [{ route: "/api/v1/countries/:code", state: "miss" }],
      [{ route: "/api/v1/countries/:code", state: "miss" }],
      [{ route: "/api/v1/countries/:code", state: "hit" }],
    ]);
  });

  test("records stale and failed loads without reflecting cache key input", async () => {
    let now = 0;
    const metrics = metricsRecorder();
    const cache = createReadonlyResponseCache({
      maxEntries: 10,
      metrics,
      now: () => now,
      staleIfErrorSeconds: 300,
      ttlSeconds: 1,
    });
    const listKey = buildCountryListCacheKey({ locale: "en" }, "localized");
    const moduleKey = buildCountryModuleCacheKey(
      "VN",
      "policy",
      { locale: "en" },
      "localized",
    );

    await cache.getOrLoad(listKey, async () => ({ status: 200, value: null }));
    now = 1_000;
    await expect(
      cache.getOrLoad(listKey, async () => {
        throw new DatabaseUnavailableError();
      }),
    ).resolves.toMatchObject({ state: "stale" });
    await expect(
      cache.getOrLoad(moduleKey, async () => {
        throw new Error("private-ID-VN-query");
      }),
    ).rejects.toThrow("private-ID-VN-query");
    await expect(
      cache.getOrLoad("private-ID-VN?query=secret", async () => ({
        status: 200,
        value: null,
      })),
    ).resolves.toMatchObject({ state: "miss" });

    expect(metrics.recordCacheRequest.mock.calls).toEqual([
      [{ route: "/api/v1/countries", state: "miss" }],
      [{ route: "/api/v1/countries", state: "stale" }],
      [
        {
          route: "/api/v1/countries/:code/modules/:moduleKey",
          state: "miss",
        },
      ],
      [{ route: "UNMATCHED", state: "miss" }],
    ]);
    expect(JSON.stringify(metrics.recordCacheRequest.mock.calls)).not.toMatch(
      /private|ID|VN|query|secret|policy/,
    );
  });

  test("isolates recorder failures from cache behavior", async () => {
    const metrics = metricsRecorder();
    metrics.recordCacheRequest.mockImplementation(() => {
      throw new Error("private-metrics-failure");
    });
    const cache = createReadonlyResponseCache({
      maxEntries: 10,
      metrics,
      staleIfErrorSeconds: 0,
      ttlSeconds: 1,
    });
    const key = buildCountryListCacheKey({}, "localized");

    await expect(
      cache.getOrLoad(key, async () => ({ status: 200, value: null })),
    ).resolves.toEqual({ state: "miss", value: null });
    await expect(
      cache.getOrLoad(key, async () => ({ status: 200, value: null })),
    ).resolves.toEqual({ state: "hit", value: null });
    expect(metrics.recordCacheRequest).toHaveBeenCalledTimes(2);
  });
});

function metricsRecorder() {
  return {
    recordCacheRequest: vi.fn(),
    recordHttpRequest: vi.fn(),
    observeDbOperation: <T>(_operation: never, work: () => Promise<T>) => work(),
  } satisfies MetricsRecorder;
}
