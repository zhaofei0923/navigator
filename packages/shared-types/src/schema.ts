export type Locale = "zh-CN" | "en";

export const COVERAGE_LEVELS = ["BASIC", "STANDARD", "COMPLETE"] as const;
export type CoverageLevel = (typeof COVERAGE_LEVELS)[number];

export const MODULE_KEYS = [
  "market-overview",
  "policy",
  "risk",
  "opportunities",
  "projects",
  "partners",
  "chinese-companies",
  "entry-strategy",
  "ai-advisor",
  "reports",
] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

export const REVIEW_STATUSES = ["draft", "pending", "published"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const CREDIBILITIES = [
  "OFFICIAL",
  "VERIFIED",
  "ESTIMATED",
  "UNVERIFIED",
] as const;
export type Credibility = (typeof CREDIBILITIES)[number];

export const MODULE_COVERAGE_STATUSES = [
  "BUILDING",
  "PARTIAL",
  "COMPLETE",
] as const;
export type ModuleCoverageStatus = (typeof MODULE_COVERAGE_STATUSES)[number];

export const RISK_CATEGORIES = [
  "political",
  "economic",
  "legal",
  "exchange-rate",
  "operational",
  "social",
  "environmental",
] as const;
export type RiskCategory = (typeof RISK_CATEGORIES)[number];

export function isRiskCategory(value: unknown): value is RiskCategory {
  return (
    typeof value === "string" &&
    RISK_CATEGORIES.some((category) => category === value)
  );
}

export const RISK_LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const PROJECT_STATUSES = [
  "PLANNING",
  "BIDDING",
  "CONSTRUCTION",
  "OPERATIONAL",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const ACCESS_LEVELS = ["FREE", "MEMBER", "PREMIUM"] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

export const INDUSTRY_TAGS = [
  "solar",
  "wind",
  "storage",
  "ev",
  "hydrogen",
  "grid",
  "bess-mfg",
  "epc",
] as const;
export type IndustryTag = (typeof INDUSTRY_TAGS)[number];

export const TECH_TAGS = [
  "pv-module",
  "inverter",
  "onshore-wind",
  "offshore-wind",
  "lfp",
  "ncm",
  "electrolyzer",
] as const;
export type TechTag = (typeof TECH_TAGS)[number];

export const REGIONS = [
  "southeast-asia",
  "south-asia",
  "middle-east",
  "africa",
  "latin-america",
  "europe",
  "central-asia",
] as const;
export type Region = (typeof REGIONS)[number];

export const POLICY_TYPES = [
  "incentive",
  "tariff",
  "localization",
  "permit",
  "tax",
  "import-export",
] as const;
export type PolicyType = (typeof POLICY_TYPES)[number];
