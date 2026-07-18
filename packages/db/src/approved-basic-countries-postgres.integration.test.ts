import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { Prisma, PrismaClient } from "@prisma/client";
import { describe, expect, test, vi } from "vitest";

import {
  importPreparedApprovedBasicCountry,
  type BasicCountryImportTransaction,
  type BasicCountryImportTransactionPort,
} from "./runtime/basic-country-import-runtime.js";
import { createPrismaBasicCountryImportPort } from "./runtime/prisma-basic-country-import-port.js";
import { readPrismaBasicCanonicalCountry } from "./runtime/prisma-basic-country-read.js";
import {
  importAllApprovedBasicCountries,
  prepareAllApprovedBasicCountryImports,
} from "./seed/approved-basic-countries-prisma-import.js";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url)).replace(/\/$/u, "");
const DATABASE_URL_REJECTED = "BASIC_POSTGRES_INTEGRATION_DATABASE_URL_REJECTED";
const DATABASE_URL_MISSING =
  "PostgreSQL BASIC import integration skipped: DATABASE_URL is not set";

const BUSINESS_TABLES_EMPTY: BusinessCounts = {
  country: 0,
  moduleCoverage: 0,
  marketOverview: 0,
  policy: 0,
  risk: 0,
  opportunity: 0,
  project: 0,
  partner: 0,
  chineseCompany: 0,
  entryStrategy: 0,
  report: 0,
  knowledgeChunk: 0,
  lead: 0,
};

const integrationDatabase = selectIntegrationDatabase(process.env.DATABASE_URL);

describe("PostgreSQL BASIC import integration URL safety", () => {
  test("accepts only the dedicated loopback database URL shape", () => {
    expect(() => requireSafeIntegrationDatabaseUrl(
      "postgresql://test:test@127.0.0.1:55432/navigator_platform_db_1_test",
    )).not.toThrow();
    expect(() => requireSafeIntegrationDatabaseUrl(
      "postgresql://test:test@[::1]:55432/navigator_platform_db_1_test",
    )).not.toThrow();
  });

  test("selects the fixed skipped state when DATABASE_URL is absent", () => {
    expect(selectIntegrationDatabase(undefined)).toEqual({
      kind: "skip",
      reason: DATABASE_URL_MISSING,
    });
  });

  test("fails closed with one redacted error for unsafe URL variants", () => {
    const unsafeValues = [
      "not-a-url",
      "mysql://test:test@127.0.0.1:55432/navigator_platform_db_1_test",
      "postgresql://test:test@localhost:55432/navigator_platform_db_1_test",
      "postgresql://test:test@127.0.0.2:55432/navigator_platform_db_1_test",
      "postgresql://test:test@127.0.0.1:55432/postgres",
      "postgresql://test:test@127.0.0.1:55432/navigator_platform_db_1_test/other",
      "postgresql://test:test@127.0.0.1:55432/navigator_platform_db_1_test?schema=other",
      "postgresql://test:test@127.0.0.1:55432/navigator_platform_db_1_test#other",
      "postgresql://credential-marker@database.example/navigator_platform_db_1_test",
      "postgresql://test:test@127.0.0.1:55432/%E0%A4%A",
    ];

    for (const value of unsafeValues) {
      expect(() => requireSafeIntegrationDatabaseUrl(value)).toThrow(DATABASE_URL_REJECTED);
      try {
        requireSafeIntegrationDatabaseUrl(value);
      } catch (error) {
        expect(String(error)).toBe(`Error: ${DATABASE_URL_REJECTED}`);
        expect(String(error)).not.toContain(value);
        expect(String(error)).not.toContain("credential-marker");
      }
    }
  });
});

if (integrationDatabase.kind === "skip") {
  describe.skip(integrationDatabase.reason, () => {
    test(integrationDatabase.reason, () => undefined);
  });
} else {
  describe("approved BASIC imports in PostgreSQL", () => {
    test("rolls back a real failure and imports every canonical publication idempotently", async () => {
      const safeDatabaseUrl = requireSafeIntegrationDatabaseUrl(integrationDatabase.value);
      const prisma = new PrismaClient({ datasources: { db: { url: safeDatabaseUrl } } });
      const disconnect = vi.spyOn(prisma, "$disconnect");

      try {
        await expectSuccessfulInitialMigration(prisma);
        await expectBusinessCounts(prisma, BUSINESS_TABLES_EMPTY);

        const prepared = prepareAllApprovedBasicCountryImports(REPO_ROOT);
        expect(prepared).toHaveLength(6);

        const realPort = createPrismaBasicCountryImportPort(prisma);
        const rollbackProbe = createRollbackProbe(realPort);
        const authenticPreparedCountry = prepared[0];
        if (authenticPreparedCountry === undefined) {
          throw new Error("BASIC_POSTGRES_INTEGRATION_PREPARATION_MISSING");
        }

        await expect(importPreparedApprovedBasicCountry(
          authenticPreparedCountry,
          rollbackProbe.port,
        )).rejects.toMatchObject({
          name: "BasicCountryImportError",
          code: "BASIC_IMPORT_DATABASE_OPERATION_FAILED",
          message: "BASIC_IMPORT_DATABASE_OPERATION_FAILED",
        });
        expect(rollbackProbe.executedOperationCount()).toBe(2);
        await expectBusinessCounts(prisma, BUSINESS_TABLES_EMPTY);

        const firstResults = await importAllApprovedBasicCountries(prepared, realPort);
        const secondResults = await importAllApprovedBasicCountries(prepared, realPort);
        const expectedCountryOrder = prepared.map(({ countryCode }) => countryCode);
        const expectedOperationCount = prepared.reduce(
          (total, country) => total + country.plan.operations.length,
          0,
        );

        expect(expectedCountryOrder).toEqual(["BR", "ID", "SA", "ZA", "AE", "VN"]);
        for (const results of [firstResults, secondResults]) {
          expect(results).toHaveLength(prepared.length);
          expect(results.map(({ countryCode }) => countryCode)).toEqual(expectedCountryOrder);
          expect(results.reduce(
            (total, result) => total + result.operationCount,
            0,
          )).toBe(expectedOperationCount);
        }
        expect(expectedOperationCount).toBe(72);

        await expectBusinessCounts(prisma, {
          ...BUSINESS_TABLES_EMPTY,
          country: 6,
          moduleCoverage: 60,
          marketOverview: 6,
        });

        for (const country of prepared) {
          const actual = await prisma.$transaction(
            (transaction: Prisma.TransactionClient) => readPrismaBasicCanonicalCountry(
              transaction,
              country.countryCode,
            ),
            { isolationLevel: "Serializable", maxWait: 5000, timeout: 15000 },
          );
          expect(isDeepStrictEqual(actual, country.canonical)).toBe(true);
        }
      } finally {
        await prisma.$disconnect();
        expect(disconnect).toHaveBeenCalledTimes(1);
      }
    });
  });
}

