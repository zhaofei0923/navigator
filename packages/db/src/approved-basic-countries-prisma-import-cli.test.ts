import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, test, vi } from "vitest";

import type { BasicCountryImportTransactionPort } from "./runtime/basic-country-import-runtime.js";

const adapterState = vi.hoisted(() => ({
  calls: 0,
  error: null as Error | null,
  port: null as BasicCountryImportTransactionPort | null,
}));

vi.mock("./runtime/prisma-basic-country-import-port.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./runtime/prisma-basic-country-import-port.js")>();
  return {
    ...actual,
    createPrismaBasicCountryImportPort() {
      adapterState.calls += 1;
      if (adapterState.error !== null) throw adapterState.error;
      if (adapterState.port === null) throw new Error("missing test port");
      return adapterState.port;
    },
  };
});

import {
  APPROVED_BASIC_COUNTRIES_IMPORT_USAGE,
  runApprovedBasicCountriesPrismaImportCli,
} from "./seed/approved-basic-countries-prisma-import-cli.js";
import { prepareAllApprovedBasicCountryImports } from "./seed/approved-basic-countries-prisma-import.js";
import type { PreparedApprovedBasicCountryImport } from "./seed/approved-basic-country-import.js";
import type {
  BasicCountryImportTransaction,
  BasicCountryImportTransactionPort as ImportPort,
} from "./runtime/basic-country-import-runtime.js";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url)).replace(/\/$/u, "");

beforeEach(() => {
  adapterState.calls = 0;
  adapterState.error = null;
  adapterState.port = null;
});

describe("approved BASIC countries Prisma import CLI", () => {
  test("prints stable help without constructing a client", async () => {
    const harness = createHarness();

    await expect(runApprovedBasicCountriesPrismaImportCli(["--help"], harness.dependencies))
      .resolves.toBe(0);

    expect(harness.stdout).toEqual([`${APPROVED_BASIC_COUNTRIES_IMPORT_USAGE}\n`]);
    expect(harness.stderr).toEqual([]);
    expect(harness.createClient).not.toHaveBeenCalled();
    expect(adapterState.calls).toBe(0);
  });

  test.each([["unexpected"], ["--help", "extra"], ["--"], ["--", "unexpected"]])(
    "rejects invalid arguments without constructing a client: %j",
    async (...args) => {
      const harness = createHarness();

      await expect(runApprovedBasicCountriesPrismaImportCli(args, harness.dependencies))
        .resolves.toBe(1);

      expect(harness.stdout).toEqual([]);
      expect(harness.stderr).toEqual([`${APPROVED_BASIC_COUNTRIES_IMPORT_USAGE}\n`]);
      expect(harness.createClient).not.toHaveBeenCalled();
      expect(adapterState.calls).toBe(0);
    },
  );

  test("prepares, constructs one client and adapter, imports, disconnects, then summarizes", async () => {
    const events: string[] = [];
    const harness = createHarness(events);
    adapterState.port = new SuccessfulBatchPort(
      prepareAllApprovedBasicCountryImports(REPO_ROOT),
    );

    await expect(runApprovedBasicCountriesPrismaImportCli([], harness.dependencies))
      .resolves.toBe(0);

    expect(harness.createClient).toHaveBeenCalledTimes(1);
    expect(adapterState.calls).toBe(1);
    expect(harness.disconnect).toHaveBeenCalledTimes(1);
    expect(harness.stderr).toEqual([]);
    expect(harness.stdout).toEqual([
      '{"status":"ok","countryCount":6,"operationCount":72}\n',
    ]);
    expect(events.at(-2)).toBe("disconnect");
    expect(events.at(-1)).toBe("stdout");
  });

  test("does not construct a client when preparation fails", async () => {
    const harness = createHarness();
    harness.dependencies.repoRoot = resolve(REPO_ROOT, "missing-private-repository");

    await expect(runApprovedBasicCountriesPrismaImportCli([], harness.dependencies))
      .resolves.toBe(1);

    expectRedactedFailure(harness);
    expect(harness.createClient).not.toHaveBeenCalled();
    expect(harness.disconnect).not.toHaveBeenCalled();
    expect(adapterState.calls).toBe(0);
  });

  test("redacts constructor failure and disconnects zero times", async () => {
    const harness = createHarness();
    harness.createClient.mockImplementation(() => {
      throw new Error("postgresql://user:secret@db/private/repo BR payload");
    });

    await expect(runApprovedBasicCountriesPrismaImportCli([], harness.dependencies))
      .resolves.toBe(1);

    expectRedactedFailure(harness);
    expect(harness.disconnect).not.toHaveBeenCalled();
    expect(adapterState.calls).toBe(0);
  });

  test("redacts adapter failure and disconnects once", async () => {
    const harness = createHarness();
    adapterState.error = new Error("SELECT * FROM secret /private/repo ID payload");

    await expect(runApprovedBasicCountriesPrismaImportCli([], harness.dependencies))
      .resolves.toBe(1);

    expectRedactedFailure(harness);
    expect(harness.disconnect).toHaveBeenCalledTimes(1);
  });

  test("redacts import failure and disconnects once", async () => {
    const harness = createHarness();
    adapterState.port = {
      transaction: async () => {
        throw new Error("postgresql://secret SELECT /private/repo country payload");
      },
    };

    await expect(runApprovedBasicCountriesPrismaImportCli([], harness.dependencies))
      .resolves.toBe(1);

    expectRedactedFailure(harness);
    expect(harness.disconnect).toHaveBeenCalledTimes(1);
  });

  test("treats disconnect failure as redacted failure without double disconnect", async () => {
    const harness = createHarness();
    adapterState.port = new SuccessfulBatchPort(
      prepareAllApprovedBasicCountryImports(REPO_ROOT),
    );
    harness.disconnect.mockRejectedValue(
      new Error("postgresql://secret SELECT /private/repo VN payload"),
    );

    await expect(runApprovedBasicCountriesPrismaImportCli([], harness.dependencies))
      .resolves.toBe(1);

    expectRedactedFailure(harness);
    expect(harness.disconnect).toHaveBeenCalledTimes(1);
  });
});

