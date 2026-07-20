import { parseBasicProfile } from "@navigator/shared-types/basic-profile";
import {
  CREDIBILITIES,
  INDUSTRY_TAGS,
  REGIONS,
  REVIEW_STATUSES,
  TECH_TAGS,
} from "@navigator/shared-types/schema";

import type {
  BasicCountryValidationResult,
  JsonRecord,
} from "./basic-country-types.js";
import {
  KEY_INDICATOR_KEYS,
  LOCALIZED_TEXT_KEYS,
  SAFE_COUNTRY_DIRECTORY,
  SAFE_RUN_ID,
  expectEnum,
  expectExactOwnKeys,
  expectFiniteNumber,
  expectFiniteNumberOrNull,
  expectNonBlank,
  expectPopulation,
  expectUtcRfc3339Timestamp,
  isHttpUrl,
  isPlainRecord,
  validateEnumArray,
} from "./basic-country-validation-utils.js";
import {
  buildBasicCountrySummary,
  validateBasicCoverage,
} from "./basic-country-coverage-validation.js";

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

export function validateBasicCountryBundle(
  bundle: unknown,
): BasicCountryValidationResult {
  const errors: string[] = [];
  if (!isPlainRecord(bundle)) {
    return invalidResult(["bundle must be an object"]);
  }

  const canonical = readRequiredRecord(bundle.canonical, "canonical", errors);
  const audit = readRequiredRecord(bundle.audit, "audit", errors);
  const country = canonical
    ? readRequiredRecord(canonical.country, "canonical.country", errors)
    : null;
  const marketOverview = canonical
    ? readRequiredRecord(canonical.marketOverview, "canonical.marketOverview", errors)
    : null;
  const manifest = audit
    ? readRequiredRecord(audit.manifest, "audit.manifest", errors)
    : null;
  const run = audit ? readRequiredRecord(audit.run, "audit.run", errors) : null;
  if (!canonical || !country || !marketOverview || !manifest || !run) {
    return invalidResult(errors);
  }

  validateCountryIdentity(country, errors);
  validateMarketOverview(marketOverview, country.code, errors);
  validateNonMarketCanonicalData(canonical, errors);
  validateBasicCoverage(country, marketOverview, errors);
  validateAudit(bundle.countryDirectory, manifest, run, errors);
  return { valid: errors.length === 0, errors, summary: buildBasicCountrySummary(country) };
}

function validateCountryIdentity(country: JsonRecord, errors: string[]): void {
  if (typeof country.code !== "string" || !/^[A-Z]{2}$/.test(country.code)) {
    errors.push("country.code must be an uppercase two-letter country code");
  }
  validateLocalized(country.name, "country.name", errors);
  validateLocalized(country.summary, "country.summary", errors);
  expectEnum(country.region, REGIONS, "country.region", errors);
  expectNonBlank(country.flagEmoji, "country.flagEmoji", errors);
  expectUtcRfc3339Timestamp(country.updatedAt, "country.updatedAt", errors);
  if (country.coverageLevel !== "BASIC") {
    errors.push("country.coverageLevel must be BASIC");
  }
}

function validateMarketOverview(
  marketOverview: JsonRecord,
  countryCode: unknown,
  errors: string[],
): void {
  for (const field of META_FIELDS) {
    if (!Object.hasOwn(marketOverview, field)) {
      errors.push(`market-overview missing ${field}`);
    }
  }
  validateLocalized(marketOverview.overview, "market-overview.overview", errors);
  expectPopulation(marketOverview.population, errors);
  expectFiniteNumberOrNull(marketOverview.gdp, "market-overview.gdp", errors);
  expectFiniteNumberOrNull(marketOverview.gdpGrowth, "market-overview.gdpGrowth", errors);
  validateLocalized(marketOverview.energyDemand, "market-overview.energyDemand", errors);
  validateLocalized(marketOverview.renewableTarget, "market-overview.renewableTarget", errors);
  validateKeyIndicators(marketOverview.keyIndicators, errors);
  if (
    Object.hasOwn(marketOverview, "basicProfile") &&
    marketOverview.basicProfile !== null &&
    parseBasicProfile(marketOverview.basicProfile) === null
  ) {
    errors.push(
      "market-overview.basicProfile must be a valid basic-market-profile/v2 profile or null",
    );
  }

  expectNonBlank(marketOverview.source, "market-overview.source", errors);
  validateSourceUrl(marketOverview.sourceUrl, marketOverview.source, errors);
  expectUtcRfc3339Timestamp(marketOverview.collectedAt, "market-overview.collectedAt", errors);
  expectUtcRfc3339Timestamp(marketOverview.updatedAt, "market-overview.updatedAt", errors);
  expectEnum(marketOverview.credibility, CREDIBILITIES, "market-overview.credibility", errors);
  if (marketOverview.credibility === "UNVERIFIED") {
    errors.push("market-overview.credibility must not be UNVERIFIED");
  }
  expectEnum(marketOverview.reviewStatus, REVIEW_STATUSES, "market-overview.reviewStatus", errors);
  if (marketOverview.reviewStatus !== "published") {
    errors.push("market-overview.reviewStatus must be published");
  }
  if (marketOverview.aiUsable !== false) {
    errors.push("market-overview.aiUsable must be false");
  }
  if (marketOverview.countryCode !== countryCode) {
    errors.push("market-overview.countryCode must match country.code");
  }
  validateEnumArray(marketOverview.industryTags, INDUSTRY_TAGS, "market-overview.industryTags", errors);
  validateEnumArray(marketOverview.techTags, TECH_TAGS, "market-overview.techTags", errors);
}

