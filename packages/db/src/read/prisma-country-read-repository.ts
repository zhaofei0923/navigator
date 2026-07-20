import { Prisma, type PrismaClient } from "@prisma/client";
import { parseBasicProfile } from "@navigator/shared-types/basic-profile";
import {
  RISK_CATEGORIES,
  sortCountrySnapshots,
  type CountryDataSnapshot,
  type CountryReadRepository,
  type JsonObject,
} from "@navigator/shared-types/country-runtime";

import {
  KEY_INDICATOR_KEYS,
  LOCALIZED_TEXT_KEYS,
  hasExactOwnKeys,
} from "../seed/basic-country-validation-utils.js";
import {
  DatabaseUnavailableError,
  DataIntegrityError,
} from "./country-read-errors.js";
import { normalizeCountryReadSnapshot } from "./country-read-normalization.js";

const COUNTRY_READ_QUERY_FAILED = "COUNTRY_READ_QUERY_FAILED" as const;
const TRANSIENT_PRISMA_ERROR_CODES: ReadonlySet<string> = new Set([
  "P1001",
  "P1002",
  "P1008",
  "P1017",
  "P2024",
  "P2037",
]);

const MODULE_KEYS = [
  "market-overview",
  "policy",
  "risk",
  "opportunities",
  "projects",
  "partners",
  "chinese-companies",
  "entry-strategy",
  "ai-advisor",
  "reports",
] as const;

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
} as const;

const PRISMA_REGION_TO_SHARED = {
  SOUTHEAST_ASIA: "southeast-asia",
  SOUTH_ASIA: "south-asia",
  MIDDLE_EAST: "middle-east",
  AFRICA: "africa",
  LATIN_AMERICA: "latin-america",
  EUROPE: "europe",
  CENTRAL_ASIA: "central-asia",
} as const;

const PRISMA_INDUSTRY_TO_SHARED = {
  SOLAR: "solar",
  WIND: "wind",
  STORAGE: "storage",
  EV: "ev",
  HYDROGEN: "hydrogen",
  GRID: "grid",
  BESS_MFG: "bess-mfg",
  EPC: "epc",
} as const;

const PRISMA_TECH_TO_SHARED = {
  PV_MODULE: "pv-module",
  INVERTER: "inverter",
  ONSHORE_WIND: "onshore-wind",
  OFFSHORE_WIND: "offshore-wind",
  LFP: "lfp",
  NCM: "ncm",
  ELECTROLYZER: "electrolyzer",
} as const;

const PRISMA_POLICY_TYPE_TO_SHARED = {
  INCENTIVE: "incentive",
  TARIFF: "tariff",
  LOCALIZATION: "localization",
  PERMIT: "permit",
  TAX: "tax",
  IMPORT_EXPORT: "import-export",
} as const;

const PRISMA_SOURCE_MODULE_TO_SHARED = PRISMA_MODULE_TO_SHARED;
const COVERAGE_LEVELS = ["BASIC", "STANDARD", "COMPLETE"] as const;
const COVERAGE_STATUSES = ["BUILDING", "PARTIAL", "COMPLETE"] as const;
const CREDIBILITIES = ["OFFICIAL", "VERIFIED", "ESTIMATED", "UNVERIFIED"] as const;
const RISK_LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;
const PROJECT_STATUSES = ["PLANNING", "BIDDING", "CONSTRUCTION", "OPERATIONAL"] as const;
const ACCESS_LEVELS = ["FREE", "MEMBER", "PREMIUM"] as const;
const STRATEGY_STEP_KEYS = ["order", "title", "detail"] as const;

const PUBLIC_RELATION_WHERE = {
  reviewStatus: "published",
  credibility: { not: "UNVERIFIED" },
} satisfies Prisma.MarketOverviewWhereInput;
const KNOWLEDGE_RELATION_WHERE = {
  ...PUBLIC_RELATION_WHERE,
  aiUsable: true,
} satisfies Prisma.KnowledgeChunkWhereInput;
const LIST_RELATION_ORDER = [
  { updatedAt: "desc" },
  { id: "asc" },
] satisfies Prisma.PolicyOrderByWithRelationInput[];

