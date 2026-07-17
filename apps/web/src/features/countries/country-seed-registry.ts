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
] as const satisfies readonly CountrySeedBundle[];
