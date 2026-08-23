"use client";

import { ArrowRight, Bot, GitCompareArrows, SunMedium } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ErrorState, LoadingState } from "@/components/page-state";
import { useDemoQuery } from "@/hooks/use-demo-query";
import { useLocale } from "@/lib/i18n";
import type { GlobeMarker } from "@/lib/types";

const CountryGlobe = dynamic(() => import("@/components/country-globe"), {
  ssr: false,
  loading: () => <div className="markets-globe-loading" aria-hidden="true" />,
});

const COPY = {
  "zh-CN": {
    title: "全球市场",
    description: "浏览合成国家画像，了解市场、政策、项目、伙伴与风险。",
    globeKicker: "全球市场导航",
    globeTitle: "从地球视图选择目标市场",
    globeHelp: "拖动、缩放或悬停国家；选择高亮市场后可进入完整国家画像。",
    readiness: "进入准备度",
    openCountry: "进入国家详情",
    compare: "对比两个国家",
    currentMarket: "当前演示市场",
    currentMarketHelp: "以下任务将自动沿用该市场，进入工具后仍可调整。",
    nextActions: "从当前市场继续",
    assistant: "AI 市场判断",
    solarStorage: "光储方案",
    compareCurrent: "加入双国对比",
  },
  en: {
    title: "Global Markets",
    description: "Explore synthetic market profiles across policy, projects, partners, and risk.",
    globeKicker: "GLOBAL MARKET NAVIGATOR",
    globeTitle: "Choose a target market from the globe",
    globeHelp: "Drag, zoom or hover over countries, then select a highlighted market to open its profile.",
    readiness: "Readiness",
    openCountry: "Open market profile",
    compare: "Compare two markets",
    currentMarket: "Current demo market",
    currentMarketHelp: "The next tasks will carry this market forward and can still be changed in each tool.",
    nextActions: "Continue from this market",
    assistant: "AI market assessment",
    solarStorage: "Solar + storage concept",
    compareCurrent: "Add to comparison",
  },
} as const;

export default function CountriesPage() {
  const { locale } = useLocale();
  const copy = COPY[locale];
  const router = useRouter();
  const markersQuery = useDemoQuery<GlobeMarker[]>("demo/globe-markers");
  const [selectedCode, setSelectedCode] = useState("");

  const selectedMarker = useMemo(
    () => markersQuery.data?.find((item) => item.code === selectedCode) ?? markersQuery.data?.[0],
    [markersQuery.data, selectedCode],
  );
  const compareHref = selectedMarker ? `/compare?countries=${selectedMarker.code}` : "/compare";
  return (
    <section className="markets-page">
      <div className="page-heading">
        <div>
          <h1>{copy.title}</h1>
          <p>{copy.description}</p>
        </div>
        <Link className="button button-primary" href={compareHref}>{copy.compare} <ArrowRight size={17} /></Link>
      </div>
      <div className="markets-explorer">
        <div className="markets-explorer-heading">
          <span className="section-kicker">{copy.globeKicker}</span>
          <h2>{copy.globeTitle}</h2>
          <p>{copy.globeHelp}</p>
        </div>
        {markersQuery.loading ? <LoadingState /> : null}
        {markersQuery.error ? <ErrorState message={markersQuery.error} retry={markersQuery.reload} /> : null}
        {markersQuery.data?.length ? (
          <CountryGlobe
            markers={markersQuery.data}
            selectedCode={selectedMarker?.code ?? markersQuery.data[0].code}
            locale={locale}
            onSelect={setSelectedCode}
            onOpenCountry={(code) => router.push(`/countries/${code}`)}
            height={520}
          />
        ) : null}
        {selectedMarker ? (
          <article className="markets-explorer-summary" aria-live="polite">
            <div>
              <span className="markets-context-label">{copy.currentMarket}</span>
              <span>{selectedMarker.code}</span>
              <strong>{selectedMarker.name}</strong>
              <p>{selectedMarker.summary}</p>
              <small>{copy.currentMarketHelp}</small>
            </div>
            <div>
              <small>{copy.readiness}</small>
              <b>{selectedMarker.readiness}<em>/100</em></b>
              <Link href={`/countries/${selectedMarker.code}`}>
                {copy.openCountry} <ArrowRight size={15} aria-hidden="true" />
              </Link>
            </div>
            <nav className="markets-context-actions" aria-label={copy.nextActions}>
              <Link href={`/tools/assistant?country=${selectedMarker.code}`}>
                <Bot size={17} aria-hidden="true" />
                <span>{copy.assistant}</span>
                <ArrowRight size={15} aria-hidden="true" />
              </Link>
              <Link href={`/tools/solar-storage?country=${selectedMarker.code}`}>
                <SunMedium size={17} aria-hidden="true" />
                <span>{copy.solarStorage}</span>
                <ArrowRight size={15} aria-hidden="true" />
              </Link>
              <Link href={`/compare?countries=${selectedMarker.code}`}>
                <GitCompareArrows size={17} aria-hidden="true" />
                <span>{copy.compareCurrent}</span>
                <ArrowRight size={15} aria-hidden="true" />
              </Link>
            </nav>
          </article>
        ) : null}
      </div>
    </section>
  );
}
