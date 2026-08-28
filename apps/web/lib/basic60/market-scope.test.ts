import { describe, expect, it } from "vitest";
import {
  isOutboundTargetCountry,
  normalizeOutboundCountryParam,
  outboundComparisonCodes,
} from "@/lib/basic60/market-scope";

describe("outbound market scope", () => {
  it.each(["CHN", "chn", " CHN ", "CN", "China", "", null, undefined])(
    "does not treat the origin country or invalid code as a target: %s",
    (code) => {
      expect(normalizeOutboundCountryParam(code)).toBeNull();
    },
  );

  it("normalizes overseas ISO3 codes", () => {
    expect(normalizeOutboundCountryParam(" idn ")).toBe("IDN");
    expect(normalizeOutboundCountryParam("BRA")).toBe("BRA");
  });

  it("filters China without mutating the reviewed country array", () => {
    const countries = Object.freeze([
      Object.freeze({ code: "CHN" }),
      Object.freeze({ code: "IDN" }),
      Object.freeze({ code: "BRA" }),
    ]);
    expect(countries.filter(isOutboundTargetCountry)).toEqual([{ code: "IDN" }, { code: "BRA" }]);
    expect(countries).toHaveLength(3);
    expect(countries[0].code).toBe("CHN");
  });

  it("removes China from comma-separated and repeated comparison parameters", () => {
    expect(outboundComparisonCodes("CHN,idn,BRA,chn")).toEqual(["IDN", "BRA"]);
    expect(outboundComparisonCodes(["CHN,IDN", "BRA", " idn "])).toEqual(["IDN", "BRA"]);
    expect(outboundComparisonCodes(undefined)).toEqual([]);
    expect(outboundComparisonCodes("CHN")).toEqual([]);
  });

  it("excludes the origin before applying the four-country comparison limit", () => {
    expect(outboundComparisonCodes("CHN,IDN,BRA,VNM,SAU,ZAF")).toEqual([
      "IDN", "BRA", "VNM", "SAU",
    ]);
  });
});
