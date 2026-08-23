import { describe, expect, it } from "vitest";
import {
  comparisonHref,
  normalizeCountryParam,
  resolveToolCountry,
  toolHref,
  toolMarket,
} from "@/lib/tool-journey";
import type { CountrySummary } from "@/lib/types";

const MARKETS: CountrySummary[] = [
  {
    data_origin: "synthetic_demo",
    code: "IDN",
    name_zh: "印度尼西亚",
    name_en: "Indonesia",
    region: "Southeast Asia",
    currency: "IDR",
    summary: "Synthetic market",
    scores: {
      market_attractiveness: 80,
      policy_certainty: 70,
      project_activity: 75,
      partner_maturity: 65,
      risk_controllability: 60,
    },
    dimension_deltas: {},
  },
  {
    data_origin: "synthetic_demo",
    code: "BRA",
    name_zh: "巴西",
    name_en: "Brazil",
    region: "Latin America",
    currency: "BRL",
    summary: "Synthetic market",
    scores: {
      market_attractiveness: 75,
      policy_certainty: 60,
      project_activity: 70,
      partner_maturity: 72,
      risk_controllability: 58,
    },
    dimension_deltas: {},
  },
];

describe("tool journey country routing", () => {
  it("normalizes a valid ISO3 value and rejects malformed parameters", () => {
    expect(normalizeCountryParam(" idn ")).toBe("IDN");
    expect(normalizeCountryParam("ID")).toBeNull();
    expect(normalizeCountryParam("IDN<script>")).toBeNull();
    expect(normalizeCountryParam(null)).toBeNull();
  });

  it("accepts a synthetic market and falls back to the first fixture market", () => {
    expect(resolveToolCountry("bra", MARKETS)).toBe("BRA");
    expect(resolveToolCountry("USA", MARKETS)).toBe("IDN");
    expect(resolveToolCountry("invalid", MARKETS)).toBe("IDN");
    expect(resolveToolCountry("BRA", [])).toBe("");
  });

  it("propagates the validated market through tool and comparison links", () => {
    expect(toolHref("/tools/assistant", "idn")).toBe("/tools/assistant?country=IDN");
    expect(toolHref("/tools/tenders?stage=watch", "BRA")).toBe(
      "/tools/tenders?stage=watch&country=BRA",
    );
    expect(toolHref("/tools/assistant", "invalid")).toBe("/tools/assistant");
    expect(comparisonHref("bra")).toBe("/compare?countries=BRA");
  });

  it("provides a locale-specific current-market label without changing its code", () => {
    expect(toolMarket("IDN", MARKETS, "zh-CN")).toEqual({
      code: "IDN",
      name: "印度尼西亚",
    });
    expect(toolMarket("IDN", MARKETS, "en")).toEqual({
      code: "IDN",
      name: "Indonesia",
    });
  });
});