function validateNonMarketCanonicalData(canonical: JsonRecord, errors: string[]): void {
  for (const moduleKey of [
    "policy",
    "risk",
    "opportunities",
    "projects",
    "partners",
    "chineseCompanies",
    "reports",
    "knowledge",
  ] as const) {
    if (!Array.isArray(canonical[moduleKey]) || canonical[moduleKey].length !== 0) {
      errors.push(`canonical.${moduleKey} must be empty for BASIC`);
    }
  }
  if (canonical.entryStrategy !== null) {
    errors.push("canonical.entryStrategy must be null for BASIC");
  }
}

function validateAudit(
  countryDirectory: unknown,
  manifest: JsonRecord,
  run: JsonRecord,
  errors: string[],
): void {
  if (typeof countryDirectory !== "string" || !SAFE_COUNTRY_DIRECTORY.test(countryDirectory)) {
    errors.push("countryDirectory must be a safe slug");
  }
  expectNonBlank(manifest.activeRunId, "audit.manifest.activeRunId", errors);
  expectNonBlank(manifest.mappingVersion, "audit.manifest.mappingVersion", errors);
  expectNonBlank(run.runId, "audit.run.runId", errors);
  if (typeof manifest.activeRunId !== "string" || !SAFE_RUN_ID.test(manifest.activeRunId)) {
    errors.push("audit.manifest.activeRunId must be a safe run id");
  }
  if (manifest.activeRunId !== run.runId) {
    errors.push("audit.manifest.activeRunId must match audit.run.runId");
  }
  const expectedPath = `data/staging/${String(countryDirectory)}/${String(manifest.activeRunId)}`;
  if (manifest.auditBundlePath !== expectedPath) {
    errors.push(`audit.manifest.auditBundlePath must equal ${expectedPath}`);
  }
  for (const [key, label] of [
    ["sourceRegister", "audit.run.sourceRegister"],
    ["extractedFacts", "audit.run.extractedFacts"],
    ["marketOverviewDraft", "audit.run.marketOverviewDraft"],
    ["reviewReport", "audit.run.reviewReport"],
  ] as const) {
    if (!isPlainRecord(run[key])) {
      errors.push(`${label} must be an object`);
    }
  }
  if (isPlainRecord(run.marketOverviewDraft)) {
    if (run.marketOverviewDraft.reviewStatus !== "draft") {
      errors.push("audit.run.marketOverviewDraft.reviewStatus must be draft");
    }
    if (run.marketOverviewDraft.aiUsable !== false) {
      errors.push("audit.run.marketOverviewDraft.aiUsable must be false");
    }
  }
}

function validateKeyIndicators(value: unknown, errors: string[]): void {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push("market-overview.keyIndicators must be a non-empty array");
    return;
  }
  for (const [index, indicator] of value.entries()) {
    const label = `market-overview.keyIndicators[${index}]`;
    if (!expectExactOwnKeys(indicator, KEY_INDICATOR_KEYS, label, errors)) {
      continue;
    }
    validateLocalized(indicator.label, `${label}.label`, errors);
    expectNonBlank(indicator.value, `${label}.value`, errors);
    expectNonBlank(indicator.unit, `${label}.unit`, errors);
    expectFiniteNumber(indicator.year, `${label}.year`, errors);
  }
}

function validateLocalized(value: unknown, label: string, errors: string[]): void {
  if (!expectExactOwnKeys(value, LOCALIZED_TEXT_KEYS, label, errors)) {
    return;
  }
  if (typeof value.zh !== "string" || typeof value.en !== "string") {
    errors.push(`${label} must include zh and en strings`);
  } else if (value.zh.trim() === "" && value.en.trim() === "") {
    errors.push(`${label} must contain zh or en text`);
  }
}

function validateSourceUrl(value: unknown, source: unknown, errors: string[]): void {
  if (value === null) {
    if (typeof source !== "string" || !source.includes("sourceUrl null")) {
      errors.push("market-overview.source must explain why sourceUrl is null");
    }
  } else if (!isHttpUrl(value)) {
    errors.push("market-overview.sourceUrl must be an HTTP(S) URL or null");
  }
}

function readRequiredRecord(value: unknown, label: string, errors: string[]): JsonRecord | null {
  if (!isPlainRecord(value)) {
    errors.push(`${label} must be an object`);
    return null;
  }
  return value;
}

function invalidResult(errors: string[]): BasicCountryValidationResult {
  return {
    valid: false,
    errors,
    summary: { countryCode: "", coverageLevel: "", moduleStatuses: {} },
  };
}
