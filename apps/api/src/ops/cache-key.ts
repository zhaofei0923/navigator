import {
  type CountryDetailFilters,
  type CountryFilters,
  type CountryModuleFilters,
  type TextMode,
  type formatCountryModuleResponse,
} from "@navigator/shared-types/country-runtime";

const COUNTRY_CACHE_KEY_VERSION = "navigator-country-cache-v1";
const DEFAULT_LOCALE = "zh-CN";
const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;

export type CountryModuleKey = Parameters<
  typeof formatCountryModuleResponse
>[1];

export type CountryCacheKeyOwnership =
  | { readonly route: "list" }
  | {
      readonly route: "detail" | "module";
      readonly countryCode: string;
    };

function canonicalizeTags<T extends string>(tags: readonly T[] | undefined): T[] {
  return [...new Set(tags ?? [])].sort();
}

function normalizeCountryCode(code: string): string {
  return code.trim().toUpperCase();
}

export function buildCountryListCacheKey(
  filters: CountryFilters,
  textMode: TextMode,
): string {
  return JSON.stringify([
    COUNTRY_CACHE_KEY_VERSION,
    "list",
    filters.coverageLevel ?? null,
    canonicalizeTags(filters.industryTags),
    filters.locale ?? DEFAULT_LOCALE,
    filters.page ?? DEFAULT_PAGE,
    filters.pageSize ?? DEFAULT_PAGE_SIZE,
    filters.region ?? null,
    canonicalizeTags(filters.techTags),
    textMode,
  ]);
}

export function buildCountryDetailCacheKey(
  code: string,
  filters: CountryDetailFilters,
  textMode: TextMode,
): string {
  return JSON.stringify([
    COUNTRY_CACHE_KEY_VERSION,
    "detail",
    normalizeCountryCode(code),
    filters.locale ?? DEFAULT_LOCALE,
    textMode,
  ]);
}

export function buildCountryModuleCacheKey(
  code: string,
  moduleKey: CountryModuleKey,
  filters: CountryModuleFilters,
  textMode: TextMode,
): string {
  return JSON.stringify([
    COUNTRY_CACHE_KEY_VERSION,
    "module",
    normalizeCountryCode(code),
    moduleKey,
    filters.locale ?? DEFAULT_LOCALE,
    filters.page ?? DEFAULT_PAGE,
    filters.pageSize ?? DEFAULT_PAGE_SIZE,
    textMode,
  ]);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isCanonicalStringList(
  value: unknown,
): value is string[] {
  if (!Array.isArray(value)) {
    return false;
  }

  return value.every(
    (tag, index) =>
      typeof tag === "string" &&
      (index === 0 || (value[index - 1] as string) < tag),
  );
}

function isNormalizedCountryCode(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value === normalizeCountryCode(value)
  );
}

function isListKeyTuple(value: readonly unknown[]): boolean {
  return (
    value.length === 10 &&
    value[0] === COUNTRY_CACHE_KEY_VERSION &&
    value[1] === "list" &&
    isNullableString(value[2]) &&
    isCanonicalStringList(value[3]) &&
    typeof value[4] === "string" &&
    isPositiveInteger(value[5]) &&
    isPositiveInteger(value[6]) &&
    isNullableString(value[7]) &&
    isCanonicalStringList(value[8]) &&
    typeof value[9] === "string"
  );
}

function isDetailKeyTuple(value: readonly unknown[]): boolean {
  return (
    value.length === 5 &&
    value[0] === COUNTRY_CACHE_KEY_VERSION &&
    value[1] === "detail" &&
    isNormalizedCountryCode(value[2]) &&
    typeof value[3] === "string" &&
    typeof value[4] === "string"
  );
}

function isModuleKeyTuple(value: readonly unknown[]): boolean {
  return (
    value.length === 8 &&
    value[0] === COUNTRY_CACHE_KEY_VERSION &&
    value[1] === "module" &&
    isNormalizedCountryCode(value[2]) &&
    typeof value[3] === "string" &&
    typeof value[4] === "string" &&
    isPositiveInteger(value[5]) &&
    isPositiveInteger(value[6]) &&
    typeof value[7] === "string"
  );
}

export function getCountryCacheKeyOwnership(
  key: string,
): CountryCacheKeyOwnership | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(key) as unknown;
  } catch {
    return null;
  }

  if (!Array.isArray(parsed)) {
    return null;
  }
  if (isListKeyTuple(parsed)) {
    return { route: "list" };
  }
  if (isDetailKeyTuple(parsed)) {
    return { countryCode: parsed[2] as string, route: "detail" };
  }
  if (isModuleKeyTuple(parsed)) {
    return { countryCode: parsed[2] as string, route: "module" };
  }

  return null;
}
