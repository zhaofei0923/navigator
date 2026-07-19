import { Global, Module, type DynamicModule } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import type { CountryReadRepository } from "@navigator/shared-types/country-runtime";

import type { ApiConfig } from "./api-config.js";
import { ContractExceptionFilter } from "./common/contract-exception.filter.js";
import { CountriesModule } from "./countries/countries.module.js";
import { HealthController } from "./ops/health.controller.js";
import { HealthService } from "./ops/health.service.js";
import {
  METRICS_REGISTRY,
  MetricsRegistry,
} from "./ops/metrics-registry.js";
import { MetricsServer } from "./ops/metrics-server.js";
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
  static register(
    config: ApiConfig,
    metricsRegistry?: MetricsRegistry,
  ): DynamicModule {
    return {
      module: AppModule,
      imports: [CountriesModule],
      controllers: [HealthController],
      providers: [
        { provide: API_CONFIG, useValue: config },
        {
          provide: METRICS_REGISTRY,
          useFactory: (): MetricsRegistry =>
            metricsRegistry ?? new MetricsRegistry(),
        },
        {
          provide: MetricsServer,
          inject: [API_CONFIG, METRICS_REGISTRY],
          useFactory: (
            apiConfig: ApiConfig,
            registry: MetricsRegistry,
          ): MetricsServer =>
            new MetricsServer({
              closeRegistry: () => registry.close(),
              port: apiConfig.metricsPort,
              render: () => registry.render(),
            }),
        },
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
        HealthService,
        { provide: APP_FILTER, useClass: ContractExceptionFilter },
      ],
      exports: [API_CONFIG, COUNTRY_READ_REPOSITORY, METRICS_REGISTRY],
    };
  }
}