interface BusinessCounts {
  readonly country: number;
  readonly moduleCoverage: number;
  readonly marketOverview: number;
  readonly policy: number;
  readonly risk: number;
  readonly opportunity: number;
  readonly project: number;
  readonly partner: number;
  readonly chineseCompany: number;
  readonly entryStrategy: number;
  readonly report: number;
  readonly knowledgeChunk: number;
  readonly lead: number;
}

interface MigrationRow {
  readonly migration_name: string;
  readonly finished_at: Date | null;
  readonly rolled_back_at: Date | null;
  readonly applied_steps_count: number;
}

type IntegrationDatabaseSelection =
  | { readonly kind: "skip"; readonly reason: typeof DATABASE_URL_MISSING }
  | { readonly kind: "run"; readonly value: string };

function selectIntegrationDatabase(
  value: string | undefined,
): IntegrationDatabaseSelection {
  return value === undefined
    ? { kind: "skip", reason: DATABASE_URL_MISSING }
    : { kind: "run", value };
}

function requireSafeIntegrationDatabaseUrl(value: string): string {
  try {
    const parsed = new URL(value);
    const decodedPathname = decodeURIComponent(parsed.pathname);
    if (
      parsed.protocol !== "postgresql:" ||
      (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "[::1]") ||
      decodedPathname !== "/navigator_platform_db_1_test" ||
      parsed.search !== "" ||
      parsed.hash !== ""
    ) {
      throw new Error(DATABASE_URL_REJECTED);
    }
    return value;
  } catch {
    throw new Error(DATABASE_URL_REJECTED);
  }
}

async function expectSuccessfulInitialMigration(prisma: PrismaClient): Promise<void> {
  const rows = await prisma.$queryRaw<MigrationRow[]>`
    SELECT migration_name, finished_at, rolled_back_at, applied_steps_count
    FROM "_prisma_migrations"
    WHERE migration_name = '0001_init'
  `;
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    migration_name: "0001_init",
    finished_at: expect.any(Date),
    rolled_back_at: null,
    applied_steps_count: 1,
  });
}

async function readBusinessCounts(prisma: PrismaClient): Promise<BusinessCounts> {
  return {
    country: await prisma.country.count(),
    moduleCoverage: await prisma.moduleCoverage.count(),
    marketOverview: await prisma.marketOverview.count(),
    policy: await prisma.policy.count(),
    risk: await prisma.risk.count(),
    opportunity: await prisma.opportunity.count(),
    project: await prisma.project.count(),
    partner: await prisma.partner.count(),
    chineseCompany: await prisma.chineseCompany.count(),
    entryStrategy: await prisma.entryStrategy.count(),
    report: await prisma.report.count(),
    knowledgeChunk: await prisma.knowledgeChunk.count(),
    lead: await prisma.lead.count(),
  };
}

async function expectBusinessCounts(
  prisma: PrismaClient,
  expected: BusinessCounts,
): Promise<void> {
  await expect(readBusinessCounts(prisma)).resolves.toEqual(expected);
}

function createRollbackProbe(realPort: BasicCountryImportTransactionPort): {
  readonly port: BasicCountryImportTransactionPort;
  readonly executedOperationCount: () => number;
} {
  let executedOperationCount = 0;
  return {
    executedOperationCount: () => executedOperationCount,
    port: {
      transaction: <T>(
        run: (transaction: BasicCountryImportTransaction) => Promise<T>,
      ): Promise<T> => realPort.transaction(async (transaction) => run({
        ...transaction,
        execute: async (operation) => {
          await transaction.execute(operation);
          executedOperationCount += 1;
          if (executedOperationCount === 2) {
            throw new Error("BASIC_POSTGRES_INTEGRATION_SYNTHETIC_ROLLBACK");
          }
        },
      })),
    },
  };
}
