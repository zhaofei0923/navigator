"use client";

import "@/components/country-detail.css";
import dynamic from "next/dynamic";
import { ChartNoAxesCombined, ChevronRight, RefreshCw } from "lucide-react";
import { Component, createContext, useContext, useId, useMemo, type ReactNode } from "react";
import { buildEnergyCompositions, buildMacroChartSeries, type EnergyComposition, type MacroChartSeries } from "@/lib/basic60/chart-data";
import { availableMetricValue, CHART_COPY, chartMetricLabel, chartPeriodLabel, energyChartNumber, exactChartNumber, macroChartScale, macroPeriodRange } from "@/lib/basic60/chart-presentation";
import { basic60UnitLabel } from "@/lib/basic60/presentation";
import type { Basic60Locale, Basic60Metric } from "@/lib/basic60/types";

const ChartLocale = createContext<Basic60Locale>("zh-CN");

function ChartLoading() {
  const locale = useContext(ChartLocale);
  return <div className="country-chart-loading" role="status"><span className="basic60-loading-dot" aria-hidden="true" />{CHART_COPY[locale].loading}</div>;
}

const MacroPlot = dynamic(() => import("@/components/country-chart-plots").then((module) => module.MacroPlot), { ssr: false, loading: ChartLoading });
const EnergyPlot = dynamic(() => import("@/components/country-chart-plots").then((module) => module.EnergyPlot), { ssr: false, loading: ChartLoading });

type ChartProps = { metrics: Basic60Metric[]; locale: Basic60Locale; countryCode: string };

export function CountryEnergyCharts({ metrics, locale, countryCode }: ChartProps) {
  const compositions = useMemo(() => buildEnergyCompositions(metrics), [metrics]);
  const headingId = useId();
  return (
    <ChartLocale.Provider value={locale}>
      <section className="country-energy-section" aria-labelledby={headingId}>
        <h2 id={headingId}>{CHART_COPY[locale].energy}</h2>
        <div className="country-energy-grid">
          {compositions.map((composition) => <EnergyPanel key={`${countryCode}-${locale}-${composition.key}`} composition={composition} locale={locale} />)}
        </div>
      </section>
    </ChartLocale.Provider>
  );
}

export function CountryMacroCharts({ metrics, locale, countryCode }: ChartProps) {
  const series = useMemo(() => buildMacroChartSeries(metrics), [metrics]);
  const headingId = useId();
  const period = macroPeriodRange(series, locale);
  return (
    <ChartLocale.Provider value={locale}>
      <section className="country-macro-section" aria-labelledby={headingId}>
        <div className="country-chart-section-heading"><h2 id={headingId}>{CHART_COPY[locale].macro}</h2>{period ? <p>{period}</p> : null}</div>
        <div className="country-macro-grid">
          {series.map((item) => <MacroPanel key={`${countryCode}-${locale}-${item.code}`} series={item} locale={locale} />)}
        </div>
      </section>
    </ChartLocale.Provider>
  );
}

function EnergyPanel({ composition, locale }: { composition: EnergyComposition; locale: Basic60Locale }) {
  const copy = CHART_COPY[locale];
  const headingId = useId();
  const title = composition.key === "capacity" ? copy.capacity : copy.generation;
  const totalLabel = composition.key === "capacity" ? copy.capacityTotal : copy.generationTotal;
  // An incompatible tuple has no safe shared unit/period for its headline.
  // The original observation remains readable, with its own unit, below.
  const total = composition.status === "incompatible" || composition.status === "invalid"
    ? null
    : availableMetricValue(composition.total);
  return (
    <article className="country-energy-panel" aria-labelledby={headingId}>
      <header className="country-energy-heading">
        <div><h3 id={headingId}>{title}</h3><p>{composition.periodLabel ?? copy.unavailable} · {composition.unit}</p></div>
        <div className="country-energy-total"><span>{totalLabel}</span><strong>{energyChartNumber(total, locale)}{total !== null ? ` ${composition.unit}` : ""}</strong></div>
      </header>
      <div className="country-energy-body">
        <ChartBoundary locale={locale}>
          {composition.status === "ready" ? <EnergyPlot composition={composition} locale={locale} /> : <ChartUnavailable locale={locale} incompatible={composition.status === "incompatible"} invalid={composition.status === "invalid"} />}
        </ChartBoundary>
      </div>
      <EnergyDataDetails composition={composition} locale={locale} title={title} />
    </article>
  );
}

