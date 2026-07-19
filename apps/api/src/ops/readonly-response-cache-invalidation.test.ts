import { describe, expect, test, vi } from "vitest";

import { DatabaseUnavailableError } from "@navigator/db/country-read-runtime";

import {
  buildCountryDetailCacheKey,
  buildCountryListCacheKey,
  buildCountryModuleCacheKey,
} from "./cache-key.js";
import {
  deferred,
  harness,
  success,
  unavailableLoader,
} from "./readonly-response-cache.test-support.js";
import type { CacheableHttpSuccess } from "./readonly-response-cache.js";

describe("bounded readonly response cache", () => {
  test("invalidates all list and exact-country keys without substring collisions", async () => {
    const { cache } = harness();
    const keys = {
      list: buildCountryListCacheKey(
        { locale: "en", page: 1, pageSize: 20 },
        "localized",
      ),
      id: buildCountryDetailCacheKey("ID", { locale: "en" }, "localized"),
      idModule: buildCountryModuleCacheKey(
        "ID",
        "policy",
        { locale: "en", page: 1, pageSize: 20 },
        "localized",
      ),
      idn: buildCountryDetailCacheKey("IDN", { locale: "en" }, "localized"),
      vn: buildCountryDetailCacheKey("VN", { locale: "en" }, "localized"),
    };
    const loaders = Object.fromEntries(
      Object.entries(keys).map(([name]) => [
        name,
        vi.fn(async () => success({ name })),
      ]),
    );
    for (const [name, key] of Object.entries(keys)) {
      await cache.getOrLoad(key, loaders[name]!);
    }
    cache.invalidateCountry(" id ");
    for (const [name, key] of Object.entries(keys)) {
      await cache.getOrLoad(key, loaders[name]!);
    }

    expect(loaders.list).toHaveBeenCalledTimes(2);
    expect(loaders.id).toHaveBeenCalledTimes(2);
    expect(loaders.idModule).toHaveBeenCalledTimes(2);
    expect(loaders.idn).toHaveBeenCalledOnce();
    expect(loaders.vn).toHaveBeenCalledOnce();
  });

  test("country invalidation also separates list in-flight generations", async () => {
    const { cache } = harness();
    const key = buildCountryListCacheKey(
      { locale: "en", page: 1, pageSize: 20 },
      "localized",
    );
    const oldFlight = deferred<CacheableHttpSuccess<{ version: number }>>();
    const newFlight = deferred<CacheableHttpSuccess<{ version: number }>>();
    const oldLoader = vi.fn(() => oldFlight.promise);
    const newLoader = vi.fn(() => newFlight.promise);
    const oldRequest = cache.getOrLoad(key, oldLoader);
    cache.invalidateCountry("VN");
    const newRequest = cache.getOrLoad(key, newLoader);

    expect(oldLoader).toHaveBeenCalledOnce();
    expect(newLoader).toHaveBeenCalledOnce();
    oldFlight.resolve(success({ version: 1 }));
    await oldRequest;
    const waiter = cache.getOrLoad(key, newLoader);
    expect(newLoader).toHaveBeenCalledOnce();
    newFlight.resolve(success({ version: 2 }));
    await expect(Promise.all([newRequest, waiter])).resolves.toEqual([
      { state: "miss", value: { version: 2 } },
      { state: "miss", value: { version: 2 } },
    ]);
    await expect(cache.getOrLoad(key, newLoader)).resolves.toMatchObject({
      state: "hit",
    });
  });

  test.each(["country", "clear"] as const)(
    "%s invalidation prevents an old refresh from returning revoked stale data",
    async (invalidation) => {
      const { cache, clock } = harness();
      const key = buildCountryDetailCacheKey(
        "ID",
        { locale: "en" },
        "localized",
      );
      await cache.getOrLoad(key, async () => success({ old: true }));
      clock.set(60_000);
      const failure = deferred<CacheableHttpSuccess<{ old: boolean }>>();
      const pending = cache.getOrLoad(key, () => failure.promise);
      if (invalidation === "country") cache.invalidateCountry("ID");
      else cache.clear();
      failure.reject(new DatabaseUnavailableError());

      await expect(pending).rejects.toBeInstanceOf(DatabaseUnavailableError);
      await expect(cache.getOrLoad(key, unavailableLoader)).rejects.toBeInstanceOf(
        DatabaseUnavailableError,
      );
    },
  );

  test.each(["country", "clear"] as const)(
    "%s invalidation separates two in-flight generations and identity-guards cleanup",
    async (invalidation) => {
      const { cache } = harness();
      const key = buildCountryDetailCacheKey(
        "ID",
        { locale: "en" },
        "localized",
      );
      const oldFlight = deferred<CacheableHttpSuccess<{ version: number }>>();
      const newFlight = deferred<CacheableHttpSuccess<{ version: number }>>();
      const oldLoader = vi.fn(() => oldFlight.promise);
      const newLoader = vi.fn(() => newFlight.promise);
      const oldRequest = cache.getOrLoad(key, oldLoader);
      if (invalidation === "country") cache.invalidateCountry("ID");
      else cache.clear();
      const newRequest = cache.getOrLoad(key, newLoader);
      const newWaiter = cache.getOrLoad(key, newLoader);
      expect(oldLoader).toHaveBeenCalledOnce();
      expect(newLoader).toHaveBeenCalledOnce();

      oldFlight.resolve(success({ version: 1 }));
      await expect(oldRequest).resolves.toMatchObject({ state: "miss" });
      const stillNewWaiter = cache.getOrLoad(key, newLoader);
      expect(newLoader).toHaveBeenCalledOnce();
      newFlight.resolve(success({ version: 2 }));
      const current = await Promise.all([newRequest, newWaiter, stillNewWaiter]);
      expect(current.map(({ value }) => value)).toEqual([
        { version: 2 },
        { version: 2 },
        { version: 2 },
      ]);
      await expect(cache.getOrLoad(key, newLoader)).resolves.toEqual({
        state: "hit",
        value: { version: 2 },
      });
    },
  );
});
