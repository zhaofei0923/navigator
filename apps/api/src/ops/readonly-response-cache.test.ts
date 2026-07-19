import { describe, expect, test, vi } from "vitest";

import {
  CountryNotFoundError,
  DatabaseUnavailableError,
  DataIntegrityError,
} from "@navigator/db/country-read-runtime";

import {
  captureError,
  deferred,
  harness,
  success,
  unavailableLoader,
} from "./readonly-response-cache.test-support.js";
import type { CacheableHttpSuccess } from "./readonly-response-cache.js";

describe("bounded readonly response cache", () => {
  test("returns isolated miss and hit clones without retaining loader mutations", async () => {
    const { cache } = harness();
    const original = { nested: { values: ["source"] } };
    const loader = vi.fn(async () => success(original));

    const miss = await cache.getOrLoad("opaque-key", loader);
    original.nested.values[0] = "mutated-after-load";
    miss.value.nested.values.push("mutated-caller");
    const hit = await cache.getOrLoad("opaque-key", loader);

    expect(miss.state).toBe("miss");
    expect(hit).toEqual({
      state: "hit",
      value: { nested: { values: ["source"] } },
    });
    expect(loader).toHaveBeenCalledOnce();
  });

  test("single-flights one key, isolates waiters, and keeps different keys independent", async () => {
    const { cache } = harness();
    const first = deferred<CacheableHttpSuccess<{ values: string[] }>>();
    const second = deferred<CacheableHttpSuccess<{ values: string[] }>>();
    const firstLoader = vi.fn(() => first.promise);
    const secondLoader = vi.fn(() => second.promise);

    const firstWaiter = cache.getOrLoad("first", firstLoader);
    const secondWaiter = cache.getOrLoad("first", firstLoader);
    const independent = cache.getOrLoad("second", secondLoader);
    expect(firstLoader).toHaveBeenCalledOnce();
    expect(secondLoader).toHaveBeenCalledOnce();

    first.resolve(success({ values: ["first"] }));
    second.resolve(success({ values: ["second"] }));
    const [one, two, other] = await Promise.all([
      firstWaiter,
      secondWaiter,
      independent,
    ]);
    one.value.values.push("caller-one");

    expect(two.value).toEqual({ values: ["first"] });
    expect(other.value).toEqual({ values: ["second"] });
    expect(one.value).not.toBe(two.value);
  });

  test("cleans a rejected flight and retries the next loader", async () => {
    const { cache } = harness();
    await expect(
      cache.getOrLoad("retry", async () => {
        throw new Error("first failure");
      }),
    ).rejects.toThrow("first failure");

    await expect(
      cache.getOrLoad("retry", async () => success({ attempt: 2 })),
    ).resolves.toEqual({ state: "miss", value: { attempt: 2 } });
  });

  test("uses exact TTL and stale boundaries without extending stale lifetime", async () => {
    const { cache, clock } = harness();
    const loader = vi.fn(async () => success({ version: 1 }));
    await cache.getOrLoad("timed", loader);

    clock.set(59_999);
    await expect(cache.getOrLoad("timed", loader)).resolves.toMatchObject({
      state: "hit",
    });
    clock.set(60_000);
    await expect(
      cache.getOrLoad("timed", unavailableLoader),
    ).resolves.toEqual({ state: "stale", value: { version: 1 } });
    clock.set(360_000);
    await expect(
      cache.getOrLoad("timed", unavailableLoader),
    ).resolves.toMatchObject({ state: "stale" });
    clock.set(360_001);
    await expect(cache.getOrLoad("timed", unavailableLoader)).rejects.toBeInstanceOf(
      DatabaseUnavailableError,
    );
    expect(loader).toHaveBeenCalledOnce();
  });

  test("single-flights transient refreshes while returning isolated stale clones", async () => {
    const { cache, clock } = harness();
    await cache.getOrLoad("stale-clones", async () =>
      success({ nested: { values: ["old"] } }),
    );
    clock.set(60_000);
    const failure = deferred<CacheableHttpSuccess<{ nested: { values: string[] } }>>();
    const loader = vi.fn(() => failure.promise);
    const first = cache.getOrLoad("stale-clones", loader);
    const second = cache.getOrLoad("stale-clones", loader);
    failure.reject(new DatabaseUnavailableError());

    const [one, two] = await Promise.all([first, second]);
    one.value.nested.values.push("caller-one");
    expect(one.state).toBe("stale");
    expect(two).toEqual({
      state: "stale",
      value: { nested: { values: ["old"] } },
    });
    expect(loader).toHaveBeenCalledOnce();
  });

  test("stale=0 never serves stale and transient failures are never cached", async () => {
    const { cache, clock } = harness({ staleIfErrorSeconds: 0 });
    await cache.getOrLoad("no-stale", async () => success({ version: 1 }));
    clock.set(60_000);

    await expect(
      cache.getOrLoad("no-stale", unavailableLoader),
    ).rejects.toBeInstanceOf(DatabaseUnavailableError);
    await expect(
      cache.getOrLoad("no-stale", async () => success({ version: 2 })),
    ).resolves.toEqual({ state: "miss", value: { version: 2 } });
  });

  test.each([
    ["integrity", () => new DataIntegrityError()],
    ["not-found", () => new CountryNotFoundError()],
    ["programmer", () => new TypeError("programmer")],
    ["unknown", () => new Error("unknown")],
    [
      "spoof",
      () => Object.assign(new Error("DATABASE_UNAVAILABLE"), {
        name: "DatabaseUnavailableError",
      }),
    ],
  ])("does not stale on %s and permanently removes the old value", async (_label, error) => {
    const { cache, clock } = harness();
    await cache.getOrLoad("non-transient", async () => success({ old: true }));
    clock.set(60_000);

    await expect(
      cache.getOrLoad("non-transient", async () => {
        throw error();
      }),
    ).rejects.toEqual(error());
    await expect(
      cache.getOrLoad("non-transient", unavailableLoader),
    ).rejects.toBeInstanceOf(DatabaseUnavailableError);
  });

  test("only accepts an explicit status-200 wrapper and removes stale on invalid success", async () => {
    const { cache, clock } = harness();
    await cache.getOrLoad("wrapper", async () => success({ old: true }));
    clock.set(60_000);

    await expect(
      cache.getOrLoad("wrapper", async () =>
        ({ status: 201, value: { invalid: true } }) as never,
      ),
    ).rejects.toThrow("READ_CACHE_VALUE_INVALID");
    await expect(
      cache.getOrLoad("wrapper", async () =>
        ({ status: 200, value: { invalid: true }, extra: "not-contract" }) as never,
      ),
    ).rejects.toThrow("READ_CACHE_VALUE_INVALID");
    await expect(
      cache.getOrLoad("wrapper", unavailableLoader),
    ).rejects.toBeInstanceOf(DatabaseUnavailableError);
  });

  test("sanitizes hostile wrapper reflection failures", async () => {
    const { cache } = harness();
    const wrapper = new Proxy(
      { status: 200, value: { safe: true } },
      {
        getPrototypeOf() {
          throw new Error("secret-reflection-failure");
        },
      },
    );

    const error = await captureError(
      cache.getOrLoad("hostile-wrapper", async () => wrapper as never),
    );
    expect(error.message).toBe("READ_CACHE_VALUE_INVALID");
    expect(error.message).not.toContain("secret-reflection-failure");
    expect("cause" in error).toBe(false);
  });

  test("serializes one descriptor snapshot without rereading a changing Proxy", async () => {
    const { cache } = harness();
    const value = new Proxy(
      { safe: "descriptor-snapshot" },
      {
        get() {
          throw new Error("must-not-reread-proxy");
        },
      },
    );

    await expect(
      cache.getOrLoad("proxy-snapshot", async () =>
        success({ nested: value } as never),
      ),
    ).resolves.toEqual({
      state: "miss",
      value: { nested: { safe: "descriptor-snapshot" } },
    });
    await expect(
      cache.getOrLoad("proxy-snapshot", async () => success({ replaced: true })),
    ).resolves.toEqual({
      state: "hit",
      value: { nested: { safe: "descriptor-snapshot" } },
    });
  });

  test.each([
    ["NaN", { value: Number.NaN }],
    ["Infinity", { value: Number.POSITIVE_INFINITY }],
    ["BigInt", { value: BigInt(1) }],
    ["Date", { value: new Date(0) }],
  ])("rejects non-JSON %s values and clears the flight", async (_label, value) => {
    const { cache } = harness();
    await expect(
      cache.getOrLoad("invalid-json", async () => success(value as never)),
    ).rejects.toThrow("READ_CACHE_VALUE_INVALID");
    await expect(
      cache.getOrLoad("invalid-json", async () => success({ valid: true })),
    ).resolves.toMatchObject({ state: "miss" });
  });

  test("rejects cycles and accessors without retaining their errors or old stale", async () => {
    const { cache, clock } = harness();
    await cache.getOrLoad("unsafe", async () => success({ old: true }));
    clock.set(60_000);
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;

    await expect(
      cache.getOrLoad("unsafe", async () => success(cycle as never)),
    ).rejects.toThrow("READ_CACHE_VALUE_INVALID");
    const accessor = Object.defineProperty({}, "secret", {
      enumerable: true,
      get() {
        throw new Error("must-not-run-accessor");
      },
    });
    await expect(
      cache.getOrLoad("unsafe", async () => success(accessor as never)),
    ).rejects.toThrow("READ_CACHE_VALUE_INVALID");
    await expect(cache.getOrLoad("unsafe", unavailableLoader)).rejects.toBeInstanceOf(
      DatabaseUnavailableError,
    );
  });
});
