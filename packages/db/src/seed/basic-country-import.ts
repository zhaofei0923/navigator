import type { ModuleKey } from "@navigator/shared-types/schema";

import type {
  BasicCountryBundle,
  BasicCountryValidationResult,
  JsonRecord,
} from "./basic-country-types.js";
import { validateBasicCountryBundle } from "./basic-country-validator.js";

export interface BasicSeedImportOperation {
  model: "country" | "moduleCoverage" | "marketOverview";
  action: "upsert";
  args: JsonRecord;
}

export interface BasicCountryImportPlan {
  summary: BasicCountryValidationResult["summary"];
  operations: BasicSeedImportOperation[];
  aiEligibleKnowledgeIds: [];
}

const MODULE_KEY_TO_PRISMA: Record<ModuleKey, string> = {
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
};

const REGION_TO_PRISMA: Record<string, string> = {
  "southeast-asia": "SOUTHEAST_ASIA",
  "south-asia": "SOUTH_ASIA",
  "middle-east": "MIDDLE_EAST",
  africa: "AFRICA",
  "latin-america": "LATIN_AMERICA",
  europe: "EUROPE",
  "central-asia": "CENTRAL_ASIA",
};

const INDUSTRY_TAG_TO_PRISMA: Record<string, string> = {
  solar: "SOLAR",
  wind: "WIND",
  storage: "STORAGE",
  ev: "EV",
  hydrogen: "HYDROGEN",
  grid: "GRID",
  "bess-mfg": "BESS_MFG",
  epc: "EPC",
};

const TECH_TAG_TO_PRISMA: Record<string, string> = {
  "pv-module": "PV_MODULE",
  inverter: "INVERTER",
  "onshore-wind": "ONSHORE_WIND",
  "offshore-wind": "OFFSHORE_WIND",
  lfp: "LFP",
  ncm: "NCM",
  electrolyzer: "ELECTROLYZER",
};

export function buildBasicCountryImportPlan(
  bundle: BasicCountryBundle,
): BasicCountryImportPlan {
  const validation = validateBasicCountryBundle(bundle);
  if (!validation.valid) {
    throw new Error(validation.errors.join("\n"));
  }

  const country = bundle.canonical.country;
  const marketOverview = bundle.canonical.marketOverview;
  const countryCode = readString(country.code, "country.code");
  const moduleCoverage = readRecordArray(
    country.moduleCoverage,
    "country.moduleCoverage",
  );

  return {
    summary: validation.summary,
    operations: [
      upsert("country", { code: countryCode }, transformCountry(country)),
      ...moduleCoverage.map((item) =>
        upsert(
          "moduleCoverage",
          {
            countryCode_moduleKey: {
              countryCode,
              moduleKey: mapEnum(
                item.moduleKey,
                MODULE_KEY_TO_PRISMA,
                "moduleCoverage.moduleKey",
              ),
            },
          },
          transformModuleCoverage(item, countryCode),
        ),
      ),
      upsert(
        "marketOverview",
        { countryCode },
        transformMarketOverview(marketOverview),
      ),
    ],
    aiEligibleKnowledgeIds: [],
  };
}

function upsert(
  model: BasicSeedImportOperation["model"],
  where: JsonRecord,
  data: JsonRecord,
): BasicSeedImportOperation {
  return {
    model,
    action: "upsert",
    args: {
      where,
      create: data,
      update: data,
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

function transformModuleCoverage(
  moduleCoverage: JsonRecord,
  countryCode: string,
): JsonRecord {
  return {
    moduleKey: mapEnum(
      moduleCoverage.moduleKey,
      MODULE_KEY_TO_PRISMA,
      "moduleCoverage.moduleKey",
    ),
    status: moduleCoverage.status,
    dataCount: moduleCoverage.dataCount,
    updatedAt: moduleCoverage.updatedAt,
    countryCode,
  };
}

function transformMarketOverview(marketOverview: JsonRecord): JsonRecord {
  return {
    overview: marketOverview.overview,
    population: marketOverview.population,
    gdp: marketOverview.gdp,
    gdpGrowth: marketOverview.gdpGrowth,
    energyDemand: marketOverview.energyDemand,
    renewableTarget: marketOverview.renewableTarget,
    keyIndicators: marketOverview.keyIndicators,
    source: marketOverview.source,
    sourceUrl: marketOverview.sourceUrl,
    collectedAt: marketOverview.collectedAt,
    updatedAt: marketOverview.updatedAt,
    credibility: marketOverview.credibility,
    reviewStatus: marketOverview.reviewStatus,
    aiUsable: marketOverview.aiUsable,
    countryCode: marketOverview.countryCode,
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

function mapEnum(
  value: unknown,
  mapping: Record<string, string>,
  label: string,
): string {
  const key = readString(value, label);
  const mapped = mapping[key];
  if (mapped === undefined) {
    throw new Error(`${label} has unsupported enum value ${key}`);
  }
  return mapped;
}

function mapEnumArray(
  value: unknown,
  mapping: Record<string, string>,
  label: string,
): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value.map((item, index) => mapEnum(item, mapping, `${label}[${index}]`));
}

function readRecordArray(value: unknown, label: string): JsonRecord[] {
  if (!Array.isArray(value) || !value.every(isRecord)) {
    throw new Error(`${label} must be an object array`);
  }
  return value;
}

function readString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
  return value;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
