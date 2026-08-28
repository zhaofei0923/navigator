// Navigation groups only: preserve the reviewed region in the source data.
export const MARKET_REGIONS = [
  {
    code: "Asia",
    labels: { "zh-CN": "亚洲", en: "Asia" },
    sourceRegions: ["Asia", "East Asia", "Southeast Asia", "South Asia", "Central Asia"],
  },
  {
    code: "Middle East",
    labels: { "zh-CN": "中东", en: "Middle East" },
    sourceRegions: ["Middle East"],
  },
  {
    code: "Europe",
    labels: { "zh-CN": "欧洲", en: "Europe" },
    sourceRegions: ["Europe", "Europe / West Asia"],
  },
  {
    code: "Africa",
    labels: { "zh-CN": "非洲", en: "Africa" },
    sourceRegions: ["Africa", "East Africa", "North Africa", "Southern Africa", "West Africa"],
  },
  {
    code: "North America",
    labels: { "zh-CN": "北美洲", en: "North America" },
    sourceRegions: ["North America"],
  },
  {
    code: "Latin America",
    labels: { "zh-CN": "拉丁美洲", en: "Latin America" },
    sourceRegions: ["Latin America", "Central America", "Caribbean"],
  },
  {
    code: "Oceania",
    labels: { "zh-CN": "大洋洲", en: "Oceania" },
    sourceRegions: ["Oceania"],
  },
  {
    code: "Other",
    labels: { "zh-CN": "其他", en: "Other" },
    sourceRegions: [],
  },
] as const;

export type MarketRegionCode = (typeof MARKET_REGIONS)[number]["code"];

const SOURCE_REGION_GROUPS = new Map<string, MarketRegionCode>(
  MARKET_REGIONS.flatMap((group) =>
    group.sourceRegions.map((region) => [region, group.code] as const),
  ),
);

export function marketRegionFor(region: string): MarketRegionCode {
  return SOURCE_REGION_GROUPS.get(region) ?? "Other";
}
