import { describe, expect, test, vi } from "vitest";
import { Test } from "@nestjs/testing";

import type { CountryReadRuntime } from "@navigator/db/country-read-runtime";
import type { CountryReadRepository } from "@navigator/shared-types/country-runtime";

import { AppModule } from "../app.module.js";
import { validateApiEnv } from "../api-config.js";
import {
  COUNTRY_READ_REPOSITORY,
  COUNTRY_READ_RUNTIME_FACTORIES,
  CountryReadRuntimeProvider,
  type CountryReadRuntimeFactories,
} from "./country-read-runtime.provider.js";

describe("CountryReadRuntimeProvider", () => {
  test("selects the database factory and closes its singleton only once", async () => {
    const runtime = createRuntime();
    const factories: CountryReadRuntimeFactories = {
      createPrismaCountryReadRuntime: vi.fn(() => runtime),
      createApprovedPublicationCountryReadRuntime: vi.fn(() => createRuntime()),
    };

    const provider = new CountryReadRuntimeProvider(
      {
        port: 3100,
        metricsPort: 9464,
        countryReadSource: "database",
        readCacheTtlSeconds: 60,
        readCacheStaleIfErrorSeconds: 300,
        readCacheMaxEntries: 1000,
        healthReadyTimeoutMs: 1000,
        databaseUrl: "postgresql://navigator:secret@127.0.0.1:5432/navigator",
        databasePoolMax: 10,
        databasePoolTimeoutSeconds: 5,
        databaseConnectTimeoutSeconds: 5,
      },
      factories,
    );

    expect(factories.createPrismaCountryReadRuntime).toHaveBeenCalledTimes(1);
    expect(factories.createPrismaCountryReadRuntime).toHaveBeenCalledWith({
      databaseUrl:
        "postgresql://navigator:secret@127.0.0.1:5432/navigator?connection_limit=10&pool_timeout=5&connect_timeout=5&application_name=navigator-api",
    });
    expect(factories.createApprovedPublicationCountryReadRuntime).not.toHaveBeenCalled();
    expect(provider.repository).toBe(runtime.repository);

    await Promise.all([
      provider.onApplicationShutdown("SIGTERM"),
      provider.onApplicationShutdown("SIGINT"),
    ]);

    expect(runtime.close).toHaveBeenCalledTimes(1);
  });

  test("selects the canonical factory without requiring a database URL", () => {
    const runtime = createRuntime();
    const factories: CountryReadRuntimeFactories = {
      createPrismaCountryReadRuntime: vi.fn(() => createRuntime()),
      createApprovedPublicationCountryReadRuntime: vi.fn(() => runtime),
    };

    new CountryReadRuntimeProvider(
      {
        port: 3100,
        metricsPort: 9464,
        countryReadSource: "canonical",
        readCacheTtlSeconds: 60,
        readCacheStaleIfErrorSeconds: 300,
        readCacheMaxEntries: 1000,
        healthReadyTimeoutMs: 1000,
        canonicalRepositoryRoot: "/srv/navigator",
      },
      factories,
    );

    expect(factories.createPrismaCountryReadRuntime).not.toHaveBeenCalled();
    expect(factories.createApprovedPublicationCountryReadRuntime).toHaveBeenCalledWith({
      repositoryRoot: "/srv/navigator",
    });
  });

  test("rejects a forged configuration instead of selecting both factories", () => {
    const factories: CountryReadRuntimeFactories = {
      createPrismaCountryReadRuntime: vi.fn(() => createRuntime()),
      createApprovedPublicationCountryReadRuntime: vi.fn(() => createRuntime()),
    };

    expect(() =>
      new CountryReadRuntimeProvider(
        {
          port: 3100,
          metricsPort: 9464,
          countryReadSource: "invalid",
        } as never,
        factories,
      ),
    ).toThrow("COUNTRY_READ_SOURCE");
    expect(factories.createPrismaCountryReadRuntime).not.toHaveBeenCalled();
    expect(factories.createApprovedPublicationCountryReadRuntime).not.toHaveBeenCalled();
  });

  test("shares one runtime for concurrent Nest injections", async () => {
    const runtime = createRuntime();
    const databaseUrl = "postgresql://navigator:secret@127.0.0.1:5432/navigator";
    const factories: CountryReadRuntimeFactories = {
      createPrismaCountryReadRuntime: vi.fn(() => runtime),
      createApprovedPublicationCountryReadRuntime: vi.fn(() => createRuntime()),
    };
    const module = await Test.createTestingModule({
      imports: [
        AppModule.register({
          port: 3100,
          metricsPort: 9464,
          countryReadSource: "database",
          readCacheTtlSeconds: 60,
          readCacheStaleIfErrorSeconds: 300,
          readCacheMaxEntries: 1000,
          healthReadyTimeoutMs: 1000,
          databaseUrl,
          databasePoolMax: 10,
          databasePoolTimeoutSeconds: 5,
          databaseConnectTimeoutSeconds: 5,
        }),
      ],
    })
      .overrideProvider(COUNTRY_READ_RUNTIME_FACTORIES)
      .useValue(factories)
      .compile();

    try {
      const [first, second] = await Promise.all([
        module.resolve<CountryReadRepository>(COUNTRY_READ_REPOSITORY),
        module.resolve<CountryReadRepository>(COUNTRY_READ_REPOSITORY),
      ]);

      expect(first).toBe(second);
      expect(first).toBe(runtime.repository);
      expect(factories.createPrismaCountryReadRuntime).toHaveBeenCalledTimes(1);
      expect(factories.createPrismaCountryReadRuntime).toHaveBeenCalledWith({
        databaseUrl: `${databaseUrl}?connection_limit=10&pool_timeout=5&connect_timeout=5&application_name=navigator-api`,
      });
      expect(factories.createApprovedPublicationCountryReadRuntime).not.toHaveBeenCalled();
    } finally {
      await module.close();
    }
  });

  test("validates raw env before building one managed URL without logging secrets", async () => {
    const databaseUrl =
      "postgresql://navigator:never-log@127.0.0.1:5432/navigator?schema=public";
    const environment = Object.freeze({
      API_PORT: "3100",
      DATABASE_URL: databaseUrl,
      DATABASE_POOL_MAX: "12",
      DATABASE_POOL_TIMEOUT_SECONDS: "6",
      DATABASE_CONNECT_TIMEOUT_SECONDS: "7",
    });
    const originalEnvironment = { ...environment };
    const runtime = createRuntime();
    const factories: CountryReadRuntimeFactories = {
      createPrismaCountryReadRuntime: vi.fn(() => runtime),
      createApprovedPublicationCountryReadRuntime: vi.fn(() => createRuntime()),
    };
    const consoleSpies = [
      vi.spyOn(console, "log").mockImplementation(() => undefined),
      vi.spyOn(console, "info").mockImplementation(() => undefined),
      vi.spyOn(console, "warn").mockImplementation(() => undefined),
      vi.spyOn(console, "error").mockImplementation(() => undefined),
    ];
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    try {
      const config = validateApiEnv(environment);
      const provider = new CountryReadRuntimeProvider(config, factories);

      expect(provider.repository).toBe(runtime.repository);
      expect(factories.createPrismaCountryReadRuntime).toHaveBeenCalledOnce();
      expect(factories.createPrismaCountryReadRuntime).toHaveBeenCalledWith({
        databaseUrl:
          "postgresql://navigator:never-log@127.0.0.1:5432/navigator?schema=public&connection_limit=12&pool_timeout=6&connect_timeout=7&application_name=navigator-api",
      });
      expect(environment).toEqual(originalEnvironment);
      expect(environment.DATABASE_URL).toBe(databaseUrl);
      for (const spy of [...consoleSpies, stdoutSpy, stderrSpy]) {
        expect(spy).not.toHaveBeenCalled();
      }
    } finally {
      for (const spy of [...consoleSpies, stdoutSpy, stderrSpy]) {
        spy.mockRestore();
      }
    }
  });

  test("forwards health ping bounds to the selected singleton runtime", async () => {
    const runtime = createRuntime();
    const factories: CountryReadRuntimeFactories = {
      createPrismaCountryReadRuntime: vi.fn(() => runtime),
      createApprovedPublicationCountryReadRuntime: vi.fn(() => createRuntime()),
    };
    const provider = new CountryReadRuntimeProvider(
      {
        port: 3100,
        metricsPort: 9464,
        countryReadSource: "database",
        readCacheTtlSeconds: 60,
        readCacheStaleIfErrorSeconds: 300,
        readCacheMaxEntries: 1000,
        healthReadyTimeoutMs: 1375,
        databaseUrl: "postgresql://navigator:secret@127.0.0.1:5432/navigator",
        databasePoolMax: 10,
        databasePoolTimeoutSeconds: 5,
        databaseConnectTimeoutSeconds: 5,
      },
      factories,
    );

    await Promise.all([
      provider.ping({ maxWaitMs: 1375, timeoutMs: 1375 }),
      provider.ping({ maxWaitMs: 1375, timeoutMs: 1375 }),
    ]);

    expect(runtime.ping).toHaveBeenCalledTimes(2);
    expect(runtime.ping).toHaveBeenNthCalledWith(1, {
      maxWaitMs: 1375,
      timeoutMs: 1375,
    });
    expect(runtime.ping).toHaveBeenNthCalledWith(2, {
      maxWaitMs: 1375,
      timeoutMs: 1375,
    });
    expect(factories.createPrismaCountryReadRuntime).toHaveBeenCalledOnce();
    expect(factories.createApprovedPublicationCountryReadRuntime).not.toHaveBeenCalled();
  });
});

function createRuntime(): CountryReadRuntime & { close: ReturnType<typeof vi.fn> } {
  return {
    repository: {} as CountryReadRuntime["repository"],
    ping: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };
}
