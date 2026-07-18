import { Global, Module, type DynamicModule } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import type { CountryReadRepository } from "@navigator/shared-types/country-runtime";

import type { ApiConfig } from "./api-config.js";
import { ContractExceptionFilter } from "./common/contract-exception.filter.js";
import { CountriesModule } from "./countries/countries.module.js";
import {
  API_CONFIG,
  COUNTRY_READ_REPOSITORY,
  COUNTRY_READ_RUNTIME_FACTORIES,
  COUNTRY_READ_RUNTIME_FACTORIES_DEFAULT,
  CountryReadRuntimeProvider,
} from "./runtime/country-read-runtime.provider.js";

@Global()
@Module({})
export class AppModule {
  static register(config: ApiConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [CountriesModule],
      providers: [
        { provide: API_CONFIG, useValue: config },
        {
          provide: COUNTRY_READ_RUNTIME_FACTORIES,
          useValue: COUNTRY_READ_RUNTIME_FACTORIES_DEFAULT,
        },
        CountryReadRuntimeProvider,
        {
          provide: COUNTRY_READ_REPOSITORY,
          inject: [CountryReadRuntimeProvider],
          useFactory: (
            runtimeProvider: CountryReadRuntimeProvider,
          ): CountryReadRepository => runtimeProvider.repository,
        },
        { provide: APP_FILTER, useClass: ContractExceptionFilter },
      ],
      exports: [COUNTRY_READ_REPOSITORY],
    };
  }
}
