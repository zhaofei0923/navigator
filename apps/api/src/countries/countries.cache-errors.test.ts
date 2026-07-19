import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  createApprovedPublicationCountryReadRuntime,
  DatabaseUnavailableError,
  DataIntegrityError,
} from "@navigator/db/country-read-runtime";
import type {
  CountryReadRepository,
  JsonValue,
} from "@navigator/shared-types/country-runtime";
import {
  COUNTRY_NOT_FOUND_GOLDEN_BODY,
  COUNTRY_ROUTE_GOLDEN_FIXTURES,
  type CountryRouteGoldenFixture,
} from "@navigator/shared-types/test-support/country-route-golden";
import { afterAll, describe, expect, test, vi } from "vitest";

import { AppModule } from "../app.module.js";
import { configureApplication } from "../main.js";
import {
  createReadonlyResponseCache,
  READONLY_RESPONSE_CACHE,
  type CacheableHttpSuccess,
  type CachedRead,
  type ReadonlyResponseCache,
} from "../ops/readonly-response-cache.js";
import { COUNTRY_READ_REPOSITORY } from "../runtime/country-read-runtime.provider.js";

const REPOSITORY_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const runtime = createApprovedPublicationCountryReadRuntime({
  repositoryRoot: REPOSITORY_ROOT,
});
const INTERNAL_ERROR_BODY = {
  error: { code: "INTERNAL_ERROR", message: "Internal server error" },
  success: false,
} as const;

afterAll(async () => {
  await runtime.close();
});

describe.sequential("country cache HTTP error boundaries", () => {
  test.each([
    ["list query", "/api/v1/countries?page=invalid"],
    ["detail query", "/api/v1/countries/ID?locale=fr"],
    ["module key", "/api/v1/countries/ID/modules/bad-module?locale=en"],
  ])("validates invalid %s before cache and repository work", async (_label, path) => {
    const repository = trackingRepository();
    const cache = trackingCache(testClock());
    const harness = await startApp(repository, cache);

    try {
      const response = await fetch(`${harness.baseUrl}${path}`);
      expect(response.status).toBe(400);
      expectNoCacheHeaders(response);
      expect(cache.keys).toEqual([]);
      expect(repository.list).not.toHaveBeenCalled();
      expect(repository.findByCode).not.toHaveBeenCalled();
    } finally {
      await harness.app.close();
    }
  });

  test("removes an expired success on null 404 before reloading the same key", async () => {
    const clock = testClock();
    const repository = trackingRepository();
    const harness = await startApp(repository, trackingCache(clock));
    const fixture = golden("detail-ID-localized-en");

    try {
      await expectSuccess(harness.baseUrl, fixture, "miss");
      clock.set(1_000);
      vi.mocked(repository.findByCode)
        .mockResolvedValueOnce(null)
        .mockRejectedValueOnce(new DatabaseUnavailableError());

      const notFound = await fetch(`${harness.baseUrl}${fixture.requestPath}`);
      expect(notFound.status).toBe(404);
      expectNoCacheHeaders(notFound);
      await expect(notFound.json()).resolves.toEqual(
        COUNTRY_NOT_FOUND_GOLDEN_BODY,
      );

      const unavailable = await fetch(
        `${harness.baseUrl}${fixture.requestPath}`,
      );
      expect(unavailable.status).toBe(500);
      expectNoCacheHeaders(unavailable);
      await expect(unavailable.json()).resolves.toEqual(INTERNAL_ERROR_BODY);

      await expectSuccess(harness.baseUrl, fixture, "miss");
      expect(repository.findByCode).toHaveBeenCalledTimes(4);
    } finally {
      await harness.app.close();
    }
  });

  test("does not turn integrity failures into stale or 404", async () => {
    const clock = testClock();
    const repository = trackingRepository();
    const harness = await startApp(repository, trackingCache(clock));
    const fixture = golden("detail-ID-localized-en");

    try {
      await expectSuccess(harness.baseUrl, fixture, "miss");
      clock.set(1_000);
      vi.mocked(repository.findByCode).mockRejectedValueOnce(
        new DataIntegrityError(),
      );
      const response = await fetch(`${harness.baseUrl}${fixture.requestPath}`);
      expect(response.status).toBe(500);
      expectNoCacheHeaders(response);
      await expect(response.json()).resolves.toEqual(INTERNAL_ERROR_BODY);
    } finally {
      await harness.app.close();
    }
  });

  test("keeps database failure without stale at fixed 500 and retries uncached", async () => {
    const repository = trackingRepository();
    vi.mocked(repository.list).mockRejectedValueOnce(
      new DatabaseUnavailableError(),
    );
    const harness = await startApp(repository, trackingCache(testClock()));
    const fixture = golden("list-localized-en");

    try {
      const failure = await fetch(`${harness.baseUrl}${fixture.requestPath}`);
      expect(failure.status).toBe(500);
      expectNoCacheHeaders(failure);
      await expect(failure.json()).resolves.toEqual(INTERNAL_ERROR_BODY);

      await expectSuccess(harness.baseUrl, fixture, "miss");
      expect(repository.list).toHaveBeenCalledTimes(2);
    } finally {
      await harness.app.close();
    }
  });
});

