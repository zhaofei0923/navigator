import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { MODULE_KEYS } from "@navigator/shared-types/schema";
import { Prisma, type PrismaClient } from "@prisma/client";
import { describe, expect, test, vi } from "vitest";

import {
  createValidBasicProfile,
  createValidBundle,
  getRecord,
} from "./basic-country-test-fixture.js";
import { buildBasicCountryImportPlan } from "./seed/basic-country-import.js";
import {
  createPrismaBasicCountryImportPort,
  type PrismaBasicCountryClient,
  type PrismaBasicCountryTransaction,
} from "./runtime/prisma-basic-country-import-port.js";
import type { BasicSeedImportOperation } from "./seed/basic-country-import.js";
import {
  prepareApprovedBasicCountryImport,
  type PreparedApprovedBasicCountryImport,
} from "./seed/approved-basic-country-import.js";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url)).replace(/\/$/u, "");
const APPROVED_COUNTRIES = [
  "brazil",
  "indonesia",
  "saudi-arabia",
  "south-africa",
  "united-arab-emirates",
  "vietnam",
] as const;

const acceptsGeneratedPrismaClient = (
  client: PrismaClient,
): PrismaBasicCountryClient => client;
void acceptsGeneratedPrismaClient;

describe("createPrismaBasicCountryImportPort", () => {
  test("runs exactly one caller-owned Serializable transaction with bounded waits", async () => {
    const transaction = createEmptyTransaction();
    const client = clientFor(transaction);

    const result = await createPrismaBasicCountryImportPort(client).transaction(
      async (value) => {
        expect(value).toBeDefined();
        return "committed";
      },
    );

    expect(result).toBe("committed");
    expect(client.transactionSpy).toHaveBeenCalledTimes(1);
    expect(client.transactionSpy).toHaveBeenCalledWith({
      isolationLevel: "Serializable",
      maxWait: 5000,
      timeout: 15000,
    });
  });

  test("does not own Prisma client construction, disconnection, or raw SQL lifecycle", async () => {
    const sourcePath = fileURLToPath(
      new URL("./runtime/prisma-basic-country-import-port.ts", import.meta.url),
    );
    const source = await readFile(sourcePath, "utf8");

    expect(source).not.toMatch(/new\s+PrismaClient|\$disconnect|\$(?:query|execute)Raw/u);
    expect(source).toContain('import { Prisma } from "@prisma/client";');
  });

  test.each([
    "marketOverview",
    "policy",
    "risk",
    "opportunity",
    "project",
    "partner",
    "chineseCompany",
    "entryStrategy",
    "report",
    "knowledgeChunk",
  ] as const)("maps %s activation counts to its exact delegate and where", async (model) => {
    const transaction = createEmptyTransaction();
    const port = createPrismaBasicCountryImportPort(
      clientFor(transaction),
    );

    await port.transaction(async ({ activationCounts }) => {
      await expect(activationCounts.count(model, "all", "ID")).resolves.toBe(0);
      await expect(activationCounts.count(model, "published", "ID")).resolves.toBe(0);
      await expect(activationCounts.count(model, "ai-eligible", "ID")).resolves.toBe(0);
    });

    const delegate = transaction[model];
    expect(delegate.count).toHaveBeenNthCalledWith(1, { where: { countryCode: "ID" } });
    expect(delegate.count).toHaveBeenNthCalledWith(2, {
      where: { countryCode: "ID", reviewStatus: "published" },
    });
    expect(delegate.count).toHaveBeenNthCalledWith(3, {
      where: {
        countryCode: "ID",
        reviewStatus: "published",
        credibility: { not: "UNVERIFIED" },
        aiUsable: true,
      },
    });
    for (const other of activationModelNames().filter((value) => value !== model)) {
      expect(transaction[other].count).not.toHaveBeenCalled();
    }
  });

  test("rebuilds the three operation variants into typed Prisma upserts", async () => {
    const prepared = approved("indonesia");
    const transaction = createEmptyTransaction();
    const port = createPrismaBasicCountryImportPort(clientFor(transaction));

    await port.transaction(async ({ execute }) => {
      for (const operation of prepared.plan.operations) await execute(operation);
    });

    expect(transaction.country.upsert).toHaveBeenCalledTimes(1);
    expect(transaction.moduleCoverage.upsert).toHaveBeenCalledTimes(MODULE_KEYS.length);
    expect(transaction.marketOverview.upsert).toHaveBeenCalledTimes(1);
    const countryArgs = firstCallArg(vi.mocked(transaction.country.upsert));
    expect(countryArgs).toMatchObject({
      where: { code: "ID" },
      create: { code: "ID", region: "SOUTHEAST_ASIA", coverageLevel: "BASIC" },
      update: { code: "ID", region: "SOUTHEAST_ASIA", coverageLevel: "BASIC" },
    });
    expect(record(countryArgs.create).updatedAt).toBeInstanceOf(Date);
    const marketArgs = firstCallArg(vi.mocked(transaction.marketOverview.upsert));
    expect(record(marketArgs.create).collectedAt).toBeInstanceOf(Date);
    expect(record(marketArgs.create).updatedAt).toBeInstanceOf(Date);
    expect(record(marketArgs.create).basicProfile).toBe(Prisma.DbNull);
    const marketOperation = prepared.plan.operations.at(-1);
    if (marketOperation?.model !== "marketOverview") throw new TypeError("missing market operation");
    expect(record(marketArgs.create).keyIndicators).toEqual(marketOperation.args.create.keyIndicators);
    expect(marketArgs).not.toHaveProperty("args");
  });

  test("round-trips a BASIC v2 profile through Prisma upsert and canonical read", async () => {
    const bundle = createValidBundle();
    const profile = createValidBasicProfile();
    getRecord(bundle.canonical.marketOverview, "market overview").basicProfile = profile;
    const plan = buildBasicCountryImportPlan(bundle);
    const state = createStatefulTransaction();
    const port = createPrismaBasicCountryImportPort(clientFor(state.transaction));

    const readback = await port.transaction(async (tx) => {
      for (const operation of plan.operations) await tx.execute(operation);
      return tx.readCanonical("VN");
    });

    expect(getRecord(readback?.marketOverview, "market overview").basicProfile)
      .toEqual(profile);
    const marketArgs = firstCallArg(vi.mocked(state.transaction.marketOverview.upsert));
    expect(record(marketArgs.create).basicProfile).toEqual(profile);
    expect(record(marketArgs.create).basicProfile).not.toBe(Prisma.DbNull);
  });

  test.each([
    ["region", 0, "region", "MOON"],
    ["coverage", 0, "coverageLevel", "UNKNOWN"],
    ["country date", 0, "updatedAt", "2026-02-31T00:00:00Z"],
    ["localized JSON", 0, "name", { zh: "only", en: "", extra: true }],
    ["module key", 1, "moduleKey", "UNKNOWN_MODULE"],
    ["module status", 1, "status", "UNKNOWN"],
    ["module date", 1, "updatedAt", "not-a-date"],
    ["credibility", 11, "credibility", "UNKNOWN"],
    ["review status", 11, "reviewStatus", "approved"],
    ["industry tag", 11, "industryTags", ["COAL"]],
    ["technology tag", 11, "techTags", ["FUSION"]],
    ["BASIC v2 profile", 11, "basicProfile", { schemaVersion: "basic-market-profile/v1" }],
    ["key indicator JSON", 11, "keyIndicators", [{ label: { zh: "x", en: "x" }, value: "1", unit: "x", year: 2026, extra: true }]],
  ] as const)("rejects invalid %s before calling a delegate", async (_label, index, field, value) => {
    const prepared = approved("indonesia");
    const operation = structuredClone(prepared.plan.operations[index]);
    const mutable = record(record(operation).args);
    record(mutable.create)[field] = value;
    record(mutable.update)[field] = value;
    const transaction = createEmptyTransaction();
    const port = createPrismaBasicCountryImportPort(clientFor(transaction));

    await expect(port.transaction((tx) => tx.execute(operation as BasicSeedImportOperation)))
      .rejects.toThrow();
    expect(totalUpsertCalls(transaction)).toBe(0);
  });

  test("reads through the callback transaction rather than the root client", async () => {
    const transaction = createEmptyTransaction();
    vi.mocked(transaction.country.findUnique).mockResolvedValue(null);
    const client = clientFor(transaction);

    await createPrismaBasicCountryImportPort(client).transaction(async (tx) => {
      await expect(tx.readCanonical("ID")).resolves.toBeNull();
    });

    expect(transaction.country.findUnique).toHaveBeenCalledTimes(1);
    expect(client.transactionSpy).toHaveBeenCalledTimes(1);
  });

  test.each(APPROVED_COUNTRIES)(
    "executes and reads back the approved %s BASIC canonical snapshot",
    async (countryDirectory) => {
      const prepared = approved(countryDirectory);
      const state = createStatefulTransaction();
      const port = createPrismaBasicCountryImportPort(clientFor(state.transaction));

      const readback = await port.transaction(async (tx) => {
        for (const operation of prepared.plan.operations) await tx.execute(operation);
        return tx.readCanonical(prepared.countryCode);
      });

      expect(readback).toEqual({
        ...prepared.canonical,
        marketOverview: {
          ...prepared.canonical.marketOverview,
          basicProfile: null,
        },
      });
    },
  );
});

