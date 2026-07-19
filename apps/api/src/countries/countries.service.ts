import { Inject, Injectable } from "@nestjs/common";
import { CountryNotFoundError } from "@navigator/db/country-read-runtime";
import {
  formatCountriesResponse,
  formatCountryDetailResponse,
  formatCountryModuleResponse,
  type CountriesResponse,
  type CountryDetailFilters,
  type CountryDetailResponse,
  type CountryFilters,
  type CountryModuleFilters,
  type CountryModuleResponse,
  type JsonValue,
  type TextMode,
} from "@navigator/shared-types/country-runtime";

import type { ApiConfig } from "../api-config.js";
import {
  buildCountryDetailCacheKey,
  buildCountryListCacheKey,
  buildCountryModuleCacheKey,
  type CountryModuleKey,
} from "../ops/cache-key.js";
import {
  METRICS_REGISTRY,
  type DbMetricOperation,
  type MetricsRecorder,
} from "../ops/metrics-registry.js";
import {
  READONLY_RESPONSE_CACHE,
  type CachedRead,
  type ReadonlyResponseCache,
} from "../ops/readonly-response-cache.js";
import { API_CONFIG } from "../runtime/country-read-runtime.provider.js";
import {
  COUNTRY_READ_PROVIDER,
  type CountryReadProvider,
} from "./country-read-provider.js";

@Injectable()
export class CountriesService {
  constructor(
    @Inject(COUNTRY_READ_PROVIDER)
    private readonly repository: CountryReadProvider,
    @Inject(READONLY_RESPONSE_CACHE)
    private readonly cache: ReadonlyResponseCache,
    @Inject(API_CONFIG)
    private readonly config: ApiConfig,
    @Inject(METRICS_REGISTRY)
    private readonly metrics: MetricsRecorder,
  ) {}

  async list(
    filters: CountryFilters,
    textMode: TextMode,
  ): Promise<CachedRead<CountriesResponse>> {
    const cached = await this.cache.getOrLoad(
      buildCountryListCacheKey(filters, textMode),
      async () => cacheableSuccess(
        formatCountriesResponse(
          await this.readDatabase("country_list", () => this.repository.list()),
          filters,
          textMode,
        ),
      ),
    );
    return typedCachedRead<CountriesResponse>(cached);
  }

  async detail(
    code: string,
    filters: CountryDetailFilters,
    textMode: TextMode,
  ): Promise<CachedRead<CountryDetailResponse>> {
    const cached = await this.cache.getOrLoad(
      buildCountryDetailCacheKey(code, filters, textMode),
      async () => {
        const snapshot = await this.readDatabase("country_detail", () =>
          this.repository.findByCode(code),
        );
        if (snapshot === null) throw new CountryNotFoundError();
        const response = formatCountryDetailResponse(
          snapshot,
          filters,
          textMode,
        );
        if (response === null) throw new Error("COUNTRY_DETAIL_FORMAT_INVALID");
        return cacheableSuccess(response);
      },
    );
    return typedCachedRead<CountryDetailResponse>(cached);
  }

  async module(
    code: string,
    moduleKey: CountryModuleKey,
    filters: CountryModuleFilters,
    textMode: TextMode,
  ): Promise<CachedRead<CountryModuleResponse>> {
    const cached = await this.cache.getOrLoad(
      buildCountryModuleCacheKey(code, moduleKey, filters, textMode),
      async () => {
        const snapshot = await this.readDatabase("country_module", () =>
          this.repository.findByCode(code),
        );
        if (snapshot === null) throw new CountryNotFoundError();
        const response = formatCountryModuleResponse(
          snapshot,
          moduleKey,
          filters,
          textMode,
        );
        if (response === null) throw new Error("COUNTRY_MODULE_FORMAT_INVALID");
        return cacheableSuccess(response);
      },
    );
    return typedCachedRead<CountryModuleResponse>(cached);
  }

  private readDatabase<T>(
    operation: DbMetricOperation,
    work: () => Promise<T>,
  ): Promise<T> {
    if (this.config.countryReadSource === "canonical") return work();
    return this.metrics.observeDbOperation(operation, work);
  }
}

function cacheableSuccess<T>(value: T): {
  readonly status: 200;
  readonly value: JsonValue;
} {
  // Formatter DTOs are JSON-only contracts but intentionally lack a broad index signature.
  return { status: 200, value: value as unknown as JsonValue };
}

function typedCachedRead<T>(cached: CachedRead<JsonValue>): CachedRead<T> {
  // The cache preserves the formatter JSON body; this restores its narrower DTO type.
  return { state: cached.state, value: cached.value as unknown as T };
}
