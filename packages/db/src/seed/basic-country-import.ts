import type {
  IndustryTag,
  ModuleKey,
  Region,
  TechTag,
} from "@navigator/shared-types/schema";

import type { BasicCountryBundle, JsonRecord } from "./basic-country-types.js";
import type {
  BasicCountryImportData,
  BasicCountryImportPlan,
  BasicKeyIndicatorImportData,
  BasicLocalizedTextImportData,
  BasicMarketOverviewImportData,
  BasicModuleCoverageImportData,
  BasicSeedImportOperation,
} from "./basic-country-import-types.js";
import {
  KEY_INDICATOR_KEYS,
  LOCALIZED_TEXT_KEYS,
  isPlainRecord,
  readExactPlainRecord,
  readFiniteNumber,
  readString,
} from "./basic-country-validation-utils.js";
import { validateApprovedBasicCountryPublication } from "./basic-country-publication.js";

export type {
  BasicCountryImportPlan,
  BasicSeedImportOperation,
} from "./basic-country-import-types.js";

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
} as const satisfies Record<ModuleKey, string>;

const REGION_TO_PRISMA = {
  "southeast-asia": "SOUTHEAST_ASIA",
  "south-asia": "SOUTH_ASIA",
  "middle-east": "MIDDLE_EAST",
  africa: "AFRICA",
  "latin-america": "LATIN_AMERICA",
  europe: "EUROPE",
  "central-asia": "CENTRAL_ASIA",
} as const satisfies Record<Region, string>;

const INDUSTRY_TAG_TO_PRISMA = {
  solar: "SOLAR",
  wind: "WIND",
  storage: "STORAGE",
  ev: "EV",
  hydrogen: "HYDROGEN",
  grid: "GRID",
  "bess-mfg": "BESS_MFG",
  epc: "EPC",
} as const satisfies Record<IndustryTag, string>;

const TECH_TAG_TO_PRISMA = {
  "pv-module": "PV_MODULE",
  inverter: "INVERTER",
  "onshore-wind": "ONSHORE_WIND",
  "offshore-wind": "OFFSHORE_WIND",
  lfp: "LFP",
  ncm: "NCM",
  electrolyzer: "ELECTROLYZER",
} as const satisfies Record<TechTag, string>;

export function buildBasicCountryImportPlan(
  bundle: BasicCountryBundle,
): BasicCountryImportPlan {
  const validation = validateApprovedBasicCountryPublication(bundle);
  if (!validation.valid) {
    throw new Error(validation.errors.join("\n"));
  }

  const country = bundle.canonical.country;
  const marketOverview = bundle.canonical.marketOverview;
  const countryCode = readString(country.code, "country.code");
  return {
    summary: validation.summary,
    operations: [
      countryUpsert(transformCountry(country)),
      ...readRecordArray(country.moduleCoverage, "country.moduleCoverage").map(
        (coverage) => moduleCoverageUpsert(coverage, countryCode),
      ),
      marketOverviewUpsert(transformMarketOverview(marketOverview)),
    ],
    aiEligibleKnowledgeIds: [],
  };
}

function countryUpsert(data: BasicCountryImportData): BasicSeedImportOperation {
  return {
    model: "country",
    action: "upsert",
    args: { where: { code: data.code }, create: data, update: data },
  };
}

function moduleCoverageUpsert(
  coverage: JsonRecord,
  countryCode: string,
): BasicSeedImportOperation {
  const data: BasicModuleCoverageImportData = {
    countryCode,
    moduleKey: mapEnum(
      coverage.moduleKey,
      MODULE_KEY_TO_PRISMA,
      "moduleCoverage.moduleKey",
    ),
    status: readString(coverage.status, "moduleCoverage.status"),
    dataCount: readFiniteNumber(coverage.dataCount, "moduleCoverage.dataCount"),
    updatedAt: readString(coverage.updatedAt, "moduleCoverage.updatedAt"),
  };
  return {
    model: "moduleCoverage",
    action: "upsert",
    args: {
      where: {
        countryCode_moduleKey: { countryCode, moduleKey: data.moduleKey },
      },
      create: data,
      update: data,
    },
  };
}

function marketOverviewUpsert(
  data: BasicMarketOverviewImportData,
): BasicSeedImportOperation {
  return {
    model: "marketOverview",
    action: "upsert",
    args: { where: { countryCode: data.countryCode }, create: data, update: data },
  };
}