const METADATA_SELECT = {
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
} as const;

const COUNTRY_SELECT = {
  code: true,
  name: true,
  region: true,
  coverageLevel: true,
  flagEmoji: true,
  summary: true,
  updatedAt: true,
  moduleCoverage: {
    where: {},
    orderBy: [{ moduleKey: "asc" }],
    select: {
      countryCode: true,
      moduleKey: true,
      status: true,
      dataCount: true,
      updatedAt: true,
    },
  },
  marketOverview: {
    where: PUBLIC_RELATION_WHERE,
    select: {
      overview: true,
      population: true,
      gdp: true,
      gdpGrowth: true,
      energyDemand: true,
      renewableTarget: true,
      keyIndicators: true,
      basicProfile: true,
      ...METADATA_SELECT,
    },
  },
  policies: {
    where: PUBLIC_RELATION_WHERE,
    orderBy: LIST_RELATION_ORDER,
    select: {
      id: true,
      title: true,
      summary: true,
      body: true,
      policyType: true,
      effectiveDate: true,
      authority: true,
      ...METADATA_SELECT,
    },
  },
  risks: {
    where: PUBLIC_RELATION_WHERE,
    orderBy: LIST_RELATION_ORDER,
    select: {
      id: true,
      title: true,
      category: true,
      level: true,
      description: true,
      mitigation: true,
      ...METADATA_SELECT,
    },
  },
  opportunities: {
    where: PUBLIC_RELATION_WHERE,
    orderBy: LIST_RELATION_ORDER,
    select: {
      id: true,
      title: true,
      description: true,
      marketSize: true,
      timeWindow: true,
      ...METADATA_SELECT,
    },
  },
  projects: {
    where: PUBLIC_RELATION_WHERE,
    orderBy: LIST_RELATION_ORDER,
    select: {
      id: true,
      name: true,
      description: true,
      status: true,
      capacity: true,
      investment: true,
      location: true,
      ...METADATA_SELECT,
    },
  },
  partners: {
    where: PUBLIC_RELATION_WHERE,
    orderBy: LIST_RELATION_ORDER,
    select: {
      id: true,
      name: true,
      partnerType: true,
      description: true,
      contactHint: true,
      ...METADATA_SELECT,
    },
  },
  chineseCompanies: {
    where: PUBLIC_RELATION_WHERE,
    orderBy: LIST_RELATION_ORDER,
    select: {
      id: true,
      name: true,
      industry: true,
      businessScope: true,
      entryYear: true,
      caseStudy: true,
      ...METADATA_SELECT,
    },
  },
  entryStrategy: {
    where: PUBLIC_RELATION_WHERE,
    select: {
      id: true,
      overview: true,
      steps: true,
      recommendedMode: true,
      ...METADATA_SELECT,
    },
  },
  reports: {
    where: PUBLIC_RELATION_WHERE,
    orderBy: LIST_RELATION_ORDER,
    select: {
      id: true,
      title: true,
      abstract: true,
      fileUrl: true,
      publishedAt: true,
      accessLevel: true,
      ...METADATA_SELECT,
    },
  },
  knowledgeChunks: {
    where: KNOWLEDGE_RELATION_WHERE,
    orderBy: LIST_RELATION_ORDER,
    select: {
      id: true,
      content: true,
      sourceModule: true,
      sourceId: true,
      ...METADATA_SELECT,
    },
  },
} satisfies Prisma.CountrySelect;

const COUNTRY_LIST_ARGS = {
  where: {},
  orderBy: [{ code: "asc" }],
  select: COUNTRY_SELECT,
} satisfies Prisma.CountryFindManyArgs;

export interface PrismaCountryReadClient {
  readonly country: {
    findMany(args: Prisma.CountryFindManyArgs): Promise<unknown>;
    findUnique(args: Prisma.CountryFindUniqueArgs): Promise<unknown>;
  };
}

