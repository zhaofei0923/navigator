import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test, vi } from "vitest";

import { loadApprovedBasicCountryPublicationV2 } from "./collection/basic-publication-loader.js";
import {
  importAllApprovedBasicCountries,
  prepareAllApprovedBasicCountryImports,
} from "./seed/approved-basic-countries-prisma-import.js";
import { discoverApprovedBasicCountryDirectories } from "./seed/approved-basic-publications-validation.js";
import {
  isPreparedApprovedBasicCountryImportFromLoader,
  type PreparedApprovedBasicCountryImport,
} from "./seed/approved-basic-country-import.js";
import type {
  BasicCountryImportTransaction,
  BasicCountryImportTransactionPort,
} from "./runtime/basic-country-import-runtime.js";
import type { BasicSeedImportOperation } from "./seed/basic-country-import.js";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url)).replace(/\/$/u, "");
const INVALID_PUBLICATION_SET_ERROR = "Approved Basic publication set is invalid";

describe("approved BASIC country Prisma import orchestration", () => {
  test("discovers and prepares every current publication in directory order", () => {
    const prepared = prepareAllApprovedBasicCountryImports(REPO_ROOT);

    expect(prepared.map(({ countryDirectory }) => countryDirectory)).toEqual([
      "brazil",
      "indonesia",
      "saudi-arabia",
      "south-africa",
      "united-arab-emirates",
      "vietnam",
    ]);
    expect(prepared.map(({ countryCode }) => countryCode)).toEqual([
      "BR", "ID", "SA", "ZA", "AE", "VN",
    ]);
    expect(Object.isFrozen(prepared)).toBe(true);
    for (const country of prepared) {
      expect(isPreparedApprovedBasicCountryImportFromLoader(country)).toBe(true);
      expect(Object.isFrozen(country)).toBe(true);
      expect(Object.isFrozen(country.canonical)).toBe(true);
      expect(Object.isFrozen(country.plan)).toBe(true);
    }
  });

  test("finishes all loading before a client can be constructed", () => {
    const createClient = vi.fn();
    const loaded: string[] = [];
    const loadPublication: typeof loadApprovedBasicCountryPublicationV2 = (
      repoRoot,
      countryDirectory,
    ) => {
      loaded.push(countryDirectory);
      if (countryDirectory === "vietnam") {
        throw new Error("postgresql://secret@host/database /private/repo VN payload");
      }
      return loadApprovedBasicCountryPublicationV2(repoRoot, countryDirectory);
    };

    expect(() => {
      const prepared = prepareAllApprovedBasicCountryImports(REPO_ROOT, loadPublication);
      createClient(prepared);
    }).toThrow();
    expect(loaded).toEqual([
      "brazil",
      "indonesia",
      "saudi-arabia",
      "south-africa",
      "united-arab-emirates",
      "vietnam",
    ]);
    expect(createClient).not.toHaveBeenCalled();
  });

  test("rejects an empty publication set before client or transaction access", async () => {
    const temporaryRepoRoot = createTemporaryRepoRoot();
    const createClient = vi.fn();
    const transaction = vi.fn();
    try {
      await expect(async () => {
        const prepared = prepareAllApprovedBasicCountryImports(temporaryRepoRoot);
        createClient();
        await importAllApprovedBasicCountries(prepared, { transaction });
      }).rejects.toMatchObject({ message: INVALID_PUBLICATION_SET_ERROR });

      expect(createClient).not.toHaveBeenCalled();
      expect(transaction).not.toHaveBeenCalled();
    } finally {
      rmSync(temporaryRepoRoot, { force: true, recursive: true });
    }
  });

  test("loads every publication then rejects duplicate prepared country codes", async () => {
    const temporaryRepoRoot = createTemporaryRepoRoot(["country-a", "country-b"]);
    try {
      const [fixtureDirectory] = discoverApprovedBasicCountryDirectories(REPO_ROOT);
      if (fixtureDirectory === undefined) {
        throw new Error("Missing approved publication fixture");
      }
      const authenticPublication = loadApprovedBasicCountryPublicationV2(
        REPO_ROOT,
        fixtureDirectory,
      );
      if (!authenticPublication.valid) {
        throw new Error("Invalid approved publication fixture");
      }
      const loaded: string[] = [];
      const createClient = vi.fn();
      const transaction = vi.fn();
      await expect(async () => {
        const prepared = prepareAllApprovedBasicCountryImports(
          temporaryRepoRoot,
          (_repoRoot, countryDirectory) => {
            loaded.push(countryDirectory);
            return authenticPublication;
          },
        );
        createClient();
        await importAllApprovedBasicCountries(prepared, { transaction });
      }).rejects.toMatchObject({ message: INVALID_PUBLICATION_SET_ERROR });

      expect(loaded).toEqual(["country-a", "country-b"]);
      expect(createClient).not.toHaveBeenCalled();
      expect(transaction).not.toHaveBeenCalled();
    } finally {
      rmSync(temporaryRepoRoot, { force: true, recursive: true });
    }
  });

  test("imports strictly serially and returns deterministic dynamic totals", async () => {
    const prepared = prepareAllApprovedBasicCountryImports(REPO_ROOT);
    const port = new StatefulBatchPort(prepared);

    const results = await importAllApprovedBasicCountries(prepared, port);

    expect(port.maximumActiveTransactions).toBe(1);
    expect(port.startedCountryCodes).toEqual(["BR", "ID", "SA", "ZA", "AE", "VN"]);
    expect(results.map(({ countryCode }) => countryCode)).toEqual([
      "BR", "ID", "SA", "ZA", "AE", "VN",
    ]);
    expect(results).toHaveLength(6);
    expect(results.reduce((total, result) => total + result.operationCount, 0)).toBe(72);
  });

  test("stops after a rolled-back failure and a full retry converges", async () => {
    const prepared = prepareAllApprovedBasicCountryImports(REPO_ROOT);
    const port = new StatefulBatchPort(prepared, "ID");

    await expect(importAllApprovedBasicCountries(prepared, port)).rejects.toMatchObject({
      code: "BASIC_IMPORT_DATABASE_OPERATION_FAILED",
    });
    expect(port.startedCountryCodes).toEqual(["BR", "ID"]);
    expect(port.rowCounts()).toEqual({ country: 1, moduleCoverage: 10, marketOverview: 1 });

    const retryResults = await importAllApprovedBasicCountries(prepared, port);

    expect(retryResults.map(({ countryCode }) => countryCode)).toEqual([
      "BR", "ID", "SA", "ZA", "AE", "VN",
    ]);
    expect(port.rowCounts()).toEqual({ country: 6, moduleCoverage: 60, marketOverview: 6 });
  });

  test("keeps production orchestration country-neutral and non-parallel", async () => {
    const source = await readFile(
      fileURLToPath(new URL("./seed/approved-basic-countries-prisma-import.ts", import.meta.url)),
      "utf8",
    );

    expect(source).not.toMatch(/brazil|indonesia|saudi-arabia|south-africa|united-arab-emirates|vietnam/u);
    expect(source).not.toMatch(/["'](?:BR|ID|SA|ZA|AE|VN)["']/u);
    expect(source).not.toMatch(/Promise\.all/u);
    expect(source).toMatch(/for\s*\(\s*const\s+\w+\s+of\s+prepared\s*\)/u);
  });
});

function createTemporaryRepoRoot(countryDirectories: readonly string[] = []): string {
  const repoRoot = mkdtempSync(join(tmpdir(), "navigator-approved-basic-set-"));
  const dataDirectory = join(repoRoot, "data");
  mkdirSync(dataDirectory);
  for (const countryDirectory of countryDirectories) {
    mkdirSync(join(dataDirectory, countryDirectory));
  }
  return repoRoot;
}

interface BatchState {
  readonly countries: Map<string, BasicSeedImportOperation>;
  readonly coverages: Map<string, BasicSeedImportOperation>;
  readonly marketOverviews: Map<string, BasicSeedImportOperation>;
}

class StatefulBatchPort implements BasicCountryImportTransactionPort {
  readonly startedCountryCodes: string[] = [];
  maximumActiveTransactions = 0;
  private activeTransactions = 0;
  private failed = false;
  private state: BatchState = {
    countries: new Map(),
    coverages: new Map(),
    marketOverviews: new Map(),
  };
  private readonly canonicalByCode: ReadonlyMap<string, PreparedApprovedBasicCountryImport["canonical"]>;

  constructor(
    prepared: readonly PreparedApprovedBasicCountryImport[],
    private readonly failOnceForCountry?: string,
  ) {
    this.canonicalByCode = new Map(prepared.map((value) => [value.countryCode, value.canonical]));
  }

  async transaction<T>(
    run: (transaction: BasicCountryImportTransaction) => Promise<T>,
  ): Promise<T> {
    this.activeTransactions += 1;
    this.maximumActiveTransactions = Math.max(
      this.maximumActiveTransactions,
      this.activeTransactions,
    );
    await new Promise<void>((resolveImmediate) => setImmediate(resolveImmediate));
    const before = this.snapshot();
    let countryCode: string | undefined;
    let operationCount = 0;
    try {
      return await run({
        activationCounts: { count: async () => 0 },
        execute: async (operation) => {
          operationCount += 1;
          if (operation.model === "country") {
            countryCode = operation.args.where.code;
            this.startedCountryCodes.push(countryCode);
          }
          if (
            countryCode === this.failOnceForCountry &&
            !this.failed &&
            operationCount === 6
          ) {
            this.failed = true;
            throw new Error("sql://secret.example/failure");
          }
          this.upsert(operation);
        },
        readCanonical: async (code) => structuredClone(this.canonicalByCode.get(code) ?? null),
      });
    } catch (error) {
      this.state = before;
      throw error;
    } finally {
      this.activeTransactions -= 1;
    }
  }

  rowCounts(): Record<string, number> {
    return {
      country: this.state.countries.size,
      moduleCoverage: this.state.coverages.size,
      marketOverview: this.state.marketOverviews.size,
    };
  }

  private upsert(operation: BasicSeedImportOperation): void {
    if (operation.model === "country") {
      this.state.countries.set(operation.args.where.code, operation);
      return;
    }
    if (operation.model === "moduleCoverage") {
      const key = operation.args.where.countryCode_moduleKey;
      this.state.coverages.set(`${key.countryCode}:${key.moduleKey}`, operation);
      return;
    }
    this.state.marketOverviews.set(operation.args.where.countryCode, operation);
  }

  private snapshot(): BatchState {
    return {
      countries: new Map(this.state.countries),
      coverages: new Map(this.state.coverages),
      marketOverviews: new Map(this.state.marketOverviews),
    };
  }
}
