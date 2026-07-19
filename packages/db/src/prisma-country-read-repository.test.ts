import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Prisma, type PrismaClient } from "@prisma/client";
import { MODULE_KEYS } from "@navigator/shared-types/schema";
import { describe, expect, test } from "vitest";

import {
  createPrismaCountryReadRepository,
  PrismaCountryReadRepositoryError,
  type PrismaCountryReadClient,
} from "./read/prisma-country-read-repository.js";
import {
  DatabaseUnavailableError,
  DataIntegrityError,
} from "./read/country-read-runtime.js";

const PRISMA_CLIENT_VERSION = "6.19.3";
const PRIVATE_FAILURE =
  "postgresql://navigator:secret@example.test/private/path SELECT confidential";
const TRANSIENT_PRISMA_CODES = [
  "P1001",
  "P1002",
  "P1008",
  "P1017",
  "P2024",
  "P2037",
] as const;
const NON_TRANSIENT_PRISMA_CODES = [
  "P1000",
  "P1003",
  "P1010",
  "P2021",
  "P2022",
  "P9999",
] as const;

const PUBLIC_WHERE = {
  reviewStatus: "published",
  credibility: { not: "UNVERIFIED" },
} as const;

function localized(value: string): Readonly<{ zh: string; en: string }> {
  return { zh: value, en: value };
}

function metadata(countryCode = "ID") {
  return {
    source: "Official source",
    sourceUrl: "https://example.test/source",
    collectedAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    credibility: "OFFICIAL",
    reviewStatus: "published",
    aiUsable: true,
    countryCode,
    industryTags: ["SOLAR"],
    techTags: ["PV_MODULE"],
  };
}

