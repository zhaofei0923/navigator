import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  createApprovedPublicationCountryReadRuntime,
  type CountryReadRuntime,
} from "@navigator/db/country-read-runtime";
import type { CountryReadRepository } from "@navigator/shared-types/country-runtime";
import {
  COUNTRY_ROUTE_GOLDEN_FIXTURES,
  type CountryRouteGoldenFixture,
} from "@navigator/shared-types/test-support/country-route-golden";
import { describe, expect, test, vi } from "vitest";

import type { ApiConfig } from "../api-config.js";
import { AppModule } from "../app.module.js";
import { configureApplication } from "../main.js";
import {
  COUNTRY_READ_RUNTIME_FACTORIES,
  CountryReadRuntimeProvider,
  type CountryReadRuntimeFactories,
} from "../runtime/country-read-runtime.provider.js";

const REPOSITORY_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const DATABASE_URL =
  "postgresql://navigator:unit-only@127.0.0.1:5432/navigator";
const EXPECTED_CONTENT_TYPE = "application/json; charset=utf-8";
const EXPECTED_COUNTRY_CODES = ["ID", "VN", "SA", "AE", "BR", "ZA"];
const INTERNAL_ERROR_BODY = {
  error: {
    code: "INTERNAL_ERROR",
    message: "Internal server error",
  },
  success: false,
} as const;

interface ProviderHarness {
  readonly app: INestApplication;
  readonly baseUrl: string;
  readonly runtimeProvider: CountryReadRuntimeProvider;
}

interface TrackedRuntime extends CountryReadRuntime {
  readonly close: ReturnType<typeof vi.fn<() => Promise<void>>>;
}

describe.sequential("country read production provider acceptance", () => {
  test("database selects one Prisma runtime and preserves every HTTP golden", async () => {
    const delegate = createApprovedPublicationCountryReadRuntime({
      repositoryRoot: REPOSITORY_ROOT,
    });
    const runtime = trackRuntime(delegate);
    const factories = createFactories({ databaseRuntime: runtime });
    const harness = await startProviderApp(
      {
        port: 3100,
        countryReadSource: "database",
        databaseUrl: DATABASE_URL,
      },
      factories,
    );

    try {
      expect(factories.createPrismaCountryReadRuntime).toHaveBeenCalledTimes(1);
      expect(factories.createPrismaCountryReadRuntime).toHaveBeenCalledWith({
        databaseUrl: DATABASE_URL,
      });
      expect(
        factories.createApprovedPublicationCountryReadRuntime,
      ).not.toHaveBeenCalled();
      await expectAllCountryRouteGoldens(harness.baseUrl);
    } finally {
      await closeHarness(harness);
    }

    expect(runtime.close).toHaveBeenCalledTimes(1);
  });

  test("canonical uses the absolute startup root from a non-repository cwd", async () => {
    expect(isAbsolute(REPOSITORY_ROOT)).toBe(true);
    expect(normalize(REPOSITORY_ROOT)).toBe(REPOSITORY_ROOT);

    const originalCwd = process.cwd();
    const temporaryCwd = await mkdtemp(join(tmpdir(), "navigator-api-provider-"));
    let runtime: TrackedRuntime | undefined;
    let harness: ProviderHarness | undefined;
    const factories = createFactories({
      createCanonicalRuntime(options) {
        runtime = trackRuntime(
          createApprovedPublicationCountryReadRuntime(options),
        );
        return runtime;
      },
    });

    process.chdir(temporaryCwd);
    try {
      harness = await startProviderApp(
        {
          port: 3100,
          countryReadSource: "canonical",
          canonicalRepositoryRoot: REPOSITORY_ROOT,
        },
        factories,
      );

      expect(factories.createPrismaCountryReadRuntime).not.toHaveBeenCalled();
      expect(
        factories.createApprovedPublicationCountryReadRuntime,
      ).toHaveBeenCalledTimes(1);
      expect(
        factories.createApprovedPublicationCountryReadRuntime,
      ).toHaveBeenCalledWith({ repositoryRoot: REPOSITORY_ROOT });
      await expectAllCountryRouteGoldens(harness.baseUrl);
    } finally {
      try {
        if (harness !== undefined) await closeHarness(harness);
      } finally {
        process.chdir(originalCwd);
        await rm(temporaryCwd, { force: true, recursive: true });
      }
    }

    expect(runtime?.close).toHaveBeenCalledTimes(1);
  });

  test("invalid source fails startup without exposing the rejected value", async () => {
    const rejectedSource = "request-selected-secret-source";
    const factories = createFactories();
    const invalidConfig = {
      port: 3100,
      countryReadSource: rejectedSource,
    } as unknown as ApiConfig;

    const error = await captureStartupError(invalidConfig, factories);
    const renderedError = error instanceof Error
      ? `${error.name}: ${error.message}`
      : String(error);

    expect(renderedError).toContain("COUNTRY_READ_SOURCE");
    expect(renderedError).not.toContain(rejectedSource);
    expect(factories.createPrismaCountryReadRuntime).not.toHaveBeenCalled();
    expect(
      factories.createApprovedPublicationCountryReadRuntime,
    ).not.toHaveBeenCalled();
  });

  test("database failure returns the fixed 500 and never falls back", async () => {
    const sensitiveFailure = [
      "postgresql://user:password@db.internal:5432/navigator",
      "SELECT secret FROM country",
      "/home/kevin/navigator/data/staging/private.json",
    ].join(" ");
    const repository: CountryReadRepository = {
      async list() {
        throw new Error(sensitiveFailure);
      },
      async findByCode() {
        throw new Error(sensitiveFailure);
      },
    };
    const runtime = trackRuntime(createRuntime(repository));
    const factories = createFactories({ databaseRuntime: runtime });
    const harness = await startProviderApp(
      {
        port: 3100,
        countryReadSource: "database",
        databaseUrl: DATABASE_URL,
      },
      factories,
    );

    try {
      expect(
        factories.createApprovedPublicationCountryReadRuntime,
      ).not.toHaveBeenCalled();
      const response = await fetch(
        `${harness.baseUrl}/api/v1/countries?locale=en`,
      );
      const body: unknown = await response.json();

      expect(response.status).toBe(500);
      expect(response.headers.get("content-type")).toBe(EXPECTED_CONTENT_TYPE);
      expect(body).toEqual(INTERNAL_ERROR_BODY);
      expect(JSON.stringify(body)).not.toContain(sensitiveFailure);
      for (const fragment of sensitiveFailure.split(" ")) {
        expect(JSON.stringify(body)).not.toContain(fragment);
      }
      expect(
        factories.createApprovedPublicationCountryReadRuntime,
      ).not.toHaveBeenCalled();
    } finally {
      await closeHarness(harness);
    }

    expect(runtime.close).toHaveBeenCalledTimes(1);
  });
});

