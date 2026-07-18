import {
  COVERAGE_LEVELS,
  INDUSTRY_TAGS,
  MODULE_KEYS,
  REGIONS,
  TECH_TAGS,
  type CoverageLevel,
  type IndustryTag,
  type Locale,
  type ModuleKey,
  type Region,
  type TechTag,
} from "./schema.js";
import type { CountryFilters, TextMode } from "./country-api.js";

export const MAX_COUNTRIES_PAGE_SIZE = 100;
export const LOCALES = ["zh-CN", "en"] as const satisfies readonly Locale[];
export const TEXT_MODES = ["localized", "raw"] as const satisfies readonly TextMode[];

export interface ParseCountryQueryInput {
  acceptLanguage?: string | null | undefined;
  searchParams: URLSearchParams;
}

export interface ApiCountryQuery {
  errors: Record<string, string>;
  filters: CountryFilters;
  textMode: TextMode;
}

function splitCsv(value: string | null): string[] {
  return value
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean) ?? [];
}

function parseEnum<T extends string>(
  value: string | null,
  allowed: readonly T[],
): T | undefined {
  if (value === null || value.trim() === "") {
    return undefined;
  }

  return allowed.includes(value as T) ? (value as T) : undefined;
}

function parseEnumList<T extends string>(
  value: string | null,
  allowed: readonly T[],
): T[] {
  return splitCsv(value).filter((item): item is T => allowed.includes(item as T));
}

function parsePositiveInteger(
  value: string | null,
  fallback: number,
  max?: number,
): number {
  if (value === null || value.trim() === "") {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return max === undefined ? parsed : Math.min(parsed, max);
}

export function resolveCountryLocale({
  acceptLanguage,
  searchParams,
}: ParseCountryQueryInput): Locale {
  const queryLocale = parseEnum<Locale>(searchParams.get("locale"), LOCALES);
  if (queryLocale !== undefined) {
    return queryLocale;
  }

  for (const item of (acceptLanguage ?? "").split(",")) {
    const language = item.split(";")[0]?.trim().toLowerCase();
    if (language === "en" || language?.startsWith("en-")) {
      return "en";
    }
    if (
      language === "zh" ||
      language === "zh-cn" ||
      language?.startsWith("zh-")
    ) {
      return "zh-CN";
    }
  }

  return "zh-CN";
}

export function parseCountryFilters(input: ParseCountryQueryInput): CountryFilters {
  const { searchParams } = input;

  return {
    coverageLevel: parseEnum<CoverageLevel>(
      searchParams.get("coverageLevel"),
      COVERAGE_LEVELS,
    ),
    industryTags: parseEnumList<IndustryTag>(
      searchParams.get("industryTags"),
      INDUSTRY_TAGS,
    ),
    locale: resolveCountryLocale(input),
    page: parsePositiveInteger(searchParams.get("page"), 1),
    pageSize: parsePositiveInteger(
      searchParams.get("pageSize"),
      20,
      MAX_COUNTRIES_PAGE_SIZE,
    ),
    region: parseEnum<Region>(searchParams.get("region"), REGIONS),
    techTags: parseEnumList<TechTag>(
      searchParams.get("techTags"),
      TECH_TAGS,
    ),
  };
}

export function parseApiCountryQuery(input: ParseCountryQueryInput): ApiCountryQuery {
  const errors = getCountryQueryValidationErrors(input.searchParams);
  const textMode = parseEnum<TextMode>(
    input.searchParams.get("textMode"),
    TEXT_MODES,
  );

  return {
    errors,
    filters: parseCountryFilters(input),
    textMode: textMode ?? "localized",
  };
}

export function parseCountryCodeParam(code: string): string {
  return code.trim().toUpperCase();
}

export function parseModuleKeyParam(value: string): ModuleKey | null {
  return (MODULE_KEYS as readonly string[]).includes(value)
    ? (value as ModuleKey)
    : null;
}

export function getCountryQueryValidationErrors(
  searchParams: URLSearchParams,
): Record<string, string> {
  const errors: Record<string, string> = {};

  addInvalidEnumError(errors, searchParams, "coverageLevel", COVERAGE_LEVELS);
  addInvalidEnumError(errors, searchParams, "locale", LOCALES);
  addInvalidEnumError(errors, searchParams, "region", REGIONS);
  addInvalidEnumListError(
    errors,
    searchParams,
    "industryTags",
    INDUSTRY_TAGS,
  );
  addInvalidEnumListError(errors, searchParams, "techTags", TECH_TAGS);
  addInvalidEnumError(errors, searchParams, "textMode", TEXT_MODES);
  addInvalidPositiveIntegerError(errors, searchParams, "page");
  addInvalidPositiveIntegerError(errors, searchParams, "pageSize");

  return errors;
}

function addInvalidEnumError<T extends string>(
  errors: Record<string, string>,
  searchParams: URLSearchParams,
  key: string,
  allowed: readonly T[],
): void {
  const value = searchParams.get(key);
  if (value === null || value.trim() === "") {
    return;
  }

  if (!allowed.includes(value as T)) {
    errors[key] = value;
  }
}

function addInvalidEnumListError<T extends string>(
  errors: Record<string, string>,
  searchParams: URLSearchParams,
  key: string,
  allowed: readonly T[],
): void {
  const rawValue = searchParams.get(key);
  if (rawValue === null || rawValue.trim() === "") {
    return;
  }

  if (splitCsv(rawValue).some((value) => !allowed.includes(value as T))) {
    errors[key] = rawValue;
  }
}

function addInvalidPositiveIntegerError(
  errors: Record<string, string>,
  searchParams: URLSearchParams,
  key: string,
): void {
  const value = searchParams.get(key);
  if (value === null || value.trim() === "") {
    return;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    errors[key] = value;
  }
}
