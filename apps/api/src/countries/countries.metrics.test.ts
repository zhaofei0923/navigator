import { CountryNotFoundError } from "@navigator/db/country-read-runtime";
import type { CountryReadRepository } from "@navigator/shared-types/country-runtime";
import { describe, expect, test, vi } from "vitest";

import type { ApiConfig } from "../api-config.js";
import type { MetricsRecorder } from "../ops/metrics-registry.js";
import type {
  CacheableHttpSuccess,
  ReadonlyResponseCache,
} from "../ops/readonly-response-cache.js";
import { CountriesService } from "./countries.service.js";

describe("CountriesService database metrics", () => {
  test("measures each database loader as a fixed logical operation", async () => {
    const operations: string[] = [];
    const repository = emptyRepository();
    const service = new CountriesService(
      repository,
      loadingCache(),
      databaseConfig(),
      metricsRecorder(operations),
    );

    await expect(service.list({}, "localized")).resolves.toMatchObject({
      state: "miss",
    });
    await expect(service.detail("ID", {}, "localized")).rejects.toBeInstanceOf(
      CountryNotFoundError,
    );
    await expect(
      service.module("VN", "policy", {}, "localized"),
    ).rejects.toBeInstanceOf(CountryNotFoundError);

    expect(operations).toEqual([
      "country_list",
      "country_detail",
      "country_module",
    ]);
    expect(repository.list).toHaveBeenCalledOnce();
    expect(repository.findByCode).toHaveBeenCalledTimes(2);
  });

  test("does not claim canonical reads or cache hits are database operations", async () => {
    const canonicalOperations: string[] = [];
    const canonicalRepository = emptyRepository();
    const canonicalService = new CountriesService(
      canonicalRepository,
      loadingCache(),
      canonicalConfig(),
      metricsRecorder(canonicalOperations),
    );
    const hitOperations: string[] = [];
    const hitRepository = emptyRepository();
    const hitService = new CountriesService(
      hitRepository,
      hitCache(),
      databaseConfig(),
      metricsRecorder(hitOperations),
    );

    await canonicalService.list({}, "localized");
    await hitService.list({}, "localized");

    expect(canonicalOperations).toEqual([]);
    expect(hitOperations).toEqual([]);
    expect(canonicalRepository.list).toHaveBeenCalledOnce();
    expect(hitRepository.list).not.toHaveBeenCalled();
  });
});

function emptyRepository() {
  return {
    findByCode: vi.fn(async () => null),
    list: vi.fn(async () => []),
  } satisfies CountryReadRepository;
}

function loadingCache(): ReadonlyResponseCache {
  return {
    async getOrLoad(key, loader) {
      void key;
      const response = await loader();
      return { state: "miss", value: response.value };
    },
    invalidateCountry: () => undefined,
    clear: () => undefined,
  };
}

function hitCache(): ReadonlyResponseCache {
  return {
    async getOrLoad<T>(
      _key: string,
      _loader: () => Promise<CacheableHttpSuccess<T & never>>,
    ) {
      return { state: "hit" as const, value: null as T };
    },
    invalidateCountry: () => undefined,
    clear: () => undefined,
  } as ReadonlyResponseCache;
}

function metricsRecorder(operations: string[]): MetricsRecorder {
  return {
    recordCacheRequest: () => undefined,
    recordHttpRequest: () => undefined,
    async observeDbOperation(operation, work) {
      operations.push(operation);
      return work();
    },
  };
}

function databaseConfig(): ApiConfig {
  return {
    port: 3100,
    metricsPort: 9464,
    countryReadSource: "database",
    readCacheTtlSeconds: 60,
    readCacheStaleIfErrorSeconds: 300,
    readCacheMaxEntries: 1000,
    healthReadyTimeoutMs: 1000,
    databaseUrl: "postgresql://navigator:secret@127.0.0.1/navigator",
    databasePoolMax: 10,
    databasePoolTimeoutSeconds: 5,
    databaseConnectTimeoutSeconds: 5,
  };
}

function canonicalConfig(): ApiConfig {
  return {
    port: 3100,
    metricsPort: 9464,
    countryReadSource: "canonical",
    readCacheTtlSeconds: 60,
    readCacheStaleIfErrorSeconds: 300,
    readCacheMaxEntries: 1000,
    healthReadyTimeoutMs: 1000,
    canonicalRepositoryRoot: "/srv/navigator",
  };
}