export type PrismaCountryReadRepositoryErrorCode =
  typeof COUNTRY_READ_QUERY_FAILED;

export class PrismaCountryReadRepositoryError extends Error {
  readonly code: PrismaCountryReadRepositoryErrorCode;

  constructor() {
    super(COUNTRY_READ_QUERY_FAILED);
    this.name = "PrismaCountryReadRepositoryError";
    this.code = COUNTRY_READ_QUERY_FAILED;
  }
}

export function createPrismaCountryReadRepository(
  client: PrismaCountryReadClient,
): CountryReadRepository {
  return Object.freeze({
    async list(): Promise<readonly CountryDataSnapshot[]> {
      let rows: unknown;
      try {
        rows = await client.country.findMany(COUNTRY_LIST_ARGS);
      } catch (error) {
        throw queryFailed(error);
      }
      if (!Array.isArray(rows)) throw invalidData();
      return validateAndSortSnapshots(rows.map(parseCountrySnapshot));
    },

    async findByCode(code: string): Promise<CountryDataSnapshot | null> {
      if (!/^[A-Z]{2}$/u.test(code)) return null;
      let row: unknown;
      try {
        row = await client.country.findUnique({
          where: { code },
          select: COUNTRY_SELECT,
        } satisfies Prisma.CountryFindUniqueArgs);
      } catch (error) {
        throw queryFailed(error);
      }
      if (row === null) return null;
      const snapshot = parseCountrySnapshot(row);
      if (snapshot.country.code !== code) throw invalidData();
      return validateAndSortSnapshots([snapshot])[0] ?? null;
    },
  });
}

function parseCountrySnapshot(value: unknown): CountryDataSnapshot {
  try {
    const row = requireRecord(value);
    const code = requireCountryCode(row.code);
    const snapshot = {
      country: parseCountry(row, code),
      marketOverview: row.marketOverview === null
        ? null
        : parseMarketOverview(row.marketOverview, code),
      policy: parseRecordList(row.policies, code, parsePolicy),
      risk: parseRecordList(row.risks, code, parseRisk),
      opportunities: parseRecordList(row.opportunities, code, parseOpportunity),
      projects: parseRecordList(row.projects, code, parseProject),
      partners: parseRecordList(row.partners, code, parsePartner),
      chineseCompanies: parseRecordList(
        row.chineseCompanies,
        code,
        parseChineseCompany,
      ),
      entryStrategy: row.entryStrategy === null
        ? null
        : parseEntryStrategy(row.entryStrategy, code),
      reports: parseRecordList(row.reports, code, parseReport),
      knowledge: parseRecordList(
        row.knowledgeChunks,
        code,
        parseKnowledge,
      ),
    } satisfies CountryDataSnapshot;
    return deepFreeze(normalizeCountryReadSnapshot(snapshot));
  } catch (error) {
    if (error instanceof PrismaCountryReadRepositoryError) throw error;
    throw invalidData(error);
  }
}

function parseCountry(row: Readonly<Record<string, unknown>>, code: string): JsonObject {
  return {
    code,
    name: parseLocalizedText(row.name),
    region: mapToken(row.region, PRISMA_REGION_TO_SHARED),
    coverageLevel: requireEnum(row.coverageLevel, COVERAGE_LEVELS),
    flagEmoji: requireNonBlankString(row.flagEmoji),
    summary: parseLocalizedText(row.summary),
    moduleCoverage: parseCoverage(row.moduleCoverage, code),
    updatedAt: dateToIso(row.updatedAt),
  };
}

