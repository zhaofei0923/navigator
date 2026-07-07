import {
  COVERAGE_LEVELS,
  INDUSTRY_TAGS,
  MODULE_KEYS,
  REGIONS,
  TECH_TAGS,
  type CoverageLevel,
  type IndustryTag,
  type Locale,
  type ModuleCoverageStatus,
  type ModuleKey,
  type Region,
  type TechTag,
} from "@navigator/shared-types/schema";
import {
  pickLocale,
  type LocalizedText,
} from "@navigator/shared-types/i18n";

import {
  countrySeedBundles,
  type CountryModuleCoverageSeed,
  type CountryModuleDataSeed,
  type CountryModuleRecord,
  type CountrySeedBundle,
} from "./country-seed-registry";

export type TextMode = "localized" | "raw";

const OBJECT_MODULE_KEYS = [
  "market-overview",
  "entry-strategy",
] as const satisfies readonly ModuleKey[];
const MAX_MODULE_PAGE_SIZE = 100;

export interface CountryModuleCoverageSummary {
  moduleKey: ModuleKey;
  status: ModuleCoverageStatus;
  dataCount: number;
  updatedAt: string;
}

export interface CountryCatalogItem {
  code: string;
  coverageLevel: CoverageLevel;
  flagEmoji: string;
  industryTags: IndustryTag[];
  moduleCoverage: CountryModuleCoverageSummary[];
  name: LocalizedText;
  region: Region;
  summary: LocalizedText;
  techTags: TechTag[];
  updatedAt: string;
}

export interface LocalizedCountryCard {
  code: string;
  coverageLevel: CoverageLevel;
  flagEmoji: string;
  moduleCoverage: CountryModuleCoverageSummary[];
  name: string;
  region: Region;
  summary: string;
  updatedAt: string;
  _i18nFallback: string[];
}

export interface RawCountryCard
  extends Omit<LocalizedCountryCard, "name" | "summary" | "_i18nFallback"> {
  name: LocalizedText;
  summary: LocalizedText;
}

export interface CountryFilters {
  coverageLevel?: CoverageLevel | undefined;
  industryTags?: IndustryTag[] | undefined;
  locale?: Locale | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
  region?: Region | undefined;
  techTags?: TechTag[] | undefined;
}

export interface LocalizedCountriesResponse {
  success: true;
  data: LocalizedCountryCard[];
  meta: {
    locale: Locale;
    page: number;
    pageSize: number;
    textMode: "localized";
    total: number;
  };
}

export interface RawCountriesResponse
  extends Omit<LocalizedCountriesResponse, "data" | "meta"> {
  data: RawCountryCard[];
  meta: Omit<LocalizedCountriesResponse["meta"], "textMode"> & {
    textMode: "raw";
  };
}

export type CountriesResponse = LocalizedCountriesResponse | RawCountriesResponse;

export interface CountryFilterOptions {
  coverageLevels: CoverageLevel[];
  industryTags: IndustryTag[];
  regions: Region[];
  techTags: TechTag[];
}

export type LocalizedCountryDetail = LocalizedCountryCard;
export type RawCountryDetail = RawCountryCard;

export interface CountryDetailFilters {
  locale?: Locale | undefined;
}

export interface LocalizedCountryDetailResponse {
  success: true;
  data: LocalizedCountryDetail;
  meta: {
    locale: Locale;
    textMode: "localized";
  };
}

export interface RawCountryDetailResponse
  extends Omit<LocalizedCountryDetailResponse, "data" | "meta"> {
  data: RawCountryDetail;
  meta: {
    locale: Locale;
    textMode: "raw";
  };
}

export type CountryDetailResponse =
  | LocalizedCountryDetailResponse
  | RawCountryDetailResponse;

export interface ModuleResponseRecord extends Record<string, unknown> {
  id?: string;
}

export interface CountryModuleFilters {
  locale?: Locale | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
}

export interface LocalizedCountryModulePayload {
  moduleKey: ModuleKey;
  status: ModuleCoverageStatus;
  items?: ModuleResponseRecord[] | undefined;
  item?: ModuleResponseRecord | undefined;
  _i18nFallback: string[];
}

export interface RawCountryModulePayload
  extends Omit<LocalizedCountryModulePayload, "_i18nFallback"> {
  _i18nFallback?: undefined;
}