function MacroPanel({ series, locale }: { series: MacroChartSeries; locale: Basic60Locale }) {
  const copy = CHART_COPY[locale];
  const headingId = useId();
  const hintId = useId();
  const title = chartMetricLabel(series.code, locale);
  const scale = macroChartScale(series, locale);
  const hasGap = series.points.some((point) => point.value === null);
  return (
    <article className="country-macro-panel" aria-labelledby={headingId}>
      <header className="country-macro-heading"><h3 id={headingId}>{title}</h3><span>{scale.unitLabel}</span></header>
      <div className="country-macro-plot" aria-describedby={hintId}>
        <ChartBoundary locale={locale}>
          {series.chartable ? <MacroPlot series={series} locale={locale} /> : <ChartUnavailable locale={locale} incompatible={series.issue === "incompatible"} invalid={series.issue === "duplicate"} />}
        </ChartBoundary>
      </div>
      <p id={hintId} className="country-sr-only">{copy.chartHint}{hasGap ? ` ${copy.missing}` : ""}</p>
      <div className="country-chart-footer">{hasGap ? <small className="country-chart-gap-note">{copy.missing}</small> : null}<MacroDataDetails series={series} locale={locale} title={title} /></div>
    </article>
  );
}

function DetailsSummary({ locale, title }: { locale: Basic60Locale; title: string }) {
  return <summary className="country-chart-data-toggle"><span>{CHART_COPY[locale].viewData}</span><span className="country-sr-only"> · {title}</span><ChevronRight size={15} aria-hidden="true" /></summary>;
}

function MacroDataDetails({ series, locale, title }: { series: MacroChartSeries; locale: Basic60Locale; title: string }) {
  const copy = CHART_COPY[locale];
  const unit = basic60UnitLabel(series.unit, locale);
  const rows = series.issue === "incompatible" || series.issue === "duplicate"
    ? series.observations.map((metric) => ({ period: chartPeriodLabel(metric.period, locale), value: availableMetricValue(metric), unit: basic60UnitLabel(metric.unit, locale) }))
    : series.points.map((point) => ({ period: point.periodLabel, value: point.value, unit }));
  return (
    <details className="country-chart-data">
      <DetailsSummary locale={locale} title={title} />
      <div className="country-chart-table-wrap" tabIndex={0} role="region" aria-label={`${title} · ${copy.details}`}>
        <table><caption className="country-sr-only">{title} · {copy.details}</caption><thead><tr><th scope="col">{copy.period}</th><th scope="col">{copy.value}</th><th scope="col">{copy.unit}</th></tr></thead><tbody>
          {rows.length ? rows.map((row, index) => <tr key={`${row.period}-${index}`}><th scope="row">{row.period}</th><td>{exactChartNumber(row.value, locale)}</td><td>{row.unit}</td></tr>) : <tr><td colSpan={3}>{copy.unavailable}</td></tr>}
        </tbody></table>
      </div>
    </details>
  );
}

function EnergyDataDetails({ composition, locale, title }: { composition: EnergyComposition; locale: Basic60Locale; title: string }) {
  const copy = CHART_COPY[locale];
  return (
    <details className="country-chart-data country-energy-data">
      <DetailsSummary locale={locale} title={title} />
      <div className="country-chart-table-wrap" tabIndex={0} role="region" aria-label={`${title} · ${copy.details}`}>
        <table><caption className="country-sr-only">{title} · {copy.details}</caption><thead><tr><th scope="col">{copy.indicator}</th><th scope="col">{copy.period}</th><th scope="col">{copy.value}</th><th scope="col">{copy.unit}</th></tr></thead><tbody>
          {composition.observations.map((metric, index) => <tr key={`${metric.metric_code}-${metric.period.label}-${index}`}><th scope="row">{chartMetricLabel(metric.metric_code, locale)}</th><td>{chartPeriodLabel(metric.period, locale)}</td><td>{exactChartNumber(availableMetricValue(metric), locale)}</td><td>{basic60UnitLabel(metric.unit, locale)}</td></tr>)}
          {composition.status === "ready" ? <tr><th scope="row">{copy.remainder}<small>{copy.calculated}</small></th><td>{composition.periodLabel}</td><td>{exactChartNumber(composition.remainder, locale)}</td><td>{composition.unit}</td></tr> : null}
          {!composition.observations.length ? <tr><td colSpan={4}>{copy.unavailable}</td></tr> : null}
        </tbody></table>
        {composition.status === "ready" ? <p className="country-chart-calculation">{copy.calculation}</p> : null}
      </div>
    </details>
  );
}

function ChartUnavailable({ locale, incompatible, invalid }: { locale: Basic60Locale; incompatible?: boolean; invalid?: boolean }) {
  const copy = CHART_COPY[locale];
  return <div className="country-chart-unavailable" role="status"><ChartNoAxesCombined size={26} aria-hidden="true" /><p>{incompatible ? copy.incompatible : invalid ? copy.invalid : copy.noChart}</p></div>;
}

class ChartBoundary extends Component<{ locale: Basic60Locale; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  render() {
    const copy = CHART_COPY[this.props.locale];
    return this.state.failed ? <div className="country-chart-unavailable" role="alert"><p>{copy.chartError}</p><button className="country-chart-retry" type="button" onClick={() => window.location.reload()}><RefreshCw size={15} aria-hidden="true" />{copy.retry}</button></div> : this.props.children;
  }
}
