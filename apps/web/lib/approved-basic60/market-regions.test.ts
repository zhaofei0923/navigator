import { describe, expect, it } from "vitest";
import { MARKET_REGIONS, marketRegionFor } from "@/lib/approved-basic60/market-regions";
import { isOutboundTargetCountry } from "@/lib/basic60/market-scope";

// Reviewed BASIC60-PRIVATE-R1 membership, independent of local runtime volumes.
const REVIEWED_COUNTRY_REGIONS = [
  { source: "Africa", group: "Africa", codes: "ZAF" },
  { source: "Caribbean", group: "Latin America", codes: "DOM" },
  { source: "Central America", group: "Latin America", codes: "PAN" },
  { source: "Central Asia", group: "Asia", codes: "KAZ UZB" },
  { source: "East Africa", group: "Africa", codes: "KEN RWA TZA UGA" },
  { source: "East Asia", group: "Asia", codes: "CHN JPN KOR" },
  {
    source: "Europe",
    group: "Europe",
    codes: "BEL DEU DNK ESP FIN FRA GBR GRC IRL ITA NLD NOR POL PRT ROU SWE",
  },
  { source: "Europe / West Asia", group: "Europe", codes: "TUR" },
  { source: "Latin America", group: "Latin America", codes: "ARG BRA CHL COL MEX PER URY" },
  { source: "Middle East", group: "Middle East", codes: "ARE JOR OMN SAU" },
  { source: "North Africa", group: "Africa", codes: "EGY MAR" },
  { source: "North America", group: "North America", codes: "CAN USA" },
  { source: "Oceania", group: "Oceania", codes: "AUS NZL" },
  { source: "South Asia", group: "Asia", codes: "BGD IND LKA NPL PAK" },
  { source: "Southeast Asia", group: "Asia", codes: "IDN MYS PHL SGP THA VNM" },
  { source: "Southern Africa", group: "Africa", codes: "NAM" },
  { source: "West Africa", group: "Africa", codes: "GHA NGA" },
] as const;

describe("marketRegionFor", () => {
  it.each(REVIEWED_COUNTRY_REGIONS)("groups $source under $group", ({ source, group }) => {
    expect(marketRegionFor(source)).toBe(group);
  });

  it("accepts an already broad Asia region", () => {
    expect(marketRegionFor("Asia")).toBe("Asia");
  });

  it.each(["Unclassified region", "Americas", ""])(
    "keeps an unknown region selectable in Other: %s",
    (source) => {
      const groupCode = marketRegionFor(source);
      expect(groupCode).toBe("Other");
      expect(MARKET_REGIONS.find((group) => group.code === groupCode)).toBeDefined();
    },
  );

  it("partitions all 60 reviewed countries once without dropping or duplicating a country", () => {
    const countries = REVIEWED_COUNTRY_REGIONS.flatMap(({ source, codes }) =>
      codes.split(" ").map((code) => ({ code, region: source })),
    );
    expect(REVIEWED_COUNTRY_REGIONS).toHaveLength(17);
    expect(countries).toHaveLength(60);
    expect(new Set(countries.map((country) => country.code)).size).toBe(60);

    const groupCounts = MARKET_REGIONS.map((group) => [
      group.code,
      countries.filter((country) => marketRegionFor(country.region) === group.code).length,
    ]);
    expect(groupCounts).toEqual([
      ["Asia", 16],
      ["Middle East", 4],
      ["Europe", 17],
      ["Africa", 10],
      ["North America", 2],
      ["Latin America", 9],
      ["Oceania", 2],
      ["Other", 0],
    ]);
  });

  it("presents only 59 overseas target markets while preserving the 60-country source package", () => {
    const sourceCountries = REVIEWED_COUNTRY_REGIONS.flatMap(({ source, codes }) =>
      codes.split(" ").map((code) => ({ code, region: source })),
    );
    const targets = sourceCountries.filter(isOutboundTargetCountry);
    expect(targets).toHaveLength(59);
    expect(new Set(targets.map((country) => country.code)).size).toBe(59);
    expect(targets.some((country) => country.code === "CHN")).toBe(false);
    expect(MARKET_REGIONS.map((group) => [
      group.code,
      targets.filter((country) => marketRegionFor(country.region) === group.code).length,
    ])).toEqual([
      ["Asia", 15], ["Middle East", 4], ["Europe", 17], ["Africa", 10],
      ["North America", 2], ["Latin America", 9], ["Oceania", 2], ["Other", 0],
    ]);
    expect(sourceCountries).toHaveLength(60);
  });

  it("adds Zambia to Africa for 60 overseas markets without changing the frozen 60-country membership", () => {
    const original = REVIEWED_COUNTRY_REGIONS.flatMap(({ source, codes }) =>
      codes.split(" ").map((code) => ({ code, region: source })),
    );
    const expanded = [...original, { code: "ZMB", region: "Southern Africa" }];
    const targets = expanded.filter(isOutboundTargetCountry);
    expect(expanded).toHaveLength(61);
    expect(expanded.slice(0, original.length)).toEqual(original);
    expect(targets).toHaveLength(60);
    expect(new Set(targets.map((country) => country.code)).size).toBe(60);
    expect(targets.some((country) => country.code === "CHN")).toBe(false);
    expect(targets.filter((country) => country.code === "ZMB")).toEqual([
      { code: "ZMB", region: "Southern Africa" },
    ]);
    expect(targets.filter((country) => marketRegionFor(country.region) === "Africa")).toHaveLength(11);
    expect(original).toHaveLength(60);
    expect(original.some((country) => country.code === "ZMB")).toBe(false);
  });
});

describe("MARKET_REGIONS", () => {
  it("keeps seven major groups in stable navigation order with Other last", () => {
    expect(MARKET_REGIONS.map((group) => group.code)).toEqual([
      "Asia",
      "Middle East",
      "Europe",
      "Africa",
      "North America",
      "Latin America",
      "Oceania",
      "Other",
    ]);
  });

  it("provides Chinese and English labels without changing group identities", () => {
    expect(MARKET_REGIONS.map((group) => group.labels["zh-CN"])).toEqual([
      "亚洲",
      "中东",
      "欧洲",
      "非洲",
      "北美洲",
      "拉丁美洲",
      "大洋洲",
      "其他",
    ]);
    expect(MARKET_REGIONS.map((group) => group.labels.en)).toEqual(
      MARKET_REGIONS.map((group) => group.code),
    );
  });

  it("assigns each declared source region to exactly one navigation group", () => {
    const sourceRegions = MARKET_REGIONS.flatMap((group) =>
      group.sourceRegions.map((source) => source),
    );
    expect(new Set(sourceRegions).size).toBe(sourceRegions.length);
    for (const group of MARKET_REGIONS) {
      for (const source of group.sourceRegions) {
        expect(marketRegionFor(source)).toBe(group.code);
      }
    }
  });
});
