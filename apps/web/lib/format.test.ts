import { describe, expect, it } from "vitest";
import { formatDate, formatNumber, trendValue } from "@/lib/format";

describe("format helpers", () => {
  it("formats an ISO date without timezone drift", () => {
    expect(formatDate("2026-08-22")).toBe("2026-08-22");
  });

  it("keeps invalid values readable and marks missing values", () => {
    expect(formatDate("not-a-date")).toBe("not-a-date");
    expect(formatDate(undefined)).toBe("未提供");
  });

  it("formats numbers and extracts a trend value", () => {
    expect(formatNumber(1234.56, 1)).toBe("1,234.6");
    expect(trendValue("较上期 -2")).toBe(-2);
    expect(trendValue("稳定")).toBe(0);
  });
});
