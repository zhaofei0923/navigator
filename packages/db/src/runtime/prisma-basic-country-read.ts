import { parseBasicProfile } from "@navigator/shared-types/basic-profile";
import {
  MODULE_KEYS,
  type Credibility,
  type IndustryTag,
  type ModuleCoverageStatus,
  type ModuleKey,
  type Region,
  type ReviewStatus,
  type TechTag,
} from "@navigator/shared-types/schema";

import type { BasicCanonicalData, JsonRecord } from "../seed/basic-country-types.js";
import {
  KEY_INDICATOR_KEYS,
  LOCALIZED_TEXT_KEYS,
  hasExactOwnKeys,
  isPlainRecord,
} from "../seed/basic-country-validation-utils.js";

const PRISMA_MODULE_TO_SHARED = {
  MARKET_OVERVIEW: "market-overview",
  POLICY: "policy",
  RISK: "risk",
  OPPORTUNITIES: "opportunities",
  PROJECTS: "projects",
  PARTNERS: "partners",
  CHINESE_COMPANIES: "chinese-companies",
  ENTRY_STRATEGY: "entry-strategy",
  AI_ADVISOR: "ai-advisor",
  REPORTS: "reports",
} as const satisfies Record<string, ModuleKey>;

const PRISMA_REGION_TO_SHARED = {
  SOUTHEAST_ASIA: "southeast-asia",
  SOUTH_ASIA: "south-asia",
  MIDDLE_EAST: "middle-east",
  AFRICA: "africa",
  LATIN_AMERICA: "latin-america",
  EUROPE: "europe",
  CENTRAL_ASIA: "central-asia",
} as const satisfies Record<string, Region>;

const PRISMA_INDUSTRY_TO_SHARED = {
  SOLAR: "solar",
  WIND: "wind",
  STORAGE: "storage",
  EV: "ev",
  HYDROGEN: "hydrogen",
  GRID: "grid",
  BESS_MFG: "bess-mfg",
  EPC: "epc",
} as const satisfies Record<string, IndustryTag>;

const PRISMA_TECH_TO_SHARED = {
  PV_MODULE: "pv-module",
  INVERTER: "inverter",
  ONSHORE_WIND: "onshore-wind",
  OFFSHORE_WIND: "offshore-wind",
  LFP: "lfp",
  NCM: "ncm",
  ELECTROLYZER: "electrolyzer",
} as const satisfies Record<string, TechTag>;

const PRISMA_CREDIBILITY = {
  OFFICIAL: "OFFICIAL",
  VERIFIED: "VERIFIED",
  ESTIMATED: "ESTIMATED",
  UNVERIFIED: "UNVERIFIED",
} as const satisfies Record<string, Credibility>;

const PRISMA_REVIEW_STATUS = {
  draft: "draft",
  pending: "pending",
  published: "published",
} as const satisfies Record<string, ReviewStatus>;

const PRISMA_COVERAGE_STATUS = {
  BUILDING: "BUILDING",
  PARTIAL: "PARTIAL",
  COMPLETE: "COMPLETE",
} as const satisfies Record<string, ModuleCoverageStatus>;

const BASIC_COUNTRY_SELECT = {
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
} as const;

export interface PrismaBasicCountryTransaction {
  readonly country: {
    findUnique(args: {
      readonly where: { readonly code: string };
      readonly select: typeof BASIC_COUNTRY_SELECT;
    }): Promise<unknown>;
  };
}

export type PrismaBasicCountryReadErrorCode =
  | "BASIC_READ_INVALID_COUNTRY_CODE"
  | "BASIC_READ_QUERY_FAILED"
  | "BASIC_READ_INVALID_COUNTRY"
  | "BASIC_READ_INVALID_COVERAGE"
  | "BASIC_READ_INVALID_MARKET_OVERVIEW"
  | "BASIC_READ_DEEP_DATA_PRESENT";

export class PrismaBasicCountryReadError extends Error {
  readonly code: PrismaBasicCountryReadErrorCode;

