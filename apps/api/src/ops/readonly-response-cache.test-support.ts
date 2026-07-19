import { DatabaseUnavailableError } from "@navigator/db/country-read-runtime";
import type { JsonValue } from "@navigator/shared-types/country-runtime";

import {
  createReadonlyResponseCache,
  type CacheableHttpSuccess,
  type ReadonlyResponseCache,
} from "./readonly-response-cache.js";

export function harness(overrides: Partial<{
  ttlSeconds: number;
  staleIfErrorSeconds: number;
  maxEntries: number;
}> = {}): { cache: ReadonlyResponseCache; clock: TestClock } {
  const clock = new TestClock();
  return {
    cache: createReadonlyResponseCache({
      maxEntries: overrides.maxEntries ?? 1_000,
      now: () => clock.now,
      staleIfErrorSeconds: overrides.staleIfErrorSeconds ?? 300,
      ttlSeconds: overrides.ttlSeconds ?? 60,
    }),
    clock,
  };
}

export function success<T extends JsonValue>(value: T): CacheableHttpSuccess<T> {
  return { status: 200, value };
}

export async function unavailableLoader(): Promise<never> {
  throw new DatabaseUnavailableError();
}

class TestClock {
  now = 0;

  set(now: number): void {
    this.now = now;
  }
}

export function deferred<T>(): {
  promise: Promise<T>;
  reject(reason: unknown): void;
  resolve(value: T): void;
} {
  let resolvePromise: ((value: T) => void) | undefined;
  let rejectPromise: ((reason: unknown) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    reject(reason: unknown): void {
      if (rejectPromise === undefined) throw new Error("DEFERRED_UNAVAILABLE");
      rejectPromise(reason);
    },
    resolve(value: T): void {
      if (resolvePromise === undefined) throw new Error("DEFERRED_UNAVAILABLE");
      resolvePromise(value);
    },
  };
}

export async function captureError(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error;
  }
  throw new Error("Expected promise to reject with Error");
}
