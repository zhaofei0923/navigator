"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Bot,
  BriefcaseBusiness,
  CheckCircle2,
  FileText,
  Globe2,
  ShieldCheck,
  SunMedium,
} from "lucide-react";
import { useMemo, useState } from "react";
import { ErrorState, LoadingState } from "@/components/page-state";
import { useDemoQuery } from "@/hooks/use-demo-query";
import { useLocale } from "@/lib/i18n";
import type { GlobeMarker } from "@/lib/types";

const CountryGlobe = dynamic(() => import("@/components/country-globe"), {
  ssr: false,
  loading: () => <div className="landing-globe-loading" aria-hidden="true" />,
});

const DEFAULT_DEMO_MARKET_CODE = "BRA";

type HomeJourneyStep = Readonly<{
  number: string;
  title: string;
  description: string;
  href: string;
}>;

const COPY = {
  "zh-CN": {
    eyebrow: "面向新能源企业的全球拓展工作台",
    title: "从市场判断，到投标准备",
    intro:
      "选择一个演示市场，在同一条任务链中完成 AI 判断、光储概念、可研草案与招标准备。",
    currentMarket: "当前演示市场",
    preparingMarket: "正在准备首个合成市场…",
    primary: "开始当前市场任务",
    secondary: "先探索全球市场",
    globeKicker: "全球市场导航",
    globeTitle: "选择本次任务的目标市场",
    globeHelp: "拖动、缩放或悬停国家；点击高亮市场可切换当前任务上下文。",
    openCountry: "进入国家详情",
    readiness: "进入准备度",
    journeyKicker: "连续任务链",
    journeyTitle: "围绕同一个市场，完成四步出海准备",
    journeyIntro: "每一步都继承当前市场，使用受控输入和合成演示结果，并指向清晰的下一步。",
    currentStep: "当前步骤",
    nextStep: "下一步",
    laterStep: "后续步骤",
    trustTitle: "内部演示边界",
    trustBody:
      "所有数据均为仓库内合成演示数据；不连接真实来源、外部模型或生产系统，不构成工程、投资或专业结论。",
    safeguardsLabel: "演示保障",
    noExternalCalls: "无外部调用",
    bilingual: "中英双语",
    journeyLabel: "当前市场任务链",
    journeyItems: [
      {
        number: "01",
        title: "AI 市场判断",
        description: "围绕进入路径、政策风险和伙伴策略形成受控建议。",
        href: "/tools/assistant",
      },
      {
        number: "02",
        title: "光储概念方案",
        description: "按市场、场景与容量形成可讨论的概念配置。",
        href: "/tools/solar-storage",
      },
      {
        number: "03",
        title: "可研草案",
        description: "把市场、技术、交付与风险组织成结构化草案。",
        href: "/tools/feasibility",
      },
      {
        number: "04",
        title: "投标准备",
        description: "筛选合成机会，明确限制条件和下一步准备动作。",
        href: "/tools/tenders",
      },
    ] satisfies readonly HomeJourneyStep[],
  },
  en: {
    eyebrow: "A global expansion workbench for renewable-energy teams",
    title: "From market decision to tender readiness",
    intro:
      "Choose one demo market, then move through AI guidance, a solar-storage concept, a feasibility draft and tender preparation in one connected journey.",
    currentMarket: "Current demo market",
    preparingMarket: "Preparing the first synthetic market…",
    primary: "Start this market journey",
    secondary: "Explore global markets first",
    globeKicker: "GLOBAL MARKET NAVIGATOR",
    globeTitle: "Choose the target market for this journey",
    globeHelp: "Drag, zoom or hover over countries; select a highlighted market to change the task context.",
    openCountry: "Open country profile",
    readiness: "Readiness",
    journeyKicker: "CONNECTED TASK JOURNEY",
    journeyTitle: "Complete four expansion tasks for the same market",
    journeyIntro: "Every step carries the current market into controlled inputs, synthetic results and a clear next action.",
    currentStep: "Current step",
    nextStep: "Next step",
    laterStep: "Later step",
    trustTitle: "Internal demo boundary",
    trustBody:
      "All information is repository-owned synthetic demo data. No real sources, external models or production systems are connected, and no output is an engineering, investment or professional conclusion.",
    safeguardsLabel: "Demo safeguards",
    noExternalCalls: "No external calls",
    bilingual: "Bilingual",
    journeyLabel: "Current-market task journey",
    journeyItems: [
      {
        number: "01",
        title: "AI market guidance",
        description: "Shape controlled guidance for entry, policy risk and partner strategy.",
        href: "/tools/assistant",
      },
      {
        number: "02",
        title: "Solar-storage concept",
        description: "Build a discussion-ready concept from market, scenario and capacity.",
        href: "/tools/solar-storage",
      },
      {
        number: "03",
        title: "Feasibility draft",
        description: "Organise market, technical, delivery and risk considerations into a draft.",
        href: "/tools/feasibility",
      },
      {
        number: "04",
        title: "Tender preparation",
        description: "Filter synthetic opportunities and identify limits and preparation actions.",
        href: "/tools/tenders",
      },
    ] satisfies readonly HomeJourneyStep[],
  },
} as const;