  constructor(code: PrismaBasicCountryReadErrorCode, options?: ErrorOptions) {
    super(code, options);
    this.name = "PrismaBasicCountryReadError";
    this.code = code;
  }
}

export async function readPrismaBasicCanonicalCountry(
  transaction: PrismaBasicCountryTransaction,
  countryCode: string,
): Promise<BasicCanonicalData | null> {
  if (!/^[A-Z]{2}$/u.test(countryCode)) {
    throw readError("BASIC_READ_INVALID_COUNTRY_CODE");
  }

  let row: unknown;
  try {
    row = await transaction.country.findUnique({
      where: { code: countryCode },
      select: BASIC_COUNTRY_SELECT,
    });
  } catch (error) {
    throw readError("BASIC_READ_QUERY_FAILED", error);
  }
  if (row === null) return null;

  const countryRow = requireRecord(row, "BASIC_READ_INVALID_COUNTRY");
  assertDeepRelationsEmpty(countryRow);
  const country = parseCountry(countryRow, countryCode);
  const marketOverview = parseMarketOverview(countryRow.marketOverview, countryCode);
  const canonical: BasicCanonicalData = {
    country,
    marketOverview,
    policy: [],
    risk: [],
    opportunities: [],
    projects: [],
    partners: [],
    chineseCompanies: [],
    entryStrategy: null,
    reports: [],
    knowledge: [],
  };
  return deepFreeze(canonical);
}

function parseCountry(row: JsonRecord, countryCode: string): JsonRecord {
  if (row.code !== countryCode || row.coverageLevel !== "BASIC") {
    throw readError("BASIC_READ_INVALID_COUNTRY");
  }
  const code = requireCountryCode(row.code, "BASIC_READ_INVALID_COUNTRY");
  const coverage = parseCoverage(row.moduleCoverage);
  return {
    code,
    name: parseLocalizedText(row.name, "BASIC_READ_INVALID_COUNTRY"),
    region: mapPrismaToken(row.region, PRISMA_REGION_TO_SHARED, "BASIC_READ_INVALID_COUNTRY"),
    coverageLevel: "BASIC",
    flagEmoji: requireNonBlankString(row.flagEmoji, "BASIC_READ_INVALID_COUNTRY"),
    summary: parseLocalizedText(row.summary, "BASIC_READ_INVALID_COUNTRY"),
    moduleCoverage: coverage,
    updatedAt: dateToIso(row.updatedAt, "BASIC_READ_INVALID_COUNTRY"),
  };
}

function parseCoverage(value: unknown): JsonRecord[] {
  if (!Array.isArray(value) || value.length !== MODULE_KEYS.length) {
    throw readError("BASIC_READ_INVALID_COVERAGE");
  }
  const byModule = new Map<ModuleKey, JsonRecord>();
  for (const item of value) {
    const row = requireRecord(item, "BASIC_READ_INVALID_COVERAGE");
    const moduleKey = mapPrismaToken(
      row.moduleKey,
      PRISMA_MODULE_TO_SHARED,
      "BASIC_READ_INVALID_COVERAGE",
    );
    if (byModule.has(moduleKey)) throw readError("BASIC_READ_INVALID_COVERAGE");
    const status = mapPrismaToken(
      row.status,
      PRISMA_COVERAGE_STATUS,
      "BASIC_READ_INVALID_COVERAGE",
    );
    const dataCount = requireNonNegativeSafeInteger(
      row.dataCount,
      "BASIC_READ_INVALID_COVERAGE",
    );
    const expectedMarket = moduleKey === "market-overview";
    if (
      status !== (expectedMarket ? "COMPLETE" : "BUILDING") ||
      dataCount !== (expectedMarket ? 1 : 0)
    ) {
      throw readError("BASIC_READ_INVALID_COVERAGE");
    }
    byModule.set(moduleKey, {
      moduleKey,
      status,
      dataCount,
      updatedAt: dateToIso(row.updatedAt, "BASIC_READ_INVALID_COVERAGE"),
    });
  }
  return MODULE_KEYS.map((moduleKey) => {
    const coverage = byModule.get(moduleKey);
    if (coverage === undefined) throw readError("BASIC_READ_INVALID_COVERAGE");
    return coverage;
  });
}

