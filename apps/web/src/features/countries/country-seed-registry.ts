import type {
  CoverageLevel,
  ModuleCoverageStatus,
  ModuleKey,
  Region,
} from "@navigator/shared-types/schema";
import type { LocalizedText } from "@navigator/shared-types/i18n";

import indonesiaChineseCompaniesSeed from "../../../../../data/indonesia/chinese-companies.json";
import indonesiaCountrySeed from "../../../../../data/indonesia/country.json";
import indonesiaEntryStrategySeed from "../../../../../data/indonesia/entry-strategy.json";
import indonesiaKnowledgeChunksSeed from "../../../../../data/indonesia/knowledge/chunks.json";
import indonesiaMarketOverviewSeed from "../../../../../data/indonesia/market-overview.json";
import indonesiaOpportunitiesSeed from "../../../../../data/indonesia/opportunities.json";
import indonesiaPartnersSeed from "../../../../../data/indonesia/partners.json";
import indonesiaPolicySeed from "../../../../../data/indonesia/policy.json";
import indonesiaProjectsSeed from "../../../../../data/indonesia/projects.json";
import indonesiaReportsSeed from "../../../../../data/indonesia/reports.json";
import indonesiaRiskSeed from "../../../../../data/indonesia/risk.json";

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
  "ai-advisor": indonesiaKnowledgeChunksSeed as readonly CountryModuleRecord[],
  "chinese-companies":
    indonesiaChineseCompaniesSeed as readonly CountryModuleRecord[],
  "entry-strategy": indonesiaEntryStrategySeed as CountryModuleRecord,
  "market-overview": indonesiaMarketOverviewSeed as CountryModuleRecord,
  opportunities: indonesiaOpportunitiesSeed as readonly CountryModuleRecord[],
  partners: indonesiaPartnersSeed as readonly CountryModuleRecord[],
  policy: indonesiaPolicySeed as readonly CountryModuleRecord[],
  projects: indonesiaProjectsSeed as readonly CountryModuleRecord[],
  reports: indonesiaReportsSeed as readonly CountryModuleRecord[],
  risk: indonesiaRiskSeed as readonly CountryModuleRecord[],
} satisfies CountryModuleDataRegistry;

export const countrySeedBundles = [
  {
    country: indonesiaCountrySeed as CountrySeedRecord,
    moduleData: indonesiaModuleData,
    tagSources: [
      indonesiaMarketOverviewSeed,
      ...indonesiaPolicySeed,
      ...indonesiaRiskSeed,
      ...indonesiaOpportunitiesSeed,
      ...indonesiaProjectsSeed,
      ...indonesiaPartnersSeed,
      ...indonesiaChineseCompaniesSeed,
      indonesiaEntryStrategySeed,
      ...indonesiaKnowledgeChunksSeed,
      ...indonesiaReportsSeed,
    ],
  },
] as const satisfies readonly CountrySeedBundle[];
