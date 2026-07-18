import { fileURLToPath } from "node:url";

import { MODULE_KEYS } from "@navigator/shared-types/schema";
import { describe, expect, test, vi } from "vitest";

import type { BasicCanonicalData } from "./seed/basic-country-types.js";
import type { BasicSeedImportOperation } from "./seed/basic-country-import.js";
import {
  prepareApprovedBasicCountryImport,
  type PreparedApprovedBasicCountryImport,
} from "./seed/approved-basic-country-import.js";

const trustedPreparations = vi.hoisted(() => new WeakSet<object>());
const preflightFailure = vi.hoisted(() => ({ error: null as Error | null }));

vi.mock("./seed/approved-basic-country-import.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./seed/approved-basic-country-import.js")>();
  return {
    ...actual,
    isPreparedApprovedBasicCountryImportFromLoader(value: unknown): boolean {
      return typeof value === "object" && value !== null && trustedPreparations.has(value);
    },
  };
});

vi.mock("./seed/basic-country-activation-preflight.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./seed/basic-country-activation-preflight.js")>();
  return {
    ...actual,
    async preflightBasicCountryActivation(
      countryCode: string,
      activationCounts: Parameters<typeof actual.preflightBasicCountryActivation>[1],
    ) {
      if (preflightFailure.error !== null) throw preflightFailure.error;
      return actual.preflightBasicCountryActivation(countryCode, activationCounts);
    },
  };
});

import {
  BasicCountryImportError,
  importPreparedApprovedBasicCountry,
  type BasicCountryImportTransaction,
  type BasicCountryImportTransactionPort,
} from "./runtime/basic-country-import-runtime.js";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url)).replace(/\/$/u, "");

