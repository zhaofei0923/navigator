import { describe, expect, it } from "vitest";
import { isBasic60Envelope } from "@/lib/basic60/contract";

describe("isBasic60Envelope", () => {
  const valid = {
    meta: {
      release_id: "BASIC60-PRIVATE-R1",
      release_profile: "basic60_private",
      formal_gate_status: "pending",
      coverage_level: "Basic",
      as_of: "2026-08-25",
      result_count: 60,
      next_cursor: null,
    },
    data: [],
  };

  it("accepts the bounded private-trial contract", () => {
    expect(isBasic60Envelope(valid)).toBe(true);
  });

  it.each([
    ["a demo envelope", { ...valid, meta: { ...valid.meta, release_profile: "synthetic_demo" } }],
    ["a formal completion claim", { ...valid, meta: { ...valid.meta, formal_gate_status: "passed" } }],
    ["another release", { ...valid, meta: { ...valid.meta, release_id: "BASIC60-PROD-R1" } }],
    ["another coverage level", { ...valid, meta: { ...valid.meta, coverage_level: "Standard" } }],
    ["an invalid as-of date", { ...valid, meta: { ...valid.meta, as_of: "today" } }],
  ])("rejects %s", (_label, envelope) => {
    expect(isBasic60Envelope(envelope)).toBe(false);
  });
});
