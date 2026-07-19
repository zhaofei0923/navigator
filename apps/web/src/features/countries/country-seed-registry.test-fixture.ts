import type {
  CoverageLevel,
  ModuleCoverageStatus,
  ModuleKey,
  Region,
} from "@navigator/shared-types/schema";
import type { LocalizedText } from "@navigator/shared-types/i18n";

import indonesiaCountrySeed from "../../../../../data/indonesia/country.json";
import indonesiaMarketOverviewSeed from "../../../../../data/indonesia/market-overview.json";
import vietnamCountrySeed from "../../../../../data/vietnam/country.json";
import vietnamMarketOverviewSeed from "../../../../../data/vietnam/market-overview.json";
import saudiArabiaCountrySeed from "../../../../../data/saudi-arabia/country.json";
import saudiArabiaMarketOverviewSeed from "../../../../../data/saudi-arabia/market-overview.json";
import unitedArabEmiratesCountrySeed from "../../../../../data/united-arab-emirates/country.json";
import unitedArabEmiratesMarketOverviewSeed from "../../../../../data/united-arab-emirates/market-overview.json";
import brazilCountrySeed from "../../../../../data/brazil/country.json";
import brazilMarketOverviewSeed from "../../../../../data/brazil/market-overview.json";
import southAfricaCountrySeed from "../../../../../data/south-africa/country.json";
import southAfricaMarketOverviewSeed from "../../../../../data/south-africa/market-overview.json";

export interface CountryModuleCoverageSeed {
  moduleKey: ModuleKey;
  status: ModuleCoverageStatus;
  dataCount: number;
  updatedAt: string;
}

export interface CountrySeedRecord {
  code: string;
  coverageLevel: CoverageLevel;
  flagEmoji: string;
  moduleCoverage: CountryModuleCoverageSeed[];
  name: LocalizedText;
  region: Region;
  summary: LocalizedText;
  updatedAt: string;
}

export interface TagSourceRecord {
  countryCode?: string;
  credibility?: string;
  aiUsable?: boolean;
  industryTags?: readonly string[];
  reviewStatus?: string;
  techTags?: readonly string[];
}

export type CountryModuleRecord = Record<string, unknown> & TagSourceRecord;

export type CountryModuleDataSeed =
  | CountryModuleRecord
  | readonly CountryModuleRecord[]
  | null;

export type CountryModuleDataRegistry = Readonly<
  Record<ModuleKey, CountryModuleDataSeed>
>;

export interface CountrySeedBundle {
  country: CountrySeedRecord;
  moduleData: CountryModuleDataRegistry;
  tagSources: readonly TagSourceRecord[];
}

const indonesiaModuleData = {
  "ai-advisor": [],
  "chinese-companies": [],
  "entry-strategy": null,
  "market-overview": indonesiaMarketOverviewSeed as CountryModuleRecord,
  opportunities: [],
  partners: [],
  policy: [],
  projects: [],
  reports: [],
  risk: [],
} satisfies CountryModuleDataRegistry;

const vietnamModuleData = {
  "ai-advisor": [],
  "chinese-companies": [],
  "entry-strategy": null,
  "market-overview": vietnamMarketOverviewSeed as CountryModuleRecord,
  opportunities: [],
  partners: [],
  policy: [],
  projects: [],
  reports: [],
  risk: [],
} satisfies CountryModuleDataRegistry;

const saudiArabiaModuleData = {
  "ai-advisor": [],
  "chinese-companies": [],
  "entry-strategy": null,
  "market-overview": saudiArabiaMarketOverviewSeed as CountryModuleRecord,
  opportunities: [],
  partners: [],
  policy: [],
  projects: [],
  reports: [],
  risk: [],
} satisfies CountryModuleDataRegistry;

const unitedArabEmiratesModuleData = {
  "ai-advisor": [],
  "chinese-companies": [],
  "entry-strategy": null,
  "market-overview": unitedArabEmiratesMarketOverviewSeed as CountryModuleRecord,
  opportunities: [],
  partners: [],
  policy: [],
  projects: [],
  reports: [],
  risk: [],
} satisfies CountryModuleDataRegistry;

const brazilModuleData = {
  "ai-advisor": [],
  "chinese-companies": [],
  "entry-strategy": null,
  "market-overview": brazilMarketOverviewSeed as CountryModuleRecord,
  opportunities: [],
  partners: [],
  policy: [],
  projects: [],
  reports: [],
  risk: [],
} satisfies CountryModuleDataRegistry;

const southAfricaModuleData = {
  "ai-advisor": [],
  "chinese-companies": [],
  "entry-strategy": null,
  "market-overview": southAfricaMarketOverviewSeed as CountryModuleRecord,
  opportunities: [],
  partners: [],
  policy: [],
  projects: [],
  reports: [],
  risk: [],
} satisfies CountryModuleDataRegistry;

export const countrySeedBundles = [
  {
    country: indonesiaCountrySeed as CountrySeedRecord,
    moduleData: indonesiaModuleData,
    tagSources: [indonesiaMarketOverviewSeed],
  },
  {
    country: vietnamCountrySeed as CountrySeedRecord,
    moduleData: vietnamModuleData,
    tagSources: [vietnamMarketOverviewSeed],
  },
  {
    country: saudiArabiaCountrySeed as CountrySeedRecord,
    moduleData: saudiArabiaModuleData,
    tagSources: [saudiArabiaMarketOverviewSeed],
  },
  {
    country: unitedArabEmiratesCountrySeed as CountrySeedRecord,
    moduleData: unitedArabEmiratesModuleData,
    tagSources: [unitedArabEmiratesMarketOverviewSeed],
  },
  {
    country: brazilCountrySeed as CountrySeedRecord,
    moduleData: brazilModuleData,
    tagSources: [brazilMarketOverviewSeed],
  },
  {
    country: southAfricaCountrySeed as CountrySeedRecord,
    moduleData: southAfricaModuleData,
    tagSources: [southAfricaMarketOverviewSeed],
  },
] as const satisfies readonly CountrySeedBundle[];
