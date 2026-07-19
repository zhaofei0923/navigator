import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
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
  constructorError: null as Error | null,
  disconnectError: null as Error | null,
  disconnectCalls: 0,
  queryError: null as Error | null,
  queryPending: false,
  queryCalls: [] as {
    readonly cooked: readonly string[];
    readonly raw: readonly string[];
    readonly values: readonly unknown[];
  }[],
  transactionInFlight: 0,
  transactionMaxInFlight: 0,
  transactionError: null as Error | null,
  transactionCalls: [] as unknown[],
  transactionKeys: [] as string[][],
}));

const approvedRepositoryState = vi.hoisted(() => ({
  listCalls: 0,
}));

vi.mock(
  "./read/approved-publication-country-read-repository.js",
  async (importOriginal) => {
    const actual = await importOriginal<
      typeof import("./read/approved-publication-country-read-repository.js")
    >();
    return {
      ...actual,
      createApprovedPublicationCountryReadRepository(
        options: Parameters<
          typeof actual.createApprovedPublicationCountryReadRepository
        >[0],
      ) {
        const repository =
          actual.createApprovedPublicationCountryReadRepository(options);
        return Object.freeze({
          findByCode: (code: string) => repository.findByCode(code),
          async list() {
            approvedRepositoryState.listCalls += 1;
            return repository.list();
          },
        });
      },
    };
  },
);

vi.mock("@prisma/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@prisma/client")>();
  return {
    ...actual,
    PrismaClient: class MockPrismaClient {
      readonly country = {
        count: async (): Promise<number> => 6,
        findMany: async (): Promise<readonly unknown[]> => [],
        findUnique: async (): Promise<null> => null,
      };

      constructor(options: unknown) {
        prismaState.constructOptions.push(options);
        if (prismaState.constructorError !== null) throw prismaState.constructorError;
      }

      async $transaction<T>(
        callback: (transaction: {
          readonly $queryRaw: <T>(
            strings: TemplateStringsArray,
            ...values: readonly unknown[]
          ) => Promise<T>;
        }) => Promise<T>,
        options: { readonly maxWait: number; readonly timeout: number },
      ): Promise<T> {
        prismaState.transactionCalls.push(options);
        prismaState.transactionInFlight += 1;
        prismaState.transactionMaxInFlight = Math.max(
          prismaState.transactionMaxInFlight,
          prismaState.transactionInFlight,
        );
        try {
          if (prismaState.transactionError !== null) {
            throw prismaState.transactionError;
          }
          let rejectPendingQuery: ((reason: unknown) => void) | undefined;
          const transaction = Object.freeze({
            $queryRaw: async <Result>(
              strings: TemplateStringsArray,
              ...values: readonly unknown[]
            ): Promise<Result> => {
              prismaState.queryCalls.push({
                cooked: [...strings],
                raw: [...strings.raw],
                values,
              });
              if (prismaState.queryPending) {
                await new Promise<never>((_resolve, reject) => {
                  rejectPendingQuery = reject;
                });
              }
              if (prismaState.queryError !== null) throw prismaState.queryError;
              return [{ result: 1 }] as unknown as Result;
            },
          });
          prismaState.transactionKeys.push(Object.keys(transaction));
          const transactionTimeout = setTimeout(() => {
            rejectPendingQuery?.(new Error("MOCK_TRANSACTION_TIMEOUT"));
          }, options.timeout);
          try {
            return await callback(transaction);
          } finally {
            clearTimeout(transactionTimeout);
          }
        } finally {
          prismaState.transactionInFlight -= 1;
        }
      }

      async $disconnect(): Promise<void> {
        prismaState.disconnectCalls += 1;
        if (prismaState.disconnectError !== null) throw prismaState.disconnectError;
      }
    },
  };
});

import {
  CountryNotFoundError,
  createApprovedPublicationCountryReadRuntime,
  createPrismaCountryReadRuntime,
  DatabaseUnavailableError,
  DataIntegrityError,
  type CountryReadRuntime,
} from "./read/country-read-runtime.js";

const REPOSITORY_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const temporaryDirectories: string[] = [];

