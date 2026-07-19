import { Inject, Injectable } from "@nestjs/common";

import type { ApiConfig } from "../api-config.js";
import {
  API_CONFIG,
  CountryReadRuntimeProvider,
} from "../runtime/country-read-runtime.provider.js";
import {
  METRICS_REGISTRY,
  type MetricsRecorder,
} from "./metrics-registry.js";

@Injectable()
export class HealthService {
  constructor(
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Inject(CountryReadRuntimeProvider)
    private readonly runtime: CountryReadRuntimeProvider,
    @Inject(METRICS_REGISTRY)
    private readonly metrics: MetricsRecorder,
  ) {}

  async isReady(): Promise<boolean> {
    try {
      const ping = () =>
        this.runtime.ping({
          maxWaitMs: this.config.healthReadyTimeoutMs,
          timeoutMs: this.config.healthReadyTimeoutMs,
        });
      if (this.config.countryReadSource === "database") {
        await this.metrics.observeDbOperation("readiness_ping", ping);
      } else {
        await ping();
      }
      return true;
    } catch {
      return false;
    }
  }
}
