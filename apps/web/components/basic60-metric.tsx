import { basic60UnitLabel, formatBasic60MetricValue } from "@/lib/basic60/presentation";
import type { Basic60Locale, Basic60Metric } from "@/lib/basic60/types";

export function Basic60MetricCard({ metric, locale }: { metric: Basic60Metric; locale: Basic60Locale }) {
  const pending = metric.value === null || metric.value_status !== "available";
  const period = metric.period.label.trim();
  const periodLabel = period && !/^(pending|unknown)$/i.test(period)
    ? period
    : locale === "en" ? "Not available" : "暂无数据";
  return (
    <article className={pending ? "basic60-metric-card is-pending" : "basic60-metric-card"}>
      <div className="basic60-metric-heading">
        <span>{metric.label}</span>
      </div>
      <strong>{formatBasic60MetricValue(metric, locale)}</strong>
      <dl>
        <div><dt>{locale === "en" ? "Period" : "统计期"}</dt><dd>{periodLabel}</dd></div>
        <div><dt>{locale === "en" ? "Unit" : "单位"}</dt><dd>{basic60UnitLabel(metric.unit, locale)}</dd></div>
      </dl>
    </article>
  );
}
