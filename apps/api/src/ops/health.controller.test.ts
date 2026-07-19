import { type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { CountryReadRuntime } from "@navigator/db/country-read-runtime";

import { type ApiConfig } from "../api-config.js";
import { AppModule } from "../app.module.js";
import { configureApplication } from "../main.js";
import {
  COUNTRY_READ_RUNTIME_FACTORIES,
  type CountryReadRuntimeFactories,
} from "../runtime/country-read-runtime.provider.js";
import { READONLY_RESPONSE_CACHE } from "./readonly-response-cache.js";

const applications: INestApplication[] = [];

afterEach(async () => {
  await Promise.all(applications.splice(0).map((application) => application.close()));
});

describe("health HTTP contract", () => {
  test.each(["database", "canonical"] as const)(
    "serves root probes for the selected %s runtime and rejects prefixed aliases",
    async (source) => {
      const ping = vi.fn(async () => undefined);
      const fixture = await startApplication(source, ping, 1375);

      const live = await fetch(`${fixture.baseUrl}/health/live`);
      expect(live.status).toBe(200);
      expect(live.headers.get("cache-control")).toBe("no-store");
      expect(live.headers.get("content-type")).toMatch(/^application\/json\b/i);
      await expect(live.json()).resolves.toEqual({ status: "ok" });
      expect(ping).not.toHaveBeenCalled();

      const ready = await fetch(`${fixture.baseUrl}/health/ready`);
      expect(ready.status).toBe(200);
      expect(ready.headers.get("cache-control")).toBe("no-store");
      expect(ready.headers.get("content-type")).toMatch(/^application\/json\b/i);
      await expect(ready.json()).resolves.toEqual({ status: "ready" });
      expect(ping).toHaveBeenCalledExactlyOnceWith({
        maxWaitMs: 1375,
        timeoutMs: 1375,
      });
      expectCacheUntouched(fixture);

      for (const path of ["/api/v1/health/live", "/api/v1/health/ready"]) {
        const response = await fetch(`${fixture.baseUrl}${path}`);
        expect(response.status).toBe(404);
        await expect(response.json()).resolves.toEqual({
          error: {
            code: "NOT_FOUND",
            details: null,
            message: "Resource not found",
          },
          success: false,
        });
      }

      if (source === "database") {
        expect(
          fixture.factories.createPrismaCountryReadRuntime,
        ).toHaveBeenCalledOnce();
        expect(
          fixture.factories.createApprovedPublicationCountryReadRuntime,
        ).not.toHaveBeenCalled();
      } else {
        expect(
          fixture.factories.createApprovedPublicationCountryReadRuntime,
        ).toHaveBeenCalledOnce();
        expect(
          fixture.factories.createPrismaCountryReadRuntime,
        ).not.toHaveBeenCalled();
      }
    },
  );

  test("keeps liveness healthy and returns a fixed 503 when runtime ping fails", async () => {
    const ping = vi.fn(async () => {
      throw new Error(
        "postgresql://navigator:secret@db.internal/private SELECT credentials",
      );
    });
    const fixture = await startApplication("database", ping, 1000);

    const live = await fetch(`${fixture.baseUrl}/health/live`);
    expect(live.status).toBe(200);
    expect(live.headers.get("cache-control")).toBe("no-store");
    expect(live.headers.get("content-type")).toMatch(/^application\/json\b/i);
    await expect(live.json()).resolves.toEqual({ status: "ok" });
    expect(ping).not.toHaveBeenCalled();

    const ready = await fetch(`${fixture.baseUrl}/health/ready`);
    expect(ready.status).toBe(503);
    expect(ready.headers.get("cache-control")).toBe("no-store");
    expect(ready.headers.get("content-type")).toMatch(/^application\/json\b/i);
    const body: unknown = await ready.json();
    expect(body).toEqual({ status: "not_ready" });
    expect(JSON.stringify(body)).not.toMatch(
      /postgresql|secret|db\.internal|SELECT|credentials|stack|cause/i,
    );
    expectCacheUntouched(fixture);
  });
});

async function startApplication(
  source: "database" | "canonical",
  ping: CountryReadRuntime["ping"],
  healthReadyTimeoutMs: number,
): Promise<{
  baseUrl: string;
  cacheClear: ReturnType<typeof vi.fn>;
  cacheGetOrLoad: ReturnType<typeof vi.fn>;
  cacheInvalidateCountry: ReturnType<typeof vi.fn>;
  factories: CountryReadRuntimeFactories;
}> {
  const runtime: CountryReadRuntime = {
    repository: {} as CountryReadRuntime["repository"],
    ping,
    close: vi.fn(async () => undefined),
  };
  const factories: CountryReadRuntimeFactories = {
    createPrismaCountryReadRuntime: vi.fn(() => runtime),
    createApprovedPublicationCountryReadRuntime: vi.fn(() => runtime),
  };
  const cacheGetOrLoad = vi.fn(() => {
    throw new Error("HEALTH_MUST_BYPASS_READ_CACHE");
  });
  const cacheClear = vi.fn();
  const cacheInvalidateCountry = vi.fn();
  const config = createConfig(source, healthReadyTimeoutMs);
  const module = await Test.createTestingModule({
    imports: [AppModule.register(config)],
  })
    .overrideProvider(COUNTRY_READ_RUNTIME_FACTORIES)
    .useValue(factories)
    .overrideProvider(READONLY_RESPONSE_CACHE)
    .useValue({
      clear: cacheClear,
      getOrLoad: cacheGetOrLoad,
      invalidateCountry: cacheInvalidateCountry,
    })
    .compile();
  const application = module.createNestApplication({ logger: false });
  applications.push(application);
  configureApplication(application);
  await application.listen(0, "127.0.0.1");
  const address = application.getHttpServer().address();
  if (address === null || typeof address === "string") {
    throw new Error("TEST_HTTP_ADDRESS_UNAVAILABLE");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    cacheClear,
    cacheGetOrLoad,
    cacheInvalidateCountry,
    factories,
  };
}

function expectCacheUntouched(fixture: {
  readonly cacheClear: ReturnType<typeof vi.fn>;
  readonly cacheGetOrLoad: ReturnType<typeof vi.fn>;
  readonly cacheInvalidateCountry: ReturnType<typeof vi.fn>;
}): void {
  expect(fixture.cacheGetOrLoad).toHaveBeenCalledTimes(0);
  expect(fixture.cacheClear).toHaveBeenCalledTimes(0);
  expect(fixture.cacheInvalidateCountry).toHaveBeenCalledTimes(0);
}

function createConfig(
  source: "database" | "canonical",
  healthReadyTimeoutMs: number,
): ApiConfig {
  const common = {
    port: 3100,
    metricsPort: 9464,
    readCacheTtlSeconds: 60,
    readCacheStaleIfErrorSeconds: 300,
    readCacheMaxEntries: 1000,
    healthReadyTimeoutMs,
  };
  if (source === "canonical") {
    return {
      ...common,
      countryReadSource: "canonical",
      canonicalRepositoryRoot: "/srv/navigator",
    };
  }
  return {
    ...common,
    countryReadSource: "database",
    databaseUrl: "postgresql://navigator:secret@127.0.0.1:5432/navigator",
    databasePoolMax: 10,
    databasePoolTimeoutSeconds: 5,
    databaseConnectTimeoutSeconds: 5,
  };
}