function transformCountry(country: JsonRecord): BasicCountryImportData {
  return {
    code: readString(country.code, "country.code"),
    name: transformLocalized(country.name, "country.name"),
    region: mapEnum(country.region, REGION_TO_PRISMA, "country.region"),
    coverageLevel: readString(country.coverageLevel, "country.coverageLevel"),
    flagEmoji: readString(country.flagEmoji, "country.flagEmoji"),
    summary: transformLocalized(country.summary, "country.summary"),
    updatedAt: readString(country.updatedAt, "country.updatedAt"),
  };
}

function transformMarketOverview(
  marketOverview: JsonRecord,
): BasicMarketOverviewImportData {
  return {
    overview: transformLocalized(marketOverview.overview, "marketOverview.overview"),
    population: readNumberOrNull(marketOverview.population, "marketOverview.population"),
    gdp: readNumberOrNull(marketOverview.gdp, "marketOverview.gdp"),
    gdpGrowth: readNumberOrNull(marketOverview.gdpGrowth, "marketOverview.gdpGrowth"),
    energyDemand: transformLocalized(
      marketOverview.energyDemand,
      "marketOverview.energyDemand",
    ),
    renewableTarget: transformLocalized(
      marketOverview.renewableTarget,
      "marketOverview.renewableTarget",
    ),
    keyIndicators: transformKeyIndicators(marketOverview.keyIndicators),
    source: readString(marketOverview.source, "marketOverview.source"),
    sourceUrl: readStringOrNull(marketOverview.sourceUrl, "marketOverview.sourceUrl"),
    collectedAt: readString(marketOverview.collectedAt, "marketOverview.collectedAt"),
    updatedAt: readString(marketOverview.updatedAt, "marketOverview.updatedAt"),
    credibility: readString(marketOverview.credibility, "marketOverview.credibility"),
    reviewStatus: readString(marketOverview.reviewStatus, "marketOverview.reviewStatus"),
    aiUsable: readBoolean(marketOverview.aiUsable, "marketOverview.aiUsable"),
    countryCode: readString(marketOverview.countryCode, "marketOverview.countryCode"),
    industryTags: mapEnumArray(
      marketOverview.industryTags,
      INDUSTRY_TAG_TO_PRISMA,
      "marketOverview.industryTags",
    ),
    techTags: mapEnumArray(
      marketOverview.techTags,
      TECH_TAG_TO_PRISMA,
      "marketOverview.techTags",
    ),
  };
}

function transformLocalized(value: unknown, label: string): BasicLocalizedTextImportData {
  const localized = readExactPlainRecord(value, LOCALIZED_TEXT_KEYS, label);
  return {
    zh: readString(localized.zh, `${label}.zh`),
    en: readString(localized.en, `${label}.en`),
  };
}

function transformKeyIndicators(value: unknown): BasicKeyIndicatorImportData[] {
  if (!Array.isArray(value)) {
    throw new Error("marketOverview.keyIndicators must be an array");
  }
  return value.map((indicator, index) => {
    const label = `marketOverview.keyIndicators[${index}]`;
    const record = readExactPlainRecord(indicator, KEY_INDICATOR_KEYS, label);
    return {
      label: transformLocalized(record.label, `${label}.label`),
      value: readString(record.value, `${label}.value`),
      unit: readString(record.unit, `${label}.unit`),
      year: readFiniteNumber(record.year, `${label}.year`),
    };
  });
}

function mapEnum<T extends string>(
  value: unknown,
  mapping: Record<T, string>,
  label: string,
): string {
  const key = readString(value, label);
  if (!Object.hasOwn(mapping, key)) {
    throw new Error(`${label} has unsupported enum value ${key}`);
  }
  return mapping[key as T];
}

function mapEnumArray<T extends string>(
  value: unknown,
  mapping: Record<T, string>,
  label: string,
): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value.map((item, index) => mapEnum(item, mapping, `${label}[${index}]`));
}

function readRecordArray(value: unknown, label: string): JsonRecord[] {
  if (!Array.isArray(value) || !value.every(isPlainRecord)) {
    throw new Error(`${label} must be an object array`);
  }
  return value;
}

function readNumberOrNull(value: unknown, label: string): number | null {
  return value === null ? null : readFiniteNumber(value, label);
}

function readStringOrNull(value: unknown, label: string): string | null {
  return value === null ? null : readString(value, label);
}

function readBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean`);
  }
  return value;
}
