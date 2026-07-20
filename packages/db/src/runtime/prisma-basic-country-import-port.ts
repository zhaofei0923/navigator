import { parseBasicProfile } from "@navigator/shared-types/basic-profile";
import { Prisma } from "@prisma/client";

import type {
  BasicCountryImportTransaction,
  BasicCountryImportTransactionPort,
} from "./basic-country-import-runtime.js";
import {
  readPrismaBasicCanonicalCountry,
  type PrismaBasicCountryTransaction as PrismaBasicCountryReadTransaction,
} from "./prisma-basic-country-read.js";
import type { BasicSeedImportOperation } from "../seed/basic-country-import.js";
import {
  KEY_INDICATOR_KEYS,
  LOCALIZED_TEXT_KEYS,
  hasExactOwnKeys,
  isPlainRecord,
} from "../seed/basic-country-validation-utils.js";

const PRISMA_REGIONS = {
  SOUTHEAST_ASIA: "SOUTHEAST_ASIA",
  SOUTH_ASIA: "SOUTH_ASIA",
  MIDDLE_EAST: "MIDDLE_EAST",
  AFRICA: "AFRICA",
  LATIN_AMERICA: "LATIN_AMERICA",
  EUROPE: "EUROPE",
  CENTRAL_ASIA: "CENTRAL_ASIA",
} as const satisfies Record<string, string>;

const PRISMA_COVERAGE_LEVELS = {
  BASIC: "BASIC",
  STANDARD: "STANDARD",
  COMPLETE: "COMPLETE",
} as const satisfies Record<string, string>;

const PRISMA_MODULE_KEYS = {
  MARKET_OVERVIEW: "MARKET_OVERVIEW",
  POLICY: "POLICY",
  RISK: "RISK",
  OPPORTUNITIES: "OPPORTUNITIES",
  PROJECTS: "PROJECTS",
  PARTNERS: "PARTNERS",
  CHINESE_COMPANIES: "CHINESE_COMPANIES",
  ENTRY_STRATEGY: "ENTRY_STRATEGY",
  AI_ADVISOR: "AI_ADVISOR",
  REPORTS: "REPORTS",
} as const satisfies Record<string, string>;

const PRISMA_MODULE_STATUSES = {
  BUILDING: "BUILDING",
  PARTIAL: "PARTIAL",
  COMPLETE: "COMPLETE",
} as const satisfies Record<string, string>;

const PRISMA_CREDIBILITIES = {
  OFFICIAL: "OFFICIAL",
  VERIFIED: "VERIFIED",
  ESTIMATED: "ESTIMATED",
  UNVERIFIED: "UNVERIFIED",
} as const satisfies Record<string, string>;

const PRISMA_REVIEW_STATUSES = {
  draft: "draft",
  pending: "pending",
  published: "published",
} as const satisfies Record<string, string>;

const PRISMA_INDUSTRY_TAGS = {
  SOLAR: "SOLAR",
  WIND: "WIND",
  STORAGE: "STORAGE",
  EV: "EV",
  HYDROGEN: "HYDROGEN",
  GRID: "GRID",
  BESS_MFG: "BESS_MFG",
  EPC: "EPC",
} as const satisfies Record<string, string>;

const PRISMA_TECH_TAGS = {
  PV_MODULE: "PV_MODULE",
  INVERTER: "INVERTER",
  ONSHORE_WIND: "ONSHORE_WIND",
  OFFSHORE_WIND: "OFFSHORE_WIND",
  LFP: "LFP",
  NCM: "NCM",
  ELECTROLYZER: "ELECTROLYZER",
} as const satisfies Record<string, string>;

type PrismaActivationWhere =
  | { readonly countryCode: string }
  | { readonly countryCode: string; readonly reviewStatus: "published" }
  | {
      readonly countryCode: string;
      readonly reviewStatus: "published";
      readonly credibility: { readonly not: "UNVERIFIED" };
      readonly aiUsable: true;
    };

interface PrismaCountDelegate {
  count(args: { readonly where: PrismaActivationWhere }): Promise<number>;
}

interface PrismaUpsertDelegate {
  upsert(args: Record<string, unknown>): Promise<unknown>;
}

interface PrismaMarketOverviewDelegate extends PrismaCountDelegate {
  upsert(args: Prisma.MarketOverviewUpsertArgs): Promise<unknown>;
}

