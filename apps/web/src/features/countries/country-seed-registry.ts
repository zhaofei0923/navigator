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
  industryTags?: readonly string[];
  reviewStatus?: string;
  techTags?: readonly string[];
}

export interface CountrySeedBundle {
  country: CountrySeedRecord;
  tagSources: readonly TagSourceRecord[];
}

export const countrySeedBundles = [
  {
    country: indonesiaCountrySeed as CountrySeedRecord,
    tagSources: [
      indonesiaMarketOverviewSeed,
      ...indonesiaPolicySeed,
      ...indonesiaRiskSeed,
      ...indonesiaOpportunitiesSeed,
      ...indonesiaProjectsSeed,
      ...indonesiaPartnersSeed,
      ...indonesiaChineseCompaniesSeed,
      indonesiaEntryStrategySeed,
      ...indonesiaReportsSeed,
    ],
  },
] as const satisfies readonly CountrySeedBundle[];