export interface LocalizedCountryModuleResponse {
  success: true;
  data: LocalizedCountryModulePayload;
  meta: {
    locale: Locale;
    page: number;
    pageSize: number;
    textMode: "localized";
    total: number;
  };
}

export interface RawCountryModuleResponse
  extends Omit<LocalizedCountryModuleResponse, "data" | "meta"> {
  data: RawCountryModulePayload;
  meta: Omit<LocalizedCountryModuleResponse["meta"], "textMode"> & {
    textMode: "raw";
  };
}

export type CountryModuleResponse =
  | LocalizedCountryModuleResponse
  | RawCountryModuleResponse;

function collectSeedTags<TTag extends string>(
  bundle: CountrySeedBundle,
  field: "industryTags" | "techTags",
  allowed: readonly TTag[],
): TTag[] {
  const tags = new Set<TTag>();

  for (const item of bundle.tagSources) {
    if (
      item.countryCode !== bundle.country.code ||
      item.reviewStatus !== "published"
    ) {
      continue;
    }

    const values = item[field] ?? [];
    for (const value of values) {
      if (allowed.includes(value as TTag)) {
        tags.add(value as TTag);
      }
    }
  }

  return [...allowed].filter((tag) => tags.has(tag));
}

function normalizeModuleCoverage(
  bundle: CountrySeedBundle,
): CountryModuleCoverageSummary[] {
  return MODULE_KEYS.map((moduleKey) => {
    const coverage = bundle.country.moduleCoverage.find(
      (item) => item.moduleKey === moduleKey,
    );

    if (coverage === undefined) {
      return {
        dataCount: 0,
        moduleKey,
        status: "BUILDING",
        updatedAt: bundle.country.updatedAt,
      };
    }

    return coverage satisfies CountryModuleCoverageSeed;
  });
}

function buildCountryCatalogItem(bundle: CountrySeedBundle): CountryCatalogItem {
  return {
    code: bundle.country.code,
    coverageLevel: bundle.country.coverageLevel,
    flagEmoji: bundle.country.flagEmoji,
    industryTags: collectSeedTags(bundle, "industryTags", INDUSTRY_TAGS),
    moduleCoverage: normalizeModuleCoverage(bundle),
    name: bundle.country.name,
    region: bundle.country.region,
    summary: bundle.country.summary,
    techTags: collectSeedTags(bundle, "techTags", TECH_TAGS),
    updatedAt: bundle.country.updatedAt,
  };
}

export const countryCatalog = countrySeedBundles.map(buildCountryCatalogItem);

function includesEvery<T extends string>(values: readonly T[], filters: T[]) {
  return filters.every((filter) => values.includes(filter));
}

export function filterCountryCatalog(filters: CountryFilters = {}) {
  const industryTags = filters.industryTags ?? [];
  const techTags = filters.techTags ?? [];

  return countryCatalog.filter((country) => {
    if (
      filters.coverageLevel !== undefined &&
      country.coverageLevel !== filters.coverageLevel
    ) {
      return false;
    }

    if (filters.region !== undefined && country.region !== filters.region) {
      return false;
    }

    if (!includesEvery(country.industryTags, industryTags)) {
      return false;
    }

    if (!includesEvery(country.techTags, techTags)) {
      return false;
    }

    return true;
  });
}

export function localizeCountryCard(
  country: CountryCatalogItem,
  locale: Locale,
): LocalizedCountryCard {
  const name = pickLocale(country.name, locale);
  const summary = pickLocale(country.summary, locale);
  const fallbackFields = [
    name.fallback ? "name" : undefined,
    summary.fallback ? "summary" : undefined,
  ].filter((field): field is string => field !== undefined);

  return {
    code: country.code,
    coverageLevel: country.coverageLevel,
    flagEmoji: country.flagEmoji,
    moduleCoverage: [...country.moduleCoverage],
    name: name.value,
    region: country.region,
    summary: summary.value,
    updatedAt: country.updatedAt,
    _i18nFallback: fallbackFields,
  };
}

export function rawCountryCard(country: CountryCatalogItem): RawCountryCard {
  return {
    code: country.code,
    coverageLevel: country.coverageLevel,
    flagEmoji: country.flagEmoji,
    moduleCoverage: [...country.moduleCoverage],
    name: country.name,
    region: country.region,
    summary: country.summary,
    updatedAt: country.updatedAt,
  };
}

