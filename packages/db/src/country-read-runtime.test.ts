import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import { afterEach, describe, expect, test, vi } from "vitest";

const prismaState = vi.hoisted(() => ({
  constructOptions: [] as unknown[],
  disconnectCalls: 0,
  transactionCalls: [] as unknown[],
}));

vi.mock("@prisma/client", () => ({
  PrismaClient: class MockPrismaClient {
    readonly country = {
      count: async (): Promise<number> => 6,
      findMany: async (): Promise<readonly unknown[]> => [],
      findUnique: async (): Promise<null> => null,
    };

    constructor(options: unknown) {
      prismaState.constructOptions.push(options);
    }

    async $transaction<T>(
      callback: (transaction: {
        readonly country: {
          count(): Promise<number>;
          findMany(): Promise<readonly unknown[]>;
          findUnique(): Promise<null>;
        };
      }) => Promise<T>,
      options: unknown,
    ): Promise<T> {
      prismaState.transactionCalls.push(options);
      return callback({ country: this.country });
    }

    async $disconnect(): Promise<void> {
      prismaState.disconnectCalls += 1;
    }
  },
}));

import {
  createApprovedPublicationCountryReadRuntime,
  createPrismaCountryReadRuntime,
  type CountryReadRuntime,
} from "./read/country-read-runtime.js";

const REPOSITORY_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const temporaryDirectories: string[] = [];

afterEach(() => {
  prismaState.constructOptions.length = 0;
  prismaState.disconnectCalls = 0;
  prismaState.transactionCalls.length = 0;
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory !== undefined) rmSync(directory, { recursive: true, force: true });
  }
});

