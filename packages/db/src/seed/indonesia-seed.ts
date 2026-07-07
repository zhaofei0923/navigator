import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

type JsonRecord = Record<string, unknown>;

export interface SeedValidationResult {
  valid: boolean;
  errors: string[];
  summary: {
    countryCode: string;
    coverageLevel: string;
    moduleStatuses: Record<string, string>;
    knowledgeEligibleCount: number;
    knowledgeSourceModuleCount: number;
  };
}

export interface IndonesiaSeed {
  country: JsonRecord;
  marketOverview: JsonRecord;
  policy: JsonRecord[];
  risk: JsonRecord[];
  opportunities: JsonRecord[];
  projects: JsonRecord[];
  partners: JsonRecord[];
  chineseCompanies: JsonRecord[];
  entryStrategy: JsonRecord;
  reports: JsonRecord[];
  knowledge: JsonRecord[];
}

export interface SeedImportOperation {
  model: string;
  action: "upsert" | "createMany";
  args: JsonRecord;
}

export interface SeedImportPlan {
  summary: SeedValidationResult["summary"];
  operations: SeedImportOperation[];
  aiEligibleKnowledgeIds: string[];
}

const COUNTRY_CODE = "ID";
const DATA_ROOT = new URL("../../../../data/indonesia/", import.meta.url);
const SHARED_TYPES_SOURCE = new URL(
  "../../../shared-types/src/index.ts",
  import.meta.url,
);

const LIST_MODULES = [
  "policy",
  "risk",
  "opportunities",
  "projects",
  "partners",
  "chinese-companies",
  "reports",
] as const;

const META_FIELDS = [
  "source",
  "sourceUrl",
  "collectedAt",
  "updatedAt",
  "credibility",
  "reviewStatus",
  "aiUsable",
  "countryCode",
  "industryTags",
  "techTags",
] as const;

const MODULE_KEY_TO_PRISMA = {
  "market-overview": "MARKET_OVERVIEW",
  policy: "POLICY",
  risk: "RISK",
  opportunities: "OPPORTUNITIES",
  projects: "PROJECTS",
  partners: "PARTNERS",
  "chinese-companies": "CHINESE_COMPANIES",
  "entry-strategy": "ENTRY_STRATEGY",
  "ai-advisor": "AI_ADVISOR",
  reports: "REPORTS",
} as const;

const INDUSTRY_TAG_TO_PRISMA = {
  solar: "SOLAR",
  wind: "WIND",
  storage: "STORAGE",
  ev: "EV",
  hydrogen: "HYDROGEN",
  grid: "GRID",
  "bess-mfg": "BESS_MFG",
  epc: "EPC",
} as const;

const TECH_TAG_TO_PRISMA = {
  "pv-module": "PV_MODULE",
  inverter: "INVERTER",
  "onshore-wind": "ONSHORE_WIND",
  "offshore-wind": "OFFSHORE_WIND",
  lfp: "LFP",
  ncm: "NCM",
  electrolyzer: "ELECTROLYZER",
} as const;

const REGION_TO_PRISMA = {
  "southeast-asia": "SOUTHEAST_ASIA",
  "south-asia": "SOUTH_ASIA",
  "middle-east": "MIDDLE_EAST",
  africa: "AFRICA",
  "latin-america": "LATIN_AMERICA",
  europe: "EUROPE",
  "central-asia": "CENTRAL_ASIA",
} as const;

const POLICY_TYPE_TO_PRISMA = {
  incentive: "INCENTIVE",
  tariff: "TARIFF",
  localization: "LOCALIZATION",
  permit: "PERMIT",
  tax: "TAX",
  "import-export": "IMPORT_EXPORT",
} as const;

const LOCALIZED_FIELDS: Record<string, readonly string[]> = {
  "market-overview": ["overview", "energyDemand", "renewableTarget"],
  policy: ["title", "summary", "body", "authority"],
  risk: ["title", "description", "mitigation"],
  opportunities: ["title", "description", "marketSize", "timeWindow"],
  projects: ["name", "description", "location"],
  partners: ["name", "description", "contactHint"],
  "chinese-companies": ["name", "businessScope", "caseStudy"],
  "entry-strategy": ["overview", "recommendedMode"],
  reports: ["title", "abstract"],
  knowledge: ["content"],
};

