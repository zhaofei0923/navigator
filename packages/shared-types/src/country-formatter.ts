import {
  COVERAGE_LEVELS,
  INDUSTRY_TAGS,
  MODULE_COVERAGE_STATUSES,
  MODULE_KEYS,
  REGIONS,
  TECH_TAGS,
  type CoverageLevel,
  type Credibility,
  type IndustryTag,
  type Locale,
  type ModuleCoverageStatus,
  type ModuleKey,
  type Region,
  type TechTag,
} from "./schema.js";
import { pickLocale, type LocalizedText } from "./i18n.js";
import type {
  CountriesResponse,
  CountryCatalogItem,
  CountryDataSnapshot,
  CountryDetailFilters,
  CountryDetailResponse,
  CountryFilterOptions,
  CountryFilters,
  CountryModuleCoverageSummary,
  CountryModuleFilters,
  CountryModuleResponse,
  JsonObject,
  JsonValue,
  LocalizedCountriesResponse,
  LocalizedCountryCard,
  LocalizedCountryDetailResponse,
  LocalizedCountryModuleResponse,
  ModuleResponseRecord,
  RawCountriesResponse,
  RawCountryCard,
  RawCountryDetailResponse,
  RawCountryModuleResponse,
  RawCountrySignals,
  RecommendedPriority,
  SignalLevel,
  TextMode,
} from "./country-api.js";

const OBJECT_MODULE_KEYS = [
  "market-overview",
  "entry-strategy",
] as const satisfies readonly ModuleKey[];
const PUBLIC_CREDIBILITIES = [
  "OFFICIAL",
  "VERIFIED",
  "ESTIMATED",
] as const satisfies readonly Credibility[];
const MAX_MODULE_PAGE_SIZE = 100;

const COMMON_PUBLIC_RESPONSE_KEYS: ReadonlySet<string> = new Set([
  "aiUsable",
  "collectedAt",
  "countryCode",
  "credibility",
  "id",
  "industryTags",
  "reviewStatus",
  "source",
  "sourceUrl",
  "techTags",
  "updatedAt",
]);

const MODULE_PUBLIC_RESPONSE_KEYS = {
  "ai-advisor": new Set([
    "content",
    "sourceId",
    "sourceModule",
    "usableChunkCount",
    "usableSourceModules",
  ]),
  "chinese-companies": new Set([
    "businessScope",
    "caseStudy",
    "entryYear",
    "industry",
    "name",
  ]),
  "entry-strategy": new Set(["overview", "recommendedMode", "steps"]),
  "market-overview": new Set([
    "energyDemand",
    "gdp",
    "gdpGrowth",
    "keyIndicators",
    "overview",
    "population",
    "renewableTarget",
  ]),
  opportunities: new Set([
    "description",
    "marketSize",
    "timeWindow",
    "title",
  ]),
  partners: new Set(["contactHint", "description", "name", "partnerType"]),
  policy: new Set([
    "authority",
    "body",
    "effectiveDate",
    "policyType",
    "summary",
    "title",
  ]),
  projects: new Set([
    "capacity",
    "description",
    "investment",
    "location",
    "name",
    "status",
  ]),
  reports: new Set(["abstract", "accessLevel", "publishedAt", "title"]),
  risk: new Set([
    "category",
    "description",
    "level",
    "mitigation",
    "title",
  ]),
} satisfies Readonly<Record<ModuleKey, ReadonlySet<string>>>;

export const COUNTRY_REGION_DISPLAY_ORDER = [
  "southeast-asia",
  "south-asia",
  "middle-east",
  "central-asia",
  "europe",
  "latin-america",
  "africa",
] as const satisfies readonly Region[];