function normalizeCountryCode(code: string): string {
  return code.trim().toUpperCase();
}

function findCountryBundle(code: string): CountrySeedBundle | undefined {
  const normalizedCode = normalizeCountryCode(code);

  return countrySeedBundles.find(
    (bundle) => bundle.country.code === normalizedCode,
  );
}

function findCountryCatalogItem(code: string): CountryCatalogItem | undefined {
  const normalizedCode = normalizeCountryCode(code);

  return countryCatalog.find((country) => country.code === normalizedCode);
}

function isObjectModule(moduleKey: ModuleKey): boolean {
  return (OBJECT_MODULE_KEYS as readonly ModuleKey[]).includes(moduleKey);
}

function getModuleCoverage(
  country: CountryCatalogItem,
  moduleKey: ModuleKey,
): CountryModuleCoverageSummary {
  const coverage = country.moduleCoverage.find(
    (item) => item.moduleKey === moduleKey,
  );

  return (
    coverage ?? {
      dataCount: 0,
      moduleKey,
      status: "BUILDING",
      updatedAt: country.updatedAt,
    }
  );
}

function isModuleRecordArray(
  moduleData: CountryModuleDataSeed,
): moduleData is readonly CountryModuleRecord[] {
  return Array.isArray(moduleData);
}

function normalizeModuleData(
  moduleData: CountryModuleDataSeed,
): CountryModuleRecord[] {
  if (moduleData === null) {
    return [];
  }

  if (isModuleRecordArray(moduleData)) {
    return [...moduleData];
  }

  return [moduleData];
}

function getPublishedModuleRecords(
  bundle: CountrySeedBundle,
  moduleKey: ModuleKey,
): CountryModuleRecord[] {
  return normalizeModuleData(bundle.moduleData[moduleKey]).filter(
    (item) => {
      if (
        item.countryCode !== bundle.country.code ||
        item.reviewStatus !== "published"
      ) {
        return false;
      }

      if (moduleKey !== "ai-advisor") {
        return true;
      }

      return item.aiUsable === true && item.credibility !== "UNVERIFIED";
    },
  );
}

function normalizePositiveInteger(value: number | undefined, fallback: number) {
  return Number.isInteger(value) && value !== undefined && value > 0
    ? value
    : fallback;
}

function normalizePageInput(filters: CountryModuleFilters) {
  const page = normalizePositiveInteger(filters.page, 1);
  const pageSize = Math.min(
    normalizePositiveInteger(filters.pageSize, 20),
    MAX_MODULE_PAGE_SIZE,
  );

  return { page, pageSize };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toLocalizedText(value: unknown): LocalizedText | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const keys = Object.keys(value);
  const onlyLocaleKeys = keys.every((key) => key === "zh" || key === "en");
  const zh = value.zh;
  const en = value.en;

  if (!onlyLocaleKeys || (typeof zh !== "string" && typeof en !== "string")) {
    return undefined;
  }

  return {
    en: typeof en === "string" ? en : "",
    zh: typeof zh === "string" ? zh : "",
  };
}

function localizeValue(
  value: unknown,
  locale: Locale,
  path: string,
  fallbackFields: string[],
): unknown {
  const text = toLocalizedText(value);
  if (text !== undefined) {
    const localized = pickLocale(text, locale);
    if (localized.fallback) {
      fallbackFields.push(path);
    }
    return localized.value;
  }

  if (Array.isArray(value)) {
    return value.map((item, index) =>
      localizeValue(item, locale, `${path}[${index}]`, fallbackFields),
    );
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, childValue]) => {
        const childPath = path === "" ? key : `${path}.${key}`;
        return [key, localizeValue(childValue, locale, childPath, fallbackFields)];
      }),
    );
  }

  return value;
}

function localizeModuleRecord(
  record: CountryModuleRecord,
  locale: Locale,
  path: string,
  fallbackFields: string[],
): ModuleResponseRecord {
  return localizeValue(
    sanitizeModuleRecord(record),
    locale,
    path,
    fallbackFields,
  ) as ModuleResponseRecord;
}

function rawModuleRecord(record: CountryModuleRecord): ModuleResponseRecord {
  return sanitizeModuleRecord(record);
}

