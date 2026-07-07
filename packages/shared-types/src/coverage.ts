import type {
  CoverageLevel,
  ModuleCoverageStatus,
  ModuleKey,
} from "./schema.js";

export interface ModuleCoverageDecision {
  moduleKey: ModuleKey;
  status: ModuleCoverageStatus;
  dataCount: number;
}

export interface AiAdvisorCoverageInput {
  usableKnowledgeCount: number;
  sourceModuleCount: number;
}

type ModuleStatusRecord = Partial<Record<ModuleKey, ModuleCoverageStatus>>;
type CountryCoverageInput = ModuleStatusRecord | readonly ModuleCoverageDecision[];

const COMPLETE_LIST_THRESHOLD = 5;
const COMPLETE_OBJECT_FILL_RATE = 0.8;
const COMPLETE_AI_KNOWLEDGE_THRESHOLD = 20;
const COMPLETE_AI_SOURCE_MODULE_THRESHOLD = 3;

const REQUIRED_COMPLETE_MODULE_KEYS: readonly ModuleKey[] = [
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
];

const REQUIRED_STANDARD_MODULE_KEYS: readonly ModuleKey[] = [
  "market-overview",
  "policy",
  "risk",
  "opportunities",
];

export function getListModuleCoverageStatus(
  dataCount: number,
): ModuleCoverageStatus {
  if (dataCount <= 0) {
    return "BUILDING";
  }

  return dataCount >= COMPLETE_LIST_THRESHOLD ? "COMPLETE" : "PARTIAL";
}

export function getObjectModuleCoverageStatus(
  item: Record<string, unknown> | null | undefined,
  coreFields: readonly string[],
): ModuleCoverageStatus {
  const fillRate = getObjectModuleFillRate(item, coreFields);
  if (fillRate === 0) {
    return "BUILDING";
  }

  return fillRate >= COMPLETE_OBJECT_FILL_RATE ? "COMPLETE" : "PARTIAL";
}

export function getObjectModuleFillRate(
  item: Record<string, unknown> | null | undefined,
  coreFields: readonly string[],
): number {
  if (item === null || item === undefined || coreFields.length === 0) {
    return 0;
  }

  const filledCount = coreFields.filter((field) => isFilled(item[field])).length;
  return filledCount / coreFields.length;
}

export function getAiAdvisorCoverageStatus({
  usableKnowledgeCount,
  sourceModuleCount,
}: AiAdvisorCoverageInput): ModuleCoverageStatus {
  if (usableKnowledgeCount <= 0) {
    return "BUILDING";
  }

  if (
    usableKnowledgeCount >= COMPLETE_AI_KNOWLEDGE_THRESHOLD &&
    sourceModuleCount >= COMPLETE_AI_SOURCE_MODULE_THRESHOLD
  ) {
    return "COMPLETE";
  }

  return "PARTIAL";
}

export function getCountryCoverageLevel(
  coverage: CountryCoverageInput,
): CoverageLevel {
  const statuses: ModuleStatusRecord = isModuleCoverageDecisionArray(coverage)
    ? moduleCoverageArrayToRecord(coverage)
    : coverage;

  if (
    REQUIRED_COMPLETE_MODULE_KEYS.every(
      (moduleKey) => statuses[moduleKey] === "COMPLETE",
    )
  ) {
    return "COMPLETE";
  }

  if (
    REQUIRED_STANDARD_MODULE_KEYS.every((moduleKey) =>
      isAtLeastPartial(statuses[moduleKey]),
    )
  ) {
    return "STANDARD";
  }

  if (!isAtLeastPartial(statuses["market-overview"])) {
    throw new Error(
      "market-overview must be at least PARTIAL before assigning BASIC coverage",
    );
  }

  return "BASIC";
}

export function isAtLeastPartial(
  status: ModuleCoverageStatus | undefined,
): boolean {
  return status === "PARTIAL" || status === "COMPLETE";
}

function moduleCoverageArrayToRecord(
  coverage: readonly ModuleCoverageDecision[],
): ModuleStatusRecord {
  return Object.fromEntries(
    coverage.map((item) => [item.moduleKey, item.status]),
  ) as ModuleStatusRecord;
}

function isModuleCoverageDecisionArray(
  coverage: CountryCoverageInput,
): coverage is readonly ModuleCoverageDecision[] {
  return Array.isArray(coverage);
}

function isFilled(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === "string") {
    return value.trim() !== "";
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.some(isFilled);
  }
  if (isRecord(value)) {
    return Object.values(value).some(isFilled);
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}