interface PrismaCountryDelegate extends PrismaUpsertDelegate {
  findUnique: PrismaBasicCountryReadTransaction["country"]["findUnique"];
}

export interface PrismaBasicCountryTransaction extends PrismaBasicCountryReadTransaction {
  readonly country: PrismaCountryDelegate;
  readonly moduleCoverage: PrismaUpsertDelegate;
  readonly marketOverview: PrismaMarketOverviewDelegate;
  readonly policy: PrismaCountDelegate;
  readonly risk: PrismaCountDelegate;
  readonly opportunity: PrismaCountDelegate;
  readonly project: PrismaCountDelegate;
  readonly partner: PrismaCountDelegate;
  readonly chineseCompany: PrismaCountDelegate;
  readonly entryStrategy: PrismaCountDelegate;
  readonly report: PrismaCountDelegate;
  readonly knowledgeChunk: PrismaCountDelegate;
}

export interface PrismaBasicCountryClient {
  $transaction<T>(
    run: (transaction: PrismaBasicCountryTransaction) => Promise<T>,
    options: {
      readonly isolationLevel: "Serializable";
      readonly maxWait: 5000;
      readonly timeout: 15000;
    },
  ): Promise<T>;
}

const ACTIVATION_DELEGATES = {
  marketOverview: (transaction: PrismaBasicCountryTransaction) => transaction.marketOverview,
  policy: (transaction: PrismaBasicCountryTransaction) => transaction.policy,
  risk: (transaction: PrismaBasicCountryTransaction) => transaction.risk,
  opportunity: (transaction: PrismaBasicCountryTransaction) => transaction.opportunity,
  project: (transaction: PrismaBasicCountryTransaction) => transaction.project,
  partner: (transaction: PrismaBasicCountryTransaction) => transaction.partner,
  chineseCompany: (transaction: PrismaBasicCountryTransaction) => transaction.chineseCompany,
  entryStrategy: (transaction: PrismaBasicCountryTransaction) => transaction.entryStrategy,
  report: (transaction: PrismaBasicCountryTransaction) => transaction.report,
  knowledgeChunk: (transaction: PrismaBasicCountryTransaction) => transaction.knowledgeChunk,
} as const satisfies Record<
  Parameters<BasicCountryImportTransaction["activationCounts"]["count"]>[0],
  (transaction: PrismaBasicCountryTransaction) => PrismaCountDelegate
>;

export function createPrismaBasicCountryImportPort(
  prismaClient: PrismaBasicCountryClient,
): BasicCountryImportTransactionPort {
  return {
    transaction: async <T>(
      run: (transaction: BasicCountryImportTransaction) => Promise<T>,
    ): Promise<T> => prismaClient.$transaction(async (transaction) => run({
      activationCounts: {
        count: async (model, scope, countryCode) => {
          const delegate = ACTIVATION_DELEGATES[model];
          return delegate(transaction).count({
            where: buildActivationWhere(scope, countryCode),
          });
        },
      },
      execute: async (operation) => executeOperation(transaction, operation),
      readCanonical: async (countryCode) =>
        readPrismaBasicCanonicalCountry(transaction, countryCode),
    }), {
      isolationLevel: "Serializable",
      maxWait: 5000,
      timeout: 15000,
    }),
  };
}

function buildActivationWhere(
  scope: Parameters<BasicCountryImportTransaction["activationCounts"]["count"]>[1],
  countryCode: string,
): PrismaActivationWhere {
  const code = requireCountryCode(countryCode);
  switch (scope) {
    case "all":
      return { countryCode: code };
    case "published":
      return { countryCode: code, reviewStatus: "published" };
    case "ai-eligible":
      return {
        countryCode: code,
        reviewStatus: "published",
        credibility: { not: "UNVERIFIED" },
        aiUsable: true,
      };
  }
}

async function executeOperation(
  transaction: PrismaBasicCountryTransaction,
  operation: BasicSeedImportOperation,
): Promise<void> {
  if (!isPlainRecord(operation) || operation.action !== "upsert") throw invalidOperation();
  switch (operation.model) {
    case "country":
      await transaction.country.upsert(parseCountryUpsert(operation));
      return;
    case "moduleCoverage":
      await transaction.moduleCoverage.upsert(parseCoverageUpsert(operation));
      return;
    case "marketOverview":
      await transaction.marketOverview.upsert(parseMarketUpsert(operation));
      return;
    default:
      throw invalidOperation();
  }
}

