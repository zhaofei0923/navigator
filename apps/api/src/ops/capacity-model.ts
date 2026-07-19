export interface CapacityAssumptions {
  readonly aiShare: number;
  readonly cacheHitRatio: number;
  readonly peakHourShare: number;
  readonly readRatio: number;
  readonly surgeFactor: number;
  readonly writeRatio: number;
}

export interface CapacityEstimate {
  readonly averageRps: number;
  readonly dbRps: number;
  readonly peakRps: number;
}

export const M1_CAPACITY_ASSUMPTIONS = Object.freeze({
  peakHourShare: 0.1,
  surgeFactor: 2,
  readRatio: 1,
  writeRatio: 0,
  cacheHitRatio: 0.8,
  aiShare: 0,
} as const satisfies CapacityAssumptions);

const INVALID_INPUT_ERROR = "CAPACITY_MODEL_INVALID_INPUT";
const SECONDS_PER_DAY = 86_400;
const SECONDS_PER_HOUR = 3_600;
const OUTPUT_PRECISION_FACTOR = 10_000;

export function calculateCapacity(
  dailyRequests: number,
  assumptions: CapacityAssumptions = M1_CAPACITY_ASSUMPTIONS,
): CapacityEstimate {
  try {
    validateDailyRequests(dailyRequests);
    validateAssumptions(assumptions);

    const averageRps = dailyRequests / SECONDS_PER_DAY;
    const peakRps = Math.ceil(
      (dailyRequests * assumptions.peakHourShare * assumptions.surgeFactor) /
        SECONDS_PER_HOUR,
    );
    const dbRps =
      peakRps *
      (assumptions.readRatio * (1 - assumptions.cacheHitRatio) +
        assumptions.writeRatio);

    if (
      !Number.isFinite(averageRps) ||
      !Number.isSafeInteger(peakRps) ||
      peakRps < 0 ||
      !Number.isFinite(dbRps) ||
      dbRps < 0
    ) {
      throw new Error(INVALID_INPUT_ERROR);
    }

    return {
      averageRps: roundOutput(averageRps),
      dbRps: roundOutput(dbRps),
      peakRps,
    };
  } catch {
    throw new Error(INVALID_INPUT_ERROR);
  }
}

function validateDailyRequests(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error(INVALID_INPUT_ERROR);
  }
}

function validateAssumptions(
  value: unknown,
): asserts value is CapacityAssumptions {
  if (value === null || typeof value !== "object") {
    throw new Error(INVALID_INPUT_ERROR);
  }

  const assumptions = value as Partial<CapacityAssumptions>;
  if (
    !isRatio(assumptions.peakHourShare, false) ||
    !isPositiveFinite(assumptions.surgeFactor) ||
    !isRatio(assumptions.readRatio) ||
    !isRatio(assumptions.writeRatio) ||
    !isRatio(assumptions.cacheHitRatio) ||
    !isRatio(assumptions.aiShare) ||
    assumptions.aiShare !== 0 ||
    Math.abs(assumptions.readRatio + assumptions.writeRatio - 1) >
      Number.EPSILON
  ) {
    throw new Error(INVALID_INPUT_ERROR);
  }
}

function isRatio(value: unknown, allowZero = true): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    (allowZero ? value >= 0 : value > 0) &&
    value <= 1
  );
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function roundOutput(value: number): number {
  const rounded =
    Math.round(value * OUTPUT_PRECISION_FACTOR) / OUTPUT_PRECISION_FACTOR;
  if (!Number.isFinite(rounded)) {
    throw new Error(INVALID_INPUT_ERROR);
  }
  return rounded;
}
