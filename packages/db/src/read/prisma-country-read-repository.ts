import {
  sortCountrySnapshots,
  type CountryDataSnapshot,
  type CountryReadRepository,
  type JsonObject,
  type JsonValue,
} from "@navigator/shared-types/country-runtime";

const COUNTRY_READ_INVALID_DATA = "COUNTRY_READ_INVALID_DATA" as const;
const COUNTRY_READ_QUERY_FAILED = "COUNTRY_READ_QUERY_FAILED" as const;

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

const PUBLIC_RELATION_WHERE = Object.freeze({
  reviewStatus: "published",
  credibility: { not: "UNVERIFIED" },
} as const);
const KNOWLEDGE_RELATION_WHERE = Object.freeze({
  ...PUBLIC_RELATION_WHERE,
  aiUsable: true,
} as const);
const LIST_RELATION_ORDER = Object.freeze([
  { updatedAt: "desc" },
  { id: "asc" },
] as const);

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
} as const;

export interface PrismaCountryFindManyArgs {
  readonly where: Readonly<Record<string, never>>;
  readonly orderBy: readonly [{ readonly code: "asc" }];
  readonly select: typeof COUNTRY_SELECT;
}

export interface PrismaCountryFindUniqueArgs {
  readonly where: Readonly<{ readonly code: string }>;
  readonly select: typeof COUNTRY_SELECT;
}

export interface PrismaCountryReadClient {
  readonly country: {
    findMany(args: PrismaCountryFindManyArgs): Promise<unknown>;
    findUnique(args: PrismaCountryFindUniqueArgs): Promise<unknown>;
  };
}

export type PrismaCountryReadRepositoryErrorCode =
  | typeof COUNTRY_READ_INVALID_DATA
  | typeof COUNTRY_READ_QUERY_FAILED;

export class PrismaCountryReadRepositoryError extends Error {
  readonly code: PrismaCountryReadRepositoryErrorCode;

  constructor(code: PrismaCountryReadRepositoryErrorCode, options?: ErrorOptions) {
    super(code, options);
    this.name = "PrismaCountryReadRepositoryError";
    this.code = code;
  }
}

