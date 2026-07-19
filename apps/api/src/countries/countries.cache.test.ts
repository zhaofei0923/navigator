import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  createApprovedPublicationCountryReadRuntime,
  DatabaseUnavailableError,
} from "@navigator/db/country-read-runtime";
import type { CountryReadRepository } from "@navigator/shared-types/country-runtime";
import {
  COUNTRY_ROUTE_GOLDEN_FIXTURES,
  type CountryRouteGoldenFixture,
} from "@navigator/shared-types/test-support/country-route-golden";
import { afterAll, describe, expect, test, vi } from "vitest";

import { AppModule } from "../app.module.js";
import { configureApplication } from "../main.js";
import {
  createReadonlyResponseCache,
  READONLY_RESPONSE_CACHE,
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
afterAll(async () => {
  await runtime.close();
});

describe.sequential("country readonly cache HTTP integration", () => {
  test("registers one cache and preserves list, detail, and module goldens on miss then hit", async () => {
    const repository = trackingRepository();
    const harness = await startApp(repository);

    try {
      expect(harness.app.get(READONLY_RESPONSE_CACHE)).toBe(
        harness.app.get(READONLY_RESPONSE_CACHE),
      );

      const requests = [
        {
          first: "/api/v1/countries?locale=en&page=01",
          second: "/api/v1/countries?page=1&locale=en",
          fixture: golden("list-localized-en"),
        },
        {
          first: "/api/v1/countries/ID?locale=en",
          second: "/api/v1/countries/id?locale=en",
          fixture: golden("detail-ID-localized-en"),
        },
        {
          first: "/api/v1/countries/ID/modules/policy?locale=en&page=1",
          second: "/api/v1/countries/id/modules/policy?page=1&locale=en",
          fixture: golden("module-policy-localized-en"),
        },
      ] as const;

      for (const request of requests) {
        await expectSuccess(harness.baseUrl, request.first, request.fixture, "miss");
        await expectSuccess(harness.baseUrl, request.second, request.fixture, "hit");
      }

      expect(repository.list).toHaveBeenCalledOnce();
      expect(repository.findByCode).toHaveBeenCalledTimes(2);
    } finally {
      await harness.app.close();
    }
  });

  test("serves list, detail, and module from stale only for typed transient failures", async () => {
    const clock = testClock();
    const repository = trackingRepository();
    const cache = responseCache(clock);
    const harness = await startApp(repository, cache);
    const fixtures = [
      golden("list-localized-en"),
      golden("detail-ID-localized-en"),
      golden("module-policy-localized-en"),
    ] as const;

    try {
      for (const fixture of fixtures) {
        await expectSuccess(
          harness.baseUrl,
          fixture.requestPath,
          fixture,
          "miss",
        );
      }
      clock.set(1_000);
      vi.mocked(repository.list).mockRejectedValueOnce(
        new DatabaseUnavailableError(),
      );
      vi.mocked(repository.findByCode)
        .mockRejectedValueOnce(new DatabaseUnavailableError())
        .mockRejectedValueOnce(new DatabaseUnavailableError());

      for (const fixture of fixtures) {
        const response = await fetch(
          `${harness.baseUrl}${fixture.requestPath}`,
        );
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe(
          "application/json; charset=utf-8",
        );
        expect(response.headers.get("x-navigator-cache")).toBe("stale");
        expect(response.headers.get("x-navigator-data-stale")).toBe("1");
        await expect(response.json()).resolves.toEqual(fixture.expectedBody);
      }
      expect(repository.list).toHaveBeenCalledTimes(2);
      expect(repository.findByCode).toHaveBeenCalledTimes(4);
    } finally {
      await harness.app.close();
    }
  });
});

interface TestHarness {
  readonly app: INestApplication;
  readonly baseUrl: string;
}

function responseCache(clock: ReturnType<typeof testClock>): ReadonlyResponseCache {
  return createReadonlyResponseCache({
    maxEntries: 10,
    now: clock.now,
    staleIfErrorSeconds: 300,
    ttlSeconds: 1,
  });
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
  cache?: ReadonlyResponseCache,
): Promise<TestHarness> {
  let builder = Test.createTestingModule({
    imports: [
      AppModule.register({
        port: 3100,
        countryReadSource: "canonical",
        readCacheMaxEntries: 10,
        readCacheStaleIfErrorSeconds: 300,
        readCacheTtlSeconds: 1,
        canonicalRepositoryRoot: REPOSITORY_ROOT,
      }),
    ],
  }).overrideProvider(COUNTRY_READ_REPOSITORY).useValue(repository);
  if (cache !== undefined) {
    builder = builder.overrideProvider(READONLY_RESPONSE_CACHE).useValue(cache);
  }
  const module = await builder.compile();
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
  path: string,
  fixture: CountryRouteGoldenFixture,
  cacheState: "hit" | "miss",
): Promise<void> {
  const response = await fetch(`${baseUrl}${path}`);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe(
    "application/json; charset=utf-8",
  );
  expect(response.headers.get("x-navigator-cache")).toBe(cacheState);
  expect(response.headers.get("x-navigator-data-stale")).toBeNull();
  await expect(response.json()).resolves.toEqual(fixture.expectedBody);
}
