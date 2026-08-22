"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Banknote, Globe2, Info } from "lucide-react";
import { DecisionPanel } from "@/components/decision-panel";
import { EmptyState, ErrorState, LoadingState } from "@/components/page-state";
import { ScoreStrip } from "@/components/score-strip";
import { SignalTimeline } from "@/components/signal-timeline";
import { useDemoQuery } from "@/hooks/use-demo-query";
import type { CountryDetail } from "@/lib/types";

const RadarVisualization = dynamic(() => import("@/components/radar-visualization"), {
  ssr: false,
  loading: () => <div className="chart-loading">正在绘制五维评分…</div>,
});

export function CountryDetailView({ code }: { code: string }) {
  const query = useDemoQuery<CountryDetail>(`countries/${encodeURIComponent(code)}`);

  if (query.loading) return <LoadingState label="正在加载国家详情…" />;
  if (query.error) return <ErrorState message={query.error} retry={query.reload} />;
  if (!query.data) return <EmptyState message="未找到此演示国家。" />;

  const country = query.data;
  return (
    <section>
      <Link className="back-link" href="/countries"><ArrowLeft size={16} />返回国家列表</Link>
      <div className="country-detail-heading">
        <div>
          <span className="country-code country-code-large">{country.code}</span>
          <h1>{country.name_zh}</h1>
          <p>{country.name_en} · {country.region}</p>
        </div>
        <Link className="button button-primary" href={`/compare?countries=${country.code}`}>加入国家对比 <ArrowRight size={17} /></Link>
      </div>
      <div className="country-facts">
        <span><Globe2 size={17} />区域 <strong>{country.region}</strong></span>
        <span><Banknote size={17} />币种 <strong>{country.currency}</strong></span>
        <span><Info size={17} />数据 <strong>synthetic_demo</strong></span>
      </div>
      <p className="country-summary">{country.summary}</p>

      <div className="detail-score-layout">
        <div>
          <ScoreStrip scores={country.scores} deltas={country.dimension_deltas} />
          <p className="synthetic-note"><Info size={14} />以上为合成演示评分，仅用于内部演示与能力说明。</p>
        </div>
        <div className="panel detail-radar-panel">
          <div className="panel-header"><h2>五维概览</h2><span>0—100</span></div>
          <RadarVisualization series={[{ key: country.code, name: country.name_zh, scores: country.scores }]} />
        </div>
      </div>

      <div className="country-detail-grid">
        <section className="panel signal-panel">
          <div className="panel-header"><h2>机会动态（按时间）</h2><Link href={`/opportunities?country=${country.code}`}>查看全部 <ArrowRight size={15} /></Link></div>
          <SignalTimeline signals={country.signals} />
        </section>
        <DecisionPanel reasons={country.reasons} risks={country.risks} actions={country.actions} />
      </div>
    </section>
  );
}