export function createPrismaCountryReadRepository(
  client: PrismaCountryReadClient,
): CountryReadRepository {
  return Object.freeze({
    async list(): Promise<readonly CountryDataSnapshot[]> {
      let rows: unknown;
      try {
        rows = await client.country.findMany({
          where: {},
          orderBy: [{ code: "asc" }],
          select: COUNTRY_SELECT,
        });
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
        });
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
    return deepFreeze(snapshot);
  } catch (error) {
    if (error instanceof PrismaCountryReadRepositoryError) throw error;
    throw invalidData(error);
  }
}

function parseCountry(row: Readonly<Record<string, unknown>>, code: string): JsonObject {
  return {
    code,
    name: cloneJsonObject(row.name),
    region: mapToken(row.region, PRISMA_REGION_TO_SHARED),
    coverageLevel: requireEnum(row.coverageLevel, COVERAGE_LEVELS),
    flagEmoji: requireNonBlankString(row.flagEmoji),
    summary: cloneJsonObject(row.summary),
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
    overview: cloneJsonObject(row.overview),
    population: finiteNumberOrNull(row.population, true),
    gdp: finiteNumberOrNull(row.gdp),
    gdpGrowth: finiteNumberOrNull(row.gdpGrowth),
    energyDemand: cloneJsonObject(row.energyDemand),
    renewableTarget: cloneJsonObject(row.renewableTarget),
    keyIndicators: cloneJsonArray(row.keyIndicators),
    ...parseMetadata(row, countryCode),
  };
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
  const seenIds = new Set<string>();
  const records = value.map((item) => {
    const row = requireRecord(item);
    const id = requireNonBlankString(row.id);
    if (seenIds.has(id)) throw invalidData();
    seenIds.add(id);
    return parser(row, countryCode);
  });
  return records.sort(compareModuleRecords);
}

function parsePolicy(row: Readonly<Record<string, unknown>>, code: string): JsonObject {
  return {
    id: requireNonBlankString(row.id),
    title: cloneJsonObject(row.title),
    summary: cloneJsonObject(row.summary),
    body: cloneJsonObject(row.body),
    policyType: mapToken(row.policyType, PRISMA_POLICY_TYPE_TO_SHARED),
    effectiveDate: dateToIsoOrNull(row.effectiveDate),
    authority: cloneJsonObject(row.authority),
    ...parseMetadata(row, code),
  };
}

function parseRisk(row: Readonly<Record<string, unknown>>, code: string): JsonObject {
  return {
    id: requireNonBlankString(row.id),
    title: cloneJsonObject(row.title),
    category: requireNonBlankString(row.category),
    level: requireEnum(row.level, RISK_LEVELS),
    description: cloneJsonObject(row.description),
    mitigation: cloneJsonObject(row.mitigation),
    ...parseMetadata(row, code),
  };
}

function parseOpportunity(
  row: Readonly<Record<string, unknown>>,
  code: string,
): JsonObject {
  return {
    id: requireNonBlankString(row.id),
    title: cloneJsonObject(row.title),
    description: cloneJsonObject(row.description),
    marketSize: cloneJsonObjectOrNull(row.marketSize),
    timeWindow: cloneJsonObjectOrNull(row.timeWindow),
    ...parseMetadata(row, code),
  };
}

function parseProject(row: Readonly<Record<string, unknown>>, code: string): JsonObject {
  return {
    id: requireNonBlankString(row.id),
    name: cloneJsonObject(row.name),
    description: cloneJsonObject(row.description),
    status: requireEnum(row.status, PROJECT_STATUSES),
    capacity: stringOrNull(row.capacity),
    investment: finiteNumberOrNull(row.investment),
    location: cloneJsonObjectOrNull(row.location),
    ...parseMetadata(row, code),
  };
}

function parsePartner(row: Readonly<Record<string, unknown>>, code: string): JsonObject {
  return {
    id: requireNonBlankString(row.id),
    name: cloneJsonObject(row.name),
    partnerType: requireNonBlankString(row.partnerType),
    description: cloneJsonObject(row.description),
    contactHint: cloneJsonObjectOrNull(row.contactHint),
    ...parseMetadata(row, code),
  };
}

function parseChineseCompany(
  row: Readonly<Record<string, unknown>>,
  code: string,
): JsonObject {
  return {
    id: requireNonBlankString(row.id),
    name: cloneJsonObject(row.name),
    industry: requireNonBlankString(row.industry),
    businessScope: cloneJsonObject(row.businessScope),
    entryYear: safeIntegerOrNull(row.entryYear),
    caseStudy: cloneJsonObjectOrNull(row.caseStudy),
    ...parseMetadata(row, code),
  };
}

function parseEntryStrategy(value: unknown, code: string): JsonObject {
  const row = requireRecord(value);
  return {
    id: requireNonBlankString(row.id),
    overview: cloneJsonObject(row.overview),
    steps: cloneJsonArray(row.steps),
    recommendedMode: cloneJsonObject(row.recommendedMode),
    ...parseMetadata(row, code),
  };
}

function parseReport(row: Readonly<Record<string, unknown>>, code: string): JsonObject {
  return {
    id: requireNonBlankString(row.id),
    title: cloneJsonObject(row.title),
    abstract: cloneJsonObject(row.abstract),
    fileUrl: requireHttpUrl(row.fileUrl),
    publishedAt: dateToIso(row.publishedAt),
    accessLevel: requireEnum(row.accessLevel, ACCESS_LEVELS),
    ...parseMetadata(row, code),
  };
}

function parseKnowledge(row: Readonly<Record<string, unknown>>, code: string): JsonObject {
  const metadata = parseMetadata(row, code, true);
  return {
    id: requireNonBlankString(row.id),
    content: cloneJsonObject(row.content),
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

function compareModuleRecords(left: JsonObject, right: JsonObject): number {
  const updatedDifference = String(right.updatedAt).localeCompare(
    String(left.updatedAt),
    "en",
  );
  return updatedDifference !== 0
    ? updatedDifference
    : String(left.id).localeCompare(String(right.id), "en");
}

function cloneJsonObject(value: unknown): JsonObject {
  const cloned = cloneJson(value);
  if (Array.isArray(cloned) || cloned === null || typeof cloned !== "object") {
    throw invalidData();
  }
  return cloned as JsonObject;
}

function cloneJsonObjectOrNull(value: unknown): JsonObject | null {
  return value === null ? null : cloneJsonObject(value);
}

function cloneJsonArray(value: unknown): readonly JsonValue[] {
  if (!Array.isArray(value)) throw invalidData();
  return value.map((item) => cloneJson(item));
}

function cloneJson(value: unknown, seen = new WeakSet<object>()): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw invalidData();
    return value;
  }
  if (typeof value !== "object" || seen.has(value)) throw invalidData();
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => cloneJson(item, seen));
  if (Object.getPrototypeOf(value) !== Object.prototype) throw invalidData();
  const cloned: Record<string, JsonValue> = {};
  for (const [key, child] of Object.entries(value)) {
    cloned[key] = cloneJson(child, seen);
  }
  return cloned;
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

function invalidData(cause?: unknown): PrismaCountryReadRepositoryError {
  return cause === undefined
    ? new PrismaCountryReadRepositoryError(COUNTRY_READ_INVALID_DATA)
    : new PrismaCountryReadRepositoryError(COUNTRY_READ_INVALID_DATA, { cause });
}

function queryFailed(cause: unknown): PrismaCountryReadRepositoryError {
  return new PrismaCountryReadRepositoryError(COUNTRY_READ_QUERY_FAILED, { cause });
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}
