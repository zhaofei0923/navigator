import { fileURLToPath } from "node:url";

import { MODULE_KEYS } from "@navigator/shared-types/schema";
import { describe, expect, test, vi } from "vitest";

import {
  PrismaBasicCountryReadError,
  readPrismaBasicCanonicalCountry,
  type PrismaBasicCountryTransaction,
} from "./runtime/prisma-basic-country-read.js";
import {
  prepareApprovedBasicCountryImport,
} from "./seed/approved-basic-country-import.js";
import { createValidBasicProfile } from "./basic-country-test-fixture.js";
import type { BasicCanonicalData } from "./seed/basic-country-types.js";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url)).replace(/\/$/u, "");

describe("readPrismaBasicCanonicalCountry", () => {
  test("performs one bounded country query with ID-only deep emptiness selects", async () => {
    const row = validRow();
    const transaction = transactionReturning(row);

    await readPrismaBasicCanonicalCountry(transaction, "ID");

    expect(transaction.country.findUnique).toHaveBeenCalledTimes(1);
    const query = vi.mocked(transaction.country.findUnique).mock.calls[0]?.[0];
    expect(query).toEqual({
      where: { code: "ID" },
      select: {
        code: true,
        name: true,
        region: true,
        coverageLevel: true,
        flagEmoji: true,
        summary: true,
        updatedAt: true,
        moduleCoverage: {
          select: { moduleKey: true, status: true, dataCount: true, updatedAt: true },
        },
        marketOverview: {
          select: {
            overview: true,
            population: true,
            gdp: true,
            gdpGrowth: true,
            energyDemand: true,
            renewableTarget: true,
            keyIndicators: true,
            basicProfile: true,
            source: true,
            sourceUrl: true,
            collectedAt: true,
            updatedAt: true,
            credibility: true,
            reviewStatus: true,
            aiUsable: true,
            countryCode: true,
            industryTags: true,
            techTags: true,
          },
        },
        policies: { select: { id: true } },
        risks: { select: { id: true } },
        opportunities: { select: { id: true } },
        projects: { select: { id: true } },
        partners: { select: { id: true } },
        chineseCompanies: { select: { id: true } },
        entryStrategy: { select: { id: true } },
        reports: { select: { id: true } },
        knowledgeChunks: { select: { id: true } },
      },
    });
    expect(JSON.stringify(query)).not.toMatch(/embedding|fileUrl/u);
  });

  test("returns null for a legacy omission and round-trips a valid BASIC v2 profile", async () => {
    const legacy = record(validRow("vietnam"));
    expect(record(
      (await readPrismaBasicCanonicalCountry(transactionReturning(legacy), "VN"))
        ?.marketOverview,
    ).basicProfile).toBeNull();

    const current = record(validRow("vietnam"));
    const profile = createValidBasicProfile();
    record(current.marketOverview).basicProfile = profile;
    expect(record(
      (await readPrismaBasicCanonicalCountry(transactionReturning(current), "VN"))
        ?.marketOverview,
    ).basicProfile).toEqual(profile);
  });

  test("reconstructs, orders, and recursively freezes a valid BASIC canonical row", async () => {
    const prepared = prepareApprovedBasicCountryImport(REPO_ROOT, "indonesia");
    const row = canonicalToRow(prepared.canonical);
    record(row).moduleCoverage = [...array(record(row).moduleCoverage)].reverse();

    const result = await readPrismaBasicCanonicalCountry(transactionReturning(row), "ID");

    expect(result).toEqual(prepared.canonical);
    expect(array(record(result?.country).moduleCoverage).map((item) => record(item).moduleKey))
      .toEqual(MODULE_KEYS);
    expectRecursivelyFrozen(result);
  });

  test("returns null only when the country is absent", async () => {
    await expect(readPrismaBasicCanonicalCountry(transactionReturning(null), "ID"))
      .resolves.toBeNull();
    await expect(readPrismaBasicCanonicalCountry(transactionReturning(validRow()), "id"))
      .rejects.toMatchObject({ code: "BASIC_READ_INVALID_COUNTRY_CODE" });
  });

  test.each([
    ["missing coverage", (row: Record<string, unknown>) => {
      array(row.moduleCoverage).pop();
    }, "BASIC_READ_INVALID_COVERAGE"],
    ["extra coverage", (row: Record<string, unknown>) => {
      array(row.moduleCoverage).push({ ...record(array(row.moduleCoverage)[0]), moduleKey: "UNKNOWN" });
    }, "BASIC_READ_INVALID_COVERAGE"],
    ["duplicate coverage", (row: Record<string, unknown>) => {
      array(row.moduleCoverage)[1] = structuredClone(array(row.moduleCoverage)[0]);
    }, "BASIC_READ_INVALID_COVERAGE"],
    ["non-BASIC country", (row: Record<string, unknown>) => {
      row.coverageLevel = "STANDARD";
    }, "BASIC_READ_INVALID_COUNTRY"],
    ["wrong market coverage status", (row: Record<string, unknown>) => {
      record(array(row.moduleCoverage)[0]).status = "PARTIAL";
    }, "BASIC_READ_INVALID_COVERAGE"],
    ["wrong market coverage count", (row: Record<string, unknown>) => {
      record(array(row.moduleCoverage)[0]).dataCount = 0;
    }, "BASIC_READ_INVALID_COVERAGE"],
    ["wrong deep coverage count", (row: Record<string, unknown>) => {
      record(array(row.moduleCoverage)[1]).dataCount = 1;
    }, "BASIC_READ_INVALID_COVERAGE"],
    ["extra LocalizedText JSON", (row: Record<string, unknown>) => {
      row.name = { ...record(row.name), hidden: "SECRET-JSON" };
    }, "BASIC_READ_INVALID_COUNTRY"],
    ["blank LocalizedText JSON", (row: Record<string, unknown>) => {
      row.summary = { zh: " ", en: "\t" };
    }, "BASIC_READ_INVALID_COUNTRY"],
    ["extra key indicator JSON", (row: Record<string, unknown>) => {
      const market = record(row.marketOverview);
      const indicator = record(array(market.keyIndicators)[0]);
      indicator.hidden = "SECRET-JSON";
    }, "BASIC_READ_INVALID_MARKET_OVERVIEW"],
    ["invalid country enum", (row: Record<string, unknown>) => {
      row.region = "MOON";
    }, "BASIC_READ_INVALID_COUNTRY"],
    ["invalid market enum", (row: Record<string, unknown>) => {
      record(row.marketOverview).credibility = "UNKNOWN";
    }, "BASIC_READ_INVALID_MARKET_OVERVIEW"],
    ["invalid industry tag", (row: Record<string, unknown>) => {
      record(row.marketOverview).industryTags = ["COAL"];
    }, "BASIC_READ_INVALID_MARKET_OVERVIEW"],
    ["invalid technology tag", (row: Record<string, unknown>) => {
      record(row.marketOverview).techTags = ["FUSION"];
    }, "BASIC_READ_INVALID_MARKET_OVERVIEW"],
    ["invalid country date", (row: Record<string, unknown>) => {
      row.updatedAt = new Date(Number.NaN);
    }, "BASIC_READ_INVALID_COUNTRY"],
    ["invalid coverage date", (row: Record<string, unknown>) => {
      record(array(row.moduleCoverage)[0]).updatedAt = "2026-01-01";
    }, "BASIC_READ_INVALID_COVERAGE"],
    ["invalid numeric value", (row: Record<string, unknown>) => {
      record(row.marketOverview).gdp = Number.NaN;
    }, "BASIC_READ_INVALID_MARKET_OVERVIEW"],
    ["invalid population value", (row: Record<string, unknown>) => {
      record(row.marketOverview).population = -1;
    }, "BASIC_READ_INVALID_MARKET_OVERVIEW"],
    ["invalid BASIC v2 profile", (row: Record<string, unknown>) => {
      record(row.marketOverview).basicProfile = { schemaVersion: "basic-market-profile/v1" };
    }, "BASIC_READ_INVALID_MARKET_OVERVIEW"],
    ["missing MarketOverview", (row: Record<string, unknown>) => {
      row.marketOverview = null;
    }, "BASIC_READ_INVALID_MARKET_OVERVIEW"],
    ["AI-usable MarketOverview", (row: Record<string, unknown>) => {
      record(row.marketOverview).aiUsable = true;
    }, "BASIC_READ_INVALID_MARKET_OVERVIEW"],
    ["non-published MarketOverview", (row: Record<string, unknown>) => {
      record(row.marketOverview).reviewStatus = "draft";
    }, "BASIC_READ_INVALID_MARKET_OVERVIEW"],
    ["UNVERIFIED MarketOverview", (row: Record<string, unknown>) => {
      record(row.marketOverview).credibility = "UNVERIFIED";
    }, "BASIC_READ_INVALID_MARKET_OVERVIEW"],
    ["MarketOverview country drift", (row: Record<string, unknown>) => {
      record(row.marketOverview).countryCode = "ZZ";
    }, "BASIC_READ_INVALID_MARKET_OVERVIEW"],
  ] as const)("fails closed for %s", async (_label, mutate, code) => {
    const row = record(validRow());
    mutate(row);

    await expect(readPrismaBasicCanonicalCountry(transactionReturning(row), "ID"))
      .rejects.toMatchObject({ name: "PrismaBasicCountryReadError", message: code, code });
  });

  test.each([
    "policies", "risks", "opportunities", "projects", "partners",
    "chineseCompanies", "reports", "knowledgeChunks",
  ] as const)("rejects a non-empty %s relation", async (relation) => {
    const row = record(validRow());
    row[relation] = [{ id: "SECRET-ID" }];

    await expect(readPrismaBasicCanonicalCountry(transactionReturning(row), "ID"))
      .rejects.toMatchObject({ code: "BASIC_READ_DEEP_DATA_PRESENT" });
  });

  test("rejects a present entry strategy relation", async () => {
    const row = record(validRow());
    row.entryStrategy = { id: "SECRET-ID" };

    await expect(readPrismaBasicCanonicalCountry(transactionReturning(row), "ID"))
      .rejects.toMatchObject({ code: "BASIC_READ_DEEP_DATA_PRESENT" });
  });

  test("uses finite stable errors without leaking rows, URLs, SQL, paths, or causes", async () => {
    const secret = "SECRET-JSON https://secret.example /repo/hidden SELECT private";
    const invalid = record(validRow());
    invalid.name = { zh: secret, en: "", extra: secret };
    const queryFailure = transactionReturning(null);
    vi.mocked(queryFailure.country.findUnique).mockRejectedValue(new Error(secret));

    for (const request of [
      readPrismaBasicCanonicalCountry(transactionReturning(invalid), "ID"),
      readPrismaBasicCanonicalCountry(queryFailure, "ID"),
    ]) {
      try {
        await request;
        throw new Error("read should fail");
      } catch (error) {
        expect(error).toBeInstanceOf(PrismaBasicCountryReadError);
        expect(String(error)).not.toContain(secret);
        expect(error).not.toMatchObject({ message: expect.stringMatching(/https|SELECT|\/repo|SECRET/u) });
      }
    }
  });
});