const JOURNEY_ICONS = [Bot, SunMedium, FileText, BriefcaseBusiness] as const;

function withMarket(path: string, countryCode: string) {
  return `${path}?country=${encodeURIComponent(countryCode)}`;
}

export default function HomePage() {
  const { locale } = useLocale();
  const copy = COPY[locale];
  const router = useRouter();
  const markersQuery = useDemoQuery<GlobeMarker[]>("demo/globe-markers");
  const [selectedCode, setSelectedCode] = useState(DEFAULT_DEMO_MARKET_CODE);

  const selected = useMemo(
    () =>
      markersQuery.data?.find((item) => item.code === selectedCode) ?? markersQuery.data?.[0],
    [markersQuery.data, selectedCode],
  );
  const currentCode = selected?.code ?? DEFAULT_DEMO_MARKET_CODE;

  return (
    <div className="landing-page">
      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-hero-copy">
          <span className="section-kicker">{copy.eyebrow}</span>
          <h1 id="landing-title">{copy.title}</h1>
          <p>{copy.intro}</p>

          <div className="landing-current-market" aria-live="polite">
            <span>{copy.currentMarket}</span>
            {selected ? (
              <strong>
                {selected.name} <b>{selected.code}</b>
              </strong>
            ) : (
              <strong>{copy.preparingMarket}</strong>
            )}
          </div>

          <div className="landing-actions">
            <Link
              className="button button-primary button-large"
              href={withMarket("/tools", currentCode)}
            >
              {copy.primary} <ArrowRight size={18} aria-hidden="true" />
            </Link>
            <a className="landing-market-link" href="#markets">
              <Globe2 size={17} aria-hidden="true" /> {copy.secondary}
            </a>
          </div>

          <div className="landing-proof" aria-label={copy.safeguardsLabel}>
            <span><CheckCircle2 size={16} aria-hidden="true" /> synthetic_demo</span>
            <span><CheckCircle2 size={16} aria-hidden="true" /> {copy.noExternalCalls}</span>
            <span><CheckCircle2 size={16} aria-hidden="true" /> {copy.bilingual}</span>
          </div>
        </div>

        <div className="landing-globe-card" id="markets">
          <div className="landing-globe-heading">
            <span>{copy.globeKicker}</span>
            <h2>{copy.globeTitle}</h2>
            <p>{copy.globeHelp}</p>
          </div>
          {markersQuery.loading ? <LoadingState label={copy.preparingMarket} /> : null}
          {markersQuery.error ? <ErrorState message={markersQuery.error} retry={markersQuery.reload} /> : null}
          {markersQuery.data?.length ? (
            <CountryGlobe
              markers={markersQuery.data}
              selectedCode={currentCode}
              locale={locale}
              height={220}
              onSelect={setSelectedCode}
              onOpenCountry={(code) => router.push(`/countries/${code}`)}
            />
          ) : null}
          {selected ? (
            <div className="landing-market-summary">
              <div>
                <span>{selected.code}</span>
                <strong>{selected.name}</strong>
                <p>{selected.summary}</p>
              </div>
              <div className="market-summary-action">
                <small>{copy.readiness}</small>
                <b>{selected.readiness}<em>/100</em></b>
                <Link href={`/countries/${selected.code}`}>
                  {copy.openCountry} <ArrowRight size={15} aria-hidden="true" />
                </Link>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <section className="landing-section journey-section" aria-labelledby="journey-title">
        <div className="landing-section-heading">
          <span className="section-kicker">{copy.journeyKicker}</span>
          <h2 id="journey-title">{copy.journeyTitle}</h2>
          <p>{copy.journeyIntro}</p>
        </div>
        <ol className="journey-chain" aria-label={`${copy.journeyLabel}: ${currentCode}`}>
          {copy.journeyItems.map((item, index) => {
            const Icon = JOURNEY_ICONS[index];
            const status = index === 0 ? copy.currentStep : index === 1 ? copy.nextStep : copy.laterStep;
            return (
              <li key={item.href}>
                <Link
                  className="journey-step"
                  href={withMarket(item.href, currentCode)}
                  aria-current={index === 0 ? "step" : undefined}
                  aria-label={`${item.number}. ${item.title}. ${status}. ${currentCode}`}
                >
                  <span className="journey-step-topline">
                    <span className="journey-step-number">{item.number}</span>
                    <span className="journey-step-status">{status}</span>
                  </span>
                  <span className="journey-step-icon"><Icon size={22} aria-hidden="true" /></span>
                  <strong>{item.title}</strong>
                  <span className="journey-step-description">{item.description}</span>
                  <span className="journey-step-action" aria-hidden="true">
                    {currentCode} <ArrowRight size={16} />
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="landing-trust landing-trust-quiet" aria-labelledby="trust-title">
        <div className="trust-icon"><ShieldCheck size={27} aria-hidden="true" /></div>
        <div><h2 id="trust-title">{copy.trustTitle}</h2><p>{copy.trustBody}</p></div>
      </section>
    </div>
  );
}