function sanitizeModuleRecord(
  record: CountryModuleRecord,
  moduleKey?: ModuleKey,
): ModuleResponseRecord {
  const { embeddingEn, embeddingZh, fileUrl, ...publicRecord } = record;

  void embeddingEn;
  void embeddingZh;
  void fileUrl;

  if (moduleKey === "ai-advisor") {
    const { content, ...aiPublicRecord } = publicRecord;
    void content;
    return { ...aiPublicRecord };
  }

  return { ...publicRecord };
}

function buildAiAdvisorSummaryRecords(
  records: CountryModuleRecord[],
): CountryModuleRecord[] {
  const sourceModules = [...new Set(
    records
      .map((record) => record.sourceModule)
      .filter((value): value is ModuleKey => MODULE_KEYS.includes(value as ModuleKey)),
  )];

  const firstRecord = records[0];
  const summary: CountryModuleRecord = {
    aiUsable: true,
    content: {
      en: "Advisor-ready knowledge is available from published, AI-usable country modules.",
      zh: "已发布且可用于 AI 的国家模块知识已就绪，可支撑顾问问答。",
    },
    credibility: "VERIFIED",
    id: "ai-advisor-readiness",
    reviewStatus: "published",
    source: "Derived from published country module knowledge chunks",
    sourceModule: "ai-advisor",
    usableChunkCount: records.length,
    usableSourceModules: sourceModules,
  };

  if (firstRecord?.countryCode !== undefined) {
    summary.countryCode = firstRecord.countryCode;
  }

  if (firstRecord?.updatedAt !== undefined) {
    summary.updatedAt = firstRecord.updatedAt;
  }

  return [summary];
}

export function buildCountryDetailResponse(
  code: string,
  filters?: CountryDetailFilters,
  textMode?: "localized",
): LocalizedCountryDetailResponse | null;
export function buildCountryDetailResponse(
  code: string,
  filters: CountryDetailFilters | undefined,
  textMode: "raw",
): RawCountryDetailResponse | null;
export function buildCountryDetailResponse(
  code: string,
  filters: CountryDetailFilters | undefined,
  textMode: TextMode,
): CountryDetailResponse | null;
export function buildCountryDetailResponse(
  code: string,
  filters: CountryDetailFilters = {},
  textMode: TextMode = "localized",
): CountryDetailResponse | null {
  const country = findCountryCatalogItem(code);
  if (country === undefined) {
    return null;
  }

  const locale = filters.locale ?? "zh-CN";

  if (textMode === "raw") {
    return {
      data: rawCountryCard(country),
      meta: {
        locale,
        textMode: "raw",
      },
      success: true,
    };
  }

  return {
    data: localizeCountryCard(country, locale),
    meta: {
      locale,
      textMode: "localized",
    },
    success: true,
  };
}

export function buildBuildingModuleResponse(
  moduleKey: ModuleKey,
  status: ModuleCoverageStatus,
  locale: Locale,
  page: number,
  pageSize: number,
  textMode: TextMode,
): CountryModuleResponse {
  if (textMode === "raw") {
    return {
      data: {
        items: [],
        moduleKey,
        status,
      },
      meta: {
        locale,
        page,
        pageSize,
        textMode: "raw",
        total: 0,
      },
      success: true,
    };
  }

  return {
    data: {
      _i18nFallback: [],
      items: [],
      moduleKey,
      status,
    },
    meta: {
      locale,
      page,
      pageSize,
      textMode: "localized",
      total: 0,
    },
    success: true,
  };
}

