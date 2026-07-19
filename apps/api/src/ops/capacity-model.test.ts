import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import {
  M1_CAPACITY_ASSUMPTIONS,
  calculateCapacity,
  type CapacityAssumptions,
} from "./capacity-model.js";

const INVALID_INPUT_ERROR = "CAPACITY_MODEL_INVALID_INPUT";

describe("M1 capacity model", () => {
  test("publishes the fixed M1 assumptions as an immutable value", () => {
    expect(M1_CAPACITY_ASSUMPTIONS).toEqual({
      aiShare: 0,
      cacheHitRatio: 0.8,
      peakHourShare: 0.1,
      readRatio: 1,
      surgeFactor: 2,
      writeRatio: 0,
    });
    expect(Object.isFrozen(M1_CAPACITY_ASSUMPTIONS)).toBe(true);
  });

  test.each([
    [100_000, { averageRps: 1.1574, dbRps: 1.2, peakRps: 6 }],
    [1_000_000, { averageRps: 11.5741, dbRps: 11.2, peakRps: 56 }],
    [10_000_000, { averageRps: 115.7407, dbRps: 111.2, peakRps: 556 }],
  ] as const)(
    "calculates the exact deterministic values for %,d daily requests",
    (dailyRequests, expected) => {
      expect(calculateCapacity(dailyRequests)).toEqual(expected);
    },
  );

  test.each([
    [0],
    [-1],
    [1.5],
    [Number.MAX_SAFE_INTEGER + 1],
    [Number.NaN],
    [Number.POSITIVE_INFINITY],
    [Number.NEGATIVE_INFINITY],
    ["100000" as never],
    [null as never],
  ])("fails closed for invalid daily request input %s", (dailyRequests) => {
    expectFixedInputError(() => calculateCapacity(dailyRequests));
  });

  test.each([
    ["zero peak-hour share", { peakHourShare: 0 }],
    ["negative peak-hour share", { peakHourShare: -0.1 }],
    ["peak-hour share above one", { peakHourShare: 1.1 }],
    ["zero surge factor", { surgeFactor: 0 }],
    ["negative surge factor", { surgeFactor: -1 }],
    ["negative read ratio", { readRatio: -0.1 }],
    ["read ratio above one", { readRatio: 1.1 }],
    ["negative write ratio", { writeRatio: -0.1 }],
    ["write ratio above one", { writeRatio: 1.1 }],
    ["negative cache-hit ratio", { cacheHitRatio: -0.1 }],
    ["cache-hit ratio above one", { cacheHitRatio: 1.1 }],
    ["negative AI share", { aiShare: -0.1 }],
    ["nonzero AI share outside M1", { aiShare: 0.1 }],
    ["AI share above one", { aiShare: 1.1 }],
    ["read/write ratios below one in total", { readRatio: 0.4, writeRatio: 0.5 }],
    ["read/write ratios above one in total", { readRatio: 0.6, writeRatio: 0.5 }],
  ] as const)("fails closed for %s", (_label, override) => {
    expectFixedInputError(() =>
      calculateCapacity(100_000, assumptionsWith(override)),
    );
  });

  test.each([
    "peakHourShare",
    "surgeFactor",
    "readRatio",
    "writeRatio",
    "cacheHitRatio",
    "aiShare",
  ] as const)("fails closed when %s is non-finite", (field) => {
    for (const value of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]) {
      expectFixedInputError(() =>
        calculateCapacity(100_000, assumptionsWith({ [field]: value })),
      );
    }
  });

  test("fails closed for malformed assumptions", () => {
    expectFixedInputError(() => calculateCapacity(100_000, null as never));
    expectFixedInputError(() => calculateCapacity(100_000, {} as never));
    expectFixedInputError(() =>
      calculateCapacity(100_000, assumptionsWith({ readRatio: "1" as never })),
    );
  });

  test("stays a pure local model without AI, network, database, or environment access", () => {
    const source = readFileSync(
      new URL("./capacity-model.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toMatch(/\b(?:import|require)\s*(?:\(|[^\n]*\bfrom\b)/u);
    expect(source).not.toMatch(/\bfetch\s*\(/u);
    expect(source).not.toMatch(/\b(?:process|Deno)\.env\b/u);
    expect(source).not.toMatch(/\b(?:DATABASE_URL|PrismaClient|pgvector)\b/u);
  });
});

function assumptionsWith(
  override: Partial<CapacityAssumptions>,
): CapacityAssumptions {
  return { ...M1_CAPACITY_ASSUMPTIONS, ...override };
}

function expectFixedInputError(action: () => unknown): void {
  let captured: Error | undefined;
  try {
    action();
  } catch (error) {
    if (error instanceof Error) captured = error;
  }
  expect(captured?.message).toBe(INVALID_INPUT_ERROR);
  expect(captured).not.toHaveProperty("cause");
}
