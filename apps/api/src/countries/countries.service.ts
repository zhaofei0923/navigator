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

import {
  buildCountryDetailCacheKey,
  buildCountryListCacheKey,
  buildCountryModuleCacheKey,
  type CountryModuleKey,
} from "../ops/cache-key.js";
import {
  READONLY_RESPONSE_CACHE,
  type CachedRead,
  type ReadonlyResponseCache,
} from "../ops/readonly-response-cache.js";
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
  ) {}

  async list(
    filters: CountryFilters,
    textMode: TextMode,
  ): Promise<CachedRead<CountriesResponse>> {
    const cached = await this.cache.getOrLoad(
      buildCountryListCacheKey(filters, textMode),
      async () => cacheableSuccess(
        formatCountriesResponse(
          await this.repository.list(),
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
        const snapshot = await this.repository.findByCode(code);
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
        const snapshot = await this.repository.findByCode(code);
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