function approved(countryDirectory: string): PreparedApprovedBasicCountryImport {
  return prepareApprovedBasicCountryImport(REPO_ROOT, countryDirectory);
}

function activationModelNames() {
  return [
    "marketOverview", "policy", "risk", "opportunity", "project", "partner",
    "chineseCompany", "entryStrategy", "report", "knowledgeChunk",
  ] as const;
}

function createEmptyTransaction(): PrismaBasicCountryTransaction {
  const count = () => ({ count: vi.fn(async () => 0) });
  return {
    country: { upsert: vi.fn(async () => ({})), findUnique: vi.fn(async () => null) },
    moduleCoverage: { upsert: vi.fn(async () => ({})) },
    marketOverview: { ...count(), upsert: vi.fn(async () => ({})) },
    policy: count(),
    risk: count(),
    opportunity: count(),
    project: count(),
    partner: count(),
    chineseCompany: count(),
    entryStrategy: count(),
    report: count(),
    knowledgeChunk: count(),
  };
}

function clientFor(transaction: PrismaBasicCountryTransaction): PrismaBasicCountryClient & {
  transactionSpy: ReturnType<typeof vi.fn>;
} {
  const transactionSpy = vi.fn();
  return {
    transactionSpy,
    async $transaction<T>(
      run: (value: PrismaBasicCountryTransaction) => Promise<T>,
      options: {
        readonly isolationLevel: "Serializable";
        readonly maxWait: 5000;
        readonly timeout: 15000;
      },
    ): Promise<T> {
      transactionSpy(options);
      return run(transaction);
    },
  };
}