describe("importPreparedApprovedBasicCountry", () => {
  test("runs the exact approved BASIC plan in one transaction", async () => {
    const prepared = approvedPreparation();
    const port = new InMemoryTransactionPort(prepared.canonical);

    await expect(importPreparedApprovedBasicCountry(prepared, port)).resolves.toEqual({
      countryCode: prepared.countryCode,
      operationCount: 12,
    });
    expect(port.transactionCalls).toBe(1);
    expect(port.executed).toHaveLength(12);
    expect(port.executed).toEqual(prepared.plan.operations);
  });

  test.each([
    ["country operation", (prepared: MutablePrepared) => { prepared.plan.operations.shift(); }],
    ["module order", (prepared: MutablePrepared) => { prepared.plan.operations[1] = prepared.plan.operations[2]!; }],
    ["country code", (prepared: MutablePrepared) => { prepared.countryCode = "ZZ"; }],
    ["summary code", (prepared: MutablePrepared) => { prepared.plan.summary.countryCode = "ZZ"; }],
    ["coverage level", (prepared: MutablePrepared) => { prepared.plan.summary.coverageLevel = "STANDARD"; }],
    ["AI knowledge ids", (prepared: MutablePrepared) => { prepared.plan.aiEligibleKnowledgeIds = ["unexpected"]; }],
  ] as const)("rejects invalid %s before opening a transaction", async (_name, corrupt) => {
    const prepared = editableApprovedPreparation();
    corrupt(prepared);
    const port = new InMemoryTransactionPort(prepared.canonical);

    await expect(importPreparedApprovedBasicCountry(
      prepared as unknown as PreparedApprovedBasicCountryImport,
      port,
    )).rejects.toMatchObject({
      code: "BASIC_IMPORT_PREFLIGHT_FAILED",
    });
    expect(port.transactionCalls).toBe(0);
    expect(port.executed).toEqual([]);
  });

  test("rejects structural, hand-built, and falsely shaped inputs before transactions", async () => {
    const prepared = approvedPreparation();
    const port = new InMemoryTransactionPort(prepared.canonical);
    const structuralClone = structuredClone(prepared);
    const handBuilt = {
      countryDirectory: prepared.countryDirectory,
      countryCode: prepared.countryCode,
      canonical: prepared.canonical,
      plan: prepared.plan,
    };

    for (const input of [structuralClone, handBuilt, { plan: prepared.plan }]) {
      await expect(
        importPreparedApprovedBasicCountry(
          input as PreparedApprovedBasicCountryImport,
          port,
        ),
      ).rejects.toMatchObject({ code: "BASIC_IMPORT_UNTRUSTED_PREPARATION" });
    }
    expect(port.transactionCalls).toBe(0);
  });

  test("fails preflight and legacy checks without executing upserts", async () => {
    const prepared = approvedPreparation();
    const invalid = new InMemoryTransactionPort(prepared.canonical, { invalidCount: true });
    const legacy = new InMemoryTransactionPort(prepared.canonical, { legacyCount: true });

    await expect(importPreparedApprovedBasicCountry(prepared, invalid)).rejects.toMatchObject({
      code: "BASIC_IMPORT_PREFLIGHT_FAILED",
    });
    await expect(importPreparedApprovedBasicCountry(prepared, legacy)).rejects.toMatchObject({
      code: "BASIC_IMPORT_LEGACY_DATA_PRESENT",
    });
    expect(invalid.executed).toEqual([]);
    expect(legacy.executed).toEqual([]);
  });

  test("rolls back state when one operation throws", async () => {
    const prepared = approvedPreparation();
    const port = new InMemoryTransactionPort(prepared.canonical, { throwAt: 6 });
    const before = port.snapshot();

    await expect(importPreparedApprovedBasicCountry(prepared, port)).rejects.toMatchObject({
      code: "BASIC_IMPORT_DATABASE_OPERATION_FAILED",
    });
    expect(port.snapshot()).toEqual(before);
  });

  test.each([null, "mismatch"] as const)("rolls back when canonical readback is %s", async (readback) => {
    const prepared = approvedPreparation();
    const port = new InMemoryTransactionPort(prepared.canonical, {
      readback: readback === "mismatch" ? { ...prepared.canonical, knowledge: [{ value: "wrong" }] } : null,
    });
    const before = port.snapshot();

    await expect(importPreparedApprovedBasicCountry(prepared, port)).rejects.toMatchObject({
      code: "BASIC_IMPORT_READBACK_MISMATCH",
    });
    expect(port.snapshot()).toEqual(before);
  });

  test("converges when importing the same approved preparation twice", async () => {
    const prepared = approvedPreparation();
    const port = new InMemoryTransactionPort(prepared.canonical);

    await importPreparedApprovedBasicCountry(prepared, port);
    await importPreparedApprovedBasicCountry(prepared, port);

    expect(port.rowCounts()).toEqual({ country: 1, moduleCoverage: 10, marketOverview: 1 });
  });

  test("returns a minimal result without approval, staging, audit, or knowledge data", async () => {
    const prepared = approvedPreparation();
    const result = await importPreparedApprovedBasicCountry(
      prepared,
      new InMemoryTransactionPort(prepared.canonical),
    );

    expect(result).toEqual({ countryCode: prepared.countryCode, operationCount: 12 });
    expect(JSON.stringify(result)).not.toMatch(/approval|staging|audit|KnowledgeChunk/i);
  });

  test.each(["transaction", "preflight", "execute", "readCanonical"] as const)(
    "maps unknown %s failures to a stable database error",
    async (phase) => {
      const prepared = approvedPreparation();
      const options: TransactionOptions = phase === "transaction"
        ? { throwTransaction: true }
        : phase === "execute"
        ? { throwAt: 1 }
        : phase === "readCanonical"
        ? { throwRead: true }
        : {};
      const port = new InMemoryTransactionPort(prepared.canonical, options);
      if (phase === "preflight") preflightFailure.error = new Error("sql://secret.example/details");

      try {
        await importPreparedApprovedBasicCountry(prepared, port);
        throw new Error("runtime should have thrown");
      } catch (error) {
        expect(error).toMatchObject({
          name: "BasicCountryImportError",
          message: "BASIC_IMPORT_DATABASE_OPERATION_FAILED",
          code: "BASIC_IMPORT_DATABASE_OPERATION_FAILED",
        });
        expect(error).not.toMatchObject({ message: expect.stringMatching(/sql|secret|details/i) });
      } finally {
        preflightFailure.error = null;
      }
    },
  );

  test("preserves existing typed errors", async () => {
    const prepared = approvedPreparation();
    const port = new InMemoryTransactionPort(prepared.canonical, {
      executeError: new BasicCountryImportError("BASIC_IMPORT_READBACK_MISMATCH"),
    });

    await expect(importPreparedApprovedBasicCountry(prepared, port)).rejects.toBe(
      port.options.executeError,
    );
  });
});

