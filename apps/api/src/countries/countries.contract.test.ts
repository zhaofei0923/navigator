import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createApprovedPublicationCountryReadRuntime } from "@navigator/db/country-read-runtime";
import type { CountryReadRepository } from "@navigator/shared-types/country-runtime";
import {
  COUNTRY_ROUTE_FORBIDDEN_BODY_FRAGMENTS,
  COUNTRY_ROUTE_GOLDEN_FIXTURES,
} from "@navigator/shared-types/test-support/country-route-golden";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { AppModule } from "../app.module.js";
import { configureApplication } from "../main.js";
import {
  READONLY_RESPONSE_CACHE,
  type ReadonlyResponseCache,
} from "../ops/readonly-response-cache.js";
import { COUNTRY_READ_REPOSITORY } from "../runtime/country-read-runtime.provider.js";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const runtime = createApprovedPublicationCountryReadRuntime({ repositoryRoot });
const repository: CountryReadRepository = {
  findByCode: vi.fn((code: string) => runtime.repository.findByCode(code)),
  list: vi.fn(() => runtime.repository.list()),
};
const forbiddenResponseFragments = [
  ...COUNTRY_ROUTE_FORBIDDEN_BODY_FRAGMENTS,
  "postgresql://",
  "SELECT ",
  "/home/",
  "\\\\Users\\\\",
] as const;

let app: INestApplication;
let baseUrl: string;
let responseCache: ReadonlyResponseCache;

beforeAll(async () => {
  const module = await Test.createTestingModule({
    imports: [
      AppModule.register({
        port: 3100,
        countryReadSource: "canonical",
        readCacheTtlSeconds: 60,
        readCacheStaleIfErrorSeconds: 300,
        readCacheMaxEntries: 1000,
        canonicalRepositoryRoot: repositoryRoot,
      }),
    ],
  })
    .overrideProvider(COUNTRY_READ_REPOSITORY)
    .useValue(repository)
    .compile();

  app = module.createNestApplication();
  configureApplication(app);
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address();
  if (address === null || typeof address === "string") {
    throw new Error("TEST_HTTP_ADDRESS_UNAVAILABLE");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
  responseCache = app.get(READONLY_RESPONSE_CACHE);
});

afterAll(async () => {
  await app.close();
  await runtime.close();
});

describe("Nest country read HTTP contract", () => {
  test("keeps production API shared-types imports on the runtime-safe subpath", async () => {
    const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const violations: string[] = [];

    for (const sourcePath of await productionTypeScriptFiles(sourceRoot)) {
      const source = await readFile(sourcePath, "utf8");
      for (const match of source.matchAll(
        /from\s+["'](@navigator\/shared-types\/[^"']+)["']/g,
      )) {
        const subpath = match[1];
        if (subpath !== "@navigator/shared-types/country-runtime") {
          violations.push(`${relative(sourceRoot, sourcePath)}: ${subpath}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  test.each(COUNTRY_ROUTE_GOLDEN_FIXTURES)(
    "$id preserves the pre-migration HTTP contract",
    async (fixture) => {
      vi.mocked(repository.list).mockClear();
      vi.mocked(repository.findByCode).mockClear();

      const requestInit =
        "headers" in fixture && fixture.headers !== undefined
          ? { headers: fixture.headers }
          : undefined;
      const response = await fetch(
        `${baseUrl}${fixture.requestPath}`,
        requestInit,
      );
      const body: unknown = await response.json();

      expect(response.status).toBe(fixture.expectedStatus);
      expect(response.headers.get("content-type")).toMatch(/^application\/json\b/i);
      expect(body).toEqual(fixture.expectedBody);

      if (fixture.expectedStatus === 400) {
        expect(repository.list).not.toHaveBeenCalled();
        expect(repository.findByCode).not.toHaveBeenCalled();
      }
      if (response.ok) {
        const serialized = JSON.stringify(body);
        for (const forbidden of forbiddenResponseFragments) {
          expect(serialized).not.toContain(forbidden);
        }
      }
    },
  );

  test("maps repository failures to a fixed, non-leaking 500 envelope", async () => {
    responseCache.clear();
    vi.mocked(repository.list).mockRejectedValueOnce(
      new Error(
        "SELECT secret FROM country at postgresql://user:password@db.internal:5432/navigator /home/kevin/navigator/data/staging embeddingEn fileUrl",
      ),
    );

    const response = await fetch(`${baseUrl}/api/v1/countries?locale=en`);
    const body: unknown = await response.json();

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toMatch(/^application\/json\b/i);
    expect(body).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error",
      },
      success: false,
    });
    const serialized = JSON.stringify(body);
    for (const forbidden of forbiddenResponseFragments) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(serialized).not.toContain("password");
    expect(serialized).not.toContain("db.internal");
  });
});

async function productionTypeScriptFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await productionTypeScriptFiles(entryPath));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      files.push(entryPath);
    }
  }
  return files;
}
