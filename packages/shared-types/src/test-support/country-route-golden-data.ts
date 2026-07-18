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

export const GOLDEN_COUNTRY_INPUTS = [
  {
    code: "ID",
    coverageLevel: "BASIC",
    flagEmoji: "🇮🇩",
    name: { en: "Indonesia", zh: "印度尼西亚" },
    region: "southeast-asia",
    summary: {
      en: "In 2025, renewables accounted for 15.75% of Indonesia's energy mix, installed renewable capacity reached 15,630 MW, and electricity consumption was 1,584 kWh per capita; generation capacity also continued to expand.",
      zh: "印度尼西亚2025年可再生能源占能源结构15.75%，可再生能源装机15,630兆瓦，人均用电量1,584千瓦时；同期电源装机容量继续扩大。",
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
    zh: "2025年能源与矿产领域投资为317亿美元，其中电力46亿美元、可再生能源与节能24亿美元。可再生能源装机达到15,630兆瓦，其中太阳能1,494兆瓦、风电152兆瓦。",
    en: "Energy and mineral investment reached USD 31.7 billion in 2025, including USD 4.6 billion in electricity and USD 2.4 billion in renewables and conservation. Installed renewable capacity reached 15,630 MW, including 1,494 MW of solar and 152 MW of wind.",
  },
  population: 285721236,
  gdp: 1445642584163.81,
  gdpGrowth: 5.10808904438025,
  energyDemand: {
    zh: "2025年人均用电量为1,584千瓦时，高于2024年的1,411千瓦时；电源装机容量同比增加7吉瓦至107.51吉瓦。",
    en: "Electricity consumption per capita was 1,584 kWh in 2025, up from 1,411 kWh in 2024; installed generation capacity increased by 7 GW to 107.51 GW.",
  },
  renewableTarget: {
    zh: "2025年《国家能源政策》将新能源和可再生能源占比目标设为2030年19%至23%、2040年36%至40%、2050年53%至55%、2060年70%至72%。能源矿产资源部报告2025年实际占比为15.75%。",
    en: "The 2025 National Energy Policy sets new and renewable energy share targets of 19%-23% in 2030, 36%-40% in 2040, 53%-55% in 2050, and 70%-72% in 2060. The Ministry reported a 15.75% share in 2025.",
  },
  keyIndicators: [
    { label: { zh: "可再生能源占比", en: "Renewable energy mix share" }, value: "15.75", unit: "%", year: 2025 },
    { label: { zh: "可再生能源装机容量", en: "Installed renewable capacity" }, value: "15630", unit: "MW", year: 2025 },
    { label: { zh: "人均用电量", en: "Electricity consumption per capita" }, value: "1584", unit: "kWh/person", year: 2025 },
  ],
  source: "Indonesia Ministry of Energy and Mineral Resources",
  sourceUrl: "https://www.esdm.go.id/en/media-center/news-archives/capaian-positif-tahun-2025-negara-hadir-penuhi-kebutuhan-energi-masyarakat",
  collectedAt: "2026-07-13T14:09:07.223Z",
  updatedAt: "2026-01-09T00:00:00.000Z",
  credibility: "OFFICIAL",
  reviewStatus: "published",
  aiUsable: false,
  countryCode: "ID",
  industryTags: ["grid", "solar", "wind"],
  techTags: [],
} as const;