function readJson(pathname: string): unknown {
  return JSON.parse(readFileSync(new URL(pathname, DATA_ROOT), "utf8"));
}

function asRecord(value: unknown, label: string): JsonRecord {
  if (isRecord(value)) {
    return value;
  }

  throw new Error(`${label} must be a JSON object`);
}

function asRecordArray(value: unknown, label: string): JsonRecord[] {
  if (Array.isArray(value) && value.every(isRecord)) {
    return value;
  }

  throw new Error(`${label} must be a JSON object array`);
}

export function loadIndonesiaSeed(): IndonesiaSeed {
  return {
    country: asRecord(readJson("country.json"), "country.json"),
    marketOverview: asRecord(
      readJson("market-overview.json"),
      "market-overview.json",
    ),
    policy: asRecordArray(readJson("policy.json"), "policy.json"),
    risk: asRecordArray(readJson("risk.json"), "risk.json"),
    opportunities: asRecordArray(
      readJson("opportunities.json"),
      "opportunities.json",
    ),
    projects: asRecordArray(readJson("projects.json"), "projects.json"),
    partners: asRecordArray(readJson("partners.json"), "partners.json"),
    chineseCompanies: asRecordArray(
      readJson("chinese-companies.json"),
      "chinese-companies.json",
    ),
    entryStrategy: asRecord(
      readJson("entry-strategy.json"),
      "entry-strategy.json",
    ),
    reports: asRecordArray(readJson("reports.json"), "reports.json"),
    knowledge: asRecordArray(readJson("knowledge/chunks.json"), "chunks.json"),
  };
}

export function buildIndonesiaSeedImportPlan(
  seed: IndonesiaSeed = loadIndonesiaSeed(),
): SeedImportPlan {
  const result = validateIndonesiaSeed(seed);
  if (!result.valid) {
    throw new Error(result.errors.join("\n"));
  }

  return {
    summary: result.summary,
    operations: buildPrismaOperations(seed),
    aiEligibleKnowledgeIds: getAiEligibleKnowledgeChunks(seed).map((chunk) =>
      readString(chunk.id, "knowledge.id"),
    ),
  };
}

export function buildIndonesiaSeedCliSummary(
  seed: IndonesiaSeed = loadIndonesiaSeed(),
): SeedValidationResult["summary"] {
  const result = validateIndonesiaSeed(seed);
  if (!result.valid) {
    throw new Error(result.errors.join("\n"));
  }

  return result.summary;
}

export function getAiEligibleKnowledgeChunks(seed: IndonesiaSeed): JsonRecord[] {
  return seed.knowledge.filter(isAiEligible);
}

export function getAiEligibleBusinessRecords(seed: IndonesiaSeed): JsonRecord[] {
  return [
    seed.marketOverview,
    ...seed.policy,
    ...seed.risk,
    ...seed.opportunities,
    ...seed.projects,
    ...seed.partners,
    ...seed.chineseCompanies,
    seed.entryStrategy,
    ...seed.reports,
  ].filter(isAiEligible);
}

export function validateIndonesiaSeed(seed: IndonesiaSeed): SeedValidationResult {
  const enums = loadSharedEnums();
  const errors: string[] = [];

  validateCountry(seed.country, enums, errors);
  validateObjectModule("market-overview", seed.marketOverview, enums, errors);
  validateObjectModule("entry-strategy", seed.entryStrategy, enums, errors);

  for (const moduleKey of LIST_MODULES) {
    for (const item of getListModule(seed, moduleKey)) {
      validateListItem(moduleKey, item, enums, errors);
    }
  }

  for (const chunk of seed.knowledge) {
    validateKnowledgeChunk(chunk, enums, errors);
  }

  validateCompleteThresholds(seed, errors);

  return {
    valid: errors.length === 0,
    errors,
    summary: buildSummary(seed),
  };
}