function parseMarketOverview(value: unknown, countryCode: string): JsonRecord {
  const row = requireRecord(value, "BASIC_READ_INVALID_MARKET_OVERVIEW");
  const credibility = mapPrismaToken(
    row.credibility,
    PRISMA_CREDIBILITY,
    "BASIC_READ_INVALID_MARKET_OVERVIEW",
  );
  const reviewStatus = mapPrismaToken(
    row.reviewStatus,
    PRISMA_REVIEW_STATUS,
    "BASIC_READ_INVALID_MARKET_OVERVIEW",
  );
  if (
    row.countryCode !== countryCode ||
    credibility === "UNVERIFIED" ||
    reviewStatus !== "published" ||
    row.aiUsable !== false
  ) {
    throw readError("BASIC_READ_INVALID_MARKET_OVERVIEW");
  }
  const source = requireNonBlankString(row.source, "BASIC_READ_INVALID_MARKET_OVERVIEW");
  const sourceUrl = parseSourceUrl(row.sourceUrl, source);
  return {
    overview: parseLocalizedText(row.overview, "BASIC_READ_INVALID_MARKET_OVERVIEW"),
    population: parsePopulation(row.population),
    gdp: parseFiniteNumberOrNull(row.gdp),
    gdpGrowth: parseFiniteNumberOrNull(row.gdpGrowth),
    energyDemand: parseLocalizedText(row.energyDemand, "BASIC_READ_INVALID_MARKET_OVERVIEW"),
    renewableTarget: parseLocalizedText(
      row.renewableTarget,
      "BASIC_READ_INVALID_MARKET_OVERVIEW",
    ),
    keyIndicators: parseKeyIndicators(row.keyIndicators),
    basicProfile: parseRequiredBasicProfile(row.basicProfile),
    source,
    sourceUrl,
    collectedAt: dateToIso(row.collectedAt, "BASIC_READ_INVALID_MARKET_OVERVIEW"),
    updatedAt: dateToIso(row.updatedAt, "BASIC_READ_INVALID_MARKET_OVERVIEW"),
    credibility,
    reviewStatus,
    aiUsable: false,
    countryCode,
    industryTags: parseMappedArray(
      row.industryTags,
      PRISMA_INDUSTRY_TO_SHARED,
      "BASIC_READ_INVALID_MARKET_OVERVIEW",
    ),
    techTags: parseMappedArray(
      row.techTags,
      PRISMA_TECH_TO_SHARED,
      "BASIC_READ_INVALID_MARKET_OVERVIEW",
    ),
  };
}

function parseRequiredBasicProfile(value: unknown) {
  const profile = parseBasicProfile(value);
  if (value !== null && value !== undefined && profile === null) {
    throw readError("BASIC_READ_INVALID_MARKET_OVERVIEW");
  }
  return profile;
}

function parseLocalizedText(
  value: unknown,
  code: PrismaBasicCountryReadErrorCode,
): JsonRecord {
  if (!hasExactOwnKeys(value, LOCALIZED_TEXT_KEYS)) throw readError(code);
  if (
    typeof value.zh !== "string" ||
    typeof value.en !== "string" ||
    (value.zh.trim() === "" && value.en.trim() === "")
  ) {
    throw readError(code);
  }
  return { zh: value.zh, en: value.en };
}