interface TestHarness {
  readonly app: INestApplication;
  readonly baseUrl: string;
}

interface TrackingCache extends ReadonlyResponseCache {
  readonly keys: string[];
}

function trackingCache(clock: ReturnType<typeof testClock>): TrackingCache {
  const delegate = createReadonlyResponseCache({
    maxEntries: 10,
    now: clock.now,
    staleIfErrorSeconds: 300,
    ttlSeconds: 1,
  });
  const keys: string[] = [];
  return {
    keys,
    getOrLoad<T extends JsonValue>(
      key: string,
      loader: () => Promise<CacheableHttpSuccess<T>>,
    ): Promise<CachedRead<T>> {
      keys.push(key);
      return delegate.getOrLoad(key, loader);
    },
    invalidateCountry: (code) => delegate.invalidateCountry(code),
    clear: () => delegate.clear(),
  };
}

function testClock() {
  let value = 0;
  return {
    now: () => value,
    set(next: number) {
      value = next;
    },
  };
}

function trackingRepository(): CountryReadRepository {
  return {
    findByCode: vi.fn((code: string) => runtime.repository.findByCode(code)),
    list: vi.fn(() => runtime.repository.list()),
  };
}

async function startApp(
  repository: CountryReadRepository,
  cache: ReadonlyResponseCache,
): Promise<TestHarness> {
  const module = await Test.createTestingModule({
    imports: [
      AppModule.register({
        port: 3100,
        metricsPort: 9464,
        countryReadSource: "canonical",
        readCacheMaxEntries: 10,
        readCacheStaleIfErrorSeconds: 300,
        readCacheTtlSeconds: 1,
        healthReadyTimeoutMs: 1000,
        canonicalRepositoryRoot: REPOSITORY_ROOT,
      }),
    ],
  })
    .overrideProvider(COUNTRY_READ_REPOSITORY)
    .useValue(repository)
    .overrideProvider(READONLY_RESPONSE_CACHE)
    .useValue(cache)
    .compile();
  const app = module.createNestApplication();
  configureApplication(app);
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address();
  if (address === null || typeof address === "string") {
    throw new Error("TEST_HTTP_ADDRESS_UNAVAILABLE");
  }
  return { app, baseUrl: `http://127.0.0.1:${address.port}` };
}

function golden(id: string): CountryRouteGoldenFixture {
  const fixture = COUNTRY_ROUTE_GOLDEN_FIXTURES.find((item) => item.id === id);
  if (fixture === undefined) throw new Error(`TEST_GOLDEN_MISSING:${id}`);
  return fixture;
}

async function expectSuccess(
  baseUrl: string,
  fixture: CountryRouteGoldenFixture,
  cacheState: "hit" | "miss",
): Promise<void> {
  const response = await fetch(`${baseUrl}${fixture.requestPath}`);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe(
    "application/json; charset=utf-8",
  );
  expect(response.headers.get("x-navigator-cache")).toBe(cacheState);
  expect(response.headers.get("x-navigator-data-stale")).toBeNull();
  await expect(response.json()).resolves.toEqual(fixture.expectedBody);
}

function expectNoCacheHeaders(response: Response): void {
  expect(response.headers.get("x-navigator-cache")).toBeNull();
  expect(response.headers.get("x-navigator-data-stale")).toBeNull();
}
