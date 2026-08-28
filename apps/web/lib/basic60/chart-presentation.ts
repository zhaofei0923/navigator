import { basic60MetricLabel, basic60UnitLabel } from "@/lib/basic60/presentation";
import type { MacroChartSeries } from "@/lib/basic60/chart-data";
import type { Basic60Locale, Basic60Metric, Basic60Period } from "@/lib/basic60/types";

export const CHART_COLORS = {
  navy: "#142b50",
  teal: "#2b99a3",
  renewable: "#49c4c8",
  remainder: "#536b8e",
  grid: "#e4e9f0",
  axis: "#65738a",
} as const;

export const CHART_COPY = {
  "zh-CN": {
    energy: "能源结构", macro: "宏观经济趋势", capacity: "电力装机结构", generation: "发电结构",
    capacityTotal: "电力总装机", generationTotal: "发电总量", renewable: "可再生能源", remainder: "其他电源",
    viewData: "查看数据", period: "统计期", value: "数值", unit: "单位", indicator: "指标",
    unavailable: "暂无数据", noChart: "暂无可绘制的数据", incompatible: "统计期或单位不一致，暂不绘制图表",
    invalid: "暂时无法绘制图表，请查看数据明细", loading: "正在加载图表", chartError: "图表暂时无法显示，仍可查看数据明细",
    retry: "重新加载", calculated: "计算值", calculation: "其他电源按总量减去可再生能源计算。",
    missing: "缺失年份以断点展示，不补零。", details: "数据明细", clear: "关闭数值提示",
    chartHint: "悬停或点击查看数值；也可展开数据明细。", percentage: "可再生能源占比",
  },
  en: {
    energy: "Energy mix", macro: "Macroeconomic trends", capacity: "Installed capacity mix", generation: "Generation mix",
    capacityTotal: "Total installed capacity", generationTotal: "Total generation", renewable: "Renewables", remainder: "Other sources",
    viewData: "View data", period: "Period", value: "Value", unit: "Unit", indicator: "Indicator",
    unavailable: "Not available", noChart: "No data to chart", incompatible: "Reporting periods or units differ; chart unavailable",
    invalid: "This chart is unavailable. View the data below.", loading: "Loading chart", chartError: "The chart is unavailable. Data details are still accessible.",
    retry: "Reload", calculated: "Calculated", calculation: "Other sources are calculated as the total minus renewables.",
    missing: "Missing years remain gaps, not zeroes.", details: "Data details", clear: "Dismiss value tooltip",
    chartHint: "Hover or select to inspect a value, or expand the data details.", percentage: "Renewable share",
  },
} as const;

const SHORT_LABELS: Record<string, Record<Basic60Locale, string>> = {
  gdp_growth_pct: { "zh-CN": "GDP增长率", en: "GDP growth" },
  gdp_per_capita_current_usd: { "zh-CN": "人均GDP", en: "GDP per capita" },
  inflation_cpi_pct: { "zh-CN": "CPI通胀率", en: "CPI inflation" },
  fdi_net_inflows_usd: { "zh-CN": "FDI净流入", en: "FDI net inflows" },
};

export function chartMetricLabel(code: string, locale: Basic60Locale): string {
  return SHORT_LABELS[code]?.[locale] ?? basic60MetricLabel(code, locale);
}

export function availableMetricValue(metric: Basic60Metric | null | undefined): number | null {
  return metric?.value_status === "available" && typeof metric.value === "number" && Number.isFinite(metric.value) ? metric.value : null;
}

export function exactChartNumber(value: number | null, locale: Basic60Locale): string {
  return value === null || !Number.isFinite(value)
    ? CHART_COPY[locale].unavailable
    : new Intl.NumberFormat(locale, { maximumSignificantDigits: 21 }).format(value);
}

