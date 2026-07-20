import type { BasicProfile } from "@navigator/shared-types/basic-profile";

import type { BasicCountryValidationResult } from "./basic-country-types.js";

export interface BasicLocalizedTextImportData {
  zh: string;
  en: string;
}

export interface BasicKeyIndicatorImportData {
  label: BasicLocalizedTextImportData;
  value: string;
  unit: string;
  year: number;
}

export interface BasicCountryImportData {
  code: string;
  name: BasicLocalizedTextImportData;
  region: string;
  coverageLevel: string;
  flagEmoji: string;
  summary: BasicLocalizedTextImportData;
  updatedAt: string;
}

export interface BasicModuleCoverageImportData {
  countryCode: string;
  moduleKey: string;
  status: string;
  dataCount: number;
  updatedAt: string;
}

export interface BasicMarketOverviewImportData {
  overview: BasicLocalizedTextImportData;
  population: number | null;
  gdp: number | null;
  gdpGrowth: number | null;
  energyDemand: BasicLocalizedTextImportData;
  renewableTarget: BasicLocalizedTextImportData;
  keyIndicators: BasicKeyIndicatorImportData[];
  basicProfile: BasicProfile | null;
  source: string;
  sourceUrl: string | null;
  collectedAt: string;
  updatedAt: string;
  credibility: string;
  reviewStatus: string;
  aiUsable: boolean;
  countryCode: string;
  industryTags: string[];
  techTags: string[];
}

export interface BasicUpsertArgs<Data, Where> {
  where: Where;
  create: Data;
  update: Data;
}

export type BasicSeedImportOperation =
  | {
      model: "country";
      action: "upsert";
      args: BasicUpsertArgs<BasicCountryImportData, { code: string }>;
    }
  | {
      model: "moduleCoverage";
      action: "upsert";
      args: BasicUpsertArgs<
        BasicModuleCoverageImportData,
        { countryCode_moduleKey: { countryCode: string; moduleKey: string } }
      >;
    }
  | {
      model: "marketOverview";
      action: "upsert";
      args: BasicUpsertArgs<BasicMarketOverviewImportData, { countryCode: string }>;
    };

export interface BasicCountryImportPlan {
  summary: BasicCountryValidationResult["summary"];
  operations: BasicSeedImportOperation[];
  aiEligibleKnowledgeIds: [];
}
