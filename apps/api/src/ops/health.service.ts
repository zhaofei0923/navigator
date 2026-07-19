import { Inject, Injectable } from "@nestjs/common";

import type { ApiConfig } from "../api-config.js";
import {
  API_CONFIG,
  CountryReadRuntimeProvider,
} from "../runtime/country-read-runtime.provider.js";

@Injectable()
export class HealthService {
  constructor(
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Inject(CountryReadRuntimeProvider)
    private readonly runtime: CountryReadRuntimeProvider,
  ) {}

  async isReady(): Promise<boolean> {
    try {
      await this.runtime.ping({
        maxWaitMs: this.config.healthReadyTimeoutMs,
        timeoutMs: this.config.healthReadyTimeoutMs,
      });
      return true;
    } catch {
      return false;
    }
  }
}
