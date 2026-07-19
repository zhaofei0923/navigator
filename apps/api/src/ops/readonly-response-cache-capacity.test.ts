import { describe, expect, test, vi } from "vitest";

import { DatabaseUnavailableError } from "@navigator/db/country-read-runtime";

import {
  harness,
  success,
  unavailableLoader,
} from "./readonly-response-cache.test-support.js";

const MIB = 1024 * 1024;

describe("bounded readonly response cache", () => {
  test("caches exactly 1 MiB by UTF-8 bytes and returns larger values without caching", async () => {
    const { cache } = harness();
    const exact = "é".repeat((MIB - 2) / 2);
    const tooLarge = `${exact}a`;
    const exactLoader = vi.fn(async () => success(exact));
    const largeLoader = vi.fn(async () => success(tooLarge));

    await expect(cache.getOrLoad("exact", exactLoader)).resolves.toMatchObject({
      state: "miss",
    });
    await expect(cache.getOrLoad("exact", exactLoader)).resolves.toMatchObject({
      state: "hit",
    });
    await cache.getOrLoad("large", largeLoader);
    await cache.getOrLoad("large", largeLoader);

    expect(exactLoader).toHaveBeenCalledOnce();
    expect(largeLoader).toHaveBeenCalledTimes(2);
  });

  test("an oversize replacement removes stale but does not evict unrelated entries", async () => {
    const { cache, clock } = harness();
    const unrelatedLoader = vi.fn(async () => success({ retained: true }));
    await cache.getOrLoad("replace", async () => success({ old: true }));
    clock.set(1);
    await cache.getOrLoad("unrelated", unrelatedLoader);
    clock.set(60_000);

    await expect(
      cache.getOrLoad("replace", async () => success("x".repeat(MIB))),
    ).resolves.toMatchObject({ state: "miss" });
    await expect(
      cache.getOrLoad("replace", unavailableLoader),
    ).rejects.toBeInstanceOf(DatabaseUnavailableError);
    await expect(
      cache.getOrLoad("unrelated", unrelatedLoader),
    ).resolves.toMatchObject({ state: "hit" });
  });

  test("enforces deterministic entry-count LRU and refreshes recency on hit", async () => {
    const { cache } = harness({ maxEntries: 10 });
    const loaders = Array.from({ length: 11 }, (_, index) =>
      vi.fn(async () => success({ index })),
    );
    for (let index = 0; index < 10; index += 1) {
      await cache.getOrLoad(`key-${index}`, loaders[index]!);
    }
    await cache.getOrLoad("key-0", loaders[0]!);
    await cache.getOrLoad("key-10", loaders[10]!);

    await cache.getOrLoad("key-0", loaders[0]!);
    await cache.getOrLoad("key-1", loaders[1]!);
    expect(loaders[0]).toHaveBeenCalledOnce();
    expect(loaders[1]).toHaveBeenCalledTimes(2);
  });

  test("enforces the 16 MiB total budget independently of entry count", async () => {
    const { cache } = harness({ maxEntries: 100 });
    const payload = "x".repeat(MIB - 2);
    const loaders = Array.from({ length: 17 }, (_, index) =>
      vi.fn(async () => success(`${payload.slice(0, -2)}${String(index).padStart(2, "0")}`)),
    );
    for (let index = 0; index < 17; index += 1) {
      await cache.getOrLoad(`bytes-${index}`, loaders[index]!);
    }

    await cache.getOrLoad("bytes-0", loaders[0]!);
    await cache.getOrLoad("bytes-16", loaders[16]!);
    expect(loaders[0]).toHaveBeenCalledTimes(2);
    expect(loaders[16]).toHaveBeenCalledOnce();
  });
});
