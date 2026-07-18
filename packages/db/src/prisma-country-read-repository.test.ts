import { MODULE_KEYS } from "@navigator/shared-types/schema";
import { describe, expect, test } from "vitest";

import {
  createPrismaCountryReadRepository,
  type PrismaCountryReadClient,
} from "./read/prisma-country-read-repository.js";

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
  queryError: Error | null = null;

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

    await expect(repository.list()).rejects.toThrow("COUNTRY_READ_INVALID_DATA");
  });

  test("redacts database failures", async () => {
    const client = new RecordingClient();
    client.queryError = new Error("postgresql://user:secret@example.test/private");

    const rejection = createPrismaCountryReadRepository(client).list();

    await expect(rejection).rejects.toThrow("COUNTRY_READ_QUERY_FAILED");
    await expect(rejection).rejects.not.toThrow("secret");
  });
});
