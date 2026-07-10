import {
  MODULE_COVERAGE_STATUSES,
  MODULE_KEYS,
} from "@navigator/shared-types/schema";
import {
  getCountryCoverageLevel,
  getObjectModuleCoverageStatus,
  type ModuleCoverageDecision,
} from "@navigator/shared-types/coverage";

import type {
  BasicCountryValidationResult,
  JsonRecord,
} from "./basic-country-types.js";
import {
  expectUtcRfc3339Timestamp,
  isEnumValue,
  isPlainRecord,
} from "./basic-country-validation-utils.js";

const MARKET_OVERVIEW_CORE_FIELDS = [
  "overview",
  "population",
  "gdp",
  "gdpGrowth",
  "energyDemand",
  "renewableTarget",
  "keyIndicators",
] as const;

export function validateBasicCoverage(
  country: JsonRecord,
  marketOverview: JsonRecord,
  errors: string[],
): void {
  const coverage = country.moduleCoverage;
  if (!Array.isArray(coverage)) {
    errors.push("country.moduleCoverage must be an array");
    return;
  }
  if (coverage.length !== MODULE_KEYS.length) {
    errors.push(`country.moduleCoverage must contain exactly ${MODULE_KEYS.length} rows`);
  }

  const expectedByKey = new Map(
    buildExpectedCoverage(marketOverview).map((item) => [item.moduleKey, item]),
  );
  const decisions: ModuleCoverageDecision[] = [];
  const seen = new Set<string>();

  for (const [index, item] of coverage.entries()) {
    if (!isPlainRecord(item)) {
      errors.push(`country.moduleCoverage[${index}] must be an object`);
      continue;
    }
    expectUtcRfc3339Timestamp(
      item.updatedAt,
      `moduleCoverage[${index}].updatedAt`,
      errors,
    );
    if (!isEnumValue(item.moduleKey, MODULE_KEYS)) {
      errors.push(`moduleCoverage[${index}].moduleKey must be registered`);
      continue;
    }
    if (seen.has(item.moduleKey)) {
      errors.push(`country.moduleCoverage has duplicate ${item.moduleKey}`);
    }
    seen.add(item.moduleKey);

    const expected = expectedByKey.get(item.moduleKey);
    if (expected === undefined) {
      continue;
    }
    if (item.status !== expected.status) {
      errors.push(`country.moduleCoverage ${item.moduleKey} status must be ${expected.status}`);
    }
    if (item.dataCount !== expected.dataCount) {
      errors.push(`country.moduleCoverage ${item.moduleKey} dataCount must be ${expected.dataCount}`);
    }
    if (isEnumValue(item.status, MODULE_COVERAGE_STATUSES)) {
      decisions.push({
        moduleKey: item.moduleKey,
        status: item.status,
        dataCount: typeof item.dataCount === "number" ? item.dataCount : Number.NaN,
      });
    }
  }

  for (const moduleKey of MODULE_KEYS) {
    if (!seen.has(moduleKey)) {
      errors.push(`country.moduleCoverage missing ${moduleKey}`);
    }
  }
  if (decisions.length === MODULE_KEYS.length && seen.size === MODULE_KEYS.length) {
    try {
      const level = getCountryCoverageLevel(decisions);
      if (level !== "BASIC") {
        errors.push(`Basic coverage must not qualify for ${level}`);
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
}

export function buildBasicCountrySummary(
  country: JsonRecord,
): BasicCountryValidationResult["summary"] {
  const moduleStatuses: Record<string, string> = {};
  if (Array.isArray(country.moduleCoverage)) {
    for (const item of country.moduleCoverage) {
      if (
        isPlainRecord(item) &&
        typeof item.moduleKey === "string" &&
        typeof item.status === "string"
      ) {
        moduleStatuses[item.moduleKey] = item.status;
      }
    }
  }
  return {
    countryCode: typeof country.code === "string" ? country.code : "",
    coverageLevel: typeof country.coverageLevel === "string" ? country.coverageLevel : "",
    moduleStatuses,
  };
}

function buildExpectedCoverage(marketOverview: JsonRecord): ModuleCoverageDecision[] {
  return MODULE_KEYS.map((moduleKey) => ({
    moduleKey,
    status:
      moduleKey === "market-overview"
        ? getObjectModuleCoverageStatus(
            marketOverview,
            MARKET_OVERVIEW_CORE_FIELDS,
          )
        : "BUILDING",
    dataCount: moduleKey === "market-overview" ? 1 : 0,
  }));
}