function validateCountry(
  country: JsonRecord,
  enums: SharedEnums,
  errors: string[],
): void {
  expectEqual(country.code, COUNTRY_CODE, "country.code", errors);
  expectIn(country.coverageLevel, enums.COVERAGE_LEVELS, "country.coverageLevel", errors);
  expectIn(country.region, enums.REGIONS, "country.region", errors);
  expectLocalized(country.name, "country.name", errors);
  expectLocalized(country.summary, "country.summary", errors);
  expectIsoDate(country.updatedAt, "country.updatedAt", errors);

  const coverage = country.moduleCoverage;
  if (!Array.isArray(coverage)) {
    errors.push("country.moduleCoverage must be an array");
    return;
  }

  const seen = new Set<string>();
  for (const [index, item] of coverage.entries()) {
    if (!isRecord(item)) {
      errors.push(`country.moduleCoverage[${index}] must be an object`);
      continue;
    }

    expectIn(item.moduleKey, enums.MODULE_KEYS, `moduleCoverage[${index}].moduleKey`, errors);
    expectIn(
      item.status,
      enums.MODULE_COVERAGE_STATUSES,
      `moduleCoverage[${index}].status`,
      errors,
    );
    expectNumber(item.dataCount, `moduleCoverage[${index}].dataCount`, errors);
    expectIsoDate(item.updatedAt, `moduleCoverage[${index}].updatedAt`, errors);
    if (typeof item.moduleKey === "string") {
      if (seen.has(item.moduleKey)) {
        errors.push(`country.moduleCoverage has duplicate ${item.moduleKey}`);
      }
      seen.add(item.moduleKey);
    }
  }

  for (const moduleKey of enums.MODULE_KEYS) {
    if (!seen.has(moduleKey)) {
      errors.push(`country.moduleCoverage missing ${moduleKey}`);
    }
  }
}

function validateObjectModule(
  moduleKey: "market-overview" | "entry-strategy",
  item: JsonRecord,
  enums: SharedEnums,
  errors: string[],
): void {
  validateMeta(moduleKey, item, enums, errors);
  validateLocalizedFields(moduleKey, item, errors);

  if (moduleKey === "market-overview") {
    expectNumberOrNull(item.population, "market-overview.population", errors);
    expectNumberOrNull(item.gdp, "market-overview.gdp", errors);
    expectNumberOrNull(item.gdpGrowth, "market-overview.gdpGrowth", errors);
    validateKeyIndicators(item.keyIndicators, errors);
  } else {
    validateStrategySteps(item.steps, errors);
  }
}

function validateListItem(
  moduleKey: (typeof LIST_MODULES)[number],
  item: JsonRecord,
  enums: SharedEnums,
  errors: string[],
): void {
  validateMeta(moduleKey, item, enums, errors);
  validateLocalizedFields(moduleKey, item, errors);

  if (moduleKey === "policy") {
    expectIn(item.policyType, enums.POLICY_TYPES, `${item.id}.policyType`, errors);
    expectIsoDateOrNull(item.effectiveDate, `${item.id}.effectiveDate`, errors);
  }
  if (moduleKey === "risk") {
    expectIn(item.level, enums.RISK_LEVELS, `${item.id}.level`, errors);
    expectString(item.category, `${item.id}.category`, errors);
  }
  if (moduleKey === "projects") {
    expectIn(item.status, enums.PROJECT_STATUSES, `${item.id}.status`, errors);
    expectStringOrNull(item.capacity, `${item.id}.capacity`, errors);
    expectNumberOrNull(item.investment, `${item.id}.investment`, errors);
  }
  if (moduleKey === "partners") {
    expectString(item.partnerType, `${item.id}.partnerType`, errors);
  }
  if (moduleKey === "chinese-companies") {
    expectIn(item.industry, enums.INDUSTRY_TAGS, `${item.id}.industry`, errors);
    expectNumberOrNull(item.entryYear, `${item.id}.entryYear`, errors);
  }
  if (moduleKey === "reports") {
    expectString(item.fileUrl, `${item.id}.fileUrl`, errors);
    expectIsoDate(item.publishedAt, `${item.id}.publishedAt`, errors);
    expectIn(item.accessLevel, enums.ACCESS_LEVELS, `${item.id}.accessLevel`, errors);
  }
}

function validateKnowledgeChunk(
  chunk: JsonRecord,
  enums: SharedEnums,
  errors: string[],
): void {
  validateMeta("knowledge", chunk, enums, errors);
  validateLocalizedFields("knowledge", chunk, errors);
  expectIn(chunk.sourceModule, enums.MODULE_KEYS, `${chunk.id}.sourceModule`, errors);
  expectString(chunk.sourceId, `${chunk.id}.sourceId`, errors);
  expectVector(chunk.embeddingZh, `${chunk.id}.embeddingZh`, errors);
  expectVector(chunk.embeddingEn, `${chunk.id}.embeddingEn`, errors);
}