const SENSITIVE_RESPONSE_KEYS = new Set([
  "approvalDecision",
  "approvalStatus",
  "approvedAt",
  "approvedBy",
  "artifactSha256",
  "artifacts",
  "authorizedPublication",
  "boundaryVerdict",
  "cachePath",
  "collectionManifest",
  "constructor",
  "decidedAt",
  "decision",
  "embeddingEn",
  "embeddingZh",
  "extractedFacts",
  "fileUrl",
  "humanDecision",
  "publicationManifest",
  "prototype",
  "rawCache",
  "reviewerId",
  "reviewReport",
  "sourceRegister",
  "stages",
  "submission",
  "__proto__",
]);

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getString(record: JsonObject, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function getNumber(record: JsonObject, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" ? value : undefined;
}

function getArray(record: JsonObject, key: string): readonly JsonValue[] {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

function requireString(record: JsonObject, key: string): string {
  const value = getString(record, key);
  if (value === undefined) {
    throw new Error(`Invalid country snapshot: ${key}`);
  }
  return value;
}

function requireEnum<T extends string>(
  record: JsonObject,
  key: string,
  allowed: readonly T[],
): T {
  const value = requireString(record, key);
  if (!allowed.includes(value as T)) {
    throw new Error(`Invalid country snapshot: ${key}`);
  }
  return value as T;
}

function toLocalizedText(value: JsonValue | undefined): LocalizedText | undefined {
  if (!isJsonObject(value)) {
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

function requireLocalizedText(record: JsonObject, key: string): LocalizedText {
  const value = toLocalizedText(record[key]);
  if (value === undefined) {
    throw new Error(`Invalid country snapshot: ${key}`);
  }
  return value;
}

function isPublicCredibility(
  value: JsonValue | undefined,
): value is (typeof PUBLIC_CREDIBILITIES)[number] {
  return (
    typeof value === "string" &&
    (PUBLIC_CREDIBILITIES as readonly string[]).includes(value)
  );
}

function isPublicCountryRecord(record: JsonObject, countryCode: string): boolean {
  return (
    record.countryCode === countryCode &&
    record.reviewStatus === "published" &&
    isPublicCredibility(record.credibility)
  );
}

function getModuleRecords(
  snapshot: CountryDataSnapshot,
  moduleKey: ModuleKey,
): readonly JsonObject[] {
  switch (moduleKey) {
    case "market-overview":
      return snapshot.marketOverview === null ? [] : [snapshot.marketOverview];
    case "policy":
      return snapshot.policy;
    case "risk":
      return snapshot.risk;
    case "opportunities":
      return snapshot.opportunities;
    case "projects":
      return snapshot.projects;
    case "partners":
      return snapshot.partners;
    case "chinese-companies":
      return snapshot.chineseCompanies;
    case "entry-strategy":
      return snapshot.entryStrategy === null ? [] : [snapshot.entryStrategy];
    case "ai-advisor":
      return snapshot.knowledge;
    case "reports":
      return snapshot.reports;
  }
}

function allSnapshotRecords(snapshot: CountryDataSnapshot): readonly JsonObject[] {
  return MODULE_KEYS.flatMap((moduleKey) => getModuleRecords(snapshot, moduleKey));
}

function getPublicModuleRecords(
  snapshot: CountryDataSnapshot,
  moduleKey: ModuleKey,
): JsonObject[] {
  const countryCode = requireString(snapshot.country, "code");

  return getModuleRecords(snapshot, moduleKey).filter((record) => {
    if (!isPublicCountryRecord(record, countryCode)) {
      return false;
    }
    return moduleKey !== "ai-advisor" || record.aiUsable === true;
  });
}

function collectTags<TTag extends string>(
  snapshot: CountryDataSnapshot,
  field: "industryTags" | "techTags",
  allowed: readonly TTag[],
): TTag[] {
  const countryCode = requireString(snapshot.country, "code");
  const found = new Set<TTag>();

  for (const record of allSnapshotRecords(snapshot)) {
    if (!isPublicCountryRecord(record, countryCode)) {
      continue;
    }
    for (const value of getArray(record, field)) {
      if (typeof value === "string" && allowed.includes(value as TTag)) {
        found.add(value as TTag);
      }
    }
  }

  return [...allowed].filter((tag) => found.has(tag));
}

function newestIsoDate(records: readonly JsonObject[], fallback: string): string {
  let newest = fallback;
  let newestTime = Date.parse(fallback);

  for (const record of records) {
    const updatedAt = getString(record, "updatedAt");
    if (updatedAt === undefined) {
      continue;
    }
    const time = Date.parse(updatedAt);
    if (!Number.isNaN(time) && time > newestTime) {
      newest = updatedAt;
      newestTime = time;
    }
  }

  return newest;
}

function uniqueSources(records: readonly JsonObject[]): string[] {
  return [
    ...new Set(
      records
        .map((record) => getString(record, "source"))
        .filter((source): source is string => source !== undefined),
    ),
  ];
}

function deriveOpportunityLevel(
  opportunities: readonly JsonObject[],
  projects: readonly JsonObject[],
): SignalLevel {
  const evidenceCount = opportunities.length + projects.length;
  if (evidenceCount === 0) {
    return "DATA_BUILDING";
  }
  if (opportunities.length >= 5 || evidenceCount >= 8) {
    return "HIGH";
  }
  return "MEDIUM";
}

function deriveRiskLevel(risks: readonly JsonObject[]): SignalLevel {
  if (risks.length === 0) {
    return "DATA_BUILDING";
  }
  const levels = risks.map((risk) => getString(risk, "level"));
  if (levels.includes("HIGH")) {
    return "HIGH";
  }
  if (levels.includes("MEDIUM")) {
    return "MEDIUM";
  }
  return "LOW";
}

function derivePolicyFriendliness(policies: readonly JsonObject[]): SignalLevel {
  if (policies.length === 0) {
    return "DATA_BUILDING";
  }
  const supportiveCount = policies.filter((policy) => {
    const policyType = getString(policy, "policyType");
    return policyType === "incentive" || policyType === "tax";
  }).length;
  const restrictiveCount = policies.filter((policy) => {
    const policyType = getString(policy, "policyType");
    return (
      policyType === "import-export" ||
      policyType === "localization" ||
      policyType === "permit" ||
      policyType === "tariff"
    );
  }).length;

  if (supportiveCount >= 2 && restrictiveCount <= 1) {
    return "HIGH";
  }
  if (supportiveCount >= 1 || policies.length >= 3) {
    return "MEDIUM";
  }
  return "LOW";
}

function deriveRecommendedPriority(
  coverageLevel: CoverageLevel,
  opportunityLevel: SignalLevel,
  riskLevel: SignalLevel,
): RecommendedPriority {
  if (riskLevel === "HIGH") {
    return "EXPLORE";
  }
  if (opportunityLevel === "DATA_BUILDING" || riskLevel === "DATA_BUILDING") {
    return "DATA_BUILDING";
  }
  if (
    opportunityLevel === "HIGH" &&
    (coverageLevel === "STANDARD" || coverageLevel === "COMPLETE")
  ) {
    return "PRIORITY";
  }
  if (opportunityLevel === "HIGH" || opportunityLevel === "MEDIUM") {
    return "WATCH";
  }
  return "EXPLORE";
}

export function buildCountrySignals(snapshot: CountryDataSnapshot): RawCountrySignals {
  const opportunities = getPublicModuleRecords(snapshot, "opportunities");
  const projects = getPublicModuleRecords(snapshot, "projects");
  const risks = getPublicModuleRecords(snapshot, "risk");
  const policies = getPublicModuleRecords(snapshot, "policy");
  const entryStrategies = getPublicModuleRecords(snapshot, "entry-strategy");
  const signalRecords = [
    ...opportunities,
    ...projects,
    ...risks,
    ...policies,
    ...entryStrategies,
  ];
  const opportunityLevel = deriveOpportunityLevel(opportunities, projects);
  const riskLevel = deriveRiskLevel(risks);
  const entryMode = toLocalizedText(entryStrategies[0]?.recommendedMode);
  const coverageLevel = requireEnum(
    snapshot.country,
    "coverageLevel",
    COVERAGE_LEVELS,
  );

  return {
    opportunityLevel,
    policyFriendliness: derivePolicyFriendliness(policies),
    recommendedEntryMode: entryMode ?? null,
    recommendedPriority: deriveRecommendedPriority(
      coverageLevel,
      opportunityLevel,
      riskLevel,
    ),
    riskLevel,
    sourceCount: uniqueSources(signalRecords).length,
    sources: uniqueSources(signalRecords),
    updatedAt: newestIsoDate(
      signalRecords,
      requireString(snapshot.country, "updatedAt"),
    ),
  };
}

function normalizeModuleCoverage(
  snapshot: CountryDataSnapshot,
): CountryModuleCoverageSummary[] {
  const country = snapshot.country;
  const coverageRecords = getArray(country, "moduleCoverage").filter(isJsonObject);

  return MODULE_KEYS.map((moduleKey) => {
    const record = coverageRecords.find((item) => item.moduleKey === moduleKey);
    if (record === undefined) {
      return {
        dataCount: 0,
        moduleKey,
        status: "BUILDING",
        updatedAt: requireString(country, "updatedAt"),
      };
    }

    return {
      dataCount: getNumber(record, "dataCount") ?? 0,
      moduleKey,
      status: requireEnum(record, "status", MODULE_COVERAGE_STATUSES),
      updatedAt: getString(record, "updatedAt") ?? requireString(country, "updatedAt"),
    };
  });
}

export function buildCountryCatalogItem(
  snapshot: CountryDataSnapshot,
): CountryCatalogItem {
  const country = snapshot.country;

  return {
    code: requireString(country, "code"),
    coverageLevel: requireEnum(country, "coverageLevel", COVERAGE_LEVELS),
    flagEmoji: requireString(country, "flagEmoji"),
    industryTags: collectTags(snapshot, "industryTags", INDUSTRY_TAGS),
    moduleCoverage: normalizeModuleCoverage(snapshot),
    name: requireLocalizedText(country, "name"),
    region: requireEnum(country, "region", REGIONS),
    signals: buildCountrySignals(snapshot),
    summary: requireLocalizedText(country, "summary"),
    techTags: collectTags(snapshot, "techTags", TECH_TAGS),
    updatedAt: requireString(country, "updatedAt"),
  };
}

function compareCatalogItems(a: CountryCatalogItem, b: CountryCatalogItem): number {
  const regionDifference =
    COUNTRY_REGION_DISPLAY_ORDER.indexOf(a.region) -
    COUNTRY_REGION_DISPLAY_ORDER.indexOf(b.region);
  if (regionDifference !== 0) {
    return regionDifference;
  }

  const nameDifference = a.name.en.localeCompare(b.name.en, "en");
  if (nameDifference !== 0) {
    return nameDifference;
  }

  return a.code.localeCompare(b.code, "en");
}

export function sortCountrySnapshots(
  snapshots: readonly CountryDataSnapshot[],
): CountryDataSnapshot[] {
  return snapshots
    .map((snapshot) => ({ catalog: buildCountryCatalogItem(snapshot), snapshot }))
    .sort((a, b) => compareCatalogItems(a.catalog, b.catalog))
    .map(({ snapshot }) => snapshot);
}

export function buildCountryCatalog(
  snapshots: readonly CountryDataSnapshot[],
): CountryCatalogItem[] {
  return snapshots.map(buildCountryCatalogItem).sort(compareCatalogItems);
}

function includesEvery<T extends string>(
  values: readonly T[],
  filters: readonly T[],
): boolean {
  return filters.every((filter) => values.includes(filter));
}

export function filterCountryCatalog(
  catalog: readonly CountryCatalogItem[],
  filters: CountryFilters = {},
): CountryCatalogItem[] {
  const industryTags = filters.industryTags ?? [];
  const techTags = filters.techTags ?? [];

  return catalog.filter((country) => {
    if (
      filters.coverageLevel !== undefined &&
      country.coverageLevel !== filters.coverageLevel
    ) {
      return false;
    }
    if (filters.region !== undefined && country.region !== filters.region) {
      return false;
    }
    return (
      includesEvery(country.industryTags, industryTags) &&
      includesEvery(country.techTags, techTags)
    );
  });
}

export function localizeCountryCard(
  country: CountryCatalogItem,
  locale: Locale,
): LocalizedCountryCard {
  const name = pickLocale(country.name, locale);
  const summary = pickLocale(country.summary, locale);
  const recommendedEntryMode =
    country.signals.recommendedEntryMode === null
      ? null
      : pickLocale(country.signals.recommendedEntryMode, locale);
  const fallbackFields = [
    name.fallback ? "name" : undefined,
    summary.fallback ? "summary" : undefined,
    recommendedEntryMode?.fallback
      ? "signals.recommendedEntryMode"
      : undefined,
  ].filter((field): field is string => field !== undefined);

  return {
    code: country.code,
    coverageLevel: country.coverageLevel,
    flagEmoji: country.flagEmoji,
    moduleCoverage: [...country.moduleCoverage],
    name: name.value,
    region: country.region,
    signals: {
      ...country.signals,
      recommendedEntryMode: recommendedEntryMode?.value ?? null,
      sources: [...country.signals.sources],
    },
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
    name: { ...country.name },
    region: country.region,
    signals: {
      ...country.signals,
      recommendedEntryMode:
        country.signals.recommendedEntryMode === null
          ? null
          : { ...country.signals.recommendedEntryMode },
      sources: [...country.signals.sources],
    },
    summary: { ...country.summary },
    updatedAt: country.updatedAt,
  };
}

function getModuleCoverage(
  country: CountryCatalogItem,
  moduleKey: ModuleKey,
): CountryModuleCoverageSummary {
  return (
    country.moduleCoverage.find((item) => item.moduleKey === moduleKey) ?? {
      dataCount: 0,
      moduleKey,
      status: "BUILDING",
      updatedAt: country.updatedAt,
    }
  );
}

function isObjectModule(moduleKey: ModuleKey): boolean {
  return (OBJECT_MODULE_KEYS as readonly ModuleKey[]).includes(moduleKey);
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && value !== undefined && value > 0
    ? value
    : fallback;
}

function normalizePageInput(filters: CountryModuleFilters): {
  page: number;
  pageSize: number;
} {
  return {
    page: normalizePositiveInteger(filters.page, 1),
    pageSize: Math.min(
      normalizePositiveInteger(filters.pageSize, 20),
      MAX_MODULE_PAGE_SIZE,
    ),
  };
}

function sanitizeJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(sanitizeJsonValue);
  }
  if (isJsonObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !SENSITIVE_RESPONSE_KEYS.has(key))
        .map(([key, childValue]) => [key, sanitizeJsonValue(childValue)]),
    );
  }
  return value;
}