function parseCountryUpsert(operation: BasicSeedImportOperation): Record<string, unknown> {
  const args = exactRecord(operation.args, ["where", "create", "update"]);
  const where = exactRecord(args.where, ["code"]);
  const create = parseCountryData(args.create);
  const update = parseCountryData(args.update);
  const code = requireCountryCode(where.code);
  if (create.code !== code || update.code !== code) throw invalidOperation();
  return { where: { code }, create, update };
}

function parseCountryData(value: unknown): Record<string, unknown> {
  const data = exactRecord(value, [
    "code", "name", "region", "coverageLevel", "flagEmoji", "summary", "updatedAt",
  ]);
  return {
    code: requireCountryCode(data.code),
    name: parseLocalizedText(data.name),
    region: mapToken(data.region, PRISMA_REGIONS),
    coverageLevel: mapToken(data.coverageLevel, PRISMA_COVERAGE_LEVELS),
    flagEmoji: requireNonBlankString(data.flagEmoji),
    summary: parseLocalizedText(data.summary),
    updatedAt: parseRfc3339(data.updatedAt),
  };
}

function parseCoverageUpsert(operation: BasicSeedImportOperation): Record<string, unknown> {
  const args = exactRecord(operation.args, ["where", "create", "update"]);
  const whereOuter = exactRecord(args.where, ["countryCode_moduleKey"]);
  const where = exactRecord(whereOuter.countryCode_moduleKey, ["countryCode", "moduleKey"]);
  const create = parseCoverageData(args.create);
  const update = parseCoverageData(args.update);
  const countryCode = requireCountryCode(where.countryCode);
  const moduleKey = mapToken(where.moduleKey, PRISMA_MODULE_KEYS);
  if (
    create.countryCode !== countryCode || update.countryCode !== countryCode ||
    create.moduleKey !== moduleKey || update.moduleKey !== moduleKey
  ) {
    throw invalidOperation();
  }
  return {
    where: { countryCode_moduleKey: { countryCode, moduleKey } },
    create,
    update,
  };
}

function parseCoverageData(value: unknown): Record<string, unknown> {
  const data = exactRecord(value, [
    "countryCode", "moduleKey", "status", "dataCount", "updatedAt",
  ]);
  return {
    countryCode: requireCountryCode(data.countryCode),
    moduleKey: mapToken(data.moduleKey, PRISMA_MODULE_KEYS),
    status: mapToken(data.status, PRISMA_MODULE_STATUSES),
    dataCount: requirePrismaInt(data.dataCount),
    updatedAt: parseRfc3339(data.updatedAt),
  };
}

function parseMarketUpsert(
  operation: BasicSeedImportOperation,
): Prisma.MarketOverviewUpsertArgs {
  const args = exactRecord(operation.args, ["where", "create", "update"]);
  const where = exactRecord(args.where, ["countryCode"]);
  const create = parseMarketData(args.create);
  const update = parseMarketData(args.update);
  const countryCode = requireCountryCode(where.countryCode);
  if (create.countryCode !== countryCode || update.countryCode !== countryCode) {
    throw invalidOperation();
  }
  return { where: { countryCode }, create, update } satisfies
    Prisma.MarketOverviewUpsertArgs;
}

function parseMarketData(
  value: unknown,
): Prisma.MarketOverviewUncheckedCreateInput {
  const data = exactRecord(value, [
    "overview", "population", "gdp", "gdpGrowth", "energyDemand", "renewableTarget",
    "keyIndicators", "basicProfile", "source", "sourceUrl", "collectedAt", "updatedAt", "credibility",
    "reviewStatus", "aiUsable", "countryCode", "industryTags", "techTags",
  ]);
  const source = requireNonBlankString(data.source);
  return {
    overview: parseLocalizedText(data.overview),
    population: parsePopulation(data.population),
    gdp: parseFiniteNumberOrNull(data.gdp),
    gdpGrowth: parseFiniteNumberOrNull(data.gdpGrowth),
    energyDemand: parseLocalizedText(data.energyDemand),
    renewableTarget: parseLocalizedText(data.renewableTarget),
    keyIndicators: parseKeyIndicators(data.keyIndicators),
    basicProfile: parseRequiredBasicProfile(data.basicProfile),
    source,
    sourceUrl: parseSourceUrl(data.sourceUrl, source),
    collectedAt: parseRfc3339(data.collectedAt),
    updatedAt: parseRfc3339(data.updatedAt),
    credibility: mapToken(data.credibility, PRISMA_CREDIBILITIES),
    reviewStatus: mapToken(data.reviewStatus, PRISMA_REVIEW_STATUSES),
    aiUsable: requireBoolean(data.aiUsable),
    countryCode: requireCountryCode(data.countryCode),
    industryTags: parseMappedArray(data.industryTags, PRISMA_INDUSTRY_TAGS),
    techTags: parseMappedArray(data.techTags, PRISMA_TECH_TAGS),
  };
}