function parseKeyIndicators(value: unknown): JsonRecord[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw readError("BASIC_READ_INVALID_MARKET_OVERVIEW");
  }
  return value.map((item) => {
    if (!hasExactOwnKeys(item, KEY_INDICATOR_KEYS)) {
      throw readError("BASIC_READ_INVALID_MARKET_OVERVIEW");
    }
    return {
      label: parseLocalizedText(item.label, "BASIC_READ_INVALID_MARKET_OVERVIEW"),
      value: requireNonBlankString(item.value, "BASIC_READ_INVALID_MARKET_OVERVIEW"),
      unit: requireNonBlankString(item.unit, "BASIC_READ_INVALID_MARKET_OVERVIEW"),
      year: requireFiniteNumber(item.year, "BASIC_READ_INVALID_MARKET_OVERVIEW"),
    };
  });
}

function assertDeepRelationsEmpty(row: JsonRecord): void {
  for (const relation of [
    "policies",
    "risks",
    "opportunities",
    "projects",
    "partners",
    "chineseCompanies",
    "reports",
    "knowledgeChunks",
  ] as const) {
    if (!Array.isArray(row[relation]) || row[relation].length !== 0) {
      throw readError("BASIC_READ_DEEP_DATA_PRESENT");
    }
  }
  if (row.entryStrategy !== null) throw readError("BASIC_READ_DEEP_DATA_PRESENT");
}

function parseMappedArray<T extends string>(
  value: unknown,
  mapping: Readonly<Record<string, T>>,
  code: PrismaBasicCountryReadErrorCode,
): T[] {
  if (!Array.isArray(value)) throw readError(code);
  return value.map((item) => mapPrismaToken(item, mapping, code));
}

function mapPrismaToken<T extends string>(
  value: unknown,
  mapping: Readonly<Record<string, T>>,
  code: PrismaBasicCountryReadErrorCode,
): T {
  if (typeof value !== "string") throw readError(code);
  const mapped = mapping[value];
  if (mapped === undefined) throw readError(code);
  return mapped;
}

function parsePopulation(value: unknown): number | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || typeof value !== "number" || value < 0 || value > 2147483647) {
    throw readError("BASIC_READ_INVALID_MARKET_OVERVIEW");
  }
  return value;
}

function parseFiniteNumberOrNull(value: unknown): number | null {
  if (value === null) return null;
  return requireFiniteNumber(value, "BASIC_READ_INVALID_MARKET_OVERVIEW");
}

function parseSourceUrl(value: unknown, source: string): string | null {
  if (value === null) {
    if (!source.includes("sourceUrl null")) {
      throw readError("BASIC_READ_INVALID_MARKET_OVERVIEW");
    }
    return null;
  }
  if (typeof value !== "string") throw readError("BASIC_READ_INVALID_MARKET_OVERVIEW");
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new TypeError();
  } catch {
    throw readError("BASIC_READ_INVALID_MARKET_OVERVIEW");
  }
  return value;
}

function dateToIso(value: unknown, code: PrismaBasicCountryReadErrorCode): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw readError(code);
  return value.toISOString();
}

function requireRecord(
  value: unknown,
  code: PrismaBasicCountryReadErrorCode,
): JsonRecord {
  if (!isPlainRecord(value)) throw readError(code);
  return value;
}

function requireCountryCode(value: unknown, code: PrismaBasicCountryReadErrorCode): string {
  if (typeof value !== "string" || !/^[A-Z]{2}$/u.test(value)) throw readError(code);
  return value;
}

function requireNonBlankString(
  value: unknown,
  code: PrismaBasicCountryReadErrorCode,
): string {
  if (typeof value !== "string" || value.trim() === "") throw readError(code);
  return value;
}

function requireFiniteNumber(
  value: unknown,
  code: PrismaBasicCountryReadErrorCode,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw readError(code);
  return value;
}

function requireNonNegativeSafeInteger(
  value: unknown,
  code: PrismaBasicCountryReadErrorCode,
): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw readError(code);
  }
  return value;
}

function readError(
  code: PrismaBasicCountryReadErrorCode,
  cause?: unknown,
): PrismaBasicCountryReadError {
  return cause === undefined
    ? new PrismaBasicCountryReadError(code)
    : new PrismaBasicCountryReadError(code, { cause });
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}
