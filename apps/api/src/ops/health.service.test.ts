import { Test, type TestingModule } from "@nestjs/testing";
import { describe, expect, test, vi } from "vitest";

import type { ApiConfig } from "../api-config.js";
import {
  API_CONFIG,
  CountryReadRuntimeProvider,
} from "../runtime/country-read-runtime.provider.js";
import { HealthService } from "./health.service.js";

describe("HealthService", () => {
  test("checks the selected runtime with the exact configured finite bounds", async () => {
    const ping = vi.fn(async () => undefined);
    const { module, service } = await createService(ping, 1375);

    try {
      await expect(service.isReady()).resolves.toBe(true);
      await expect(service.isReady()).resolves.toBe(true);
      expect(ping).toHaveBeenCalledTimes(2);
      expect(ping).toHaveBeenNthCalledWith(1, {
        maxWaitMs: 1375,
        timeoutMs: 1375,
      });
      expect(ping).toHaveBeenNthCalledWith(2, {
        maxWaitMs: 1375,
        timeoutMs: 1375,
      });
    } finally {
      await module.close();
    }
  });

  test.each([
    new Error(
      "postgresql://navigator:secret@db.internal/private SELECT credentials",
    ),
    "non-error-secret",
  ])("maps runtime failure to not-ready without throwing or retaining %p", async (failure) => {
    const ping = vi.fn(async () => {
      throw failure;
    });
    const { module, service } = await createService(ping, 1000);

    try {
      await expect(service.isReady()).resolves.toBe(false);
      expect(ping).toHaveBeenCalledExactlyOnceWith({
        maxWaitMs: 1000,
        timeoutMs: 1000,
      });
    } finally {
      await module.close();
    }
  });

  test("maps a synchronous runtime failure to not-ready", async () => {
    const ping = vi.fn((_options): Promise<void> => {
      throw new Error("synchronous-private-runtime-failure");
    });
    const { module, service } = await createService(ping, 1000);

    try {
      await expect(service.isReady()).resolves.toBe(false);
      expect(ping).toHaveBeenCalledOnce();
    } finally {
      await module.close();
    }
  });

  test("waits for the runtime-owned timeout before reporting not-ready", async () => {
    let rejectPing: ((reason?: unknown) => void) | undefined;
    const ping = vi.fn(
      () => new Promise<void>((_resolve, reject) => {
        rejectPing = reject;
      }),
    );
    const { module, service } = await createService(ping, 1000);
    vi.useFakeTimers();

    try {
      let readinessResult: boolean | undefined;
      const readiness = service.isReady().then((result) => {
        readinessResult = result;
        return result;
      });

      expect(ping).toHaveBeenCalledExactlyOnceWith({
        maxWaitMs: 1000,
        timeoutMs: 1000,
      });
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(5000);
      expect(readinessResult).toBeUndefined();

      if (rejectPing === undefined) throw new Error("DEFERRED_PING_NOT_STARTED");
      rejectPing(new Error("RUNTIME_OWNED_TIMEOUT"));
      await expect(readiness).resolves.toBe(false);
    } finally {
      vi.useRealTimers();
      await module.close();
    }
  });
});

async function createService(
  ping: (options: {
    readonly maxWaitMs: number;
    readonly timeoutMs: number;
  }) => Promise<void>,
  healthReadyTimeoutMs: number,
): Promise<{ module: TestingModule; service: HealthService }> {
  const config: ApiConfig = {
    port: 3100,
    countryReadSource: "database",
    readCacheTtlSeconds: 60,
    readCacheStaleIfErrorSeconds: 300,
    readCacheMaxEntries: 1000,
    healthReadyTimeoutMs,
    databaseUrl: "postgresql://navigator:secret@127.0.0.1:5432/navigator",
    databasePoolMax: 10,
    databasePoolTimeoutSeconds: 5,
    databaseConnectTimeoutSeconds: 5,
  };
  const module = await Test.createTestingModule({
    providers: [
      HealthService,
      { provide: API_CONFIG, useValue: config },
      { provide: CountryReadRuntimeProvider, useValue: { ping } },
    ],
  }).compile();
  return { module, service: module.get(HealthService) };
}