function validRow(countryDirectory = "indonesia"): unknown {
  return canonicalToRow(
    prepareApprovedBasicCountryImport(REPO_ROOT, countryDirectory).canonical,
  );
}

function canonicalToRow(canonical: BasicCanonicalData): unknown {
  const country = record(structuredClone(canonical.country));
  country.region = mapToken(country.region, {
    "southeast-asia": "SOUTHEAST_ASIA", "south-asia": "SOUTH_ASIA",
    "middle-east": "MIDDLE_EAST", africa: "AFRICA", "latin-america": "LATIN_AMERICA",
    europe: "EUROPE", "central-asia": "CENTRAL_ASIA",
  });
  country.updatedAt = new Date(String(country.updatedAt));
  country.moduleCoverage = array(country.moduleCoverage).map((item) => {
    const coverage = record(item);
    return {
      moduleKey: mapToken(coverage.moduleKey, {
        "market-overview": "MARKET_OVERVIEW", policy: "POLICY", risk: "RISK",
        opportunities: "OPPORTUNITIES", projects: "PROJECTS", partners: "PARTNERS",
        "chinese-companies": "CHINESE_COMPANIES", "entry-strategy": "ENTRY_STRATEGY",
        "ai-advisor": "AI_ADVISOR", reports: "REPORTS",
      }),
      status: coverage.status,
      dataCount: coverage.dataCount,
      updatedAt: new Date(String(coverage.updatedAt)),
    };
  });
  const market = record(structuredClone(canonical.marketOverview));
  market.collectedAt = new Date(String(market.collectedAt));
  market.updatedAt = new Date(String(market.updatedAt));
  market.industryTags = array(market.industryTags).map((value) => mapToken(value, {
    solar: "SOLAR", wind: "WIND", storage: "STORAGE", ev: "EV", hydrogen: "HYDROGEN",
    grid: "GRID", "bess-mfg": "BESS_MFG", epc: "EPC",
  }));
  market.techTags = array(market.techTags).map((value) => mapToken(value, {
    "pv-module": "PV_MODULE", inverter: "INVERTER", "onshore-wind": "ONSHORE_WIND",
    "offshore-wind": "OFFSHORE_WIND", lfp: "LFP", ncm: "NCM", electrolyzer: "ELECTROLYZER",
  }));
  return {
    ...country,
    marketOverview: market,
    policies: [],
    risks: [],
    opportunities: [],
    projects: [],
    partners: [],
    chineseCompanies: [],
    entryStrategy: null,
    reports: [],
    knowledgeChunks: [],
  };
}

function transactionReturning(row: unknown): PrismaBasicCountryTransaction {
  return {
    country: { findUnique: vi.fn(async () => row) },
  };
}

function mapToken(value: unknown, mapping: Readonly<Record<string, string>>): string {
  const mapped = typeof value === "string" ? mapping[value] : undefined;
  if (mapped === undefined) throw new TypeError("missing test enum mapping");
  return mapped;
}

function expectRecursivelyFrozen(value: unknown, seen = new WeakSet<object>()): void {
  if (typeof value !== "object" || value === null || seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectRecursivelyFrozen(child, seen);
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new TypeError("expected array");
  return value;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("expected record");
  }
  return value as Record<string, unknown>;
}