function validateMeta(
  moduleKey: string,
  item: JsonRecord,
  enums: SharedEnums,
  errors: string[],
): void {
  for (const field of META_FIELDS) {
    if (!(field in item)) {
      errors.push(`${moduleKey}.${String(item.id ?? "object")} missing ${field}`);
    }
  }

  expectString(item.source, `${item.id}.source`, errors);
  expectStringOrNull(item.sourceUrl, `${item.id}.sourceUrl`, errors);
  if (
    item.sourceUrl === null &&
    typeof item.source === "string" &&
    !item.source.includes("sourceUrl null")
  ) {
    errors.push(`${item.id}.source must explain why sourceUrl is null`);
  }
  expectIsoDate(item.collectedAt, `${item.id}.collectedAt`, errors);
  expectIsoDate(item.updatedAt, `${item.id}.updatedAt`, errors);
  expectIn(item.credibility, enums.CREDIBILITIES, `${item.id}.credibility`, errors);
  expectIn(item.reviewStatus, enums.REVIEW_STATUSES, `${item.id}.reviewStatus`, errors);
  expectBoolean(item.aiUsable, `${item.id}.aiUsable`, errors);
  expectEqual(item.countryCode, COUNTRY_CODE, `${item.id}.countryCode`, errors);
  expectStringArrayValues(item.industryTags, enums.INDUSTRY_TAGS, `${item.id}.industryTags`, errors);
  expectStringArrayValues(item.techTags, enums.TECH_TAGS, `${item.id}.techTags`, errors);
}

function validateLocalizedFields(
  moduleKey: string,
  item: JsonRecord,
  errors: string[],
): void {
  for (const field of LOCALIZED_FIELDS[moduleKey] ?? []) {
    const value = item[field];
    if (value === null && ["marketSize", "timeWindow", "location", "contactHint", "caseStudy"].includes(field)) {
      continue;
    }
    expectLocalized(value, `${item.id}.${field}`, errors);
  }
}

function validateCompleteThresholds(seed: IndonesiaSeed, errors: string[]): void {
  if (seed.country.coverageLevel !== "COMPLETE") {
    errors.push("country.coverageLevel must be COMPLETE");
  }

  if (objectFillRate(seed.marketOverview, [
    "overview",
    "population",
    "gdp",
    "gdpGrowth",
    "energyDemand",
    "renewableTarget",
    "keyIndicators",
  ]) < 0.8) {
    errors.push("market-overview core field fill rate must be >= 80%");
  }

  if (objectFillRate(seed.entryStrategy, ["overview", "steps", "recommendedMode"]) < 0.8) {
    errors.push("entry-strategy core field fill rate must be >= 80%");
  }

  for (const moduleKey of LIST_MODULES) {
    const publishedCount = getListModule(seed, moduleKey).filter(
      (item) => item.reviewStatus === "published",
    ).length;
    if (publishedCount < 5) {
      errors.push(`${moduleKey} must have at least 5 published items`);
    }
  }

  const eligibleKnowledge = getAiEligibleKnowledgeChunks(seed);
  const sourceModules = new Set(
    eligibleKnowledge
      .map((chunk) => chunk.sourceModule)
      .filter((sourceModule): sourceModule is string => typeof sourceModule === "string"),
  );
  if (eligibleKnowledge.length < 20) {
    errors.push("ai-advisor must have at least 20 AI-eligible knowledge chunks");
  }
  if (sourceModules.size < 3) {
    errors.push("ai-advisor knowledge must cover at least 3 source modules");
  }

  validateModuleCoverageMatchesSeed(seed, errors);
}

function buildSummary(seed: IndonesiaSeed): SeedValidationResult["summary"] {
  const coverage = Array.isArray(seed.country.moduleCoverage)
    ? seed.country.moduleCoverage.filter(isRecord)
    : [];
  const moduleStatuses = Object.fromEntries(
    coverage
      .filter((item) => typeof item.moduleKey === "string" && typeof item.status === "string")
      .map((item) => [item.moduleKey as string, item.status as string]),
  );
  const eligibleKnowledge = getAiEligibleKnowledgeChunks(seed);
  const sourceModules = new Set(
    eligibleKnowledge
      .map((chunk) => chunk.sourceModule)
      .filter((sourceModule): sourceModule is string => typeof sourceModule === "string"),
  );

  return {
    countryCode: typeof seed.country.code === "string" ? seed.country.code : "",
    coverageLevel:
      typeof seed.country.coverageLevel === "string" ? seed.country.coverageLevel : "",
    moduleStatuses,
    knowledgeEligibleCount: eligibleKnowledge.length,
    knowledgeSourceModuleCount: sourceModules.size,
  };
}

