import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  CREDIBILITIES,
  INDUSTRY_TAGS,
  MODULE_COVERAGE_STATUSES,
  MODULE_KEYS,
  REGIONS,
  REVIEW_STATUSES,
  TECH_TAGS,
} from "@navigator/shared-types/schema";
import {
  getCountryCoverageLevel,
  getObjectModuleCoverageStatus,
  type ModuleCoverageDecision,
} from "@navigator/shared-types/coverage";

import type {
  BasicCollectionManifest,
  BasicCountryBundle,
  BasicCountryValidationResult,
  JsonRecord,
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

const SAFE_COUNTRY_DIRECTORY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const UTC_RFC3339_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?Z$/;
const PRISMA_INT_MAX = 2147483647;

export function validateBasicCountryBundle(
  bundle: unknown,
): BasicCountryValidationResult {
  const errors: string[] = [];

  if (!isRecord(bundle)) {
    errors.push("bundle must be an object");
    return invalidResult(errors);
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
  validateCoverage(country, marketOverview, errors);
  validateAudit(bundle.countryDirectory, manifest, run, errors);

  return {
    valid: errors.length === 0,
    errors,
    summary: buildSummary(country),
  };
}

export function loadBasicCountryBundle(
  repoRoot: string,
  countryDirectory: string,
): BasicCountryBundle {
  if (!SAFE_COUNTRY_DIRECTORY.test(countryDirectory)) {
    throw new Error("countryDirectory must be a safe slug");
  }

  const countryRoot = join(repoRoot, "data", countryDirectory);
  const country = readJsonRecord(join(countryRoot, "country.json"));
  const marketOverview = readJsonRecord(join(countryRoot, "market-overview.json"));
  const manifest = readManifest(
    readJsonRecord(join(countryRoot, "collection-manifest.json")),
    countryDirectory,
  );
  const auditRoot = join(repoRoot, manifest.auditBundlePath);

  return {
    countryDirectory,
    canonical: {
      country,
      marketOverview,
      policy: readOptionalRecordArray(join(countryRoot, "policy.json")),
      risk: readOptionalRecordArray(join(countryRoot, "risk.json")),
      opportunities: readOptionalRecordArray(join(countryRoot, "opportunities.json")),
      projects: readOptionalRecordArray(join(countryRoot, "projects.json")),
      partners: readOptionalRecordArray(join(countryRoot, "partners.json")),
      chineseCompanies: readOptionalRecordArray(
        join(countryRoot, "chinese-companies.json"),
      ),
      entryStrategy: readOptionalRecord(join(countryRoot, "entry-strategy.json")),
      reports: readOptionalRecordArray(join(countryRoot, "reports.json")),
      knowledge: readOptionalRecordArray(join(countryRoot, "knowledge", "chunks.json")),
    },
    audit: {
      manifest,
      run: {
        runId: manifest.activeRunId,
        sourceRegister: readJsonRecord(join(auditRoot, "source-register.json")),
        extractedFacts: readJsonRecord(join(auditRoot, "extracted-facts.json")),
        marketOverviewDraft: readJsonRecord(
          join(auditRoot, "market-overview.draft.json"),
        ),
        reviewReport: readJsonRecord(join(auditRoot, "review-report.json")),
      },
    },
  };
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
    if (!(field in marketOverview)) {
      errors.push(`market-overview missing ${field}`);
    }
  }

  validateLocalized(marketOverview.overview, "market-overview.overview", errors);
  expectPopulation(marketOverview.population, errors);
  expectFiniteNumberOrNull(marketOverview.gdp, "market-overview.gdp", errors);
  expectFiniteNumberOrNull(
    marketOverview.gdpGrowth,
    "market-overview.gdpGrowth",
    errors,
  );
  validateLocalized(
    marketOverview.energyDemand,
    "market-overview.energyDemand",
    errors,
  );
  validateLocalized(
    marketOverview.renewableTarget,
    "market-overview.renewableTarget",
    errors,
  );
  validateKeyIndicators(marketOverview.keyIndicators, errors);

  expectNonBlank(marketOverview.source, "market-overview.source", errors);
  validateSourceUrl(marketOverview.sourceUrl, marketOverview.source, errors);
  expectUtcRfc3339Timestamp(
    marketOverview.collectedAt,
    "market-overview.collectedAt",
    errors,
  );
  expectUtcRfc3339Timestamp(
    marketOverview.updatedAt,
    "market-overview.updatedAt",
    errors,
  );
  expectEnum(marketOverview.credibility, CREDIBILITIES, "market-overview.credibility", errors);
  if (marketOverview.credibility === "UNVERIFIED") {
    errors.push("market-overview.credibility must not be UNVERIFIED");
  }
  expectEnum(
    marketOverview.reviewStatus,
    REVIEW_STATUSES,
    "market-overview.reviewStatus",
    errors,
  );
  if (marketOverview.reviewStatus !== "published") {
    errors.push("market-overview.reviewStatus must be published");
  }
  if (marketOverview.aiUsable !== false) {
    errors.push("market-overview.aiUsable must be false");
  }
  if (marketOverview.countryCode !== countryCode) {
    errors.push("market-overview.countryCode must match country.code");
  }
  validateEnumArray(
    marketOverview.industryTags,
    INDUSTRY_TAGS,
    "market-overview.industryTags",
    errors,
  );
  validateEnumArray(
    marketOverview.techTags,
    TECH_TAGS,
    "market-overview.techTags",
    errors,
  );
}

function validateNonMarketCanonicalData(
  canonical: JsonRecord,
  errors: string[],
): void {
  const listModules = [
    "policy",
    "risk",
    "opportunities",
    "projects",
    "partners",
    "chineseCompanies",
    "reports",
    "knowledge",
  ] as const;

  for (const moduleKey of listModules) {
    if (!Array.isArray(canonical[moduleKey]) || canonical[moduleKey].length !== 0) {
      errors.push(`canonical.${moduleKey} must be empty for BASIC`);
    }
  }
  if (canonical.entryStrategy !== null) {
    errors.push("canonical.entryStrategy must be null for BASIC");
  }
}

function validateCoverage(
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

  const expected = buildExpectedCoverage(marketOverview);
  const expectedByKey = new Map(expected.map((item) => [item.moduleKey, item]));
  const decisions: ModuleCoverageDecision[] = [];
  const seen = new Set<string>();

  for (const [index, item] of coverage.entries()) {
    if (!isRecord(item)) {
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

    const expectedRow = expectedByKey.get(item.moduleKey);
    if (expectedRow === undefined) {
      continue;
    }
    if (item.status !== expectedRow.status) {
      errors.push(
        `country.moduleCoverage ${item.moduleKey} status must be ${expectedRow.status}`,
      );
    }
    if (item.dataCount !== expectedRow.dataCount) {
      errors.push(
        `country.moduleCoverage ${item.moduleKey} dataCount must be ${expectedRow.dataCount}`,
      );
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
      errors.push(errorMessage(error));
    }
  }
}

function validateAudit(
  countryDirectory: unknown,
  manifest: JsonRecord,
  run: JsonRecord,
  errors: string[],
): void {
  if (
    typeof countryDirectory !== "string" ||
    !SAFE_COUNTRY_DIRECTORY.test(countryDirectory)
  ) {
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

  validateAuditArtifact(run.sourceRegister, "audit.run.sourceRegister", errors);
  validateAuditArtifact(run.extractedFacts, "audit.run.extractedFacts", errors);
  validateAuditArtifact(run.marketOverviewDraft, "audit.run.marketOverviewDraft", errors);
  validateAuditArtifact(run.reviewReport, "audit.run.reviewReport", errors);
  if (isRecord(run.marketOverviewDraft)) {
    if (run.marketOverviewDraft.reviewStatus !== "draft") {
      errors.push("audit.run.marketOverviewDraft.reviewStatus must be draft");
    }
    if (run.marketOverviewDraft.aiUsable !== false) {
      errors.push("audit.run.marketOverviewDraft.aiUsable must be false");
    }
  }
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

function buildSummary(country: JsonRecord): BasicCountryValidationResult["summary"] {
  const moduleStatuses: Record<string, string> = {};
  if (Array.isArray(country.moduleCoverage)) {
    for (const item of country.moduleCoverage) {
      if (isRecord(item) && typeof item.moduleKey === "string" && typeof item.status === "string") {
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

function invalidResult(errors: string[]): BasicCountryValidationResult {
  return {
    valid: false,
    errors,
    summary: {
      countryCode: "",
      coverageLevel: "",
      moduleStatuses: {},
    },
  };
}

function validateKeyIndicators(value: unknown, errors: string[]): void {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push("market-overview.keyIndicators must be a non-empty array");
    return;
  }
  for (const [index, indicator] of value.entries()) {
    if (!isRecord(indicator)) {
      errors.push(`market-overview.keyIndicators[${index}] must be an object`);
      continue;
    }
    validateLocalized(
      indicator.label,
      `market-overview.keyIndicators[${index}].label`,
      errors,
    );
    expectNonBlank(indicator.value, `market-overview.keyIndicators[${index}].value`, errors);
    expectNonBlank(indicator.unit, `market-overview.keyIndicators[${index}].unit`, errors);
    expectFiniteNumber(indicator.year, `market-overview.keyIndicators[${index}].year`, errors);
  }
}

function validateLocalized(value: unknown, label: string, errors: string[]): void {
  if (!isRecord(value) || typeof value.zh !== "string" || typeof value.en !== "string") {
    errors.push(`${label} must include zh and en strings`);
    return;
  }
  if (value.zh.trim() === "" && value.en.trim() === "") {
    errors.push(`${label} must contain zh or en text`);
  }
}

function validateSourceUrl(value: unknown, source: unknown, errors: string[]): void {
  if (value === null) {
    if (typeof source !== "string" || !source.includes("sourceUrl null")) {
      errors.push("market-overview.source must explain why sourceUrl is null");
    }
    return;
  }
  if (!isHttpUrl(value)) {
    errors.push("market-overview.sourceUrl must be an HTTP(S) URL or null");
  }
}

function validateEnumArray<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
  errors: string[],
): void {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    errors.push(`${label} must be a string array`);
    return;
  }
  for (const item of value) {
    if (!isEnumValue(item, allowed)) {
      errors.push(`${label} contains unsupported value ${item}`);
    }
  }
}

function validateAuditArtifact(value: unknown, label: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${label} must be an object`);
  }
}

function expectEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
  errors: string[],
): void {
  if (!isEnumValue(value, allowed)) {
    errors.push(`${label} must be one of ${allowed.join(", ")}`);
  }
}

function expectNonBlank(value: unknown, label: string, errors: string[]): void {
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(`${label} must be a non-empty string`);
  }
}

function expectFiniteNumber(value: unknown, label: string, errors: string[]): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.push(`${label} must be a finite number`);
  }
}

function expectFiniteNumberOrNull(value: unknown, label: string, errors: string[]): void {
  if (value !== null) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      errors.push(`${label} must be a finite number or null`);
    }
  }
}

function expectPopulation(value: unknown, errors: string[]): void {
  if (
    value !== null &&
    (typeof value !== "number" ||
      !Number.isSafeInteger(value) ||
      value < 0 ||
      value > PRISMA_INT_MAX)
  ) {
    errors.push(
      "market-overview.population must be a non-negative safe integer up to 2147483647 or null",
    );
  }
}

function expectUtcRfc3339Timestamp(
  value: unknown,
  label: string,
  errors: string[],
): void {
  if (!isUtcRfc3339Timestamp(value)) {
    errors.push(`${label} must be a strict UTC RFC3339 timestamp`);
  }
}

function isUtcRfc3339Timestamp(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  const match = UTC_RFC3339_TIMESTAMP.exec(value);
  if (match === null) {
    return false;
  }
  const [, year, month, day, hour, minute, second] = match;
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined ||
    second === undefined
  ) {
    return false;
  }
  const numericYear = Number(year);
  const numericMonth = Number(month);
  const numericDay = Number(day);
  const numericHour = Number(hour);
  const numericMinute = Number(minute);
  const numericSecond = Number(second);
  return (
    numericMonth >= 1 &&
    numericMonth <= 12 &&
    numericDay >= 1 &&
    numericDay <= daysInMonth(numericYear, numericMonth) &&
    numericHour <= 23 &&
    numericMinute <= 59 &&
    numericSecond <= 59
  );
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function isEnumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

function isHttpUrl(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRequiredRecord(
  value: unknown,
  label: string,
  errors: string[],
): JsonRecord | null {
  if (!isRecord(value)) {
    errors.push(`${label} must be an object`);
    return null;
  }
  return value;
}

function readManifest(
  value: JsonRecord,
  countryDirectory: string,
): BasicCollectionManifest {
  const activeRunId = readNonBlankString(value.activeRunId, "activeRunId");
  if (!SAFE_RUN_ID.test(activeRunId)) {
    throw new Error("activeRunId must be a safe run id");
  }
  const mappingVersion = readNonBlankString(value.mappingVersion, "mappingVersion");
  const auditBundlePath = readNonBlankString(value.auditBundlePath, "auditBundlePath");
  const expectedPath = `data/staging/${countryDirectory}/${activeRunId}`;
  if (auditBundlePath !== expectedPath) {
    throw new Error(`auditBundlePath must equal ${expectedPath}`);
  }
  return { activeRunId, mappingVersion, auditBundlePath };
}

function readOptionalRecord(pathname: string): JsonRecord | null {
  return existsSync(pathname) ? readJsonRecord(pathname) : null;
}

function readOptionalRecordArray(pathname: string): JsonRecord[] {
  if (!existsSync(pathname)) {
    return [];
  }
  const value = readJson(pathname);
  if (!Array.isArray(value)) {
    throw new Error(`${pathname} must contain a JSON array`);
  }
  return value.map((item, index) => {
    if (!isRecord(item)) {
      throw new Error(`${pathname}[${index}] must be a JSON object`);
    }
    return item;
  });
}

function readJsonRecord(pathname: string): JsonRecord {
  const value = readJson(pathname);
  if (!isRecord(value)) {
    throw new Error(`${pathname} must contain a JSON object`);
  }
  return value;
}

function readJson(pathname: string): unknown {
  try {
    return JSON.parse(readFileSync(pathname, "utf8")) as unknown;
  } catch (error) {
    throw new Error(`Unable to read JSON file ${pathname}: ${errorMessage(error)}`);
  }
}

function readNonBlankString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