export function displayChartNumber(value: number | null, locale: Basic60Locale, fractionDigits = 2): string {
  if (value === null || !Number.isFinite(value)) return CHART_COPY[locale].unavailable;
  const options = value !== 0 && Math.abs(value) < 10 ** -fractionDigits
    ? { maximumSignificantDigits: 3 }
    : { maximumFractionDigits: fractionDigits };
  return new Intl.NumberFormat(locale, options).format(value);
}

export function energyChartNumber(value: number | null, locale: Basic60Locale): string {
  return value === null || !Number.isFinite(value)
    ? CHART_COPY[locale].unavailable
    : new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

export function chartPeriodLabel(period: Basic60Period, locale: Basic60Locale): string {
  const annualStart = /^(\d{4})-01-01$/.exec(period.start);
  if (annualStart && period.end === `${annualStart[1]}-12-31`) return annualStart[1];
  if (/^\d{4}$/.test(period.label)) return period.label;
  if (/^\d{4}-\d{2}(?:-\d{2})?$/.test(period.label)) return period.label;
  return CHART_COPY[locale].unavailable;
}

export function macroPeriodRange(series: readonly MacroChartSeries[], locale: Basic60Locale): string {
  const years = series.flatMap((item) => item.points.map((point) => point.year));
  if (!years.length) return "";
  const first = Math.min(...years);
  const last = Math.max(...years);
  return first === last ? String(first) : `${first}${locale === "en" ? "–" : "—"}${last}`;
}

export type ChartScale = { divisor: number; suffix: string; unitLabel: string };

export function macroChartScale(series: MacroChartSeries, locale: Basic60Locale): ChartScale {
  const maximum = Math.max(0, ...series.points.map((point) => Math.abs(point.value ?? 0)));
  const unit = basic60UnitLabel(series.unit, locale);
  // Scale axis labels, never the source values or the exact-data table.
  if (series.unit === "USD" || (unit !== "%" && maximum >= 1_000_000)) {
    const scales: readonly [number, string][] = locale === "en"
      ? [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]]
      : [[1e12, "万亿"], [1e8, "亿"], [1e4, "万"]];
    const scale = scales.find(([divisor]) => maximum >= divisor);
    if (scale) return { divisor: scale[0], suffix: scale[1], unitLabel: `${unit} · ${scale[1]}` };
  }
  return { divisor: 1, suffix: "", unitLabel: unit };
}

function macroChartAxis(series: MacroChartSeries): { domain: [number, number]; ticks: number[] } {
  const values = series.points.flatMap((point) => point.value === null ? [] : [point.value]);
  const empty: { domain: [number, number]; ticks: number[] } = { domain: [0, 1], ticks: [0, 0.25, 0.5, 0.75, 1] };
  if (!values.length) return empty;
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === 0 && max === 0) return empty;
  const showZero = series.kind === "bar" || series.unit === "PERCENT";
  const lower = showZero ? Math.min(0, min) : min;
  const upper = showZero ? Math.max(0, max) : max;
  const padding = (upper - lower || Math.abs(upper) || 1) * 0.18;
  const paddedLower = showZero && lower === 0 ? 0 : lower - padding;
  const paddedUpper = showZero && upper === 0 ? 0 : upper + padding;
  const roughStep = (paddedUpper - paddedLower) / 6;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const step = ([1, 2, 5, 10].find((factor) => factor * magnitude >= roughStep) ?? 10) * magnitude;
  const first = Math.floor(paddedLower / step);
  const last = Math.ceil(paddedUpper / step);
  // Round only tick coordinates; observation and tooltip values stay untouched.
  const ticks = Array.from({ length: last - first + 1 }, (_, index) => Number(((first + index) * step).toPrecision(12)));
  return { domain: [ticks[0], ticks[ticks.length - 1]], ticks };
}

export function macroChartDomain(series: MacroChartSeries): [number, number] {
  return macroChartAxis(series).domain;
}

export function macroChartTicks(series: MacroChartSeries): number[] {
  return macroChartAxis(series).ticks;
}