function getListModule(
  seed: IndonesiaSeed,
  moduleKey: (typeof LIST_MODULES)[number],
): JsonRecord[] {
  if (moduleKey === "chinese-companies") {
    return seed.chineseCompanies;
  }
  return seed[moduleKey];
}

function isAiEligible(item: JsonRecord): boolean {
  return (
    item.reviewStatus === "published" &&
    item.aiUsable === true &&
    item.credibility !== "UNVERIFIED"
  );
}

function buildPrismaOperations(seed: IndonesiaSeed): SeedImportOperation[] {
  const moduleCoverage = asRecordArray(
    seed.country.moduleCoverage,
    "country.moduleCoverage",
  );

  return [
    upsertOperation("country", "code", COUNTRY_CODE, transformCountry(seed.country)),
    createManyOperation("moduleCoverage", moduleCoverage.map(transformModuleCoverage)),
    upsertOperation(
      "marketOverview",
      "countryCode",
      COUNTRY_CODE,
      transformMarketOverview(seed.marketOverview),
    ),
    createManyOperation("policy", seed.policy.map(transformPolicy)),
    createManyOperation("risk", seed.risk.map(transformRisk)),
    createManyOperation("opportunity", seed.opportunities.map(transformOpportunity)),
    createManyOperation("project", seed.projects.map(transformProject)),
    createManyOperation("partner", seed.partners.map(transformPartner)),
    createManyOperation(
      "chineseCompany",
      seed.chineseCompanies.map(transformChineseCompany),
    ),
    upsertOperation(
      "entryStrategy",
      "countryCode",
      COUNTRY_CODE,
      transformEntryStrategy(seed.entryStrategy),
    ),
    createManyOperation("report", seed.reports.map(transformReport)),
    createManyOperation("knowledgeChunk", seed.knowledge.map(transformKnowledgeChunk)),
  ];
}

function upsertOperation(
  model: string,
  whereField: string,
  whereValue: string,
  data: JsonRecord,
): SeedImportOperation {
  return {
    model,
    action: "upsert",
    args: {
      where: { [whereField]: whereValue },
      create: data,
      update: data,
    },
  };
}

function createManyOperation(model: string, data: JsonRecord[]): SeedImportOperation {
  return {
    model,
    action: "createMany",
    args: {
      data,
      skipDuplicates: true,
    },
  };
}

function transformCountry(country: JsonRecord): JsonRecord {
  return {
    code: readString(country.code, "country.code"),
    name: country.name,
    region: mapEnum(country.region, REGION_TO_PRISMA, "country.region"),
    coverageLevel: country.coverageLevel,
    flagEmoji: country.flagEmoji,
    summary: country.summary,
    updatedAt: country.updatedAt,
  };
}

function transformModuleCoverage(item: JsonRecord): JsonRecord {
  const moduleKey = readString(item.moduleKey, "moduleCoverage.moduleKey");
  return {
    id: `id_cov_${moduleKey.replaceAll("-", "_")}`,
    moduleKey: mapEnum(moduleKey, MODULE_KEY_TO_PRISMA, "moduleCoverage.moduleKey"),
    status: item.status,
    dataCount: item.dataCount,
    updatedAt: item.updatedAt,
    countryCode: COUNTRY_CODE,
  };
}

function transformMarketOverview(item: JsonRecord): JsonRecord {
  return {
    ...copyFields(item, [
      "id",
      "overview",
      "population",
      "gdp",
      "gdpGrowth",
      "energyDemand",
      "renewableTarget",
      "keyIndicators",
    ]),
    ...transformMeta(item),
  };
}

function transformPolicy(item: JsonRecord): JsonRecord {
  return {
    ...copyFields(item, [
      "id",
      "title",
      "summary",
      "body",
      "effectiveDate",
      "authority",
    ]),
    policyType: mapEnum(item.policyType, POLICY_TYPE_TO_PRISMA, `${item.id}.policyType`),
    ...transformMeta(item),
  };
}