function sanitizeModuleRecord(
  record: JsonObject,
  moduleKey: ModuleKey,
): JsonObject {
  const isReadinessRecord =
    moduleKey === "ai-advisor" && record.id === "ai-advisor-readiness";

  return Object.fromEntries(
    Object.entries(record)
      .filter(([key]) => {
        if (
          !COMMON_PUBLIC_RESPONSE_KEYS.has(key) &&
          !MODULE_PUBLIC_RESPONSE_KEYS[moduleKey].has(key)
        ) {
          return false;
        }
        return moduleKey !== "ai-advisor" || key !== "content" || isReadinessRecord;
      })
      .map(([key, value]) => [key, sanitizeJsonValue(value)]),
  );
}

function localizeValue(
  value: JsonValue,
  locale: Locale,
  path: string,
  fallbackFields: string[],
): JsonValue {
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
  if (isJsonObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, childValue]) => {
        const childPath = path === "" ? key : `${path}.${key}`;
        return [
          key,
          localizeValue(childValue, locale, childPath, fallbackFields),
        ];
      }),
    );
  }
  return value;
}

function localizeModuleRecord(
  record: JsonObject,
  locale: Locale,
  moduleKey: ModuleKey,
  path: string,
  fallbackFields: string[],
): ModuleResponseRecord {
  const localized = localizeValue(
    sanitizeModuleRecord(record, moduleKey),
    locale,
    path,
    fallbackFields,
  );
  if (!isJsonObject(localized)) {
    throw new Error("Invalid country snapshot: localized module record");
  }
  return localized;
}