function parseCoverage(value: unknown, countryCode: string): readonly JsonObject[] {
  if (!Array.isArray(value) || value.length !== MODULE_KEYS.length) {
    throw invalidData();
  }
  const byModule = new Map<string, JsonObject>();
  for (const item of value) {
    const row = requireRecord(item);
    if (row.countryCode !== countryCode) throw invalidData();
    const moduleKey = mapToken(row.moduleKey, PRISMA_MODULE_TO_SHARED);
    if (byModule.has(moduleKey)) throw invalidData();
    byModule.set(moduleKey, {
      moduleKey,
      status: requireEnum(row.status, COVERAGE_STATUSES),
      dataCount: requireNonNegativeSafeInteger(row.dataCount),
      updatedAt: dateToIso(row.updatedAt),
    });
  }
  return MODULE_KEYS.map((moduleKey) => {
    const item = byModule.get(moduleKey);
    if (item === undefined) throw invalidData();
    return item;
  });
}

function parseMarketOverview(value: unknown, countryCode: string): JsonObject {
  const row = requireRecord(value);
  return {
    overview: parseLocalizedText(row.overview),
    population: finiteNumberOrNull(row.population, true),
    gdp: finiteNumberOrNull(row.gdp),
    gdpGrowth: finiteNumberOrNull(row.gdpGrowth),
    energyDemand: parseLocalizedText(row.energyDemand),
    renewableTarget: parseLocalizedText(row.renewableTarget),
    keyIndicators: parseKeyIndicators(row.keyIndicators),
    basicProfile: parseRequiredBasicProfile(row.basicProfile),
    ...parseMetadata(row, countryCode),
  };
}

function parseRequiredBasicProfile(value: unknown): JsonObject | null {
  const profile = parseBasicProfile(value);
  if (value !== null && value !== undefined && profile === null) throw invalidData();
  return profile as unknown as JsonObject | null;
}

type RecordParser = (
  row: Readonly<Record<string, unknown>>,
  countryCode: string,
) => JsonObject;

function parseRecordList(
  value: unknown,
  countryCode: string,
  parser: RecordParser,
): readonly JsonObject[] {
  if (!Array.isArray(value)) throw invalidData();
  return value.map((item) => {
    const row = requireRecord(item);
    return parser(row, countryCode);
  });
}

function parsePolicy(row: Readonly<Record<string, unknown>>, code: string): JsonObject {
  return {
    id: requireNonBlankString(row.id),
    title: parseLocalizedText(row.title),
    summary: parseLocalizedText(row.summary),
    body: parseLocalizedText(row.body),
    policyType: mapToken(row.policyType, PRISMA_POLICY_TYPE_TO_SHARED),
    effectiveDate: dateToIsoOrNull(row.effectiveDate),
    authority: parseLocalizedText(row.authority),
    ...parseMetadata(row, code),
  };
}

function parseRisk(row: Readonly<Record<string, unknown>>, code: string): JsonObject {
  return {
    id: requireNonBlankString(row.id),
    title: parseLocalizedText(row.title),
    category: requireEnum(requireOwnDataValue(row, "category"), RISK_CATEGORIES),
    level: requireEnum(row.level, RISK_LEVELS),
    description: parseLocalizedText(row.description),
    mitigation: parseLocalizedText(row.mitigation),
    ...parseMetadata(row, code),
  };
}

function parseOpportunity(
  row: Readonly<Record<string, unknown>>,
  code: string,
): JsonObject {
  return {
    id: requireNonBlankString(row.id),
    title: parseLocalizedText(row.title),
    description: parseLocalizedText(row.description),
    marketSize: parseLocalizedTextOrNull(row.marketSize),
    timeWindow: parseLocalizedTextOrNull(row.timeWindow),
    ...parseMetadata(row, code),
  };
}

function parseProject(row: Readonly<Record<string, unknown>>, code: string): JsonObject {
  return {
    id: requireNonBlankString(row.id),
    name: parseLocalizedText(row.name),
    description: parseLocalizedText(row.description),
    status: requireEnum(row.status, PROJECT_STATUSES),
    capacity: stringOrNull(row.capacity),
    investment: finiteNumberOrNull(row.investment),
    location: parseLocalizedTextOrNull(row.location),
    ...parseMetadata(row, code),
  };
}

