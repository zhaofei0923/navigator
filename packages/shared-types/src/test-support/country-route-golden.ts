import {
  GOLDEN_COUNTRY_INPUTS,
  GOLDEN_ID_MARKET_OVERVIEW,
  GOLDEN_MODULE_KEYS,
} from "./country-route-golden-data.js";

export interface CountryRouteGoldenFixture {
  readonly id: string;
  readonly route: "detail" | "list" | "module";
  readonly requestPath: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly params?: {
    readonly code?: string;
    readonly moduleKey?: string;
  };
  readonly expectedStatus: number;
  readonly expectedBody: unknown;
}

type GoldenCountry = (typeof GOLDEN_COUNTRY_INPUTS)[number];
type GoldenLocale = "en" | "zh-CN";
type GoldenTextMode = "localized" | "raw";

function coverage(updatedAt: string) {
  return GOLDEN_MODULE_KEYS.map((moduleKey) => ({
    dataCount: moduleKey === "market-overview" ? 1 : 0,
    moduleKey,
    status: moduleKey === "market-overview" ? "COMPLETE" : "BUILDING",
    updatedAt,
  }));
}

function signals(updatedAt: string) {
  return {
    opportunityLevel: "DATA_BUILDING",
    policyFriendliness: "DATA_BUILDING",
    recommendedEntryMode: null,
    recommendedPriority: "DATA_BUILDING",
    riskLevel: "DATA_BUILDING",
    sourceCount: 0,
    sources: [],
    updatedAt,
  };
}

function countryCard(
  country: GoldenCountry,
  locale: GoldenLocale,
  textMode: GoldenTextMode,
) {
  const common = {
    code: country.code,
    coverageLevel: country.coverageLevel,
    flagEmoji: country.flagEmoji,
    moduleCoverage: coverage(country.updatedAt),
    region: country.region,
    signals: signals(country.updatedAt),
    updatedAt: country.updatedAt,
  };

  if (textMode === "raw") {
    return { ...common, name: country.name, summary: country.summary };
  }

  const language = locale === "en" ? "en" : "zh";
  return {
    ...common,
    name: country.name[language],
    summary: country.summary[language],
    _i18nFallback: [],
  };
}

function listBody(
  codes: readonly string[],
  locale: GoldenLocale,
  textMode: GoldenTextMode,
  page = 1,
  pageSize = 20,
  total = codes.length,
) {
  return {
    data: codes.map((code) =>
      countryCard(
        GOLDEN_COUNTRY_INPUTS.find((country) => country.code === code)!,
        locale,
        textMode,
      ),
    ),
    meta: { locale, page, pageSize, textMode, total },
    success: true,
  };
}

function detailBody(
  country: GoldenCountry,
  locale: GoldenLocale,
  textMode: GoldenTextMode,
) {
  return {
    data: countryCard(country, locale, textMode),
    meta: { locale, textMode },
    success: true,
  };
}

function localizedJson(value: unknown, locale: GoldenLocale): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => localizedJson(item, locale));
  }
  if (value !== null && typeof value === "object") {
    const record = value as Readonly<Record<string, unknown>>;
    const keys = Object.keys(record);
    if (
      keys.length > 0 &&
      keys.every((key) => key === "en" || key === "zh") &&
      typeof record.en === "string" &&
      typeof record.zh === "string"
    ) {
      return locale === "en" ? record.en : record.zh;
    }
    return Object.fromEntries(
      Object.entries(record).map(([key, item]) => [key, localizedJson(item, locale)]),
    );
  }
  return value;
}

function moduleBody(
  moduleKey: (typeof GOLDEN_MODULE_KEYS)[number],
  locale: GoldenLocale,
  textMode: GoldenTextMode,
) {
  const meta = { locale, page: 1, pageSize: 20, textMode, total: moduleKey === "market-overview" ? 1 : 0 };
  if (moduleKey !== "market-overview") {
    const data = { items: [], moduleKey, status: "BUILDING" };
    return {
      data: textMode === "raw" ? data : { ...data, _i18nFallback: [] },
      meta,
      success: true,
    };
  }
  const item = textMode === "raw"
    ? GOLDEN_ID_MARKET_OVERVIEW
    : localizedJson(GOLDEN_ID_MARKET_OVERVIEW, locale);
  const data = { item, moduleKey, status: "COMPLETE" };
  return {
    data: textMode === "raw" ? data : { ...data, _i18nFallback: [] },
    meta,
    success: true,
  };
}

function validationBody(message: string, details: Readonly<Record<string, string>>) {
  return {
    error: { code: "VALIDATION_ERROR", details, message },
    success: false,
  };
}

export const COUNTRY_NOT_FOUND_GOLDEN_BODY = {
  error: { code: "NOT_FOUND", details: null, message: "Country not found" },
  success: false,
} as const;

const ALL_CODES = ["ID", "VN", "SA", "AE", "BR", "ZA"] as const;

