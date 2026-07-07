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
  type CountrySeedBundle,
} from "./country-seed-registry";

export type TextMode = "localized" | "raw";

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
