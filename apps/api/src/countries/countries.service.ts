import { Inject, Injectable } from "@nestjs/common";
import {
  formatCountriesResponse,
  formatCountryDetailResponse,
  formatCountryModuleResponse,
} from "@navigator/shared-types/country-runtime";
import type {
  CountryDetailFilters,
  CountryFilters,
  CountryModuleFilters,
  TextMode,
} from "@navigator/shared-types/country-api";
import type { ModuleKey } from "@navigator/shared-types/schema";

import {
  COUNTRY_READ_PROVIDER,
  type CountryReadProvider,
} from "./country-read-provider.js";

@Injectable()
export class CountriesService {
  constructor(
    @Inject(COUNTRY_READ_PROVIDER)
    private readonly repository: CountryReadProvider,
  ) {}

  async list(filters: CountryFilters, textMode: TextMode) {
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
  ) {
    return formatCountryDetailResponse(
      await this.repository.findByCode(code),
      filters,
      textMode,
    );
  }

  async module(
    code: string,
    moduleKey: ModuleKey,
    filters: CountryModuleFilters,
    textMode: TextMode,
  ) {
    return formatCountryModuleResponse(
      await this.repository.findByCode(code),
      moduleKey,
      filters,
      textMode,
    );
  }
}