function transformRisk(item: JsonRecord): JsonRecord {
  return {
    ...copyFields(item, ["id", "title", "category", "level", "description", "mitigation"]),
    ...transformMeta(item),
  };
}

function transformOpportunity(item: JsonRecord): JsonRecord {
  return {
    ...copyFields(item, [
      "id",
      "title",
      "description",
      "marketSize",
      "timeWindow",
    ]),
    ...transformMeta(item),
  };
}

function transformProject(item: JsonRecord): JsonRecord {
  return {
    ...copyFields(item, [
      "id",
      "name",
      "description",
      "status",
      "capacity",
      "investment",
      "location",
    ]),
    ...transformMeta(item),
  };
}

function transformPartner(item: JsonRecord): JsonRecord {
  return {
    ...copyFields(item, [
      "id",
      "name",
      "partnerType",
      "description",
      "contactHint",
    ]),
    ...transformMeta(item),
  };
}

function transformChineseCompany(item: JsonRecord): JsonRecord {
  return {
    ...copyFields(item, [
      "id",
      "name",
      "industry",
      "businessScope",
      "entryYear",
      "caseStudy",
    ]),
    ...transformMeta(item),
  };
}

function transformEntryStrategy(item: JsonRecord): JsonRecord {
  return {
    ...copyFields(item, ["id", "overview", "steps", "recommendedMode"]),
    ...transformMeta(item),
  };
}

function transformReport(item: JsonRecord): JsonRecord {
  return {
    ...copyFields(item, [
      "id",
      "title",
      "abstract",
      "fileUrl",
      "publishedAt",
      "accessLevel",
    ]),
    ...transformMeta(item),
  };
}

function transformKnowledgeChunk(item: JsonRecord): JsonRecord {
  return {
    ...copyFields(item, [
      "id",
      "content",
      "embeddingZh",
      "embeddingEn",
      "sourceId",
    ]),
    sourceModule: mapEnum(
      item.sourceModule,
      MODULE_KEY_TO_PRISMA,
      `${item.id}.sourceModule`,
    ),
    ...transformMeta(item),
  };
}

function transformMeta(item: JsonRecord): JsonRecord {
  return {
    source: item.source,
    sourceUrl: item.sourceUrl,
    collectedAt: item.collectedAt,
    updatedAt: item.updatedAt,
    credibility: item.credibility,
    reviewStatus: item.reviewStatus,
    aiUsable: item.aiUsable,
    countryCode: item.countryCode,
    industryTags: mapEnumArray(
      item.industryTags,
      INDUSTRY_TAG_TO_PRISMA,
      `${item.id}.industryTags`,
    ),
    techTags: mapEnumArray(item.techTags, TECH_TAG_TO_PRISMA, `${item.id}.techTags`),
  };
}

function validateModuleCoverageMatchesSeed(
  seed: IndonesiaSeed,
  errors: string[],
): void {
  const coverage = Array.isArray(seed.country.moduleCoverage)
    ? seed.country.moduleCoverage.filter(isRecord)
    : [];
  const coverageByModule = new Map(
    coverage
      .filter((item) => typeof item.moduleKey === "string")
      .map((item) => [item.moduleKey as string, item]),
  );
  const expected = buildExpectedModuleCoverage(seed);

  for (const item of expected) {
    const actual = coverageByModule.get(item.moduleKey);
    if (actual === undefined) {
      errors.push(`country.moduleCoverage missing ${item.moduleKey}`);
      continue;
    }
    if (actual.status !== item.status) {
      errors.push(
        `country.moduleCoverage ${item.moduleKey} status must be ${item.status}`,
      );
    }
    if (actual.dataCount !== item.dataCount) {
      errors.push(
        `country.moduleCoverage ${item.moduleKey} dataCount must be ${item.dataCount}`,
      );
    }
  }
}

