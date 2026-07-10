import {
  getCountryCoverageLevel,
  getObjectModuleCoverageStatus,
  type ModuleCoverageDecision,
} from "@navigator/shared-types/coverage";
import { MODULE_KEYS } from "@navigator/shared-types/schema";

import type {
  BasicCountryBundle,
  BasicCountryTemplateInput,
} from "./basic-country-types.js";

const MARKET_OVERVIEW_CORE_FIELDS = [
  "overview",
  "population",
  "gdp",
  "gdpGrowth",
  "energyDemand",
  "renewableTarget",
  "keyIndicators",
] as const;

export function createBasicCountryBundle(
  input: BasicCountryTemplateInput,
): BasicCountryBundle {
  assertBasicMarketOverview(input.marketOverview);

  const moduleCoverage: ModuleCoverageDecision[] = MODULE_KEYS.map((moduleKey) => ({
    moduleKey,
    status:
      moduleKey === "market-overview"
        ? getObjectModuleCoverageStatus(
            input.marketOverview,
            MARKET_OVERVIEW_CORE_FIELDS,
          )
        : "BUILDING",
    dataCount: moduleKey === "market-overview" ? 1 : 0,
  }));

  return {
    countryDirectory: input.countryDirectory,
    canonical: {
      country: {
        ...input.country,
        coverageLevel: getCountryCoverageLevel(moduleCoverage),
        moduleCoverage: moduleCoverage.map((item) => ({
          ...item,
          updatedAt: input.country.updatedAt,
        })),
      },
      marketOverview: input.marketOverview,
      policy: [],
      risk: [],
      opportunities: [],
      projects: [],
      partners: [],
      chineseCompanies: [],
      entryStrategy: null,
      reports: [],
      knowledge: [],
    },
    audit: {
      manifest: input.manifest,
      run: input.auditRun,
    },
  };
}

function assertBasicMarketOverview(marketOverview: Record<string, unknown>): void {
  if (marketOverview.reviewStatus !== "published") {
    throw new Error("marketOverview.reviewStatus must be published");
  }
  if (marketOverview.credibility === "UNVERIFIED") {
    throw new Error("marketOverview.credibility must not be UNVERIFIED");
  }
  if (marketOverview.aiUsable !== false) {
    throw new Error("marketOverview.aiUsable must be false");
  }
}
