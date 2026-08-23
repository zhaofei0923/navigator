"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Banknote,
  Bot,
  ClipboardCheck,
  FileSearch,
  GitCompareArrows,
  Globe2,
  Info,
  SunMedium,
} from "lucide-react";
import { DecisionPanel } from "@/components/decision-panel";
import { EmptyState, ErrorState, LoadingState } from "@/components/page-state";
import { ScoreStrip } from "@/components/score-strip";
import { SignalTimeline } from "@/components/signal-timeline";
import { useDemoQuery } from "@/hooks/use-demo-query";
import { useLocale } from "@/lib/i18n";
import type { CountryDetail } from "@/lib/types";

const RadarVisualization = dynamic(() => import("@/components/radar-visualization"), {
  ssr: false,
  loading: () => <RadarLoading />,
});

const COPY = {
  "zh-CN": {
    radarLoading: "正在绘制五维评分…",
    loading: "正在加载国家详情…",
    missing: "未找到此演示国家。",
    back: "返回全球市场",
    compare: "加入双国对比",
    region: "区域",
    currency: "币种",
    data: "数据",
    note: "以上为合成演示评分，仅用于内部演示与能力说明。",
    overview: "五维概览",
    context: "当前演示市场",
    judgement: "市场判断快照",
    judgementHelp: "先看五维评分，再核对进入理由、主要风险和下一步动作。",
    related: "继续当前市场任务",
    relatedHelp: "下列入口将沿用当前演示市场，不会调用真实数据或外部模型。",
    assistant: "AI 市场判断",
    assistantHelp: "生成受控模板判断",
    solarStorage: "光储方案",
    solarStorageHelp: "形成概念级配置建议",
    feasibility: "可研草案",
    feasibilityHelp: "整理非正式章节草案",
    tenders: "投标准备",
    tendersHelp: "检查演示投标准备度",
    compareAction: "双国对比",
    compareHelp: "将当前市场设为市场 A",
    timeline: "机会动态（按时间）",
    viewAll: "查看全部",
  },
  en: {
    radarLoading: "Drawing five-dimension scores…",
    loading: "Loading market profile…",
    missing: "This demo market could not be found.",
    back: "Back to global markets",
    compare: "Add to two-market comparison",
    region: "Region",
    currency: "Currency",
    data: "Data",
    note: "These synthetic scores are for internal demonstration and capability explanation only.",
    overview: "Five-dimension overview",
    context: "Current demo market",
    judgement: "Market decision snapshot",
    judgementHelp: "Review the five dimensions first, then validate entry reasons, key risks, and next actions.",
    related: "Continue this market journey",
    relatedHelp: "These tasks carry the current demo market forward without real data or external model calls.",
    assistant: "AI market assessment",
    assistantHelp: "Generate a controlled assessment",
    solarStorage: "Solar + storage concept",
    solarStorageHelp: "Outline a concept-level configuration",
    feasibility: "Feasibility draft",
    feasibilityHelp: "Structure a non-official section draft",
    tenders: "Tender preparation",
    tendersHelp: "Check demo tender readiness",
    compareAction: "Two-market comparison",
    compareHelp: "Set this market as Market A",
    timeline: "Opportunity timeline",
    viewAll: "View all",
  },
} as const;

function RadarLoading() {
  const { locale } = useLocale();
  return <div className="chart-loading" role="status">{COPY[locale].radarLoading}</div>;
}

export function CountryDetailView({ code }: { code: string }) {
  const { locale } = useLocale();
  const copy = COPY[locale];
  const query = useDemoQuery<CountryDetail>(`countries/${encodeURIComponent(code)}`);

  if (query.loading) return <LoadingState label={copy.loading} />;
  if (query.error) return <ErrorState message={query.error} retry={query.reload} />;
  if (!query.data) return <EmptyState message={copy.missing} />;

  const country = query.data;
  const countryName = locale === "en" ? country.name_en : country.name_zh;
  return (
    <section>
      <Link className="back-link" href="/countries"><ArrowLeft size={16} />{copy.back}</Link>
      <div className="country-detail-heading">
        <div>
          <span className="section-kicker country-context-label">{copy.context}</span>
          <span className="country-code country-code-large">{country.code}</span>
          <h1>{countryName}</h1>
          <p>{country.region}</p>
        </div>
        <Link className="button button-primary" href={`/compare?countries=${country.code}`}>{copy.compare} <ArrowRight size={17} /></Link>
      </div>
      <div className="country-facts">
        <span><Globe2 size={17} />{copy.region} <strong>{country.region}</strong></span>
        <span><Banknote size={17} />{copy.currency} <strong>{country.currency}</strong></span>
        <span><Info size={17} />{copy.data} <strong>synthetic_demo</strong></span>
      </div>
      <p className="country-summary">{country.summary}</p>

      <section className="country-judgement-section" aria-labelledby="country-judgement-title">
        <div className="country-judgement-heading">
          <div>
            <span className="section-kicker">{copy.overview}</span>
            <h2 id="country-judgement-title">{copy.judgement}</h2>
          </div>
          <p>{copy.judgementHelp}</p>
        </div>
        <div className="detail-score-layout">
          <div>
            <ScoreStrip scores={country.scores} deltas={country.dimension_deltas} />
            <p className="synthetic-note"><Info size={14} />{copy.note}</p>
          </div>
          <div className="panel detail-radar-panel">
            <div className="panel-header"><h2>{copy.overview}</h2><span>0—100</span></div>
            <RadarVisualization series={[{ key: country.code, name: countryName, scores: country.scores }]} />
          </div>
        </div>
      </section>

      <div className="country-decision-layout">
        <DecisionPanel reasons={country.reasons} risks={country.risks} actions={country.actions} />
        <aside className="panel related-actions-panel" aria-labelledby="related-actions-title">
          <div className="panel-header related-actions-heading">
            <div>
              <h2 id="related-actions-title">{copy.related}</h2>
              <p>{copy.relatedHelp}</p>
            </div>
          </div>
          <nav className="related-actions-list" aria-label={copy.related}>
            <RelatedAction
              href={`/tools/assistant?country=${country.code}`}
              icon={<Bot size={19} />}
              title={copy.assistant}
              description={copy.assistantHelp}
            />
            <RelatedAction
              href={`/tools/solar-storage?country=${country.code}`}
              icon={<SunMedium size={19} />}
              title={copy.solarStorage}
              description={copy.solarStorageHelp}
            />
            <RelatedAction
              href={`/tools/feasibility?country=${country.code}`}
              icon={<FileSearch size={19} />}
              title={copy.feasibility}
              description={copy.feasibilityHelp}
            />
            <RelatedAction
              href={`/tools/tenders?country=${country.code}`}
              icon={<ClipboardCheck size={19} />}
              title={copy.tenders}
              description={copy.tendersHelp}
            />
            <RelatedAction
              href={`/compare?countries=${country.code}`}
              icon={<GitCompareArrows size={19} />}
              title={copy.compareAction}
              description={copy.compareHelp}
            />
          </nav>
        </aside>
      </div>

      <section className="panel signal-panel country-signal-section">
        <div className="panel-header"><h2>{copy.timeline}</h2><Link href={`/opportunities?country=${country.code}`}>{copy.viewAll} <ArrowRight size={15} /></Link></div>
        <SignalTimeline signals={country.signals} />
      </section>
    </section>
  );
}

function RelatedAction({
  href,
  icon,
  title,
  description,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Link className="related-action-card" href={href}>
      <span className="related-action-icon" aria-hidden="true">{icon}</span>
      <span>
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      <ArrowRight size={16} aria-hidden="true" />
    </Link>
  );
}