function buildExpectedModuleCoverage(
  seed: IndonesiaSeed,
): Array<{ moduleKey: string; status: string; dataCount: number }> {
  const listModuleCoverage = LIST_MODULES.map((moduleKey) => {
    const dataCount = getListModule(seed, moduleKey).filter(
      (item) => item.reviewStatus === "published",
    ).length;
    return {
      moduleKey,
      status: statusFromListCount(dataCount),
      dataCount,
    };
  });
  const aiDataCount = getAiEligibleKnowledgeChunks(seed).length;
  const aiSourceModuleCount = new Set(
    getAiEligibleKnowledgeChunks(seed)
      .map((chunk) => chunk.sourceModule)
      .filter((sourceModule): sourceModule is string => typeof sourceModule === "string"),
  ).size;

  return [
    {
      moduleKey: "market-overview",
      status: statusFromObjectFillRate(
        objectFillRate(seed.marketOverview, [
          "overview",
          "population",
          "gdp",
          "gdpGrowth",
          "energyDemand",
          "renewableTarget",
          "keyIndicators",
        ]),
      ),
      dataCount: isFilled(seed.marketOverview) ? 1 : 0,
    },
    ...listModuleCoverage,
    {
      moduleKey: "entry-strategy",
      status: statusFromObjectFillRate(
        objectFillRate(seed.entryStrategy, ["overview", "steps", "recommendedMode"]),
      ),
      dataCount: isFilled(seed.entryStrategy) ? 1 : 0,
    },
    {
      moduleKey: "ai-advisor",
      status: statusFromKnowledgeCoverage(aiDataCount, aiSourceModuleCount),
      dataCount: aiDataCount,
    },
  ];
}

function statusFromListCount(count: number): string {
  if (count === 0) {
    return "BUILDING";
  }
  return count >= 5 ? "COMPLETE" : "PARTIAL";
}

function statusFromObjectFillRate(fillRate: number): string {
  if (fillRate === 0) {
    return "BUILDING";
  }
  return fillRate >= 0.8 ? "COMPLETE" : "PARTIAL";
}

function statusFromKnowledgeCoverage(
  eligibleCount: number,
  sourceModuleCount: number,
): string {
  if (eligibleCount === 0) {
    return "BUILDING";
  }
  return eligibleCount >= 20 && sourceModuleCount >= 3 ? "COMPLETE" : "PARTIAL";
}

function copyFields(item: JsonRecord, fields: readonly string[]): JsonRecord {
  return Object.fromEntries(fields.map((field) => [field, item[field]]));
}

function readString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
  return value;
}

function mapEnum<T extends Record<string, string>>(
  value: unknown,
  mapping: T,
  label: string,
): T[keyof T] {
  const key = readString(value, label);
  const mapped = mapping[key];
  if (mapped === undefined) {
    throw new Error(`${label} has unsupported enum value ${key}`);
  }
  return mapped as T[keyof T];
}

function mapEnumArray<T extends Record<string, string>>(
  value: unknown,
  mapping: T,
  label: string,
): Array<T[keyof T]> {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value.map((item, index) => mapEnum(item, mapping, `${label}[${index}]`));
}

interface SharedEnums {
  ACCESS_LEVELS: string[];
  COVERAGE_LEVELS: string[];
  CREDIBILITIES: string[];
  INDUSTRY_TAGS: string[];
  MODULE_COVERAGE_STATUSES: string[];
  MODULE_KEYS: string[];
  POLICY_TYPES: string[];
  PROJECT_STATUSES: string[];
  REGIONS: string[];
  REVIEW_STATUSES: string[];
  RISK_LEVELS: string[];
  TECH_TAGS: string[];
}

function loadSharedEnums(): SharedEnums {
  const source = readFileSync(SHARED_TYPES_SOURCE, "utf8");
  return {
    ACCESS_LEVELS: readSharedConst(source, "ACCESS_LEVELS"),
    COVERAGE_LEVELS: readSharedConst(source, "COVERAGE_LEVELS"),
    CREDIBILITIES: readSharedConst(source, "CREDIBILITIES"),
    INDUSTRY_TAGS: readSharedConst(source, "INDUSTRY_TAGS"),
    MODULE_COVERAGE_STATUSES: readSharedConst(source, "MODULE_COVERAGE_STATUSES"),
    MODULE_KEYS: readSharedConst(source, "MODULE_KEYS"),
    POLICY_TYPES: readSharedConst(source, "POLICY_TYPES"),
    PROJECT_STATUSES: readSharedConst(source, "PROJECT_STATUSES"),
    REGIONS: readSharedConst(source, "REGIONS"),
    REVIEW_STATUSES: readSharedConst(source, "REVIEW_STATUSES"),
    RISK_LEVELS: readSharedConst(source, "RISK_LEVELS"),
    TECH_TAGS: readSharedConst(source, "TECH_TAGS"),
  };
}