afterEach(() => {
  approvedRepositoryState.listCalls = 0;
  prismaState.constructOptions.length = 0;
  prismaState.constructorError = null;
  prismaState.disconnectError = null;
  prismaState.disconnectCalls = 0;
  prismaState.queryError = null;
  prismaState.queryPending = false;
  prismaState.queryCalls.length = 0;
  prismaState.transactionInFlight = 0;
  prismaState.transactionMaxInFlight = 0;
  prismaState.transactionError = null;
  prismaState.transactionCalls.length = 0;
  prismaState.transactionKeys.length = 0;
  vi.useRealTimers();
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory !== undefined) rmSync(directory, { recursive: true, force: true });
  }
});

describe("CountryReadRuntime factories", () => {
  test.each([
    [DatabaseUnavailableError, "DatabaseUnavailableError", "DATABASE_UNAVAILABLE"],
    [DataIntegrityError, "DataIntegrityError", "DATA_INTEGRITY_ERROR"],
    [CountryNotFoundError, "CountryNotFoundError", "COUNTRY_NOT_FOUND"],
  ] as const)(
    "exports fixed public %s without a cause or caller-controlled payload",
    (ErrorConstructor, name, message) => {
      const error = new ErrorConstructor();

      expect(error.name).toBe(name);
      expect(error.message).toBe(message);
      expect(Object.keys(error)).toEqual(["name"]);
      expect("cause" in error).toBe(false);
      expect(Object.values(error).some((value) => value instanceof Error)).toBe(false);
    },
  );

  test("keeps PrismaClient construction inside the DB runtime factory", () => {
    const sourceFiles = [
      ...listProductionTypeScriptFiles(join(REPOSITORY_ROOT, "apps", "api", "src")),
      ...listProductionTypeScriptFiles(
        join(REPOSITORY_ROOT, "packages", "db", "src", "read"),
      ),
    ];
    const constructorOwners = sourceFiles
      .filter((filePath) => /\bnew\s+PrismaClient\s*\(/u.test(readFileSync(filePath, "utf8")))
      .map((filePath) => filePath.slice(REPOSITORY_ROOT.length + 1));

    expect(constructorOwners).toEqual([
      "packages/db/src/read/country-read-runtime.ts",
    ]);
  });

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
    expect(prismaState.queryCalls).toEqual([
      { cooked: ["SELECT 1"], raw: ["SELECT 1"], values: [] },
    ]);
    expect(prismaState.transactionKeys).toEqual([["$queryRaw"]]);
    expect(prismaState.disconnectCalls).toBe(1);
  });

  test("uses a static tagged query and releases each timed-out transaction", async () => {
    vi.useFakeTimers();
    const runtime = createPrismaCountryReadRuntime({
      databaseUrl: "postgresql://navigator:secret@example.test/navigator",
    });
    prismaState.queryPending = true;

    try {
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const pendingPing = runtime.ping({ maxWaitMs: 125, timeoutMs: 125 });
        const rejectedPing = expect(pendingPing).rejects.toThrow(
          "COUNTRY_READ_PING_FAILED",
        );

        expect(prismaState.queryCalls).toHaveLength(attempt);
        expect(prismaState.transactionInFlight).toBe(1);
        await vi.advanceTimersByTimeAsync(124);
        expect(prismaState.transactionInFlight).toBe(1);
        await vi.advanceTimersByTimeAsync(1);
        await rejectedPing;
        expect(prismaState.transactionInFlight).toBe(0);
      }

      expect(prismaState.transactionMaxInFlight).toBe(1);
      expect(prismaState.transactionCalls).toEqual([
        { maxWait: 125, timeout: 125 },
        { maxWait: 125, timeout: 125 },
      ]);
      expect(prismaState.transactionKeys).toEqual([
        ["$queryRaw"],
        ["$queryRaw"],
      ]);
      expect(prismaState.queryCalls).toEqual([
        { cooked: ["SELECT 1"], raw: ["SELECT 1"], values: [] },
        { cooked: ["SELECT 1"], raw: ["SELECT 1"], values: [] },
      ]);
    } finally {
      vi.useRealTimers();
    }
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

  test("redacts constructor and configuration failures without retaining cause", () => {
    prismaState.constructorError = new Error(
      "postgresql://navigator:secret@example.test/private/path",
    );

    const constructorError = captureThrown(() => createPrismaCountryReadRuntime({
      databaseUrl: "postgresql://navigator:secret@example.test/private/path",
    }));
    expectStableRuntimeError(constructorError, "COUNTRY_READ_RUNTIME_INIT_FAILED");

    prismaState.constructorError = null;
    const configError = captureThrown(() => createPrismaCountryReadRuntime({
      databaseUrl: "",
    }));
    expectStableRuntimeError(configError, "COUNTRY_READ_RUNTIME_CONFIG_INVALID");
  });

  test("redacts ping failures without retaining cause", async () => {
    const runtime = createPrismaCountryReadRuntime({
      databaseUrl: "postgresql://navigator:secret@example.test/private/path",
    });
    prismaState.transactionError = new Error(
      "postgresql://navigator:secret@example.test/private/path",
    );

    const error = await captureRejected(
      runtime.ping({ maxWaitMs: 10, timeoutMs: 20 }),
    );

    expectStableRuntimeError(error, "COUNTRY_READ_PING_FAILED");
  });

  test("redacts close failures and preserves idempotence after rejection", async () => {
    const runtime = createPrismaCountryReadRuntime({
      databaseUrl: "postgresql://navigator:secret@example.test/private/path",
    });
    prismaState.disconnectError = new Error(
      "postgresql://navigator:secret@example.test/private/path",
    );

    const first = runtime.close();
    const second = runtime.close();
    const firstError = await captureRejected(first);
    const secondError = await captureRejected(second);

    expect(first).toBe(second);
    expectStableRuntimeError(firstError, "COUNTRY_READ_CLOSE_FAILED");
    expectStableRuntimeError(secondError, "COUNTRY_READ_CLOSE_FAILED");
    expect(prismaState.disconnectCalls).toBe(1);
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

  test("canonical readiness is an O(1) check of startup-validated state", async () => {
    const fixtureRoot = createRepositoryFixture();
    const runtime = createApprovedPublicationCountryReadRuntime({
      repositoryRoot: fixtureRoot,
    });
    rmSync(fixtureRoot, { recursive: true, force: true });

    await expect(
      runtime.ping({ maxWaitMs: 100, timeoutMs: 100 }),
    ).resolves.toBeUndefined();
    await expect(
      runtime.ping({ maxWaitMs: 100, timeoutMs: 100 }),
    ).resolves.toBeUndefined();
    expect(approvedRepositoryState.listCalls).toBe(0);

    await expect(runtime.repository.list()).resolves.not.toHaveLength(0);
    expect(approvedRepositoryState.listCalls).toBe(1);
  }, 30_000);

  test("rejects a damaged canonical snapshot before a runtime can start", () => {
    const fixtureRoot = createRepositoryFixture();
    writeFileSync(
      join(fixtureRoot, "data", "indonesia", "country.json"),
      "{}\n",
    );

    expect(() =>
      createApprovedPublicationCountryReadRuntime({
        repositoryRoot: fixtureRoot,
      }),
    ).toThrow("APPROVED_PUBLICATION_RUNTIME_INVALID");
  });

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

  test("plain Node loads the canonical runtime from dist-only packages without source stripping", () => {
    execFileSync(
      "corepack",
      ["pnpm", "--filter", "@navigator/db", "build"],
      { cwd: REPOSITORY_ROOT, stdio: "pipe" },
    );
    for (const artifact of [
      "country-runtime.js",
      "country-runtime.d.ts",
      "coverage.js",
      "coverage.d.ts",
      "schema.js",
      "schema.d.ts",
    ]) {
      expect(existsSync(join(
        REPOSITORY_ROOT,
        "packages",
        "shared-types",
        "dist",
        artifact,
      ))).toBe(true);
    }
    const packageRoot = makeTemporaryDirectory("navigator-runtime-package-");
    const navigatorModules = join(packageRoot, "node_modules", "@navigator");
    mkdirSync(navigatorModules, { recursive: true });
    writeFileSync(join(packageRoot, "package.json"), '{"type":"module"}\n');
    installDistOnlyPackage("db", join(navigatorModules, "db"));
    installDistOnlyPackage("shared-types", join(navigatorModules, "shared-types"));

    const prismaModules = join(packageRoot, "node_modules", "@prisma");
    mkdirSync(prismaModules, { recursive: true });
    symlinkSync(
      join(
        REPOSITORY_ROOT,
        "packages",
        "db",
        "node_modules",
        "@prisma",
        "client",
      ),
      join(prismaModules, "client"),
      "dir",
    );

    expect(existsSync(join(navigatorModules, "db", "src"))).toBe(false);
    expect(existsSync(join(navigatorModules, "shared-types", "src"))).toBe(false);

    const canonicalRoot = join(packageRoot, "canonical-repository");
    cpSync(join(REPOSITORY_ROOT, "data"), join(canonicalRoot, "data"), {
      recursive: true,
    });
    const foreignCwd = join(packageRoot, "foreign-cwd");
    mkdirSync(foreignCwd);

    const script = `
      const dbResolved = import.meta.resolve("@navigator/db/country-read-runtime");
      const sharedResolved = import.meta.resolve("@navigator/shared-types/country-runtime");
      const {
        CountryNotFoundError,
        createApprovedPublicationCountryReadRuntime,
        DatabaseUnavailableError,
        DataIntegrityError,
      } =
        await import("@navigator/db/country-read-runtime");
      const runtime = createApprovedPublicationCountryReadRuntime({
        repositoryRoot: ${JSON.stringify(canonicalRoot)},
      });
      const countries = await runtime.repository.list();
      await runtime.ping({ maxWaitMs: 1, timeoutMs: 1 });
      await runtime.close();
      process.stdout.write(JSON.stringify({
        codes: countries.map((snapshot) => snapshot.country.code),
        dbResolved,
        sharedResolved,
        publicErrors: [
          new DatabaseUnavailableError(),
          new DataIntegrityError(),
          new CountryNotFoundError(),
        ].map((error) => ({
          name: error.name,
          message: error.message,
          ownKeys: Object.keys(error),
          hasCause: "cause" in error,
        })),
      }));
    `;
    const result = JSON.parse(
      execFileSync(
        process.execPath,
        ["--no-strip-types", "--input-type=module", "--eval", script],
        {
          cwd: foreignCwd,
          encoding: "utf8",
          env: { ...process.env, NODE_OPTIONS: "" },
        },
      ),
    ) as {
      readonly codes: readonly string[];
      readonly dbResolved: string;
      readonly sharedResolved: string;
      readonly publicErrors: readonly {
        readonly name: string;
        readonly message: string;
        readonly ownKeys: readonly string[];
        readonly hasCause: boolean;
      }[];
    };

    expect(result.codes).toEqual(["ID", "VN", "SA", "AE", "BR", "ZA"]);
    expect(result.publicErrors).toEqual([
      {
        name: "DatabaseUnavailableError",
        message: "DATABASE_UNAVAILABLE",
        ownKeys: ["name"],
        hasCause: false,
      },
      {
        name: "DataIntegrityError",
        message: "DATA_INTEGRITY_ERROR",
        ownKeys: ["name"],
        hasCause: false,
      },
      {
        name: "CountryNotFoundError",
        message: "COUNTRY_NOT_FOUND",
        ownKeys: ["name"],
        hasCause: false,
      },
    ]);
    expect(result.dbResolved).toMatch(/\/dist\/read\/country-read-runtime\.js$/u);
    expect(result.sharedResolved).toMatch(/\/dist\/country-runtime\.js$/u);
    expect(result.dbResolved).not.toMatch(/\.ts$/u);
    expect(result.sharedResolved).not.toMatch(/\.ts$/u);
  }, 30_000);
});

function installDistOnlyPackage(
  packageName: "db" | "shared-types",
  destination: string,
): void {
  const source = join(REPOSITORY_ROOT, "packages", packageName);
  mkdirSync(destination, { recursive: true });
  cpSync(join(source, "package.json"), join(destination, "package.json"));
  cpSync(join(source, "dist"), join(destination, "dist"), { recursive: true });
}

function listProductionTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) return listProductionTypeScriptFiles(entryPath);
    if (!entry.isFile() || !entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) {
      return [];
    }
    return [entryPath];
  });
}

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

function captureThrown(operation: () => unknown): Error {
  try {
    operation();
  } catch (error) {
    if (error instanceof Error) return error;
  }
  throw new Error("Expected operation to throw Error");
}

async function captureRejected(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error;
  }
  throw new Error("Expected promise to reject with Error");
}

function expectStableRuntimeError(error: Error, code: string): void {
  expect(error.message).toBe(code);
  expect("cause" in error).toBe(false);
  expect(JSON.stringify(error)).not.toMatch(/secret|private\/path/u);
  expect(Object.values(error).some((value) => value instanceof Error)).toBe(false);
}