interface MutablePrepared {
  countryDirectory: string;
  countryCode: string;
  canonical: BasicCanonicalData;
  plan: {
    summary: { countryCode: string; coverageLevel: string; moduleStatuses: Record<string, string> };
    operations: BasicSeedImportOperation[];
    aiEligibleKnowledgeIds: string[];
  };
}

function approvedPreparation(): PreparedApprovedBasicCountryImport {
  const prepared = prepareApprovedBasicCountryImport(REPO_ROOT, "indonesia");
  trustedPreparations.add(prepared);
  return prepared;
}

function editableApprovedPreparation(): MutablePrepared {
  const prepared = structuredClone(approvedPreparation()) as MutablePrepared;
  trustedPreparations.add(prepared);
  return prepared;
}

interface TransactionOptions {
  readonly executeError?: Error;
  readonly invalidCount?: boolean;
  readonly legacyCount?: boolean;
  readonly readback?: BasicCanonicalData | null;
  readonly throwAt?: number;
  readonly throwRead?: boolean;
  readonly throwTransaction?: boolean;
}

interface MemoryState {
  readonly countries: Map<string, BasicSeedImportOperation>;
  readonly coverages: Map<string, BasicSeedImportOperation>;
  readonly marketOverviews: Map<string, BasicSeedImportOperation>;
  canonical: BasicCanonicalData | null;
}

class InMemoryTransactionPort implements BasicCountryImportTransactionPort {
  transactionCalls = 0;
  executed: BasicSeedImportOperation[] = [];
  options: TransactionOptions;
  private state: MemoryState = {
    countries: new Map(),
    coverages: new Map(),
    marketOverviews: new Map(),
    canonical: null,
  };

  constructor(private readonly expectedCanonical: BasicCanonicalData, options: TransactionOptions = {}) {
    this.options = options;
  }

  async transaction<T>(
    run: (transaction: BasicCountryImportTransaction) => Promise<T>,
  ): Promise<T> {
    this.transactionCalls += 1;
    if (this.options.throwTransaction) throw new Error("sql://secret.example/transaction");
    const before = this.snapshotState();
    try {
      return await run({
        activationCounts: {
          count: async () => this.options.invalidCount ? Number.NaN : this.options.legacyCount ? 1 : 0,
        },
        execute: async (operation) => this.execute(operation),
        readCanonical: async () => this.readCanonical(),
      });
    } catch (error) {
      this.state = before;
      throw error;
    }
  }

  snapshot(): MemoryState {
    return this.snapshotState();
  }

  rowCounts(): Record<string, number> {
    return {
      country: this.state.countries.size,
      moduleCoverage: this.state.coverages.size,
      marketOverview: this.state.marketOverviews.size,
    };
  }

  private async execute(operation: BasicSeedImportOperation): Promise<void> {
    this.executed.push(operation);
    if (this.options.executeError !== undefined) throw this.options.executeError;
    if (this.options.throwAt === this.executed.length) {
      throw new Error("sql://secret.example/execute");
    }
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
    this.state.canonical = structuredClone(this.expectedCanonical);
  }

  private async readCanonical(): Promise<BasicCanonicalData | null> {
    if (this.options.throwRead) throw new Error("sql://secret.example/readback");
    if (this.options.readback !== undefined) return structuredClone(this.options.readback);
    return structuredClone(this.state.canonical);
  }

  private snapshotState(): MemoryState {
    return {
      countries: new Map(this.state.countries),
      coverages: new Map(this.state.coverages),
      marketOverviews: new Map(this.state.marketOverviews),
      canonical: structuredClone(this.state.canonical),
    };
  }
}