const listFixtures: readonly CountryRouteGoldenFixture[] = [
  { id: "list-localized-en", route: "list", requestPath: "/api/v1/countries?locale=en", expectedStatus: 200, expectedBody: listBody(ALL_CODES, "en", "localized") },
  { id: "list-localized-zh", route: "list", requestPath: "/api/v1/countries?locale=zh-CN", expectedStatus: 200, expectedBody: listBody(ALL_CODES, "zh-CN", "localized") },
  { id: "list-raw-en", route: "list", requestPath: "/api/v1/countries?locale=en&textMode=raw", expectedStatus: 200, expectedBody: listBody(ALL_CODES, "en", "raw") },
  { id: "list-raw-zh", route: "list", requestPath: "/api/v1/countries?locale=zh-CN&textMode=raw", expectedStatus: 200, expectedBody: listBody(ALL_CODES, "zh-CN", "raw") },
  { id: "list-pagination", route: "list", requestPath: "/api/v1/countries?locale=en&page=2&pageSize=2", expectedStatus: 200, expectedBody: listBody(["SA", "AE"], "en", "localized", 2, 2, 6) },
  { id: "list-pageSize-cap", route: "list", requestPath: "/api/v1/countries?locale=en&pageSize=999", expectedStatus: 200, expectedBody: listBody(ALL_CODES, "en", "localized", 1, 100, 6) },
  { id: "list-all-filters", route: "list", requestPath: "/api/v1/countries?coverageLevel=BASIC&region=southeast-asia&industryTags=solar,wind&techTags=onshore-wind&locale=en&textMode=localized&page=1&pageSize=1", expectedStatus: 200, expectedBody: listBody(["VN"], "en", "localized", 1, 1, 1) },
  { id: "list-industry-filter-storage", route: "list", requestPath: "/api/v1/countries?industryTags=storage&locale=en", expectedStatus: 200, expectedBody: listBody(["VN", "SA", "ZA"], "en", "localized", 1, 20, 3) },
  { id: "list-industry-all-match-empty", route: "list", requestPath: "/api/v1/countries?industryTags=storage,ev&locale=en", expectedStatus: 200, expectedBody: listBody([], "en", "localized", 1, 20, 0) },
  { id: "list-filter-empty", route: "list", requestPath: "/api/v1/countries?coverageLevel=COMPLETE&locale=en", expectedStatus: 200, expectedBody: listBody([], "en", "localized", 1, 20, 0) },
  { id: "list-accept-language", route: "list", requestPath: "/api/v1/countries", headers: { "accept-language": "en-US,en;q=0.9" }, expectedStatus: 200, expectedBody: listBody(ALL_CODES, "en", "localized") },
];

const invalidQueries = [
  ["coverageLevel", "DEEP"], ["locale", "fr"], ["region", "antarctica"],
  ["industryTags", "solar,bad-tag"], ["techTags", "pv-module,bad-tech"],
  ["textMode", "compact"], ["page", "0"], ["page", "abc"],
  ["pageSize", "0"], ["pageSize", "abc"],
] as const;

const invalidListFixtures = invalidQueries.map(([key, value]) => ({
  id: `list-invalid-${key}-${value === "abc" ? "alpha" : value}`,
  route: "list" as const,
  requestPath: `/api/v1/countries?${key}=${value}`,
  expectedStatus: 400,
  expectedBody: validationBody("Invalid countries query", { [key]: value }),
}));

const detailFixtures = GOLDEN_COUNTRY_INPUTS.flatMap((country) =>
  (["en", "zh-CN"] as const).flatMap((locale) =>
    (["localized", "raw"] as const).map((textMode) => ({
      id: `detail-${country.code}-${textMode}-${locale === "en" ? "en" : "zh"}`,
      route: "detail" as const,
      requestPath: `/api/v1/countries/${country.code}?locale=${locale}&textMode=${textMode}`,
      params: { code: country.code },
      expectedStatus: 200,
      expectedBody: detailBody(country, locale, textMode),
    })),
  ),
);

const detailBoundaryFixtures: readonly CountryRouteGoldenFixture[] = [
  { id: "detail-lowercase-country", route: "detail", requestPath: "/api/v1/countries/id?locale=en", params: { code: "id" }, expectedStatus: 200, expectedBody: detailBody(GOLDEN_COUNTRY_INPUTS[0], "en", "localized") },
  { id: "detail-whitespace-country", route: "detail", requestPath: "/api/v1/countries/%20ID%20?locale=en", params: { code: " ID " }, expectedStatus: 200, expectedBody: detailBody(GOLDEN_COUNTRY_INPUTS[0], "en", "localized") },
  { id: "detail-empty-country", route: "detail", requestPath: "/api/v1/countries/%20?locale=en", params: { code: "" }, expectedStatus: 404, expectedBody: COUNTRY_NOT_FOUND_GOLDEN_BODY },
  { id: "detail-length-country", route: "detail", requestPath: "/api/v1/countries/IDN?locale=en", params: { code: "IDN" }, expectedStatus: 404, expectedBody: COUNTRY_NOT_FOUND_GOLDEN_BODY },
  { id: "detail-unknown-country", route: "detail", requestPath: "/api/v1/countries/ZZ?locale=en", params: { code: "ZZ" }, expectedStatus: 404, expectedBody: COUNTRY_NOT_FOUND_GOLDEN_BODY },
];

