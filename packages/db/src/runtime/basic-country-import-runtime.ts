import { isDeepStrictEqual } from "node:util";

import { MODULE_KEYS } from "@navigator/shared-types/schema";

import {
  isPreparedApprovedBasicCountryImportFromLoader,
  type PreparedApprovedBasicCountryImport,
} from "../seed/approved-basic-country-import.js";
import {
  preflightBasicCountryActivation,
  type BasicActivationCountPort,
} from "../seed/basic-country-activation-preflight.js";
import type { BasicSeedImportOperation } from "../seed/basic-country-import.js";
import type { BasicCanonicalData } from "../seed/basic-country-types.js";

const MODULE_KEY_TO_IMPORT_VALUE = {
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
} as const satisfies Record<(typeof MODULE_KEYS)[number], string>;

const COUNTRY_DATA_KEYS = [
  "code",
  "name",
  "region",
  "coverageLevel",
  "flagEmoji",
  "summary",
  "updatedAt",
] as const;
const MODULE_COVERAGE_DATA_KEYS = [
  "countryCode",
  "moduleKey",
  "status",
  "dataCount",
  "updatedAt",
] as const;
const MARKET_OVERVIEW_DATA_KEYS = [
  "overview",
  "population",
  "gdp",
  "gdpGrowth",
  "energyDemand",
  "renewableTarget",
  "keyIndicators",
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

export interface BasicCountryImportTransaction {
  readonly activationCounts: BasicActivationCountPort;
  execute(operation: BasicSeedImportOperation): Promise<void>;
  readCanonical(countryCode: string): Promise<BasicCanonicalData | null>;
}

export interface BasicCountryImportTransactionPort {
  transaction<T>(
    run: (transaction: BasicCountryImportTransaction) => Promise<T>,
  ): Promise<T>;
}

export interface BasicCountryImportResult {
  readonly countryCode: string;
  readonly operationCount: number;
}

export type BasicCountryImportErrorCode =
  | "BASIC_IMPORT_UNTRUSTED_PREPARATION"
  | "BASIC_IMPORT_PREFLIGHT_FAILED"
  | "BASIC_IMPORT_LEGACY_DATA_PRESENT"
  | "BASIC_IMPORT_READBACK_MISMATCH"
  | "BASIC_IMPORT_DATABASE_OPERATION_FAILED";

export class BasicCountryImportError extends Error {
  readonly code: BasicCountryImportErrorCode;

  constructor(code: BasicCountryImportErrorCode, options?: ErrorOptions) {
    super(code, options);
    this.name = "BasicCountryImportError";
    this.code = code;
  }
}

export async function importPreparedApprovedBasicCountry(
  prepared: PreparedApprovedBasicCountryImport,
  port: BasicCountryImportTransactionPort,
): Promise<BasicCountryImportResult> {
  if (!isPreparedApprovedBasicCountryImportFromLoader(prepared)) {
    throw new BasicCountryImportError("BASIC_IMPORT_UNTRUSTED_PREPARATION");
  }
  if (!hasExactBasicPlan(prepared)) {
    throw new BasicCountryImportError("BASIC_IMPORT_PREFLIGHT_FAILED");
  }

  try {
    return await port.transaction(async (transaction) => {
      const preflight = await preflightBasicCountryActivation(
        prepared.countryCode,
        transaction.activationCounts,
      );
      if (!preflight.valid) {
        throw new BasicCountryImportError("BASIC_IMPORT_PREFLIGHT_FAILED");
      }
      if (preflight.activation !== "ready") {
        throw new BasicCountryImportError("BASIC_IMPORT_LEGACY_DATA_PRESENT");
      }

      for (const operation of prepared.plan.operations) {
        await transaction.execute(operation);
      }

      const readback = await transaction.readCanonical(prepared.countryCode);
      if (readback === null || !isDeepStrictEqual(readback, prepared.canonical)) {
        throw new BasicCountryImportError("BASIC_IMPORT_READBACK_MISMATCH");
      }
      return {
        countryCode: prepared.countryCode,
        operationCount: prepared.plan.operations.length,
      };
    });
  } catch (error) {
    if (error instanceof BasicCountryImportError) throw error;
    throw new BasicCountryImportError("BASIC_IMPORT_DATABASE_OPERATION_FAILED", {
      cause: error,
    });
  }
}

function hasExactBasicPlan(prepared: PreparedApprovedBasicCountryImport): boolean {
  const { canonical, countryCode, countryDirectory, plan } = prepared;
  if (countryDirectory.length === 0 || countryCode.length !== 2) return false;
  if (!hasCanonicalCountryCode(canonical, countryCode)) return false;
  if (!hasExactKeys(plan.summary, ["countryCode", "coverageLevel", "moduleStatuses"])) {
    return false;
  }
  if (
    plan.summary.countryCode !== countryCode ||
    plan.summary.coverageLevel !== "BASIC" ||
    !hasExactModuleStatuses(plan.summary.moduleStatuses)
  ) {
    return false;
  }
  if (!Array.isArray(plan.aiEligibleKnowledgeIds) || plan.aiEligibleKnowledgeIds.length !== 0) {
    return false;
  }
  if (plan.operations.length !== MODULE_KEYS.length + 2) return false;

  const countryOperation = plan.operations[0];
  const marketOverviewOperation = plan.operations.at(-1);
  if (
    countryOperation === undefined ||
    marketOverviewOperation === undefined ||
    !isExactCountryOperation(countryOperation, countryCode) ||
    !isExactMarketOverviewOperation(marketOverviewOperation, countryCode)
  ) {
    return false;
  }

  return MODULE_KEYS.every((moduleKey, index) => {
    const operation = plan.operations[index + 1];
    return operation !== undefined && isExactModuleCoverageOperation(
      operation,
      countryCode,
      MODULE_KEY_TO_IMPORT_VALUE[moduleKey],
    );
  });
}

function hasCanonicalCountryCode(
  canonical: BasicCanonicalData,
  countryCode: string,
): boolean {
  return isRecord(canonical.country) &&
    canonical.country.code === countryCode &&
    canonical.country.coverageLevel === "BASIC";
}

function hasExactModuleStatuses(value: Record<string, string>): boolean {
  if (!hasExactKeys(value, MODULE_KEYS)) return false;
  return MODULE_KEYS.every((moduleKey) =>
    value[moduleKey] === (moduleKey === "market-overview" ? "COMPLETE" : "BUILDING")
  );
}

function isExactCountryOperation(
  operation: BasicSeedImportOperation,
  countryCode: string,
): boolean {
  if (operation.model !== "country" || operation.action !== "upsert") return false;
  const { args } = operation;
  return hasExactKeys(args, ["where", "create", "update"]) &&
    hasExactKeys(args.where, ["code"]) &&
    args.where.code === countryCode &&
    isExactCountryData(args.create, countryCode) &&
    isDeepStrictEqual(args.create, args.update);
}

function isExactModuleCoverageOperation(
  operation: BasicSeedImportOperation,
  countryCode: string,
  moduleKey: string,
): boolean {
  if (operation.model !== "moduleCoverage" || operation.action !== "upsert") return false;
  const { args } = operation;
  const where = args.where.countryCode_moduleKey;
  return hasExactKeys(args, ["where", "create", "update"]) &&
    hasExactKeys(args.where, ["countryCode_moduleKey"]) &&
    hasExactKeys(where, ["countryCode", "moduleKey"]) &&
    where.countryCode === countryCode &&
    where.moduleKey === moduleKey &&
    isExactModuleCoverageData(args.create, countryCode, moduleKey) &&
    isDeepStrictEqual(args.create, args.update);
}

function isExactMarketOverviewOperation(
  operation: BasicSeedImportOperation,
  countryCode: string,
): boolean {
  if (operation.model !== "marketOverview" || operation.action !== "upsert") return false;
  const { args } = operation;
  return hasExactKeys(args, ["where", "create", "update"]) &&
    hasExactKeys(args.where, ["countryCode"]) &&
    args.where.countryCode === countryCode &&
    isExactMarketOverviewData(args.create, countryCode) &&
    isDeepStrictEqual(args.create, args.update);
}

function isExactCountryData(value: unknown, countryCode: string): boolean {
  return isRecord(value) &&
    hasExactKeys(value, COUNTRY_DATA_KEYS) &&
    value.code === countryCode &&
    value.coverageLevel === "BASIC";
}

function isExactModuleCoverageData(
  value: unknown,
  countryCode: string,
  moduleKey: string,
): boolean {
  return isRecord(value) &&
    hasExactKeys(value, MODULE_COVERAGE_DATA_KEYS) &&
    value.countryCode === countryCode &&
    value.moduleKey === moduleKey &&
    value.status === (moduleKey === "MARKET_OVERVIEW" ? "COMPLETE" : "BUILDING") &&
    value.dataCount === (moduleKey === "MARKET_OVERVIEW" ? 1 : 0);
}

function isExactMarketOverviewData(value: unknown, countryCode: string): boolean {
  return isRecord(value) &&
    hasExactKeys(value, MARKET_OVERVIEW_DATA_KEYS) &&
    value.countryCode === countryCode;
}

function hasExactKeys(value: object, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length &&
    keys.every((key, index) => key === [...expected].sort()[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