function parseRequiredBasicProfile(
  value: unknown,
): Prisma.InputJsonValue | Prisma.NullTypes.DbNull {
  if (value === null) return Prisma.DbNull;
  const profile = parseBasicProfile(value);
  if (profile === null) throw invalidOperation();
  const json = toPrismaInputJsonValue(profile);
  if (json === null) throw invalidOperation();
  return json;
}

function parseLocalizedText(value: unknown): Record<string, string> {
  if (!hasExactOwnKeys(value, LOCALIZED_TEXT_KEYS)) throw invalidOperation();
  if (
    typeof value.zh !== "string" || typeof value.en !== "string" ||
    (value.zh.trim() === "" && value.en.trim() === "")
  ) {
    throw invalidOperation();
  }
  return { zh: value.zh, en: value.en };
}

function parseKeyIndicators(value: unknown): Prisma.InputJsonObject[] {
  if (!Array.isArray(value) || value.length === 0) throw invalidOperation();
  return value.map((item) => {
    if (!hasExactOwnKeys(item, KEY_INDICATOR_KEYS)) throw invalidOperation();
    return {
      label: parseLocalizedText(item.label),
      value: requireNonBlankString(item.value),
      unit: requireNonBlankString(item.unit),
      year: requireFiniteNumber(item.year),
    };
  });
}

function toPrismaInputJsonValue(
  value: unknown,
): Prisma.InputJsonValue | null {
  if (value === null) return null;
  if (
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(toPrismaInputJsonValue);
  }
  if (isPlainRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        toPrismaInputJsonValue(item),
      ]),
    );
  }
  throw invalidOperation();
}

function parseMappedArray<T extends string>(
  value: unknown,
  mapping: Readonly<Record<string, T>>,
): T[] {
  if (!Array.isArray(value)) throw invalidOperation();
  return value.map((item) => mapToken(item, mapping));
}

function mapToken<T extends string>(
  value: unknown,
  mapping: Readonly<Record<string, T>>,
): T {
  if (typeof value !== "string") throw invalidOperation();
  const mapped = mapping[value];
  if (mapped === undefined) throw invalidOperation();
  return mapped;
}

function parseRfc3339(value: unknown): Date {
  if (typeof value !== "string") throw invalidOperation();
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?Z$/u.exec(value);
  if (match === null) throw invalidOperation();
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw invalidOperation();
  const numbers = match.slice(1).map(Number);
  if (
    date.getUTCFullYear() !== numbers[0] || date.getUTCMonth() + 1 !== numbers[1] ||
    date.getUTCDate() !== numbers[2] || date.getUTCHours() !== numbers[3] ||
    date.getUTCMinutes() !== numbers[4] || date.getUTCSeconds() !== numbers[5]
  ) {
    throw invalidOperation();
  }
  return date;
}

function parsePopulation(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 2147483647) {
    throw invalidOperation();
  }
  return value;
}

function parseFiniteNumberOrNull(value: unknown): number | null {
  return value === null ? null : requireFiniteNumber(value);
}

function parseSourceUrl(value: unknown, source: string): string | null {
  if (value === null) {
    if (!source.includes("sourceUrl null")) throw invalidOperation();
    return null;
  }
  if (typeof value !== "string") throw invalidOperation();
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new TypeError();
  } catch {
    throw invalidOperation();
  }
  return value;
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!hasExactOwnKeys(value, keys)) throw invalidOperation();
  return value;
}

function requireCountryCode(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Z]{2}$/u.test(value)) throw invalidOperation();
  return value;
}

function requireNonBlankString(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") throw invalidOperation();
  return value;
}

function requireFiniteNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw invalidOperation();
  return value;
}

function requirePrismaInt(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 2147483647) {
    throw invalidOperation();
  }
  return value;
}

function requireBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw invalidOperation();
  return value;
}

function invalidOperation(): TypeError {
  return new TypeError("INVALID_PRISMA_BASIC_IMPORT_OPERATION");
}