export function buildCountryModuleResponse(
  code: string,
  moduleKey: ModuleKey,
  filters?: CountryModuleFilters,
  textMode?: "localized",
): LocalizedCountryModuleResponse | null;
export function buildCountryModuleResponse(
  code: string,
  moduleKey: ModuleKey,
  filters: CountryModuleFilters | undefined,
  textMode: "raw",
): RawCountryModuleResponse | null;
export function buildCountryModuleResponse(
  code: string,
  moduleKey: ModuleKey,
  filters: CountryModuleFilters | undefined,
  textMode: TextMode,
): CountryModuleResponse | null;
export function buildCountryModuleResponse(
  code: string,
  moduleKey: ModuleKey,
  filters: CountryModuleFilters = {},
  textMode: TextMode = "localized",
): CountryModuleResponse | null {
  const bundle = findCountryBundle(code);
  const country = findCountryCatalogItem(code);
  if (bundle === undefined || country === undefined) {
    return null;
  }

  const locale = filters.locale ?? "zh-CN";
  const { page, pageSize } = normalizePageInput(filters);
  const coverage = getModuleCoverage(country, moduleKey);

  if (coverage.status === "BUILDING") {
    return buildBuildingModuleResponse(
      moduleKey,
      coverage.status,
      locale,
      page,
      pageSize,
      textMode,
    );
  }

  const publishedRecords = getPublishedModuleRecords(bundle, moduleKey);
  const responseRecords =
    moduleKey === "ai-advisor"
      ? buildAiAdvisorSummaryRecords(publishedRecords)
      : publishedRecords;
  const fallbackFields: string[] = [];

  if (isObjectModule(moduleKey)) {
    const record = responseRecords[0];
    const rawItem = record === undefined ? undefined : rawModuleRecord(record);
    const localizedItem =
      record === undefined
        ? undefined
        : localizeModuleRecord(record, locale, "item", fallbackFields);

    if (textMode === "raw") {
      return {
        data: {
          item: rawItem,
          moduleKey,
          status: coverage.status,
        },
        meta: {
          locale,
          page,
          pageSize,
          textMode: "raw",
          total: rawItem === undefined ? 0 : 1,
        },
        success: true,
      };
    }

    return {
      data: {
        _i18nFallback: fallbackFields,
        item: localizedItem,
        moduleKey,
        status: coverage.status,
      },
      meta: {
        locale,
        page,
        pageSize,
        textMode: "localized",
        total: localizedItem === undefined ? 0 : 1,
      },
      success: true,
    };
  }

  const pageStart = (page - 1) * pageSize;
  const pageItems = responseRecords.slice(pageStart, pageStart + pageSize);

  if (textMode === "raw") {
    return {
      data: {
        items: pageItems.map((item) => sanitizeModuleRecord(item, moduleKey)),
        moduleKey,
        status: coverage.status,
      },
      meta: {
        locale,
        page,
        pageSize,
        textMode: "raw",
        total: responseRecords.length,
      },
      success: true,
    };
  }

  return {
    data: {
      _i18nFallback: fallbackFields,
      items: pageItems.map((item, index) =>
        localizeModuleRecord(item, locale, `items[${index}]`, fallbackFields),
      ),
      moduleKey,
      status: coverage.status,
    },
    meta: {
      locale,
      page,
      pageSize,
      textMode: "localized",
      total: responseRecords.length,
    },
    success: true,
  };
}

export function buildCountriesResponse(
  filters?: CountryFilters,
  textMode?: "localized",
): LocalizedCountriesResponse;
export function buildCountriesResponse(
  filters: CountryFilters | undefined,
  textMode: "raw",
): RawCountriesResponse;
export function buildCountriesResponse(
  filters: CountryFilters | undefined,
  textMode: TextMode,
): CountriesResponse;
export function buildCountriesResponse(
  filters: CountryFilters = {},
  textMode: TextMode = "localized",
): CountriesResponse {
  const locale = filters.locale ?? "zh-CN";
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 20;
  const filtered = filterCountryCatalog(filters);
  const pageStart = (page - 1) * pageSize;
  const pageItems = filtered.slice(pageStart, pageStart + pageSize);

  if (textMode === "raw") {
    return {
      data: pageItems.map((country) => rawCountryCard(country)),
      meta: {
        locale,
        page,
        pageSize,
        textMode: "raw",
        total: filtered.length,
      },
      success: true,
    };
  }

  return {
    data: pageItems.map((country) => localizeCountryCard(country, locale)),
    meta: {
      locale,
      page,
      pageSize,
      textMode: "localized",
      total: filtered.length,
    },
    success: true,
  };
}

export function getFilterOptions(): CountryFilterOptions {
  const regions = new Set<Region>();
  const industryTags = new Set<IndustryTag>();
  const techTags = new Set<TechTag>();

  for (const country of countryCatalog) {
    regions.add(country.region);
    country.industryTags.forEach((tag) => industryTags.add(tag));
    country.techTags.forEach((tag) => techTags.add(tag));
  }

  return {
    coverageLevels: [...COVERAGE_LEVELS],
    industryTags: [...INDUSTRY_TAGS].filter((tag) => industryTags.has(tag)),
    regions: [...REGIONS].filter((region) => regions.has(region)),
    techTags: [...TECH_TAGS].filter((tag) => techTags.has(tag)),
  };
}