function createFactories(options: {
  readonly databaseRuntime?: CountryReadRuntime;
  readonly createCanonicalRuntime?: (
    options: { readonly repositoryRoot: string },
  ) => CountryReadRuntime;
} = {}): CountryReadRuntimeFactories {
  return {
    createPrismaCountryReadRuntime: vi.fn(() =>
      options.databaseRuntime ?? createRuntime(emptyRepository())),
    createApprovedPublicationCountryReadRuntime: vi.fn((runtimeOptions) =>
      options.createCanonicalRuntime?.(runtimeOptions) ??
      createRuntime(emptyRepository())),
  };
}

async function startProviderApp(
  config: ApiConfig,
  factories: CountryReadRuntimeFactories,
): Promise<ProviderHarness> {
  const module = await Test.createTestingModule({
    imports: [AppModule.register(config)],
  })
    .overrideProvider(COUNTRY_READ_RUNTIME_FACTORIES)
    .useValue(factories)
    .compile();
  const app = module.createNestApplication();
  configureApplication(app);
  try {
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address();
    if (address === null || typeof address === "string") {
      throw new Error("TEST_HTTP_ADDRESS_UNAVAILABLE");
    }
    return {
      app,
      baseUrl: `http://127.0.0.1:${address.port}`,
      runtimeProvider: app.get(CountryReadRuntimeProvider),
    };
  } catch (error) {
    await app.close();
    throw error;
  }
}

async function closeHarness(harness: ProviderHarness): Promise<void> {
  await Promise.all([
    harness.runtimeProvider.onApplicationShutdown("SIGTERM"),
    harness.runtimeProvider.onApplicationShutdown("SIGINT"),
  ]);
  await harness.app.close();
}

async function expectAllCountryRouteGoldens(baseUrl: string): Promise<void> {
  expect(COUNTRY_ROUTE_GOLDEN_FIXTURES).toHaveLength(112);
  let sixCountryListBody: unknown;

  for (const fixture of COUNTRY_ROUTE_GOLDEN_FIXTURES) {
    const body = await expectCountryRouteGolden(baseUrl, fixture);
    if (fixture.id === "list-localized-en") sixCountryListBody = body;
  }

  expect(readCountryCodes(sixCountryListBody)).toEqual(EXPECTED_COUNTRY_CODES);
}

async function expectCountryRouteGolden(
  baseUrl: string,
  fixture: CountryRouteGoldenFixture,
): Promise<unknown> {
  const requestInit = fixture.headers === undefined
    ? undefined
    : { headers: fixture.headers };
  const response = await fetch(`${baseUrl}${fixture.requestPath}`, requestInit);
  const body: unknown = await response.json();

  expect(response.status, fixture.id).toBe(fixture.expectedStatus);
  expect(response.headers.get("content-type"), fixture.id).toBe(
    EXPECTED_CONTENT_TYPE,
  );
  expect(body, fixture.id).toEqual(fixture.expectedBody);
  return body;
}

function readCountryCodes(value: unknown): readonly string[] {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    throw new Error("TEST_SIX_COUNTRY_LIST_INVALID");
  }
  return value.data.map((item) => {
    if (!isRecord(item) || typeof item.code !== "string") {
      throw new Error("TEST_SIX_COUNTRY_LIST_INVALID");
    }
    return item.code;
  });
}

async function captureStartupError(
  config: ApiConfig,
  factories: CountryReadRuntimeFactories,
): Promise<unknown> {
  try {
    const module = await Test.createTestingModule({
      imports: [AppModule.register(config)],
    })
      .overrideProvider(COUNTRY_READ_RUNTIME_FACTORIES)
      .useValue(factories)
      .compile();
    await module.close();
  } catch (error) {
    return error;
  }
  throw new Error("TEST_EXPECTED_STARTUP_FAILURE");
}

function trackRuntime(runtime: CountryReadRuntime): TrackedRuntime {
  const close = vi.fn(async () => runtime.close());
  return {
    repository: runtime.repository,
    ping: (options) => runtime.ping(options),
    close,
  };
}

function createRuntime(repository: CountryReadRepository): CountryReadRuntime {
  return {
    repository,
    async ping() {},
    async close() {},
  };
}

function emptyRepository(): CountryReadRepository {
  return {
    async list() {
      return [];
    },
    async findByCode() {
      return null;
    },
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
