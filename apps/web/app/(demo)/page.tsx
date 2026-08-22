"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowRight, Info } from "lucide-react";
import { useMemo, useState } from "react";
import { CountryRail } from "@/components/country-rail";
import { DecisionPanel } from "@/components/decision-panel";
import { EmptyState, ErrorState, LoadingState } from "@/components/page-state";
import { ScoreStrip } from "@/components/score-strip";
import { SignalTimeline } from "@/components/signal-timeline";
import { useDemoQuery } from "@/hooks/use-demo-query";
import type { CountryDetail, CountrySummary } from "@/lib/types";

const RadarVisualization = dynamic(() => import("@/components/radar-visualization"), {
  ssr: false,
  loading: () => <div className="chart-loading">正在绘制五维评分…</div>,
});

export default function HomePage() {
  const countries = useDemoQuery<CountrySummary[]>("countries");
  const [selectedCountryCode, setSelectedCountryCode] = useState<string | null>(null);
  const [signalType, setSignalType] = useState("all");
  const selectedCode = selectedCountryCode || countries.data?.[0]?.code || "";

  const detail = useDemoQuery<CountryDetail>(
    selectedCode ? `countries/${encodeURIComponent(selectedCode)}` : null,
  );
  const signalTypes = useMemo(
    () => Array.from(new Set(detail.data?.signals.map((item) => item.category) || [])),
    [detail.data],
  );
  const filteredSignals = useMemo(
    () =>
      detail.data?.signals.filter((item) => signalType === "all" || item.category === signalType) || [],
    [detail.data, signalType],
  );

  if (countries.loading) return <LoadingState />;
  if (countries.error) return <ErrorState message={countries.error} retry={countries.reload} />;
  if (!countries.data?.length) return <EmptyState message="尚未配置合成演示国家。" />;

  return (
    <>
      <section className="hero-heading">
        <h1>出海决策，从国家全景开始</h1>
        <p>在同一视图中查看市场、政策、项目与合作伙伴信号。</p>
        <div className="hero-actions">
          <Link className="button button-primary" href="/compare">
            开始国家对比 <ArrowRight size={17} aria-hidden="true" />
          </Link>
          <span className="selection-count">已选 <strong>1</strong>/4</span>
        </div>
      </section>

      <CountryRail
        countries={countries.data}
        selectedCode={selectedCode}
        onSelect={(code) => {
          setSelectedCountryCode(code);
          setSignalType("all");
        }}
      />

      {detail.loading ? <LoadingState label="正在加载国家全景…" /> : null}
      {detail.error ? <ErrorState message={detail.error} retry={detail.reload} /> : null}
      {detail.data ? (
        <div className="home-dashboard">
          <div className="country-workspace panel">
            <div className="country-overview-header">
              <div>
                <h2>{detail.data.name_zh} <span>国家概览</span></h2>
                <p>{detail.data.summary}</p>
              </div>
              <Link className="button button-secondary" href={`/countries/${detail.data.code}`}>
                进入国家详情 <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </div>
            <div className="overview-score-grid">
              <ScoreStrip scores={detail.data.scores} deltas={detail.data.dimension_deltas} />
              <RadarVisualization
                compact
                series={[{ key: detail.data.code, name: detail.data.name_zh, scores: detail.data.scores }]}
              />
            </div>
            <p className="synthetic-note"><Info size={14} aria-hidden="true" />以上为合成演示评分，仅用于内部演示与能力说明。</p>
            <section className="timeline-section" aria-labelledby="timeline-title">
              <div className="timeline-toolbar">
                <h2 id="timeline-title">机会动态（按时间）</h2>
                <label>
                  <span className="sr-only">筛选类型</span>
                  <select value={signalType} onChange={(event) => setSignalType(event.target.value)}>
                    <option value="all">类型：全部</option>
                    {signalTypes.map((type) => <option key={type} value={type}>{type}</option>)}
                  </select>
                </label>
              </div>
              <SignalTimeline signals={filteredSignals} />
            </section>
          </div>
          <DecisionPanel
            reasons={detail.data.reasons}
            risks={detail.data.risks}
            actions={detail.data.actions}
          />
        </div>
      ) : null}
    </>
  );
}