function parsePartner(row: Readonly<Record<string, unknown>>, code: string): JsonObject {
  return {
    id: requireNonBlankString(row.id),
    name: parseLocalizedText(row.name),
    partnerType: requireNonBlankString(row.partnerType),
    description: parseLocalizedText(row.description),
    contactHint: parseLocalizedTextOrNull(row.contactHint),
    ...parseMetadata(row, code),
  };
}

function parseChineseCompany(
  row: Readonly<Record<string, unknown>>,
  code: string,
): JsonObject {
  return {
    id: requireNonBlankString(row.id),
    name: parseLocalizedText(row.name),
    industry: requireNonBlankString(row.industry),
    businessScope: parseLocalizedText(row.businessScope),
    entryYear: safeIntegerOrNull(row.entryYear),
    caseStudy: parseLocalizedTextOrNull(row.caseStudy),
    ...parseMetadata(row, code),
  };
}

function parseEntryStrategy(value: unknown, code: string): JsonObject {
  const row = requireRecord(value);
  return {
    id: requireNonBlankString(row.id),
    overview: parseLocalizedText(row.overview),
    steps: parseStrategySteps(row.steps),
    recommendedMode: parseLocalizedText(row.recommendedMode),
    ...parseMetadata(row, code),
  };
}

function parseReport(row: Readonly<Record<string, unknown>>, code: string): JsonObject {
  return {
    id: requireNonBlankString(row.id),
    title: parseLocalizedText(row.title),
    abstract: parseLocalizedText(row.abstract),
    fileUrl: requireNonBlankString(row.fileUrl),
    publishedAt: dateToIso(row.publishedAt),
    accessLevel: requireEnum(row.accessLevel, ACCESS_LEVELS),
    ...parseMetadata(row, code),
  };
}

function parseKnowledge(row: Readonly<Record<string, unknown>>, code: string): JsonObject {
  const metadata = parseMetadata(row, code, true);
  return {
    id: requireNonBlankString(row.id),
    content: parseLocalizedText(row.content),
    sourceModule: mapToken(row.sourceModule, PRISMA_SOURCE_MODULE_TO_SHARED),
    sourceId: requireNonBlankString(row.sourceId),
    ...metadata,
  };
}

function parseMetadata(
  row: Readonly<Record<string, unknown>>,
  countryCode: string,
  requireAiUsable = false,
): JsonObject {
  if (row.countryCode !== countryCode) throw invalidData();
  const credibility = requireEnum(row.credibility, CREDIBILITIES);
  if (
    row.reviewStatus !== "published" ||
    credibility === "UNVERIFIED" ||
    typeof row.aiUsable !== "boolean" ||
    (requireAiUsable && row.aiUsable !== true)
  ) {
    throw invalidData();
  }
  return {
    source: requireNonBlankString(row.source),
    sourceUrl: httpUrlOrNull(row.sourceUrl),
    collectedAt: dateToIso(row.collectedAt),
    updatedAt: dateToIso(row.updatedAt),
    credibility,
    reviewStatus: "published",
    aiUsable: row.aiUsable,
    countryCode,
    industryTags: mapTokenArray(row.industryTags, PRISMA_INDUSTRY_TO_SHARED),
    techTags: mapTokenArray(row.techTags, PRISMA_TECH_TO_SHARED),
  };
}

function validateAndSortSnapshots(
  snapshots: readonly CountryDataSnapshot[],
): readonly CountryDataSnapshot[] {
  try {
    const seenCodes = new Set<string>();
    for (const snapshot of snapshots) {
      const code = snapshot.country.code;
      if (typeof code !== "string" || seenCodes.has(code)) throw invalidData();
      seenCodes.add(code);
    }
    return deepFreeze(sortCountrySnapshots(snapshots));
  } catch (error) {
    if (error instanceof PrismaCountryReadRepositoryError) throw error;
    throw invalidData(error);
  }
}

function parseLocalizedText(value: unknown): JsonObject {
  if (
    !hasExactOwnKeys(value, LOCALIZED_TEXT_KEYS) ||
    typeof value.zh !== "string" ||
    typeof value.en !== "string"
  ) {
    throw invalidData();
  }
  return { zh: value.zh, en: value.en };
}

