import type { Basic60Locale, Basic60Metric } from "@/lib/basic60/types";

const UNIT_LABELS: Record<string, Record<Basic60Locale, string>> = {
  PERCENT: { "zh-CN": "%", en: "%" },
  PERSON: { "zh-CN": "人", en: "people" },
  PEOPLE: { "zh-CN": "人", en: "people" },
  COUNT: { "zh-CN": "人", en: "people" },
  SQ_KM: { "zh-CN": "平方公里", en: "km²" },
  KM2: { "zh-CN": "平方公里", en: "km²" },
  MW: { "zh-CN": "MW", en: "MW" },
  GWH: { "zh-CN": "GWh", en: "GWh" },
  USD: { "zh-CN": "USD", en: "USD" },
  USD_PER_PERSON: { "zh-CN": "USD/人", en: "USD/person" },
  LCU_PER_USD: { "zh-CN": "本币/USD", en: "LCU/USD" },
};

export function basic60UnitLabel(unit: string, locale: Basic60Locale): string {
  return UNIT_LABELS[unit.toUpperCase()]?.[locale] ?? unit;
}

export function formatBasic60MetricValue(metric: Basic60Metric, locale: Basic60Locale): string {
  if (metric.value === null || metric.value_status !== "available") {
    return locale === "en" ? "Not available" : "暂无数据";
  }
  const magnitude = Math.abs(metric.value);
  const maximumFractionDigits = magnitude >= 100 ? 0 : magnitude >= 1 ? 2 : 4;
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits }).format(metric.value);
  const unit = basic60UnitLabel(metric.unit, locale);
  return unit === "%" ? `${number}%` : `${number} ${unit}`;
}

const METRIC_LABELS: Record<string, Record<Basic60Locale, string>> = {
  population_total: { "zh-CN": "人口总量", en: "Population" },
  land_area_sq_km: { "zh-CN": "陆地面积", en: "Land area" },
  gdp_current_usd: { "zh-CN": "国内生产总值", en: "GDP" },
  gdp_growth_pct: { "zh-CN": "经济增长率", en: "GDP growth" },
  gdp_per_capita_current_usd: { "zh-CN": "人均国内生产总值", en: "GDP per capita" },
  inflation_cpi_pct: { "zh-CN": "通货膨胀率", en: "Inflation" },
  official_exchange_rate_lcu_per_usd: { "zh-CN": "官方汇率", en: "Official exchange rate" },
  fdi_net_inflows_usd: { "zh-CN": "外国直接投资净流入", en: "Foreign direct investment inflows" },
  electricity_installed_capacity_mw: { "zh-CN": "电力装机容量", en: "Installed electricity capacity" },
  electricity_generation_gwh: { "zh-CN": "发电量", en: "Electricity generation" },
  renewable_capacity_mw: { "zh-CN": "可再生能源装机容量", en: "Renewable energy capacity" },
  renewable_generation_gwh: { "zh-CN": "可再生能源发电量", en: "Renewable energy generation" },
  renewable_share_capacity_pct: { "zh-CN": "可再生能源装机占比", en: "Renewable share of installed capacity" },
  renewable_share_generation_pct: { "zh-CN": "可再生能源发电占比", en: "Renewable share of generation" },
  electricity_demand_gwh: { "zh-CN": "用电需求", en: "Electricity demand" },
};

export function basic60MetricLabel(metricCode: string, locale: Basic60Locale): string {
  return METRIC_LABELS[metricCode]?.[locale] ?? (locale === "en" ? "Other indicator" : "其他指标");
}

export function basic60CountryName(
  country: { name_zh: string; name_en: string },
  locale: Basic60Locale,
): string {
  return locale === "en" ? country.name_en : country.name_zh;
}
