import { Inject, Injectable, type OnApplicationShutdown } from "@nestjs/common";
import {
  createApprovedPublicationCountryReadRuntime,
  createPrismaCountryReadRuntime,
  type CountryReadRuntime,
} from "@navigator/db/country-read-runtime";
import type { CountryReadRepository } from "@navigator/shared-types/country-runtime";

import type { ApiConfig } from "../api-config.js";
import { buildDatabaseRuntimeConfig } from "../database/database-config.js";

export const API_CONFIG = Symbol("API_CONFIG");
export const COUNTRY_READ_RUNTIME_FACTORIES = Symbol("COUNTRY_READ_RUNTIME_FACTORIES");
export const COUNTRY_READ_REPOSITORY = Symbol("COUNTRY_READ_REPOSITORY");

export interface CountryReadRuntimeFactories {
  readonly createPrismaCountryReadRuntime: typeof createPrismaCountryReadRuntime;
  readonly createApprovedPublicationCountryReadRuntime: typeof createApprovedPublicationCountryReadRuntime;
}

export const COUNTRY_READ_RUNTIME_FACTORIES_DEFAULT: CountryReadRuntimeFactories =
  Object.freeze({
    createPrismaCountryReadRuntime,
    createApprovedPublicationCountryReadRuntime,
  });

@Injectable()
export class CountryReadRuntimeProvider implements OnApplicationShutdown {
  private closePromise: Promise<void> | undefined;
  private readonly runtime: CountryReadRuntime;

  constructor(
    @Inject(API_CONFIG) config: ApiConfig,
    @Inject(COUNTRY_READ_RUNTIME_FACTORIES)
    factories: CountryReadRuntimeFactories = COUNTRY_READ_RUNTIME_FACTORIES_DEFAULT,
  ) {
    this.runtime = createRuntime(config, factories);
  }

  get repository(): CountryReadRepository {
    return this.runtime.repository;
  }

  ping(options: Parameters<CountryReadRuntime["ping"]>[0]): Promise<void> {
    return this.runtime.ping(options);
  }

  onApplicationShutdown(_signal?: string): Promise<void> {
    if (this.closePromise === undefined) {
      this.closePromise = Promise.resolve().then(() => this.runtime.close());
    }
    return this.closePromise;
  }
}

function createRuntime(
  config: ApiConfig,
  factories: CountryReadRuntimeFactories,
): CountryReadRuntime {
  if (config.countryReadSource === "database") {
    const runtimeConfig = buildDatabaseRuntimeConfig({
      databaseUrl: config.databaseUrl,
      poolMax: config.databasePoolMax,
      poolTimeoutSeconds: config.databasePoolTimeoutSeconds,
      connectTimeoutSeconds: config.databaseConnectTimeoutSeconds,
    });
    return factories.createPrismaCountryReadRuntime({
      databaseUrl: runtimeConfig.databaseUrl,
    });
  }
  if (config.countryReadSource === "canonical") {
    return factories.createApprovedPublicationCountryReadRuntime({
      repositoryRoot: config.canonicalRepositoryRoot,
    });
  }
  throw new Error("COUNTRY_READ_SOURCE");
}