function parseLocalizedTextOrNull(value: unknown): JsonObject | null {
  return value === null ? null : parseLocalizedText(value);
}

function parseKeyIndicators(value: unknown): readonly JsonObject[] {
  if (!Array.isArray(value)) throw invalidData();
  return value.map((item) => {
    if (
      !hasExactOwnKeys(item, KEY_INDICATOR_KEYS) ||
      typeof item.value !== "string" ||
      typeof item.unit !== "string" ||
      typeof item.year !== "number" ||
      !Number.isSafeInteger(item.year)
    ) {
      throw invalidData();
    }
    return {
      label: parseLocalizedText(item.label),
      value: item.value,
      unit: item.unit,
      year: item.year,
    };
  });
}

function parseStrategySteps(value: unknown): readonly JsonObject[] {
  if (!Array.isArray(value)) throw invalidData();
  return value.map((item) => {
    if (
      !hasExactOwnKeys(item, STRATEGY_STEP_KEYS) ||
      typeof item.order !== "number" ||
      !Number.isSafeInteger(item.order)
    ) {
      throw invalidData();
    }
    return {
      order: item.order,
      title: parseLocalizedText(item.title),
      detail: parseLocalizedText(item.detail),
    };
  });
}

function requireRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw invalidData();
  }
  return value as Readonly<Record<string, unknown>>;
}

function requireOwnDataValue(
  value: Readonly<Record<string, unknown>>,
  key: string,
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !("value" in descriptor)) throw invalidData();
  return descriptor.value;
}

function requireCountryCode(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Z]{2}$/u.test(value)) throw invalidData();
  return value;
}

function requireNonBlankString(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") throw invalidData();
  return value;
}

function requireEnum<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) throw invalidData();
  return value as T;
}

function mapToken<T extends string>(
  value: unknown,
  mapping: Readonly<Record<string, T>>,
): T {
  if (typeof value !== "string") throw invalidData();
  const mapped = mapping[value];
  if (mapped === undefined) throw invalidData();
  return mapped;
}

function mapTokenArray<T extends string>(
  value: unknown,
  mapping: Readonly<Record<string, T>>,
): readonly T[] {
  if (!Array.isArray(value)) throw invalidData();
  return value.map((item) => mapToken(item, mapping));
}

function dateToIso(value: unknown): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw invalidData();
  return value.toISOString();
}

function dateToIsoOrNull(value: unknown): string | null {
  return value === null ? null : dateToIso(value);
}

function finiteNumberOrNull(value: unknown, integer = false): number | null {
  if (value === null) return null;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    (integer && (!Number.isSafeInteger(value) || value < 0))
  ) {
    throw invalidData();
  }
  return value;
}

function safeIntegerOrNull(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw invalidData();
  return value;
}

function requireNonNegativeSafeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw invalidData();
  }
  return value;
}

function stringOrNull(value: unknown): string | null {
  if (value === null) return null;
  return requireNonBlankString(value);
}

function httpUrlOrNull(value: unknown): string | null {
  return value === null ? null : requireHttpUrl(value);
}

function requireHttpUrl(value: unknown): string {
  const raw = requireNonBlankString(value);
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw invalidData();
  } catch (error) {
    if (error instanceof PrismaCountryReadRepositoryError) throw error;
    throw invalidData(error);
  }
  return raw;
}

function invalidData(cause?: unknown): DataIntegrityError {
  void cause;
  return new DataIntegrityError();
}

function queryFailed(
  cause: unknown,
): DatabaseUnavailableError | PrismaCountryReadRepositoryError {
  if (isTransientPrismaError(cause)) return new DatabaseUnavailableError();
  return new PrismaCountryReadRepositoryError();
}

function isTransientPrismaError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return TRANSIENT_PRISMA_ERROR_CODES.has(error.code);
  }
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return error.errorCode !== undefined &&
      TRANSIENT_PRISMA_ERROR_CODES.has(error.errorCode);
  }
  return false;
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}