const invalidDetailFixtures = invalidQueries.map(([key, value]) => ({
  id: `detail-invalid-${key}-${value === "abc" ? "alpha" : value}`,
  route: "detail" as const,
  requestPath: `/api/v1/countries/ID?${key}=${value}`,
  params: { code: "ID" },
  expectedStatus: 400,
  expectedBody: validationBody("Invalid country detail query", { [key]: value }),
}));

const moduleFixtures = GOLDEN_MODULE_KEYS.flatMap((moduleKey) =>
  (["en", "zh-CN"] as const).flatMap((locale) =>
    (["localized", "raw"] as const).map((textMode) => ({
      id: `module-${moduleKey}-${textMode}-${locale === "en" ? "en" : "zh"}`,
      route: "module" as const,
      requestPath: `/api/v1/countries/ID/modules/${moduleKey}?locale=${locale}&textMode=${textMode}`,
      params: { code: "ID", moduleKey },
      expectedStatus: 200,
      expectedBody: moduleBody(moduleKey, locale, textMode),
    })),
  ),
);

const moduleBoundaryFixtures: readonly CountryRouteGoldenFixture[] = [
  { id: "module-invalid-moduleKey", route: "module", requestPath: "/api/v1/countries/ID/modules/bad-module?locale=en", params: { code: "ID", moduleKey: "bad-module" }, expectedStatus: 400, expectedBody: validationBody("Invalid country module query", { moduleKey: "bad-module" }) },
  { id: "module-unknown-country", route: "module", requestPath: "/api/v1/countries/ZZ/modules/policy?locale=en", params: { code: "ZZ", moduleKey: "policy" }, expectedStatus: 404, expectedBody: COUNTRY_NOT_FOUND_GOLDEN_BODY },
];

const invalidModuleFixtures = invalidQueries.map(([key, value]) => ({
  id: `module-invalid-${key}-${value === "abc" ? "alpha" : value}`,
  route: "module" as const,
  requestPath: `/api/v1/countries/ID/modules/policy?${key}=${value}`,
  params: { code: "ID", moduleKey: "policy" },
  expectedStatus: 400,
  expectedBody: validationBody("Invalid country module query", { [key]: value }),
}));

export const COUNTRY_ROUTE_GOLDEN_FIXTURES = [
  ...listFixtures,
  ...invalidListFixtures,
  ...detailFixtures,
  ...detailBoundaryFixtures,
  ...invalidDetailFixtures,
  ...moduleFixtures,
  ...moduleBoundaryFixtures,
  ...invalidModuleFixtures,
] as const satisfies readonly CountryRouteGoldenFixture[];

export const COUNTRY_ROUTE_FORBIDDEN_BODY_FRAGMENTS = [
  "approvalDecision", "artifactSha256", "authorizedPublication", "boundaryVerdict",
  "cachePath", "data/staging", "embeddingEn", "embeddingZh", "fileUrl",
  "rawCache", "reviewerId", "sourceRegister", "stages",
] as const;

export const COUNTRY_FALLBACK_GOLDEN = {
  input: {
    code: "ZZ", coverageLevel: "BASIC", flagEmoji: "", industryTags: [],
    moduleCoverage: [], name: { en: "", zh: "测试国家" }, region: "southeast-asia",
    signals: { ...signals("2026-01-15T00:00:00.000Z"), recommendedEntryMode: { en: "", zh: "测试进入模式" } },
    summary: { en: "", zh: "测试摘要" }, techTags: [], updatedAt: "2026-01-15T00:00:00.000Z",
  },
  locale: "en",
  expected: {
    code: "ZZ", coverageLevel: "BASIC", flagEmoji: "", moduleCoverage: [], name: "测试国家",
    region: "southeast-asia", signals: { ...signals("2026-01-15T00:00:00.000Z"), recommendedEntryMode: "测试进入模式" },
    summary: "测试摘要", updatedAt: "2026-01-15T00:00:00.000Z",
    _i18nFallback: ["name", "summary", "signals.recommendedEntryMode"],
  },
} as const;

export {
  COUNTRY_SENSITIVE_GOLDEN_BODY,
  COUNTRY_SENSITIVE_RAW_GOLDEN_BODY,
  COUNTRY_SENSITIVE_GOLDEN_SNAPSHOT,
} from "./country-route-golden-sensitive.js";
