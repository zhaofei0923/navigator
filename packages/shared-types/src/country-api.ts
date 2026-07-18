import type {
  CoverageLevel,
  IndustryTag,
  Locale,
  ModuleCoverageStatus,
  ModuleKey,
  Region,
  TechTag,
} from "./schema.js";
import type { LocalizedText } from "./i18n.js";

export type JsonPrimitive = boolean | null | number | string;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export interface CountryDataSnapshot {
  readonly country: JsonObject;
  readonly marketOverview: JsonObject | null;
  readonly policy: readonly JsonObject[];
  readonly risk: readonly JsonObject[];
  readonly opportunities: readonly JsonObject[];
  readonly projects: readonly JsonObject[];
  readonly partners: readonly JsonObject[];
  readonly chineseCompanies: readonly JsonObject[];
  readonly entryStrategy: JsonObject | null;
  readonly reports: readonly JsonObject[];
  readonly knowledge: readonly JsonObject[];
}

export interface CountryReadRepository {
  list(): Promise<readonly CountryDataSnapshot[]>;
  findByCode(code: string): Promise<CountryDataSnapshot | null>;
}

export type TextMode = "localized" | "raw";

export interface CountryModuleCoverageSummary {
  moduleKey: ModuleKey;
  status: ModuleCoverageStatus;
  dataCount: number;
  updatedAt: string;
}

export type SignalLevel = "HIGH" | "MEDIUM" | "LOW" | "DATA_BUILDING";
export type RecommendedPriority =
  | "PRIORITY"
  | "WATCH"
  | "EXPLORE"
  | "DATA_BUILDING";

export interface CountrySignalsBase {
  opportunityLevel: SignalLevel;
  policyFriendliness: SignalLevel;
  recommendedPriority: RecommendedPriority;
  riskLevel: SignalLevel;
  sourceCount: number;
  sources: string[];
  updatedAt: string;
}

export interface RawCountrySignals extends CountrySignalsBase {
  recommendedEntryMode: LocalizedText | null;
}

export interface LocalizedCountrySignals extends CountrySignalsBase {
  recommendedEntryMode: string | null;
}

export interface CountryCatalogItem {
  code: string;
  coverageLevel: CoverageLevel;
  flagEmoji: string;
  industryTags: IndustryTag[];
  moduleCoverage: CountryModuleCoverageSummary[];
  name: LocalizedText;
  region: Region;
  signals: RawCountrySignals;
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
  signals: LocalizedCountrySignals;
  summary: string;
  updatedAt: string;
  _i18nFallback: string[];
}

export interface RawCountryCard
  extends Omit<
    LocalizedCountryCard,
    "name" | "signals" | "summary" | "_i18nFallback"
  > {
  name: LocalizedText;
  signals: RawCountrySignals;
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

export interface ModuleResponseRecord {
  [key: string]: JsonValue | undefined;
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
