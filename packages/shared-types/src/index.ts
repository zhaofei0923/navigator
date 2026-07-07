import type { Locale } from "./schema.js";

export {
  ACCESS_LEVELS,
  COVERAGE_LEVELS,
  CREDIBILITIES,
  INDUSTRY_TAGS,
  MODULE_COVERAGE_STATUSES,
  MODULE_KEYS,
  POLICY_TYPES,
  PROJECT_STATUSES,
  REGIONS,
  REVIEW_STATUSES,
  RISK_LEVELS,
  TECH_TAGS,
  type AccessLevel,
  type CoverageLevel,
  type Credibility,
  type IndustryTag,
  type Locale,
  type ModuleCoverageStatus,
  type ModuleKey,
  type PolicyType,
  type ProjectStatus,
  type Region,
  type ReviewStatus,
  type RiskLevel,
  type TechTag,
} from "./schema.js";

export {
  EnvValidationError,
  validateEnv,
  type AppEnvConfig,
  type LogLevel,
  type NodeEnv,
} from "./env.js";
export {
  getAiAdvisorCoverageStatus,
  getCountryCoverageLevel,
  getListModuleCoverageStatus,
  getObjectModuleCoverageStatus,
  getObjectModuleFillRate,
  isAtLeastPartial,
  type AiAdvisorCoverageInput,
  type ModuleCoverageDecision,
} from "./coverage.js";

export interface LocalizedText {
  zh: string;
  en: string;
}

export function pickLocale(
  text: LocalizedText | undefined | null,
  locale: Locale,
): { value: string; fallback: boolean } {
  const primary = text?.[locale === "zh-CN" ? "zh" : "en"];
  if (primary !== undefined && primary.trim() !== "") {
    return { value: primary, fallback: false };
  }

  const other = text?.[locale === "zh-CN" ? "en" : "zh"];
  if (other !== undefined && other.trim() !== "") {
    return { value: other, fallback: true };
  }

  return { value: "", fallback: true };
}
