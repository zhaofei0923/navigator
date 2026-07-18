import { describe, expect, test, vi } from "vitest";
import { Test } from "@nestjs/testing";

import type { CountryReadRuntime } from "@navigator/db/country-read-runtime";

import {
  API_CONFIG,
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
        countryReadSource: "database",
        databaseUrl: "postgresql://navigator:secret@127.0.0.1:5432/navigator",
      },
      factories,
    );

    expect(factories.createPrismaCountryReadRuntime).toHaveBeenCalledTimes(1);
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
        countryReadSource: "canonical",
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
    const factories: CountryReadRuntimeFactories = {
      createPrismaCountryReadRuntime: vi.fn(() => runtime),
      createApprovedPublicationCountryReadRuntime: vi.fn(() => createRuntime()),
    };
    const module = await Test.createTestingModule({
      providers: [
        {
          provide: API_CONFIG,
          useValue: {
            port: 3100,
            countryReadSource: "database",
            databaseUrl: "postgresql://navigator:secret@127.0.0.1:5432/navigator",
          },
        },
        {
          provide: COUNTRY_READ_RUNTIME_FACTORIES,
          useValue: factories,
        },
        CountryReadRuntimeProvider,
      ],
    })
      .compile();

    try {
      const [first, second] = await Promise.all([
        module.resolve(CountryReadRuntimeProvider),
        module.resolve(CountryReadRuntimeProvider),
      ]);

      expect(first).toBe(second);
      expect(factories.createPrismaCountryReadRuntime).toHaveBeenCalledTimes(1);
      expect(factories.createApprovedPublicationCountryReadRuntime).not.toHaveBeenCalled();
    } finally {
      await module.close();
    }
  });
});

function createRuntime(): CountryReadRuntime & { close: ReturnType<typeof vi.fn> } {
  return {
    repository: {} as CountryReadRuntime["repository"],
    ping: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };
}