function validRow(): Record<string, unknown> {
  const meta = metadata();
  return {
    code: "ID",
    name: localized("Indonesia"),
    region: "SOUTHEAST_ASIA",
    coverageLevel: "COMPLETE",
    flagEmoji: "🇮🇩",
    summary: localized("Summary"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    moduleCoverage: MODULE_KEYS.map((moduleKey) => ({
      countryCode: "ID",
      moduleKey: moduleKey.replaceAll("-", "_").toUpperCase(),
      status: "COMPLETE",
      dataCount: 5,
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    })),
    marketOverview: {
      overview: localized("Overview"),
      population: 1,
      gdp: 2,
      gdpGrowth: 3,
      energyDemand: localized("Demand"),
      renewableTarget: localized("Target"),
      keyIndicators: [{ label: localized("Indicator"), value: "1", unit: "%", year: 2026 }],
      ...meta,
    },
    policies: [{
      id: "policy-1",
      title: localized("Policy"),
      summary: localized("Summary"),
      body: localized("Body"),
      policyType: "INCENTIVE",
      effectiveDate: new Date("2026-01-03T00:00:00.000Z"),
      authority: localized("Authority"),
      ...meta,
    }],
    risks: [{
      id: "risk-1",
      title: localized("Risk"),
      category: "legal",
      level: "MEDIUM",
      description: localized("Description"),
      mitigation: localized("Mitigation"),
      ...meta,
    }],
    opportunities: [{
      id: "opportunity-1",
      title: localized("Opportunity"),
      description: localized("Description"),
      marketSize: localized("Large"),
      timeWindow: null,
      ...meta,
    }],
    projects: [{
      id: "project-1",
      name: localized("Project"),
      description: localized("Description"),
      status: "PLANNING",
      capacity: "1 MW",
      investment: 1,
      location: localized("Location"),
      ...meta,
    }],
    partners: [{
      id: "partner-1",
      name: localized("Partner"),
      partnerType: "EPC",
      description: localized("Description"),
      contactHint: null,
      ...meta,
    }],
    chineseCompanies: [{
      id: "company-1",
      name: localized("Company"),
      industry: "solar",
      businessScope: localized("Scope"),
      entryYear: 2024,
      caseStudy: null,
      ...meta,
    }],
    entryStrategy: {
      id: "strategy-1",
      overview: localized("Strategy"),
      steps: [{ order: 1, title: localized("Step"), detail: localized("Detail") }],
      recommendedMode: localized("JV"),
      ...meta,
    },
    reports: [{
      id: "report-1",
      title: localized("Report"),
      abstract: localized("Abstract"),
      fileUrl: "https://example.test/report.pdf",
      publishedAt: new Date("2026-01-04T00:00:00.000Z"),
      accessLevel: "FREE",
      ...meta,
    }],
    knowledgeChunks: [{
      id: "knowledge-1",
      content: localized("Knowledge"),
      sourceModule: "POLICY",
      sourceId: "policy-1",
      ...meta,
    }],
  };
}

class RecordingClient implements PrismaCountryReadClient {
  readonly calls: Array<{ method: string; args: unknown }> = [];
  row: Record<string, unknown> | null = validRow();
  queryError: unknown = null;

  readonly country = {
    findMany: async (args: unknown): Promise<readonly unknown[]> => {
      this.calls.push({ method: "findMany", args });
      if (this.queryError !== null) throw this.queryError;
      return this.row === null ? [] : [this.row];
    },
    findUnique: async (args: unknown): Promise<unknown> => {
      this.calls.push({ method: "findUnique", args });
      if (this.queryError !== null) throw this.queryError;
      return this.row;
    },
  };

  readonly $queryRaw = (): never => {
    throw new Error("raw SQL must not be used");
  };
}

function compileOnlyGeneratedPrismaClient(client: PrismaClient): void {
  createPrismaCountryReadRepository(client);
}

void compileOnlyGeneratedPrismaClient;

describe("Prisma CountryReadRepository boundary", () => {
  test("uses explicit deterministic queries and C-end relation filters", async () => {
    const client = new RecordingClient();
    const repository = createPrismaCountryReadRepository(client);

    await repository.list();
    await repository.findByCode("ID");

    expect(client.calls).toHaveLength(2);
    const listArgs = client.calls[0]?.args as Record<string, unknown>;
    const findArgs = client.calls[1]?.args as Record<string, unknown>;
    expect(listArgs.where).toEqual({});
    expect(listArgs.orderBy).toEqual([{ code: "asc" }]);
    expect(findArgs.where).toEqual({ code: "ID" });
    expect(listArgs.select).toEqual(findArgs.select);

    const select = listArgs.select as Record<string, Record<string, unknown>>;
    for (const relation of [
      "marketOverview", "policies", "risks", "opportunities", "projects",
      "partners", "chineseCompanies", "entryStrategy", "reports",
    ]) {
      expect(select[relation]?.where).toEqual(PUBLIC_WHERE);
    }
    expect(select.knowledgeChunks?.where).toEqual({
      ...PUBLIC_WHERE,
      aiUsable: true,
    });
    expect(select.knowledgeChunks?.select).not.toHaveProperty("embeddingZh");
    expect(select.knowledgeChunks?.select).not.toHaveProperty("embeddingEn");
  });

  test("maps Prisma dates, enums and JSON into a storage-neutral snapshot", async () => {
    const repository = createPrismaCountryReadRepository(new RecordingClient());

    const snapshot = await repository.findByCode("ID");

    expect(snapshot?.country).toMatchObject({
      code: "ID",
      region: "southeast-asia",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
    expect(snapshot?.policy[0]).toMatchObject({
      policyType: "incentive",
      industryTags: ["solar"],
      techTags: ["pv-module"],
      effectiveDate: "2026-01-03T00:00:00.000Z",
    });
    expect(snapshot?.knowledge[0]).not.toHaveProperty("embeddingZh");
    expect(snapshot).not.toHaveProperty("country.findMany");
  });

  test("normalizes multiple policy, report, and knowledge records without dropping them", async () => {
    const client = new RecordingClient();
    const row = structuredClone(validRow());
    row.policies = reversedRecords(row, "policies", [
      ["policy-z", "2026-01-01T00:00:00.000Z"],
      ["policy-b", "2026-03-01T00:00:00.000Z"],
      ["policy-a", "2026-03-01T00:00:00.000Z"],
    ]);
    row.reports = reversedRecords(row, "reports", [
      ["report-old", "2026-01-01T00:00:00.000Z"],
      ["report-new", "2026-03-01T00:00:00.000Z"],
    ]);
    row.knowledgeChunks = reversedRecords(row, "knowledgeChunks", [
      ["knowledge-b", "2026-04-01T00:00:00.000Z"],
      ["knowledge-a", "2026-04-01T00:00:00.000Z"],
    ]);
    client.row = row;

    const snapshot = await createPrismaCountryReadRepository(client).findByCode("ID");

    expect(snapshot?.policy.map((record) => record.id)).toEqual([
      "policy-a", "policy-b", "policy-z",
    ]);
    expect(snapshot?.reports.map((record) => record.id)).toEqual([
      "report-new", "report-old",
    ]);
    expect(snapshot?.knowledge.map((record) => record.id)).toEqual([
      "knowledge-a", "knowledge-b",
    ]);
  });

  test("rejects invalid codes without querying and returns null for unknown codes", async () => {
    const client = new RecordingClient();
    const repository = createPrismaCountryReadRepository(client);

    await expect(repository.findByCode(" id ")).resolves.toBeNull();
    expect(client.calls).toHaveLength(0);
    client.row = null;
    await expect(repository.findByCode("ZZ")).resolves.toBeNull();
    expect(client.calls).toHaveLength(1);
  });

  test.each([
    ["missing coverage", (row: Record<string, unknown>) => { row.moduleCoverage = []; }],
    ["duplicate coverage", (row: Record<string, unknown>) => {
      const coverage = row.moduleCoverage as unknown[];
      row.moduleCoverage = [...coverage, coverage[0]];
    }],
    ["malformed JSON", (row: Record<string, unknown>) => { row.name = { zh: undefined, en: "Indonesia" }; }],
    ["relation countryCode drift", (row: Record<string, unknown>) => {
      const policies = row.policies as Array<Record<string, unknown>>;
      if (policies[0] !== undefined) policies[0].countryCode = "VN";
    }],
    ["duplicate module relation", (row: Record<string, unknown>) => {
      const policies = row.policies as unknown[];
      row.policies = [...policies, structuredClone(policies[0])];
    }],
    ["unpublished relation crossing the boundary", (row: Record<string, unknown>) => {
      const policies = row.policies as Array<Record<string, unknown>>;
      if (policies[0] !== undefined) policies[0].reviewStatus = "draft";
    }],
  ])("fails closed with a stable redacted error for %s", async (_label, mutate) => {
    const client = new RecordingClient();
    const row = structuredClone(validRow());
    mutate(row);
    client.row = row;
    const repository = createPrismaCountryReadRepository(client);

    await expect(repository.list()).rejects.toThrow("DATA_INTEGRITY_ERROR");
  });

  test.each([
    ["unregistered value", "other"],
    ["case variant", "LEGAL"],
    ["blank value", "   "],
    ["non-string value", 1],
  ] as const)("fails closed with a stable redacted error for risk category %s", async (
    _label,
    category,
  ) => {
    const client = new RecordingClient();
    const row = structuredClone(validRow());
    firstRelation(row, "risks").category = category;
    client.row = row;

    const error = await captureError(
      createPrismaCountryReadRepository(client).list(),
    );

    expectStableRedactedError(error, "DATA_INTEGRITY_ERROR");
  });

  test("rejects an accessor-backed risk category without invoking its getter", async () => {
    const client = new RecordingClient();
    const row = structuredClone(validRow());
    let getterCalls = 0;
    Object.defineProperty(firstRelation(row, "risks"), "category", {
      configurable: true,
      enumerable: true,
      get() {
        getterCalls += 1;
        return "legal";
      },
    });
    client.row = row;

    const error = await captureError(
      createPrismaCountryReadRepository(client).list(),
    );

    expectStableRedactedError(error, "DATA_INTEGRITY_ERROR");
    expect(getterCalls).toBe(0);
  });

  test.each(TRANSIENT_PRISMA_CODES)(
    "classifies real Prisma known request error %s as transient database unavailability",
    async (code) => {
      const client = new RecordingClient();
      client.queryError = knownRequestError(code);

      const error = await captureError(
        createPrismaCountryReadRepository(client).list(),
      );

      expectFixedPublicError(
        error,
        DatabaseUnavailableError,
        "DatabaseUnavailableError",
        "DATABASE_UNAVAILABLE",
      );
    },
  );

  test.each(TRANSIENT_PRISMA_CODES)(
    "classifies real Prisma initialization error %s as transient database unavailability",
    async (code) => {
      const client = new RecordingClient();
      client.queryError = initializationError(code);

      const error = await captureError(
        createPrismaCountryReadRepository(client).findByCode("ID"),
      );

      expectFixedPublicError(
        error,
        DatabaseUnavailableError,
        "DatabaseUnavailableError",
        "DATABASE_UNAVAILABLE",
      );
    },
  );

  test.each(NON_TRANSIENT_PRISMA_CODES)(
    "keeps real Prisma known request error %s non-transient",
    async (code) => {
      const client = new RecordingClient();
      client.queryError = knownRequestError(code);

      const error = await captureError(
        createPrismaCountryReadRepository(client).list(),
      );

      expectFixedNonTransientQueryError(error);
    },
  );

  test.each(NON_TRANSIENT_PRISMA_CODES)(
    "keeps real Prisma initialization error %s non-transient",
    async (code) => {
      const client = new RecordingClient();
      client.queryError = initializationError(code);

      const error = await captureError(
        createPrismaCountryReadRepository(client).findByCode("ID"),
      );

      expectFixedNonTransientQueryError(error);
    },
  );

  test.each([
    ["validation", () => new Prisma.PrismaClientValidationError(
      PRIVATE_FAILURE,
      { clientVersion: PRISMA_CLIENT_VERSION },
    )],
    ["unknown request", () => new Prisma.PrismaClientUnknownRequestError(
      PRIVATE_FAILURE,
      { clientVersion: PRISMA_CLIENT_VERSION },
    )],
    ["Rust panic", () => new Prisma.PrismaClientRustPanicError(
      PRIVATE_FAILURE,
      PRISMA_CLIENT_VERSION,
    )],
    ["plain", () => new Error(PRIVATE_FAILURE)],
    ["forged Error name/code", () => Object.assign(new Error(PRIVATE_FAILURE), {
      name: "PrismaClientKnownRequestError",
      code: "P1001",
    })],
    ["forged object name/code", () => ({
      name: "PrismaClientKnownRequestError",
      code: "P1001",
      message: PRIVATE_FAILURE,
    })],
  ] as const)("keeps %s failures non-transient", async (_label, createError) => {
    const client = new RecordingClient();
    client.queryError = createError();

    const error = await captureError(
      createPrismaCountryReadRepository(client).list(),
    );

    expectFixedNonTransientQueryError(error);
  });

  test("does not retain query or validation errors in cause or enumerable properties", async () => {
    const queryClient = new RecordingClient();
    queryClient.queryError = new Error(
      "postgresql://user:secret@example.test/private/path",
    );
    const queryError = await captureError(
      createPrismaCountryReadRepository(queryClient).list(),
    );
    expectStableRedactedError(queryError, "COUNTRY_READ_QUERY_FAILED");

    const validationClient = new RecordingClient();
    const invalidRow = structuredClone(validRow());
    invalidRow.name = { zh: undefined, en: "invalid" };
    validationClient.row = invalidRow;
    const validationError = await captureError(
      createPrismaCountryReadRepository(validationClient).list(),
    );
    expectFixedPublicError(
      validationError,
      DataIntegrityError,
      "DataIntegrityError",
      "DATA_INTEGRITY_ERROR",
    );
  });

  test("binds query shapes to generated Prisma 6 types without runtime double assertions", () => {
    const sourceDirectory = dirname(fileURLToPath(import.meta.url));
    const repositorySource = readFileSync(
      resolve(sourceDirectory, "read/prisma-country-read-repository.ts"),
      "utf8",
    );
    const runtimeSource = readFileSync(
      resolve(sourceDirectory, "read/country-read-runtime.ts"),
      "utf8",
    );

    expect(repositorySource).toContain("satisfies Prisma.CountrySelect");
    expect(repositorySource).toContain("satisfies Prisma.CountryFindManyArgs");
    expect(repositorySource).toContain("satisfies Prisma.CountryFindUniqueArgs");
    expect(runtimeSource).not.toContain("as unknown as PrismaRuntimeClient");
  });

  test.each(localizedJsonMutations())(
    "fails closed for invalid LocalizedText field %s",
    async (_label, mutate) => {
      const client = new RecordingClient();
      const row = structuredClone(validRow());
      mutate(row);
      client.row = row;

      await expect(createPrismaCountryReadRepository(client).list()).rejects.toThrow(
        "DATA_INTEGRITY_ERROR",
      );
    },
  );

  test.each([
    ["Indicator missing year", (row: Record<string, unknown>) => {
      marketOverview(row).keyIndicators = [{ label: localized("Label"), value: "1", unit: "%" }];
    }],
    ["Indicator extra audit key", (row: Record<string, unknown>) => {
      marketOverview(row).keyIndicators = [{
        label: localized("Label"), value: "1", unit: "%", year: 2026, audit: true,
      }];
    }],
    ["Indicator wrong label", (row: Record<string, unknown>) => {
      marketOverview(row).keyIndicators = [{ label: { zh: "missing-en" }, value: "1", unit: "%", year: 2026 }];
    }],
    ["Indicator unsafe year", (row: Record<string, unknown>) => {
      marketOverview(row).keyIndicators = [{ label: localized("Label"), value: "1", unit: "%", year: 2026.5 }];
    }],
    ["StrategyStep missing detail", (row: Record<string, unknown>) => {
      entryStrategy(row).steps = [{ order: 1, title: localized("Step") }];
    }],
    ["StrategyStep extra audit key", (row: Record<string, unknown>) => {
      entryStrategy(row).steps = [{
        order: 1, title: localized("Step"), detail: localized("Detail"), audit: true,
      }];
    }],
    ["StrategyStep wrong localized detail", (row: Record<string, unknown>) => {
      entryStrategy(row).steps = [{ order: 1, title: localized("Step"), detail: { zh: 1, en: "Detail" } }];
    }],
    ["StrategyStep unsafe order", (row: Record<string, unknown>) => {
      entryStrategy(row).steps = [{ order: 1.5, title: localized("Step"), detail: localized("Detail") }];
    }],
  ] as const)("fails closed for malformed %s", async (_label, mutate) => {
    const client = new RecordingClient();
    const row = structuredClone(validRow());
    mutate(row);
    client.row = row;

    await expect(createPrismaCountryReadRepository(client).list()).rejects.toThrow(
      "DATA_INTEGRITY_ERROR",
    );
  });

  test("accepts and preserves a nonblank gated relative report locator", async () => {
    const client = new RecordingClient();
    const row = structuredClone(validRow());
    firstRelation(row, "reports").fileUrl = "reports/ID/member/report.pdf";
    client.row = row;

    const snapshot = await createPrismaCountryReadRepository(client).findByCode("ID");

    expect(snapshot?.reports[0]?.fileUrl).toBe("reports/ID/member/report.pdf");
  });
});

function reversedRecords(
  row: Record<string, unknown>,
  relation: string,
  identities: readonly (readonly [string, string])[],
): Array<Record<string, unknown>> {
  const template = firstRelation(row, relation);
  return identities.map(([id, updatedAt]) => ({
    ...structuredClone(template),
    id,
    updatedAt: new Date(updatedAt),
  })).reverse();
}

function localizedJsonMutations(): Array<readonly [
  string,
  (row: Record<string, unknown>) => void,
]> {
  const withAudit = { zh: "中文", en: "English", audit: { runId: "secret-run" } };
  return [
    ["country.name missing en", (row) => { row.name = { zh: "中文" }; }],
    ["country.summary wrong type", (row) => { row.summary = { zh: 1, en: "Summary" }; }],
    ["marketOverview.overview", (row) => { marketOverview(row).overview = withAudit; }],
    ["marketOverview.energyDemand", (row) => { marketOverview(row).energyDemand = withAudit; }],
    ["marketOverview.renewableTarget", (row) => { marketOverview(row).renewableTarget = withAudit; }],
    ["policy.title", (row) => { firstRelation(row, "policies").title = withAudit; }],
    ["policy.summary", (row) => { firstRelation(row, "policies").summary = withAudit; }],
    ["policy.body", (row) => { firstRelation(row, "policies").body = withAudit; }],
    ["policy.authority", (row) => { firstRelation(row, "policies").authority = withAudit; }],
    ["risk.title", (row) => { firstRelation(row, "risks").title = withAudit; }],
    ["risk.description", (row) => { firstRelation(row, "risks").description = withAudit; }],
    ["risk.mitigation", (row) => { firstRelation(row, "risks").mitigation = withAudit; }],
    ["opportunity.title", (row) => { firstRelation(row, "opportunities").title = withAudit; }],
    ["opportunity.description", (row) => { firstRelation(row, "opportunities").description = withAudit; }],
    ["opportunity.marketSize", (row) => { firstRelation(row, "opportunities").marketSize = withAudit; }],
    ["opportunity.timeWindow", (row) => { firstRelation(row, "opportunities").timeWindow = withAudit; }],
    ["project.name", (row) => { firstRelation(row, "projects").name = withAudit; }],
    ["project.description", (row) => { firstRelation(row, "projects").description = withAudit; }],
    ["project.location", (row) => { firstRelation(row, "projects").location = withAudit; }],
    ["partner.name", (row) => { firstRelation(row, "partners").name = withAudit; }],
    ["partner.description", (row) => { firstRelation(row, "partners").description = withAudit; }],
    ["partner.contactHint", (row) => { firstRelation(row, "partners").contactHint = withAudit; }],
    ["chineseCompany.name", (row) => { firstRelation(row, "chineseCompanies").name = withAudit; }],
    ["chineseCompany.businessScope", (row) => { firstRelation(row, "chineseCompanies").businessScope = withAudit; }],
    ["chineseCompany.caseStudy", (row) => { firstRelation(row, "chineseCompanies").caseStudy = withAudit; }],
    ["entryStrategy.overview", (row) => { entryStrategy(row).overview = withAudit; }],
    ["entryStrategy.recommendedMode", (row) => { entryStrategy(row).recommendedMode = withAudit; }],
    ["report.title", (row) => { firstRelation(row, "reports").title = withAudit; }],
    ["report.abstract", (row) => { firstRelation(row, "reports").abstract = withAudit; }],
    ["knowledge.content", (row) => { firstRelation(row, "knowledgeChunks").content = withAudit; }],
  ];
}

function marketOverview(row: Record<string, unknown>): Record<string, unknown> {
  const value = row.marketOverview;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid market overview fixture");
  }
  return value as Record<string, unknown>;
}

function entryStrategy(row: Record<string, unknown>): Record<string, unknown> {
  const value = row.entryStrategy;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid entry strategy fixture");
  }
  return value as Record<string, unknown>;
}

function firstRelation(
  row: Record<string, unknown>,
  relation: string,
): Record<string, unknown> {
  const value = row[relation];
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Invalid relation fixture");
  }
  const first = value[0];
  if (typeof first !== "object" || first === null || Array.isArray(first)) {
    throw new Error("Invalid relation fixture");
  }
  return first as Record<string, unknown>;
}

