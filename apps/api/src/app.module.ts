import { Global, Module, type DynamicModule } from "@nestjs/common";
import type { CountryReadRepository } from "@navigator/shared-types/country-runtime";

import type { ApiConfig } from "./api-config.js";
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
      ],
      exports: [COUNTRY_READ_REPOSITORY],
    };
  }
}
