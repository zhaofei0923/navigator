import { Module } from "@nestjs/common";

import type { ApiConfig } from "../api-config.js";
import {
  createReadonlyResponseCache,
  READONLY_RESPONSE_CACHE,
  type ReadonlyResponseCache,
} from "../ops/readonly-response-cache.js";
import {
  METRICS_REGISTRY,
  type MetricsRecorder,
} from "../ops/metrics-registry.js";
import { API_CONFIG } from "../runtime/country-read-runtime.provider.js";

import { CountriesController } from "./countries.controller.js";
import { CountriesService } from "./countries.service.js";

@Module({
  controllers: [CountriesController],
  providers: [
    {
      provide: READONLY_RESPONSE_CACHE,
      inject: [API_CONFIG, METRICS_REGISTRY],
      useFactory: (
        config: ApiConfig,
        metrics: MetricsRecorder,
      ): ReadonlyResponseCache =>
        createReadonlyResponseCache({
          maxEntries: config.readCacheMaxEntries,
          metrics,
          staleIfErrorSeconds: config.readCacheStaleIfErrorSeconds,
          ttlSeconds: config.readCacheTtlSeconds,
        }),
    },
    CountriesService,
  ],
})
export class CountriesModule {}
