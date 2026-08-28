import {
  basic60CountryName,
  formatBasic60MetricValue,
} from "@/lib/basic60/presentation";
import type {
  Basic60CountrySummary,
  Basic60Locale,
} from "@/lib/basic60/types";

const FEATURED_METRIC_CODES = [
  "renewable_capacity_mw",
  "renewable_share_generation_pct",
  "electricity_generation_gwh",
  "gdp_current_usd",
] as const;

const FEATURED_METRIC_PRIORITY = new Map<string, number>(
  FEATURED_METRIC_CODES.map((code, index) => [code, index]),
);

export type Basic60FeaturedMetricView = Readonly<{
  code: string;
  label: string;
  value: string;
  period: string;
}>;

export type Basic60MarketView = Readonly<{
  code: string;
  name: string;
  alternateName: string;
  region: string;
  coverageLevel: "Basic";
  availableMetricCount: number;
  metricCount: number;
  featuredMetrics: readonly Basic60FeaturedMetricView[];
}>;

export function toBasic60MarketView(
  country: Basic60CountrySummary,
  locale: Basic60Locale,
): Basic60MarketView {
  const availableMetrics = country.latest_metrics.filter(
    (metric) => metric.value_status === "available" && metric.value !== null,
  );
  const featuredMetrics = [...availableMetrics]
    .sort((left, right) => {
      const leftPriority =
        FEATURED_METRIC_PRIORITY.get(left.metric_code) ?? Number.MAX_SAFE_INTEGER;
      const rightPriority =
        FEATURED_METRIC_PRIORITY.get(right.metric_code) ?? Number.MAX_SAFE_INTEGER;
      if (leftPriority !== rightPriority) return leftPriority - rightPriority;
      return left.metric_code.localeCompare(right.metric_code);
    })
    .slice(0, 2)
    .map((metric) => ({
      code: metric.metric_code,
      label: metric.label,
      value: formatBasic60MetricValue(metric, locale),
      period: metric.period.label,
    }));

  return {
    code: country.code,
    name: basic60CountryName(country, locale),
    alternateName: locale === "en" ? country.name_zh : country.name_en,
    region: country.region_code,
    coverageLevel: country.coverage_level,
    availableMetricCount: availableMetrics.length,
    metricCount: country.latest_metrics.length,
    featuredMetrics,
  };
}