async function captureError(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error;
  }
  throw new Error("Expected promise to reject with Error");
}

function expectStableRedactedError(error: Error, code: string): void {
  expect(error.message).toBe(code);
  expect("cause" in error).toBe(false);
  expect(JSON.stringify(error)).not.toMatch(/secret|private\/path/u);
  expect(Object.values(error).some((value) => value instanceof Error)).toBe(false);
}

function knownRequestError(
  code: string,
): InstanceType<typeof Prisma.PrismaClientKnownRequestError> {
  return new Prisma.PrismaClientKnownRequestError(PRIVATE_FAILURE, {
    code,
    clientVersion: PRISMA_CLIENT_VERSION,
    meta: { databaseUrl: PRIVATE_FAILURE, sql: "SELECT confidential" },
  });
}

function initializationError(
  code: string,
): InstanceType<typeof Prisma.PrismaClientInitializationError> {
  return new Prisma.PrismaClientInitializationError(
    PRIVATE_FAILURE,
    PRISMA_CLIENT_VERSION,
    code,
  );
}

function expectFixedPublicError<T extends Error>(
  error: Error,
  ErrorConstructor: new () => T,
  name: string,
  message: string,
): void {
  expect(error).toBeInstanceOf(ErrorConstructor);
  expect(error.name).toBe(name);
  expect(error.message).toBe(message);
  expect(Object.keys(error)).toEqual(["name"]);
  expect("cause" in error).toBe(false);
  expect(JSON.stringify(error)).not.toMatch(/secret|confidential|private\/path/u);
  expect(error.stack).not.toMatch(/secret|confidential|private\/path/u);
}

function expectFixedNonTransientQueryError(error: Error): void {
  expect(error).toBeInstanceOf(PrismaCountryReadRepositoryError);
  expect(error.name).toBe("PrismaCountryReadRepositoryError");
  expect(error.message).toBe("COUNTRY_READ_QUERY_FAILED");
  expect(error).toHaveProperty("code", "COUNTRY_READ_QUERY_FAILED");
  expect("cause" in error).toBe(false);
  expect(JSON.stringify(error)).not.toMatch(/secret|confidential|private\/path/u);
  expect(error.stack).not.toMatch(/secret|confidential|private\/path/u);
}