describe("CountryReadRuntime factories", () => {
  test("Prisma runtime owns one client, passes finite ping bounds and closes once", async () => {
    const runtime: CountryReadRuntime = createPrismaCountryReadRuntime({
      databaseUrl: "postgresql://navigator:private@example.test/navigator",
    });

    await runtime.repository.list();
    await runtime.repository.list();
    await runtime.ping({ maxWaitMs: 250, timeoutMs: 750 });
    await runtime.close();
    await runtime.close();

    expect(prismaState.constructOptions).toHaveLength(1);
    expect(prismaState.transactionCalls).toEqual([{ maxWait: 250, timeout: 750 }]);
    expect(prismaState.disconnectCalls).toBe(1);
  });

  test.each([
    { maxWaitMs: 0, timeoutMs: 1 },
    { maxWaitMs: 1, timeoutMs: Number.POSITIVE_INFINITY },
    { maxWaitMs: 1.5, timeoutMs: 2 },
  ])("Prisma ping rejects non-finite positive integer bounds", async (options) => {
    const runtime = createPrismaCountryReadRuntime({
      databaseUrl: "postgresql://navigator:navigator@example.test/navigator",
    });

    await expect(runtime.ping(options)).rejects.toThrow(
      "COUNTRY_READ_PING_OPTIONS_INVALID",
    );
    expect(prismaState.transactionCalls).toHaveLength(0);
  });

  test("canonical runtime freezes one startup snapshot and remains cwd/filesystem independent", async () => {
    const fixtureRoot = createRepositoryFixture();
    const runtime = createApprovedPublicationCountryReadRuntime({
      repositoryRoot: fixtureRoot,
    });
    const first = await runtime.repository.list();
    rmSync(fixtureRoot, { recursive: true, force: true });
    const foreignCwd = makeTemporaryDirectory("navigator-country-cwd-");
    const originalCwd = process.cwd();

    try {
      process.chdir(foreignCwd);
      await runtime.ping({ maxWaitMs: 1, timeoutMs: 1 });
      const second = await runtime.repository.list();
      expect(second).toBe(first);
      expect(isRecursivelyFrozen(second)).toBe(true);
      await runtime.close();
      await runtime.close();
    } finally {
      process.chdir(originalCwd);
    }
  }, 30_000);

  test("canonical runtime requires an injected absolute root but normalizes it", async () => {
    expect(() => createApprovedPublicationCountryReadRuntime({
      repositoryRoot: "data",
    })).toThrow("APPROVED_PUBLICATION_RUNTIME_INVALID");

    const nonNormalizedRoot = join(
      dirname(REPOSITORY_ROOT),
      basename(REPOSITORY_ROOT),
      "..",
      basename(REPOSITORY_ROOT),
    );
    const runtime = createApprovedPublicationCountryReadRuntime({
      repositoryRoot: nonNormalizedRoot,
    });
    await expect(runtime.repository.list()).resolves.toHaveLength(6);
  });

  test("plain Node resolves compiled runtime subpaths from a non-repository package", () => {
    execFileSync(
      "corepack",
      ["pnpm", "--filter", "@navigator/db", "build"],
      { cwd: REPOSITORY_ROOT, stdio: "pipe" },
    );
    const packageRoot = makeTemporaryDirectory("navigator-runtime-package-");
    const navigatorModules = join(packageRoot, "node_modules", "@navigator");
    mkdirSync(navigatorModules, { recursive: true });
    writeFileSync(join(packageRoot, "package.json"), '{"type":"module"}\n');
    symlinkSync(
      join(REPOSITORY_ROOT, "packages", "db"),
      join(navigatorModules, "db"),
      "dir",
    );
    symlinkSync(
      join(REPOSITORY_ROOT, "packages", "shared-types"),
      join(navigatorModules, "shared-types"),
      "dir",
    );
    const foreignCwd = join(packageRoot, "foreign-cwd");
    mkdirSync(foreignCwd);

    const script = `
      const dbResolved = import.meta.resolve("@navigator/db/country-read-runtime");
      const sharedResolved = import.meta.resolve("@navigator/shared-types/country-runtime");
      const { createApprovedPublicationCountryReadRuntime } =
        await import("@navigator/db/country-read-runtime");
      const runtime = createApprovedPublicationCountryReadRuntime({
        repositoryRoot: ${JSON.stringify(REPOSITORY_ROOT)},
      });
      process.chdir(${JSON.stringify(foreignCwd)});
      const countries = await runtime.repository.list();
      await runtime.ping({ maxWaitMs: 1, timeoutMs: 1 });
      await runtime.close();
      process.stdout.write(JSON.stringify({
        codes: countries.map((snapshot) => snapshot.country.code),
        dbResolved,
        sharedResolved,
      }));
    `;
    const result = JSON.parse(
      execFileSync(
        process.execPath,
        ["--input-type=module", "--eval", script],
        { cwd: packageRoot, encoding: "utf8" },
      ),
    ) as {
      readonly codes: readonly string[];
      readonly dbResolved: string;
      readonly sharedResolved: string;
    };

    expect(result.codes).toEqual(["ID", "VN", "SA", "AE", "BR", "ZA"]);
    expect(result.dbResolved).toMatch(/\/dist\/read\/country-read-runtime\.js$/u);
    expect(result.sharedResolved).toMatch(/\/dist\/country-runtime\.js$/u);
    expect(result.dbResolved).not.toMatch(/\.ts$/u);
    expect(result.sharedResolved).not.toMatch(/\.ts$/u);
  }, 30_000);
});

function createRepositoryFixture(): string {
  const fixtureRoot = makeTemporaryDirectory("navigator-country-root-");
  cpSync(join(REPOSITORY_ROOT, "data"), join(fixtureRoot, "data"), {
    recursive: true,
  });
  return fixtureRoot;
}

function makeTemporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function isRecursivelyFrozen(value: unknown, seen = new WeakSet<object>()): boolean {
  if (typeof value !== "object" || value === null || seen.has(value)) return true;
  if (!Object.isFrozen(value)) return false;
  seen.add(value);
  return Object.values(value).every((child) => isRecursivelyFrozen(child, seen));
}
