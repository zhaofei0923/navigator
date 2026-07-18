import {
  buildCountryCatalog,
  buildCountrySignals as buildSharedCountrySignals,
  filterCountryCatalog as filterSharedCountryCatalog,
  formatBuildingModuleResponse,
  formatCountriesResponse,
  formatCountryDetailResponse,
  formatCountryModuleResponse,
  getCountryFilterOptions,
  localizeCountryCard as localizeSharedCountryCard,
  rawCountryCard as rawSharedCountryCard,
} from "@navigator/shared-types/country-formatter";
import { parseCountryCodeParam } from "@navigator/shared-types/country-query";
import type {
  CountriesResponse,
  CountryCatalogItem,
  CountryDataSnapshot,
  CountryDetailFilters,
  CountryDetailResponse,
  CountryFilters,
  CountryModuleFilters,
  CountryModuleResponse,
  CountryReadRepository,
  JsonObject,
  LocalizedCountriesResponse,
  LocalizedCountryCard,
  LocalizedCountryDetailResponse,
  LocalizedCountryModuleResponse,
  RawCountriesResponse,
  RawCountryCard,
  RawCountryDetailResponse,
  RawCountryModuleResponse,
  RawCountrySignals,
  TextMode,
} from "@navigator/shared-types/country-api";
import type { Locale, ModuleCoverageStatus, ModuleKey } from "@navigator/shared-types/schema";

import {
  countrySeedBundles,
  type CountryModuleDataSeed,
  type CountryModuleRecord,
  type CountrySeedBundle,
} from "./country-seed-registry";

export type {
  CountriesResponse,
  CountryCatalogItem,
  CountryDetailFilters,
  CountryDetailResponse,
  CountryFilterOptions,
  CountryFilters,
  CountryModuleCoverageSummary,
  CountryModuleFilters,
  CountryModuleResponse,
  CountrySignalsBase,
  LocalizedCountriesResponse,
  LocalizedCountryCard,
  LocalizedCountryDetail,
  LocalizedCountryDetailResponse,
  LocalizedCountryModulePayload,
  LocalizedCountryModuleResponse,
  LocalizedCountrySignals,
  ModuleResponseRecord,
  RawCountriesResponse,
  RawCountryCard,
  RawCountryDetail,
  RawCountryDetailResponse,
  RawCountryModulePayload,
  RawCountryModuleResponse,
  RawCountrySignals,
  RecommendedPriority,
  SignalLevel,
  TextMode,
} from "@navigator/shared-types/country-api";

function asJsonObject(record: CountryModuleRecord): JsonObject {
  return record as unknown as JsonObject;
}

function asJsonObjectList(data: CountryModuleDataSeed): readonly JsonObject[] {
  if (data === null) {
    return [];
  }
  if (Array.isArray(data)) {
    return data.map(asJsonObject);
  }
  return [asJsonObject(data as CountryModuleRecord)];
}

function asJsonObjectOrNull(data: CountryModuleDataSeed): JsonObject | null {
  return asJsonObjectList(data)[0] ?? null;
}

function toCountrySnapshot(bundle: CountrySeedBundle): CountryDataSnapshot {
  return {
    chineseCompanies: asJsonObjectList(bundle.moduleData["chinese-companies"]),
    country: bundle.country as unknown as JsonObject,
    entryStrategy: asJsonObjectOrNull(bundle.moduleData["entry-strategy"]),
    knowledge: asJsonObjectList(bundle.moduleData["ai-advisor"]),
    marketOverview: asJsonObjectOrNull(bundle.moduleData["market-overview"]),
    opportunities: asJsonObjectList(bundle.moduleData.opportunities),
    partners: asJsonObjectList(bundle.moduleData.partners),
    policy: asJsonObjectList(bundle.moduleData.policy),
    projects: asJsonObjectList(bundle.moduleData.projects),
    reports: asJsonObjectList(bundle.moduleData.reports),
    risk: asJsonObjectList(bundle.moduleData.risk),
  };
}

const countrySnapshots = countrySeedBundles.map(toCountrySnapshot);

function findCountrySnapshot(code: string): CountryDataSnapshot | null {
  const normalizedCode = parseCountryCodeParam(code);
  return (
    countrySnapshots.find(
      (snapshot) => snapshot.country.code === normalizedCode,
    ) ?? null
  );
}

export const countryReadRepository: CountryReadRepository = {
  async findByCode(code) {
    return findCountrySnapshot(code);
  },
  async list() {
    return countrySnapshots;
  },
};

export function buildCountrySignals(bundle: CountrySeedBundle): RawCountrySignals {
  return buildSharedCountrySignals(toCountrySnapshot(bundle));
}

export const countryCatalog = buildCountryCatalog(countrySnapshots);

export function filterCountryCatalog(
  filters: CountryFilters = {},
): CountryCatalogItem[] {
  return filterSharedCountryCatalog(countryCatalog, filters);
}

export function localizeCountryCard(
  country: CountryCatalogItem,
  locale: Locale,
): LocalizedCountryCard {
  return localizeSharedCountryCard(country, locale);
}

export function rawCountryCard(country: CountryCatalogItem): RawCountryCard {
  return rawSharedCountryCard(country);
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
  return formatCountryDetailResponse(
    findCountrySnapshot(code),
    filters,
    textMode,
  );
}

export function buildBuildingModuleResponse(
  moduleKey: ModuleKey,
  status: ModuleCoverageStatus,
  locale: Locale,
  page: number,
  pageSize: number,
  textMode: TextMode,
): CountryModuleResponse {
  return formatBuildingModuleResponse(
    moduleKey,
    status,
    locale,
    page,
    pageSize,
    textMode,
  );
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
  return formatCountryModuleResponse(
    findCountrySnapshot(code),
    moduleKey,
    filters,
    textMode,
  );
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
  return formatCountriesResponse(countrySnapshots, filters, textMode);
}

export function getFilterOptions() {
  return getCountryFilterOptions(countrySnapshots);
}
