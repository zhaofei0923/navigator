"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowRight, CalendarDays, Check, Info, Plus, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { EmptyState, ErrorState, LoadingState } from "@/components/page-state";
import { demoApi } from "@/lib/api-client";
import type { ComparisonResult, CountrySummary, ScoreDimensionKey } from "@/lib/types";
import { SCORE_DIMENSIONS } from "@/lib/types";
import { useDemoQuery } from "@/hooks/use-demo-query";

const RadarVisualization = dynamic(() => import("@/components/radar-visualization"), {
  ssr: false,
  loading: () => <div className="chart-loading">正在绘制对比图…</div>,
});

type ViewKey = "all" | ScoreDimensionKey;

const VIEW_TABS: ReadonlyArray<{ key: ViewKey; label: string }> = [
  { key: "all", label: "综合视图" },
  { key: "market_attractiveness", label: "市场" },
  { key: "policy_certainty", label: "政策" },
  { key: "project_activity", label: "项目" },
  { key: "risk_controllability", label: "风险" },
];

export default function ComparePage() {
  const searchParams = useSearchParams();
  const countriesQuery = useDemoQuery<CountrySummary[]>("countries");
  const [selectedOverride, setSelectedOverride] = useState<string[] | null>(null);
  const [view, setView] = useState<ViewKey>("all");
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [loadingComparison, setLoadingComparison] = useState(false);
  const [comparisonError, setComparisonError] = useState<string | null>(null);

  const selected = useMemo(() => {
    if (selectedOverride) return selectedOverride;
    if (!countriesQuery.data?.length) return [];
    const requested = (searchParams.get("countries") || "")
      .split(",")
      .map((code) => code.trim().toUpperCase())
      .filter(Boolean);
    const validCodes = new Set(countriesQuery.data.map((country) => country.code));
    const initial = Array.from(new Set(requested.filter((code) => validCodes.has(code))));
    for (const country of countriesQuery.data) {
      if (initial.length >= 3) break;
      if (!initial.includes(country.code)) initial.push(country.code);
    }
    return initial.slice(0, 4);
  }, [countriesQuery.data, searchParams, selectedOverride]);

  useEffect(() => {
    if (selected.length < 2) return;
    const controller = new AbortController();

    async function loadComparison() {
      await Promise.resolve();
      if (controller.signal.aborted) return;
      setLoadingComparison(true);
      setComparisonError(null);
      try {
        const response = await demoApi<ComparisonResult>("country-comparisons", {
          method: "POST",
          body: JSON.stringify({ country_codes: selected }),
          signal: controller.signal,
        });
        setResult(response.data);
      } catch (reason: unknown) {
        if (!controller.signal.aborted) {
          setResult(null);
          setComparisonError(reason instanceof Error ? reason.message : "国家对比失败。");
        }
      } finally {
        if (!controller.signal.aborted) setLoadingComparison(false);
      }
    }

    void loadComparison();
    return () => controller.abort();
  }, [selected]);

  const available = useMemo(
    () => countriesQuery.data?.filter((country) => !selected.includes(country.code)) || [],
    [countriesQuery.data, selected],
  );
  const shownDimensions = view === "all" ? SCORE_DIMENSIONS : SCORE_DIMENSIONS.filter((item) => item.key === view);

  function toggle(code: string) {
    setSelectedOverride((override) => {
      const current = override || selected;
      if (current.includes(code)) return current.length <= 2 ? current : current.filter((item) => item !== code);
      return current.length >= 4 ? current : [...current, code];
    });
  }

  if (countriesQuery.loading) return <LoadingState label="正在准备国家对比…" />;
  if (countriesQuery.error) return <ErrorState message={countriesQuery.error} retry={countriesQuery.reload} />;
  if (!countriesQuery.data?.length) return <EmptyState message="没有可供对比的合成演示国家。" />;

  return (
    <section>
      <div className="page-heading compare-heading">
        <div><h1>国家对比</h1><p>并列比较市场、政策、项目、伙伴与风险信号。</p></div>
      </div>

      <div className="compare-selector" aria-label="选择二至四个国家">
        {selected.map((code) => {
          const country = countriesQuery.data?.find((item) => item.code === code);
          return (
            <button key={code} className="selected-country" type="button" onClick={() => toggle(code)} aria-label={`移除 ${country?.name_zh || code}`} disabled={selected.length <= 2}>
              <span>{country?.name_zh || code}</span><Check size={16} aria-hidden="true" /><X size={15} aria-hidden="true" />
            </button>
          );
        })}
        {selected.length < 4 ? (
          <label className="add-country">
            <Plus size={17} aria-hidden="true" />
            <span className="sr-only">添加国家</span>
            <select
              value=""
              onChange={(event) => event.target.value && toggle(event.target.value)}
              aria-label="添加国家"
            >
              <option value="">添加国家</option>
              {available.map((country) => <option key={country.code} value={country.code}>{country.name_zh}</option>)}
            </select>
          </label>
        ) : null}
        <span className="selection-count">已选 <strong>{selected.length}</strong>/4</span>
      </div>

      <div className="compare-tools">
        <div className="compare-tabs" role="tablist" aria-label="对比维度">
          {VIEW_TABS.map((item) => (
            <button key={item.key} type="button" role="tab" aria-selected={view === item.key} onClick={() => setView(item.key)}>{item.label}</button>
          ))}
        </div>
        <div className="compare-meta"><CalendarDays size={16} />动态合成演示数据 <span /> <Info size={16} />synthetic_demo</div>
      </div>

      {selected.length < 2 ? <EmptyState message="请至少选择两个国家。" /> : null}
      {loadingComparison ? <LoadingState label="正在重新计算合成对比…" /> : null}
      {comparisonError ? <ErrorState message={comparisonError} /> : null}
      {result && !loadingComparison ? (
        <>
          <div className="compare-primary-grid">
            <section className="panel comparison-matrix" aria-labelledby="matrix-title">
              <div className="panel-header"><h2 id="matrix-title">合成演示评分（0—100）</h2></div>
              <div className="table-scroll">
                <table className="matrix-table">
                  <thead><tr><th>维度</th>{result.countries.map((country) => <th key={country.country_code}>{country.name_zh}</th>)}</tr></thead>
                  <tbody>
                    {shownDimensions.map((dimension) => (
                      <tr key={dimension.key}>
                        <th>{dimension.label}</th>
                        {result.countries.map((country) => {
                          const value = country.scores[dimension.key];
                          const delta = country.dimension_deltas[dimension.key] ?? 0;
                          return (
                            <td key={country.country_code}>
                              <div className="matrix-score"><strong>{value}</strong><span className="progress-track"><i style={{ width: `${value}%` }} /></span><em className={delta < 0 ? "negative" : "positive"}>{delta > 0 ? "↑" : delta < 0 ? "↓" : "→"} {Math.abs(delta)}</em></div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="synthetic-note matrix-note"><Info size={14} />以上为合成演示评分，仅用于内部演示与能力说明。</p>
            </section>
            <section className="panel compare-radar-panel">
              <div className="panel-header"><h2>维度对比（0—100）</h2></div>
              <RadarVisualization series={result.countries.map((country) => ({ key: country.country_code, name: country.name_zh, scores: country.scores }))} />
            </section>
          </div>

          <div className="compare-secondary-grid">
            <section className="panel differences-panel">
              <div className="panel-header"><h2>关键差异</h2></div>
              <div className="table-scroll">
                <table className="data-table">
                  <thead><tr><th>国家</th><th>领先维度</th><th>说明</th><th>行动</th></tr></thead>
                  <tbody>{result.countries.map((country) => {
                    const leading = SCORE_DIMENSIONS.reduce((best, item) => country.scores[item.key] > country.scores[best.key] ? item : best);
                    return <tr key={country.country_code}><td><strong>{country.name_zh}</strong></td><td>{leading.label}</td><td>{country.reason}</td><td><Link className="evidence-link" href={`/countries/${country.country_code}`}>查看依据 <ArrowRight size={14} /></Link></td></tr>;
                  })}</tbody>
                </table>
              </div>
            </section>
            <aside className="panel recommendation-panel">
              <div className="panel-header"><h2>推荐路径</h2></div>
              <ol>
                {result.countries.slice(0, 2).map((country, index) => (
                  <li key={country.country_code}><span>{index + 1}</span><div><strong>{index === 0 ? "优先进入" : "备选市场"}：{country.name_zh}</strong><p>{country.reason}</p></div></li>
                ))}
              </ol>
              <p className="recommendation-summary">{result.recommendation}</p>
              {result.countries[0] ? <Link className="button button-primary button-wide" href={`/countries/${result.countries[0].country_code}`}>查看{result.countries[0].name_zh}详情 <ArrowRight size={16} /></Link> : null}
            </aside>
          </div>
          <p className="methodology-note"><Info size={14} />方法说明：{result.methodology}</p>
        </>
      ) : null}
    </section>
  );
}