function createHarness(events: string[] = []) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const disconnect = vi.fn(async () => {
    events.push("disconnect");
  });
  const client = { $transaction: vi.fn(), $disconnect: disconnect };
  const createClient = vi.fn(() => client);
  const dependencies = {
    repoRoot: REPO_ROOT,
    createClient,
    stdout: (line: string) => {
      events.push("stdout");
      stdout.push(line);
    },
    stderr: (line: string) => {
      events.push("stderr");
      stderr.push(line);
    },
  };
  return { client, createClient, dependencies, disconnect, stderr, stdout };
}

function expectRedactedFailure(harness: ReturnType<typeof createHarness>): void {
  expect(harness.stdout).toEqual([]);
  expect(harness.stderr).toEqual(["BASIC_IMPORT_FAILED\n"]);
  expect(harness.stderr.join("")).not.toMatch(
    /postgres|secret|select|private|repo|payload|BR|ID|VN|stack/i,
  );
}

class SuccessfulBatchPort implements ImportPort {
  private readonly canonicalByCode: ReadonlyMap<string, PreparedApprovedBasicCountryImport["canonical"]>;

  constructor(prepared: readonly PreparedApprovedBasicCountryImport[]) {
    this.canonicalByCode = new Map(prepared.map((value) => [value.countryCode, value.canonical]));
  }

  async transaction<T>(
    run: (transaction: BasicCountryImportTransaction) => Promise<T>,
  ): Promise<T> {
    return run({
      activationCounts: { count: async () => 0 },
      execute: async () => undefined,
      readCanonical: async (countryCode) =>
        structuredClone(this.canonicalByCode.get(countryCode) ?? null),
    });
  }
}