function readSharedConst(source: string, name: keyof SharedEnums): string[] {
  const match = source.match(
    new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\] as const;`),
  );
  if (match?.[1] === undefined) {
    throw new Error(`Missing ${name} in @navigator/shared-types`);
  }

  return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1] ?? "");
}

function objectFillRate(item: JsonRecord, fields: readonly string[]): number {
  const filled = fields.filter((field) => isFilled(item[field])).length;
  return filled / fields.length;
}

function isFilled(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === "string") {
    return value.trim() !== "";
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (isRecord(value)) {
    return Object.keys(value).length > 0;
  }
  return true;
}

function validateKeyIndicators(value: unknown, errors: string[]): void {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push("market-overview.keyIndicators must be a non-empty array");
    return;
  }

  for (const [index, indicator] of value.entries()) {
    if (!isRecord(indicator)) {
      errors.push(`keyIndicators[${index}] must be an object`);
      continue;
    }
    expectLocalized(indicator.label, `keyIndicators[${index}].label`, errors);
    expectString(indicator.value, `keyIndicators[${index}].value`, errors);
    expectString(indicator.unit, `keyIndicators[${index}].unit`, errors);
    expectNumber(indicator.year, `keyIndicators[${index}].year`, errors);
  }
}

function validateStrategySteps(value: unknown, errors: string[]): void {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push("entry-strategy.steps must be a non-empty array");
    return;
  }

  for (const [index, step] of value.entries()) {
    if (!isRecord(step)) {
      errors.push(`steps[${index}] must be an object`);
      continue;
    }
    expectNumber(step.order, `steps[${index}].order`, errors);
    expectLocalized(step.title, `steps[${index}].title`, errors);
    expectLocalized(step.detail, `steps[${index}].detail`, errors);
  }
}

function expectLocalized(value: unknown, label: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${label} must be LocalizedText`);
    return;
  }

  expectString(value.zh, `${label}.zh`, errors);
  expectString(value.en, `${label}.en`, errors);
}

function expectString(value: unknown, label: string, errors: string[]): void {
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(`${label} must be a non-empty string`);
  }
}

function expectStringOrNull(value: unknown, label: string, errors: string[]): void {
  if (value !== null) {
    expectString(value, label, errors);
  }
}

function expectNumber(value: unknown, label: string, errors: string[]): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.push(`${label} must be a finite number`);
  }
}

function expectNumberOrNull(value: unknown, label: string, errors: string[]): void {
  if (value !== null) {
    expectNumber(value, label, errors);
  }
}

function expectBoolean(value: unknown, label: string, errors: string[]): void {
  if (typeof value !== "boolean") {
    errors.push(`${label} must be a boolean`);
  }
}

function expectEqual(
  value: unknown,
  expected: string,
  label: string,
  errors: string[],
): void {
  if (value !== expected) {
    errors.push(`${label} must be ${expected}`);
  }
}

function expectIn(
  value: unknown,
  allowed: readonly string[],
  label: string,
  errors: string[],
): void {
  if (typeof value !== "string" || !allowed.includes(value)) {
    errors.push(`${label} must be one of ${allowed.join(", ")}`);
  }
}

function expectStringArrayValues(
  value: unknown,
  allowed: readonly string[],
  label: string,
  errors: string[],
): void {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    errors.push(`${label} must be a string array`);
    return;
  }

  for (const item of value) {
    if (!allowed.includes(item)) {
      errors.push(`${label} contains unsupported value ${item}`);
    }
  }
}

function expectIsoDate(value: unknown, label: string, errors: string[]): void {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    errors.push(`${label} must be an ISO date string`);
  }
}

function expectIsoDateOrNull(value: unknown, label: string, errors: string[]): void {
  if (value !== null) {
    expectIsoDate(value, label, errors);
  }
}

function expectVector(value: unknown, label: string, errors: string[]): void {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every((item) => typeof item === "number" && Number.isFinite(item))
  ) {
    errors.push(`${label} must be a numeric vector array`);
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function runCli(): void {
  const plan = buildIndonesiaSeedImportPlan();
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entrypoint) {
  runCli();
}
