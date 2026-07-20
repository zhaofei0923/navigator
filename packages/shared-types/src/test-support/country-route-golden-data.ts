export const GOLDEN_MODULE_KEYS = [
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

interface GoldenProfileFieldOptions {
  readonly key: string;
  readonly label: { readonly zh: string; readonly en: string };
  readonly status: "AVAILABLE" | "NOT_AVAILABLE";
  readonly value: unknown;
  readonly sourceIds: readonly string[];
  readonly unit?: string | null;
  readonly year?: number | null;
  readonly reason?: { readonly zh: string; readonly en: string } | null;
}

function profileField({
  key,
  label,
  status,
  value,
  sourceIds,
  unit = null,
  year = null,
  reason = null,
}: GoldenProfileFieldOptions) {
  return {
    key,
    label,
    status,
    value,
    unit,
    year,
    sourceIds,
    checkedAt: "2026-07-20",
    reason,
    note: null,
  };
}

function profileSource(
  id: string,
  publisher: string,
  title: { readonly zh: string; readonly en: string },
  url: string,
  retrievedAt: string,
  publishedAt: string | null = null,
) {
  return {
    id,
    publisher,
    title,
    url,
    publishedAt,
    retrievedAt,
    credibility: "OFFICIAL",
  };
}

const EMBER_UNAVAILABLE_REASON = {
  zh: "未提供已审核的Ember不可变标准化快照",
  en: "A reviewed immutable normalized Ember snapshot was not provided",
} as const;

const IRENA_UNAVAILABLE_REASONS = {
  total: {
    zh: "尚未取得IRENA对商业产品自动获取和使用IRENASTAT数据的书面许可，因此本批不写入可再生能源总装机数值",
    en: "Written IRENA permission for automated retrieval and commercial-product use of IRENASTAT data has not been obtained so total renewable capacity is not included in this batch",
  },
  solar: {
    zh: "尚未取得IRENA对商业产品自动获取和使用IRENASTAT数据的书面许可，因此本批不写入太阳能装机数值",
    en: "Written IRENA permission for automated retrieval and commercial-product use of IRENASTAT data has not been obtained so solar capacity is not included in this batch",
  },
  wind: {
    zh: "尚未取得IRENA对商业产品自动获取和使用IRENASTAT数据的书面许可，因此本批不写入风电装机数值",
    en: "Written IRENA permission for automated retrieval and commercial-product use of IRENASTAT data has not been obtained so wind capacity is not included in this batch",
  },
  hydro: {
    zh: "尚未取得IRENA对商业产品自动获取和使用IRENASTAT数据的书面许可，因此本批不写入水电装机数值",
    en: "Written IRENA permission for automated retrieval and commercial-product use of IRENASTAT data has not been obtained so hydropower capacity is not included in this batch",
  },
} as const;

const GOLDEN_ID_BASIC_PROFILE = {
  schemaVersion: "basic-market-profile/v2",
  categories: {
    countryBasics: {
      fields: [
        profileField({ key: "countryCode", label: { zh: "国家代码", en: "Country code" }, status: "AVAILABLE", value: "ID", sourceIds: ["world-bank-country"] }),
        profileField({ key: "countryName", label: { zh: "国家名称", en: "Country name" }, status: "AVAILABLE", value: { zh: "印度尼西亚", en: "Indonesia" }, sourceIds: ["world-bank-country"] }),
        profileField({ key: "region", label: { zh: "区域", en: "Region" }, status: "AVAILABLE", value: "southeast-asia", sourceIds: ["indonesia-esdm-2025-performance"] }),
        profileField({ key: "population", label: { zh: "人口", en: "Population" }, status: "AVAILABLE", value: 285721236, unit: "people", year: 2025, sourceIds: ["world-bank-population"] }),
        profileField({ key: "gdp", label: { zh: "国内生产总值", en: "GDP" }, status: "AVAILABLE", value: 1445642584163.81, unit: "current US$", year: 2025, sourceIds: ["world-bank-gdp"] }),
        profileField({ key: "gdpPerCapita", label: { zh: "人均国内生产总值", en: "GDP per capita" }, status: "AVAILABLE", value: 5059.62596411213, unit: "current US$ per person", year: 2025, sourceIds: ["world-bank-gdp-per-capita"] }),
        profileField({ key: "gdpGrowth", label: { zh: "国内生产总值增长率", en: "GDP growth" }, status: "AVAILABLE", value: 5.10808904438025, unit: "%", year: 2025, sourceIds: ["world-bank-gdp-growth"] }),
      ],
    },
    electricityMarket: {
      fields: [
        profileField({ key: "totalGeneration", label: { zh: "总发电量", en: "Total generation" }, status: "NOT_AVAILABLE", value: null, sourceIds: ["ember-electricity"], reason: EMBER_UNAVAILABLE_REASON }),
        profileField({ key: "electricityConsumption", label: { zh: "用电量", en: "Electricity consumption" }, status: "NOT_AVAILABLE", value: null, sourceIds: ["ember-electricity"], reason: EMBER_UNAVAILABLE_REASON }),
        profileField({ key: "electricityMix", label: { zh: "电力结构", en: "Electricity mix" }, status: "NOT_AVAILABLE", value: null, sourceIds: ["ember-electricity"], reason: EMBER_UNAVAILABLE_REASON }),
        profileField({ key: "renewableGenerationShare", label: { zh: "可再生发电占比", en: "Renewable generation share" }, status: "NOT_AVAILABLE", value: null, sourceIds: ["ember-electricity"], reason: EMBER_UNAVAILABLE_REASON }),
      ],
    },
    energyAccess: {
      fields: [
        profileField({ key: "electricityAccess", label: { zh: "通电率", en: "Access to electricity" }, status: "AVAILABLE", value: 99.9, unit: "%", year: 2024, sourceIds: ["world-bank-electricity-access"] }),
      ],
    },
    renewableCapacity: {
      fields: [
        profileField({ key: "totalRenewableCapacity", label: { zh: "可再生能源总装机", en: "Total renewable capacity" }, status: "NOT_AVAILABLE", value: null, sourceIds: ["irenastat-capacity"], reason: IRENA_UNAVAILABLE_REASONS.total }),
        profileField({ key: "solarCapacity", label: { zh: "太阳能装机", en: "Solar capacity" }, status: "NOT_AVAILABLE", value: null, sourceIds: ["irenastat-capacity"], reason: IRENA_UNAVAILABLE_REASONS.solar }),
        profileField({ key: "windCapacity", label: { zh: "风电装机", en: "Wind capacity" }, status: "NOT_AVAILABLE", value: null, sourceIds: ["irenastat-capacity"], reason: IRENA_UNAVAILABLE_REASONS.wind }),
        profileField({ key: "hydroCapacity", label: { zh: "水电装机", en: "Hydropower capacity" }, status: "NOT_AVAILABLE", value: null, sourceIds: ["irenastat-capacity"], reason: IRENA_UNAVAILABLE_REASONS.hydro }),
      ],
    },
    solarResource: {
      fields: [
        profileField({
          key: "ghi", label: { zh: "全球水平辐照度", en: "GHI" }, status: "NOT_AVAILABLE", value: null, sourceIds: ["global-solar-atlas"],
          reason: { zh: "Global Solar Atlas国家GIS下载页未提供经批准的自动化接口且条款禁止自动设备访问；本批未人工下载并审核栅格，因此不提供GHI数值", en: "The Global Solar Atlas country GIS page provides no approved automation interface and its terms prohibit automated access; no raster was manually downloaded and reviewed for this batch so GHI is not available" },
        }),
        profileField({
          key: "pvout", label: { zh: "光伏输出", en: "PVOUT" }, status: "NOT_AVAILABLE", value: null, sourceIds: ["global-solar-atlas"],
          reason: { zh: "Global Solar Atlas国家GIS下载页未提供经批准的自动化接口且条款禁止自动设备访问；本批未人工下载并审核栅格，因此不提供PVOUT数值", en: "The Global Solar Atlas country GIS page provides no approved automation interface and its terms prohibit automated access; no raster was manually downloaded and reviewed for this batch so PVOUT is not available" },
        }),
        profileField({
          key: "solarPotentialSummary", label: { zh: "太阳能潜力摘要", en: "Solar potential summary" }, status: "NOT_AVAILABLE", value: null, sourceIds: ["global-solar-atlas"],
          reason: { zh: "本批未取得经人工审核的Global Solar Atlas国家栅格及聚合方法，无法生成双语太阳能潜力摘要", en: "No manually reviewed Global Solar Atlas country raster and aggregation method were obtained for this batch so a bilingual solar potential summary cannot be produced" },
        }),
      ],
    },
    windResource: {
      fields: [
        profileField({
          key: "onshoreWindClass", label: { zh: "陆上风资源等级", en: "Onshore wind class" }, status: "NOT_AVAILABLE", value: null, sourceIds: ["global-wind-atlas"],
          reason: { zh: "Global Wind Atlas提供栅格下载但未提供经审核的国家陆上风资源等级；本批尚未固定陆地边界掩膜和分级方法", en: "Global Wind Atlas provides raster downloads but no reviewed national onshore wind class; a land-boundary mask and classification method have not yet been fixed for this batch" },
        }),
        profileField({
          key: "offshoreWindClass", label: { zh: "近海风资源等级", en: "Offshore wind class" }, status: "NOT_AVAILABLE", value: null, sourceIds: ["global-wind-atlas"],
          reason: { zh: "Global Wind Atlas提供含专属经济区的栅格但未提供经审核的国家近海风资源等级；本批尚未固定海域边界掩膜和分级方法", en: "Global Wind Atlas provides rasters covering exclusive economic zones but no reviewed national offshore wind class; a marine-boundary mask and classification method have not yet been fixed for this batch" },
        }),
        profileField({
          key: "resourceSummary", label: { zh: "风资源摘要", en: "Wind resource summary" }, status: "NOT_AVAILABLE", value: null, sourceIds: ["global-wind-atlas"],
          reason: { zh: "未取得经审核的国家风资源等级及聚合方法，无法生成风资源摘要", en: "No reviewed national wind class and aggregation method were obtained, so a wind-resource summary is not available" },
        }),
      ],
    },
    policyOverview: {
      fields: [
        profileField({
          key: "summary", label: { zh: "政策摘要", en: "Policy summary" }, status: "AVAILABLE", sourceIds: ["iea-policies"],
          value: { zh: "IEA政策页将印尼国家电力总规划列为2025年生效的国家政策，并记录到2060年新能源和可再生能源约占能源结构73.6%的目标。", en: "The IEA policy page lists Indonesia's National Electricity General Plan as a national policy in force from 2025 and records a target for new and renewable energy to reach about 73.6% of the energy mix by 2060." },
        }),
      ],
    },
    marketSummary: {
      fields: [
        profileField({
          key: "opportunitySummary", label: { zh: "市场机会摘要", en: "Market opportunity summary" }, status: "AVAILABLE", sourceIds: ["iea-policies"],
          value: { zh: "对中国新能源企业而言，IEA记录的印尼国家电力总规划可作为跟踪当地电力转型政策的线索。该政策在2025年生效，并记录了到2060年新能源和可再生能源约占能源结构73.6%的目标。进入、融资、项目储备及并网条件仍需以进一步尽调核实。", en: "For Chinese new-energy companies, the IEA-recorded National Electricity General Plan is a lead for tracking Indonesia's power-transition policy. It took effect in 2025 and records a target for new and renewable energy to reach about 73.6% of the energy mix by 2060. Market entry, financing, project pipeline, and grid conditions still require further due diligence." },
        }),
      ],
    },
  },
  sources: [
    profileSource("ember-electricity", "Ember", { zh: "Ember 电力数据", en: "Ember electricity data" }, "https://ember-energy.org/data/electricity-data-explorer/", "2026-07-20T10:44:13Z"),
    profileSource("global-solar-atlas", "World Bank ESMAP", { zh: "全球太阳能地图集", en: "Global Solar Atlas" }, "https://globalsolaratlas.info/", "2026-07-20T10:44:13Z"),
    profileSource("global-wind-atlas", "World Bank ESMAP", { zh: "全球风能地图集", en: "Global Wind Atlas" }, "https://globalwindatlas.info/", "2026-07-20T10:44:13Z"),
    profileSource("iea-policies", "International Energy Agency", { zh: "印尼国家电力总规划", en: "Indonesia National Electricity General Plan" }, "https://www.iea.org/policies/30494-national-electricity-general-plan", "2026-07-20T10:44:13Z"),
    profileSource("indonesia-esdm-2025-performance", "Indonesia Ministry of Energy and Mineral Resources", { zh: "Indonesia Ministry of Energy and Mineral Resources", en: "Indonesia Ministry of Energy and Mineral Resources" }, "https://www.esdm.go.id/en/media-center/news-archives/capaian-positif-tahun-2025-negara-hadir-penuhi-kebutuhan-energi-masyarakat", "2026-07-20T12:14:11.627Z", "2026-01-09T00:00:00.000Z"),
    profileSource("irenastat-capacity", "International Renewable Energy Agency (IRENA)", { zh: "IRENASTAT 装机容量", en: "IRENASTAT capacity" }, "https://pxweb.irena.org/pxweb/en/IRENASTAT/", "2026-07-20T10:44:13Z"),
    profileSource("world-bank-country", "World Bank", { zh: "World Bank", en: "World Bank" }, "https://api.worldbank.org/v2/country/ID?format=json", "2026-07-20T12:21:28.851Z"),
    profileSource("world-bank-electricity-access", "World Bank", { zh: "通电率", en: "Access to electricity" }, "https://api.worldbank.org/v2/country/ID/indicator/EG.ELC.ACCS.ZS?source=2&format=json&mrv=1&per_page=1", "2026-07-20T12:38:45.306Z"),
    profileSource("world-bank-gdp", "World Bank", { zh: "World Bank", en: "World Bank" }, "https://api.worldbank.org/v2/country/ID/indicator/NY.GDP.MKTP.CD?source=2&format=json&mrv=1&per_page=1", "2026-07-20T12:21:30.499Z"),
    profileSource("world-bank-gdp-growth", "World Bank", { zh: "World Bank", en: "World Bank" }, "https://api.worldbank.org/v2/country/ID/indicator/NY.GDP.MKTP.KD.ZG?source=2&format=json&mrv=1&per_page=1", "2026-07-20T12:21:35.716Z"),
    profileSource("world-bank-gdp-per-capita", "World Bank", { zh: "人均国内生产总值", en: "GDP per capita" }, "https://api.worldbank.org/v2/country/ID/indicator/NY.GDP.PCAP.CD?source=2&format=json&mrv=1&per_page=1", "2026-07-20T12:38:45.357Z"),
    profileSource("world-bank-population", "World Bank", { zh: "World Bank", en: "World Bank" }, "https://api.worldbank.org/v2/country/ID/indicator/SP.POP.TOTL?source=2&format=json&mrv=1&per_page=1", "2026-07-20T12:21:36.482Z"),
  ],
  updatedAt: "2026-07-20T12:30:00Z",
} as const;

export const GOLDEN_COUNTRY_INPUTS = [
  {
    code: "ID",
    coverageLevel: "BASIC",
    flagEmoji: "🇮🇩",
    name: { en: "Indonesia", zh: "印度尼西亚" },
    region: "southeast-asia",
    summary: {
      en: "In 2025, renewables accounted for 15.75% of Indonesia's energy mix and electricity consumption was 1,584 kWh per capita; generation capacity also continued to expand.",
      zh: "印度尼西亚2025年可再生能源占能源结构15.75%，人均用电量1,584千瓦时；同期电源装机容量继续扩大。",
    },
    updatedAt: "2026-01-09T00:00:00.000Z",
  },
  {
    code: "VN",
    coverageLevel: "BASIC",
    flagEmoji: "🇻🇳",
    name: { en: "Viet Nam", zh: "越南" },
    region: "southeast-asia",
    summary: {
      en: "Viet Nam's power system had 82,387 MW of installed capacity in 2024, including 21,447 MW of renewables; total power production and purchases reached 308,732 million kWh. The adjusted Power Development Plan VIII sets 2030 ranges for wind, solar, and storage.",
      zh: "越南2024年电力系统总装机82,387兆瓦，其中可再生能源装机21,447兆瓦；全年发电与购电总量为308,732百万千瓦时。调整后的电力规划VIII列明了2030年风电、光伏和储能发展区间。",
    },
    updatedAt: "2026-01-08T07:34:00.000Z",
  },
  {
    code: "SA",
    coverageLevel: "BASIC",
    flagEmoji: "🇸🇦",
    name: { en: "Saudi Arabia", zh: "沙特阿拉伯" },
    region: "middle-east",
    summary: {
      en: "Saudi Arabia had approximately 92.5 GW of total licensed generation capacity, 6,551 MW of operational renewable project capacity, and 402,628 GWh of electrical energy sent to the network in 2024. Official sources state renewable generation and storage capacity targets for 2030.",
      zh: "沙特阿拉伯2024年许可发电总装机容量约为92.5吉瓦，可再生能源项目投运容量为6,551兆瓦，电网受电量为402,628吉瓦时。官方资料列明了2030年可再生能源发电占比和储能容量目标。",
    },
    updatedAt: "2025-07-14T00:00:00.000Z",
  },
  {
    code: "AE",
    coverageLevel: "BASIC",
    flagEmoji: "🇦🇪",
    name: { en: "United Arab Emirates", zh: "阿拉伯联合酋长国" },
    region: "middle-east",
    summary: {
      en: "The United Arab Emirates' Barakah Nuclear Energy Plant generates 40 TWh per year and provides up to 25% of the country's electricity; the grid-connected UAE Wind Program has 103.5 MW of wind capacity. The updated UAE Energy Strategy 2050 states renewable and clean-energy targets for 2030.",
      zh: "阿拉伯联合酋长国的巴拉卡核电站每年发电40太瓦时，可提供该国高达25%的电力；并网的阿联酋风电项目风电容量为103.5兆瓦。更新后的《阿联酋能源战略2050》列明了2030年可再生能源和清洁能源目标。",
    },
    updatedAt: "2024-12-30T00:00:00.000Z",
  },
  {
    code: "BR",
    coverageLevel: "BASIC",
    flagEmoji: "🇧🇷",
    name: { en: "Brazil", zh: "巴西" },
    region: "latin-america",
    summary: {
      en: "Brazil's final electricity consumption grew 2.7% year on year in 2025. Solar PV generation was 88.1 TWh with 64,793 MW of installed capacity, while wind generation was 116.5 TWh with 34,707 MW. Wind and solar together accounted for 26.4% of total generation, and micro and mini distributed generation accounted for 7.0%.",
      zh: "巴西2025年最终电力消费同比增长2.7%；太阳能光伏发电量为88.1太瓦时、装机容量为64,793兆瓦，风电发电量为116.5太瓦时、装机容量为34,707兆瓦。风电和太阳能合计占总发电量的26.4%，微型和小型分布式发电占7.0%。",
    },
    updatedAt: "2026-06-03T00:00:00.000Z",
  },
  {
    code: "ZA",
    coverageLevel: "BASIC",
    flagEmoji: "🇿🇦",
    name: { en: "South Africa", zh: "南非" },
    region: "africa",
    summary: {
      en: "South Africa's power system is served by Eskom as its principal grid operator. Eskom reported 189.7 TWh of sales volumes and 195,702 GWh of Eskom-only energy sent out in FY2025. The government Integrated Resource Plan 2025, published on 28 October 2025, states that its current base includes installed, under-construction, and deemed-online-in-2025 capacity, including 5,344 MW of wind and 3,646 MW of grid-tied solar; it sets cumulative planned additions of 43,041 MW of wind and 28,713 MW of solar for 2026-2042. A 2023 announcement covered two hybrid renewable projects totaling 203 MW using solar PV, onshore wind, and battery storage.",
      zh: "南非电力系统以Eskom为主要电网运营商。Eskom在2025财年的售电量为189.7太瓦时，Eskom口径送出电量为195,702吉瓦时。2025年10月28日发布的政府《综合资源计划2025》显示，当前基础包括已投运、在建及视为于2025年投运的容量，其中风电5,344兆瓦、并网太阳能3,646兆瓦；该计划提出2026至2042年累计规划新增风电43,041兆瓦和太阳能28,713兆瓦。2023年公告的两个混合可再生能源项目总计203兆瓦，采用光伏、陆上风电和储能技术。",
    },
    updatedAt: "2025-10-28T00:00:00.000Z",
  },
] as const;

export const GOLDEN_ID_MARKET_OVERVIEW = {
  overview: {
    zh: "2025年能源与矿产领域投资为317亿美元，其中电力46亿美元、可再生能源与节能24亿美元。",
    en: "Energy and mineral investment reached USD 31.7 billion in 2025, including USD 4.6 billion in electricity and USD 2.4 billion in renewables and conservation.",
  },
  population: 285721236,
  gdp: 1445642584163.81,
  gdpGrowth: 5.10808904438025,
  energyDemand: {
    zh: "2025年人均用电量为1,584千瓦时，高于2024年的1,411千瓦时；电源装机容量同比增加7吉瓦至107.51吉瓦。",
    en: "Electricity consumption per capita was 1,584 kWh in 2025, up from 1,411 kWh in 2024; installed generation capacity increased by 7 GW to 107.51 GW.",
  },
  renewableTarget: {
    zh: "经核验的能源矿产资源部2025年实际数据表明，可再生能源占能源结构15.75%；该来源未在本草案中验证任何中长期目标。",
    en: "The verified 2025 Ministry data reports renewables at 15.75% of the energy mix; this draft does not verify any medium- or long-term target from this source.",
  },
  keyIndicators: [
    { label: { zh: "可再生能源占比", en: "Renewable energy mix share" }, value: "15.75", unit: "%", year: 2025 },
    { label: { zh: "人均用电量", en: "Electricity consumption per capita" }, value: "1584", unit: "kWh/person", year: 2025 },
  ],
  basicProfile: GOLDEN_ID_BASIC_PROFILE,
  source: "Indonesia Ministry of Energy and Mineral Resources",
  sourceUrl: "https://www.esdm.go.id/en/media-center/news-archives/capaian-positif-tahun-2025-negara-hadir-penuhi-kebutuhan-energi-masyarakat",
  collectedAt: "2026-07-20T12:21:36.482Z",
  updatedAt: "2026-01-09T00:00:00.000Z",
  credibility: "OFFICIAL",
  reviewStatus: "published",
  aiUsable: false,
  countryCode: "ID",
  industryTags: ["grid", "solar", "wind"],
  techTags: [],
} as const;
