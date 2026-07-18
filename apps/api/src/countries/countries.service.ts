import { Inject, Injectable } from "@nestjs/common";
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
  type TextMode,
} from "@navigator/shared-types/country-runtime";

import {
  COUNTRY_READ_PROVIDER,
  type CountryReadProvider,
} from "./country-read-provider.js";

type CountryModuleKey = Parameters<typeof formatCountryModuleResponse>[1];

@Injectable()
export class CountriesService {
  constructor(
    @Inject(COUNTRY_READ_PROVIDER)
    private readonly repository: CountryReadProvider,
  ) {}

  async list(
    filters: CountryFilters,
    textMode: TextMode,
  ): Promise<CountriesResponse> {
    return formatCountriesResponse(
      await this.repository.list(),
      filters,
      textMode,
    );
  }

  async detail(
    code: string,
    filters: CountryDetailFilters,
    textMode: TextMode,
  ): Promise<CountryDetailResponse | null> {
    return formatCountryDetailResponse(
      await this.repository.findByCode(code),
      filters,
      textMode,
    );
  }

  async module(
    code: string,
    moduleKey: CountryModuleKey,
    filters: CountryModuleFilters,
    textMode: TextMode,
  ): Promise<CountryModuleResponse | null> {
    return formatCountryModuleResponse(
      await this.repository.findByCode(code),
      moduleKey,
      filters,
      textMode,
    );
  }
}