function createStatefulTransaction(): { transaction: PrismaBasicCountryTransaction } {
  let country: Record<string, unknown> | null = null;
  const coverages = new Map<string, Record<string, unknown>>();
  let marketOverview: Record<string, unknown> | null = null;
  const transaction = createEmptyTransaction();
  transaction.country.upsert = vi.fn(async (args) => {
    country = record(args.create);
    return country;
  });
  transaction.moduleCoverage.upsert = vi.fn(async (args) => {
    const value = record(args.create);
    coverages.set(String(value.moduleKey), value);
    return value;
  });
  transaction.marketOverview.upsert = vi.fn(async (args) => {
    const create = record(args.create);
    marketOverview = {
      ...create,
      basicProfile: create.basicProfile === Prisma.DbNull
        ? null
        : create.basicProfile,
    };
    return marketOverview;
  });
  transaction.country.findUnique = vi.fn(async () => country === null ? null : {
    ...country,
    moduleCoverage: [...coverages.values()].reverse(),
    marketOverview,
    policies: [],
    risks: [],
    opportunities: [],
    projects: [],
    partners: [],
    chineseCompanies: [],
    entryStrategy: null,
    reports: [],
    knowledgeChunks: [],
  });
  return { transaction };
}

function totalUpsertCalls(transaction: PrismaBasicCountryTransaction): number {
  return vi.mocked(transaction.country.upsert).mock.calls.length +
    vi.mocked(transaction.moduleCoverage.upsert).mock.calls.length +
    vi.mocked(transaction.marketOverview.upsert).mock.calls.length;
}

function firstCallArg(call: { mock: { calls: unknown[][] } }): Record<string, unknown> {
  return record(call.mock.calls[0]?.[0]);
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("expected record");
  }
  return value as Record<string, unknown>;
}
