import {
  parseApiCountryQuery as parseSharedApiCountryQuery,
  parseCountryFilters as parseSharedCountryFilters,
  type ApiCountryQuery,
} from "@navigator/shared-types/country-query";
import type { CountryFilters } from "@navigator/shared-types/country-api";
import type { Locale } from "@navigator/shared-types/schema";

export {
  LOCALES,
  MAX_COUNTRIES_PAGE_SIZE,
  TEXT_MODES,
  getCountryQueryValidationErrors,
  parseCountryCodeParam,
  parseModuleKeyParam,
  resolveCountryLocale,
  type ApiCountryQuery,
  type ParseCountryQueryInput,
} from "@navigator/shared-types/country-query";

interface ParseWebCountryQueryInput {
  locale?: Locale | undefined;
  searchParams: URLSearchParams;
}

function toSharedInput({
  locale,
  searchParams,
}: ParseWebCountryQueryInput) {
  return {
    acceptLanguage: locale,
    searchParams,
  };
}

export function parseCountryFilters(
  input: ParseWebCountryQueryInput,
): CountryFilters {
  return parseSharedCountryFilters(toSharedInput(input));
}

export function parseApiCountryQuery(
  input: ParseWebCountryQueryInput,
): ApiCountryQuery {
  return parseSharedApiCountryQuery(toSharedInput(input));
}