function buildAiAdvisorSummaryRecords(records: readonly JsonObject[]): JsonObject[] {
  const sourceModules = [
    ...new Set(
      records
        .map((record) => getString(record, "sourceModule"))
        .filter(
          (value): value is ModuleKey =>
            value !== undefined && MODULE_KEYS.includes(value as ModuleKey),
        ),
    ),
  ];
  const firstRecord = records[0];
  const summary: Record<string, JsonValue> = {
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

  if (firstRecord !== undefined) {
    const countryCode = getString(firstRecord, "countryCode");
    const updatedAt = getString(firstRecord, "updatedAt");
    if (countryCode !== undefined) {
      summary.countryCode = countryCode;
    }
    if (updatedAt !== undefined) {
      summary.updatedAt = updatedAt;
    }
  }

  return [summary];
}

export function formatCountryDetailResponse(
  snapshot: CountryDataSnapshot | null,
  filters?: CountryDetailFilters,
  textMode?: "localized",
): LocalizedCountryDetailResponse | null;
export function formatCountryDetailResponse(
  snapshot: CountryDataSnapshot | null,
  filters: CountryDetailFilters | undefined,
  textMode: "raw",
): RawCountryDetailResponse | null;
export function formatCountryDetailResponse(
  snapshot: CountryDataSnapshot | null,
  filters: CountryDetailFilters | undefined,
  textMode: TextMode,
): CountryDetailResponse | null;
export function formatCountryDetailResponse(
  snapshot: CountryDataSnapshot | null,
  filters: CountryDetailFilters = {},
  textMode: TextMode = "localized",
): CountryDetailResponse | null {
  if (snapshot === null) {
    return null;
  }
  const country = buildCountryCatalogItem(snapshot);
  const locale = filters.locale ?? "zh-CN";
  if (textMode === "raw") {
    return {
      data: rawCountryCard(country),
      meta: { locale, textMode: "raw" },
      success: true,
    };
  }
  return {
    data: localizeCountryCard(country, locale),
    meta: { locale, textMode: "localized" },
    success: true,
  };
}

export function formatBuildingModuleResponse(
  moduleKey: ModuleKey,
  status: ModuleCoverageStatus,
  locale: Locale,
  page: number,
  pageSize: number,
  textMode: TextMode,
): CountryModuleResponse {
  if (textMode === "raw") {
    return {
      data: { items: [], moduleKey, status },
      meta: { locale, page, pageSize, textMode: "raw", total: 0 },
      success: true,
    };
  }
  return {
    data: { _i18nFallback: [], items: [], moduleKey, status },
    meta: { locale, page, pageSize, textMode: "localized", total: 0 },
    success: true,
  };
}

export function formatCountryModuleResponse(
  snapshot: CountryDataSnapshot | null,
  moduleKey: ModuleKey,
  filters?: CountryModuleFilters,
  textMode?: "localized",
): LocalizedCountryModuleResponse | null;
export function formatCountryModuleResponse(
  snapshot: CountryDataSnapshot | null,
  moduleKey: ModuleKey,
  filters: CountryModuleFilters | undefined,
  textMode: "raw",
): RawCountryModuleResponse | null;
export function formatCountryModuleResponse(
  snapshot: CountryDataSnapshot | null,
  moduleKey: ModuleKey,
  filters: CountryModuleFilters | undefined,
  textMode: TextMode,
): CountryModuleResponse | null;
export function formatCountryModuleResponse(
  snapshot: CountryDataSnapshot | null,
  moduleKey: ModuleKey,
  filters: CountryModuleFilters = {},
  textMode: TextMode = "localized",
): CountryModuleResponse | null {
  if (snapshot === null) {
    return null;
  }
  const country = buildCountryCatalogItem(snapshot);
  const locale = filters.locale ?? "zh-CN";
  const { page, pageSize } = normalizePageInput(filters);
  const coverage = getModuleCoverage(country, moduleKey);
  if (coverage.status === "BUILDING") {
    return formatBuildingModuleResponse(
      moduleKey,
      coverage.status,
      locale,
      page,
      pageSize,
      textMode,
    );
  }

  const publishedRecords = getPublicModuleRecords(snapshot, moduleKey);
  const responseRecords =
    moduleKey === "ai-advisor"
      ? buildAiAdvisorSummaryRecords(publishedRecords)
      : publishedRecords;
  const fallbackFields: string[] = [];

  if (isObjectModule(moduleKey)) {
    const record = responseRecords[0];
    const rawItem =
      record === undefined ? undefined : sanitizeModuleRecord(record, moduleKey);
    const localizedItem =
      record === undefined
        ? undefined
        : localizeModuleRecord(record, locale, moduleKey, "item", fallbackFields);
    if (textMode === "raw") {
      return {
        data: { item: rawItem, moduleKey, status: coverage.status },
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
        localizeModuleRecord(
          item,
          locale,
          moduleKey,
          `items[${index}]`,
          fallbackFields,
        ),
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

export function formatCountriesResponse(
  snapshots: readonly CountryDataSnapshot[],
  filters?: CountryFilters,
  textMode?: "localized",
): LocalizedCountriesResponse;
export function formatCountriesResponse(
  snapshots: readonly CountryDataSnapshot[],
  filters: CountryFilters | undefined,
  textMode: "raw",
): RawCountriesResponse;
export function formatCountriesResponse(
  snapshots: readonly CountryDataSnapshot[],
  filters: CountryFilters | undefined,
  textMode: TextMode,
): CountriesResponse;
export function formatCountriesResponse(
  snapshots: readonly CountryDataSnapshot[],
  filters: CountryFilters = {},
  textMode: TextMode = "localized",
): CountriesResponse {
  const locale = filters.locale ?? "zh-CN";
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 20;
  const filtered = filterCountryCatalog(buildCountryCatalog(snapshots), filters);
  const pageStart = (page - 1) * pageSize;
  const pageItems = filtered.slice(pageStart, pageStart + pageSize);

  if (textMode === "raw") {
    return {
      data: pageItems.map(rawCountryCard),
      meta: { locale, page, pageSize, textMode: "raw", total: filtered.length },
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

export function getCountryFilterOptions(
  snapshots: readonly CountryDataSnapshot[],
): CountryFilterOptions {
  const catalog = buildCountryCatalog(snapshots);
  const regions = new Set<Region>();
  const industryTags = new Set<IndustryTag>();
  const techTags = new Set<TechTag>();

  for (const country of catalog) {
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
