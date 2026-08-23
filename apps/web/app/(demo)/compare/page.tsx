"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowRight, Bot, Info, Scale, Trophy } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { EmptyState, ErrorState, LoadingState } from "@/components/page-state";
import { useDemoQuery } from "@/hooks/use-demo-query";
import { demoApi } from "@/lib/api-client";
import { useLocale } from "@/lib/i18n";
import type { ComparisonResult, CountrySummary, ScoreDimensionKey } from "@/lib/types";
import { SCORE_DIMENSIONS } from "@/lib/types";
import {
  comparisonTrendLabel,
  getDimensionLeaderCodes,
  orderComparisonCountries,
  resolveComparisonSelection,
  type ComparisonSelection,
} from "./comparison-model";

const RadarVisualization = dynamic(() => import("@/components/radar-visualization"), {
  ssr: false,
  loading: () => <div className="chart-loading">…</div>,
});

const COPY = {
  "zh-CN": {
    eyebrow: "双国信息对比",
    title: "双国信息对比",
    description: "对照两个合成市场的核心评分与关键差异，作为国家研究中的辅助判断。",
    first: "市场 A",
    second: "市场 B",
    scoreTitle: "五维信息对照",
    radarTitle: "双国评分轮廓",
    recommendation: "演示推荐路径",
    identityTitle: "市场身份与总体判断",
    overallScore: "综合评分",
    rank: "演示排序",
    dimensionLeader: "本维度领先",
    firstMove: "优先研究顺序",
    firstMoveHelp: "顺序由现有演示排序与综合评分整理，不构成投资建议。",
    open: "查看国家详情",
    continue: "继续 AI 判断",
    methodology: "方法说明",
    labels: { market_attractiveness: "市场吸引力", policy_certainty: "政策确定性", project_activity: "项目活跃度", partner_maturity: "伙伴成熟度", risk_controllability: "风险可控性" },
  },
  en: {
    eyebrow: "TWO-MARKET COMPARISON",
    title: "Two-market comparison",
    description: "Compare the core scores and key differences of two synthetic markets as a supporting step in country research.",
    first: "Market A",
    second: "Market B",
    scoreTitle: "Five-dimension comparison",
    radarTitle: "Market score profiles",
    recommendation: "Demo recommendation path",
    identityTitle: "Market identity and overall view",
    overallScore: "Overall score",
    rank: "Demo rank",
    dimensionLeader: "Dimension leader",
    firstMove: "Suggested research sequence",
    firstMoveHelp: "This sequence uses the existing demo rank and overall score and is not investment advice.",
    open: "Open country profile",
    continue: "Continue AI assessment",
    methodology: "Methodology",
    labels: { market_attractiveness: "Market attractiveness", policy_certainty: "Policy certainty", project_activity: "Project activity", partner_maturity: "Partner maturity", risk_controllability: "Risk controllability" },
  },
} as const;

export default function ComparePage() {
  const { locale } = useLocale();
  const copy = COPY[locale];
  const searchParams = useSearchParams();
  const countries = useDemoQuery<CountrySummary[]>("countries");
  const [selectedOverride, setSelectedOverride] = useState<[string, string] | null>(null);
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const defaultSelected = useMemo<[string, string] | null>(() => {
    if (!countries.data) return null;
    return resolveComparisonSelection(countries.data, searchParams.get("countries"));
  }, [countries.data, searchParams]);
  const selected = selectedOverride ?? defaultSelected;

  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    async function compare() {
      setLoading(true);
      setError(null);
      try {
        const response = await demoApi<ComparisonResult>(`demo/country-comparisons?locale=${locale}`, {
          method: "POST",
          body: JSON.stringify({ country_codes: selected }),
          signal: controller.signal,
        });
        setResult(response.data);
      } catch (reason: unknown) {
        if (!controller.signal.aborted) {
          setResult(null);
          setError(reason instanceof Error ? reason.message : locale === "en" ? "Comparison unavailable." : "国家对比暂时不可用。");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void compare();
    return () => controller.abort();
  }, [locale, selected]);

  const countryByCode = useMemo(() => new Map((countries.data || []).map((country) => [country.code, country])), [countries.data]);

  if (countries.loading) return <LoadingState />;
  if (countries.error) return <ErrorState message={countries.error} retry={countries.reload} />;
  if (!countries.data?.length || !selected) return <EmptyState />;

  function changeCountry(index: 0 | 1, code: string) {
    if (!selected) return;
    const next: [string, string] = [selected[0], selected[1]];
    next[index] = code;
    setSelectedOverride(next);
  }

  const orderedCountries = result ? orderComparisonCountries(result.countries, selected) : [];
  const slotByCode = new Map(selected.map((code, index) => [code, index === 0 ? copy.first : copy.second]));
  const recommendationCountries = [...orderedCountries].sort(
    (first, second) => first.rank - second.rank || second.overall_score - first.overall_score,
  );

  return (
    <section className="compare-page-v2">
      <header className="compare-hero-v2">
        <span className="section-kicker">{copy.eyebrow}</span>
        <h1>{copy.title}</h1>
        <p>{copy.description}</p>
      </header>

      <div className="two-country-selector panel" aria-label={copy.title}>
        {[0, 1].map((index) => {
          const code = selected[index];
          const country = countryByCode.get(code);
          return (
            <label key={index}>
              <span className="compare-market-slot">{index === 0 ? copy.first : copy.second}</span>
              <span className="compare-market-code">{code}</span>
              <strong>{country ? (locale === "en" ? country.name_en : country.name_zh) : code}</strong>
              <select
                aria-label={index === 0 ? copy.first : copy.second}
                value={code}
                onChange={(event) => changeCountry(index as 0 | 1, event.target.value)}
              >
                {countries.data?.filter((item) => item.code !== selected[index === 0 ? 1 : 0]).map((item) => (
                  <option value={item.code} key={item.code}>{locale === "en" ? item.name_en : item.name_zh}</option>
                ))}
              </select>
            </label>
          );
        })}
        <span className="compare-versus"><Scale size={20} /><b>VS</b></span>
      </div>

      {loading ? <LoadingState /> : null}
      {error ? <ErrorState message={error} /> : null}
      {result && !loading ? (
        <>
          <section className="compare-identity-section" aria-labelledby="compare-identity-title">
            <div className="compare-section-heading">
              <span className="section-kicker">{copy.identityTitle}</span>
              <h2 id="compare-identity-title">{copy.identityTitle}</h2>
            </div>
            <div className="compare-market-identities">
              {orderedCountries.map((country) => (
                <article className="panel compare-market-identity" key={country.country_code}>
                  <div>
                    <span className="compare-market-slot">{slotByCode.get(country.country_code)}</span>
                    <span className="country-code">{country.country_code}</span>
                  </div>
                  <h3>{locale === "en" ? country.name_en : country.name_zh}</h3>
                  <p>{comparisonTrendLabel(country.trend, locale)}</p>
                  <dl className="compare-market-stats">
                    <div>
                      <dt>{copy.overallScore}</dt>
                      <dd>{country.overall_score}<span>/100</span></dd>
                    </div>
                    <div>
                      <dt>{copy.rank}</dt>
                      <dd>#{country.rank}</dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>
          </section>

          <div className="compare-overview-v2">
            <section className="panel compare-score-panel">
              <div className="panel-header"><h2>{copy.scoreTitle}</h2></div>
              <div className="compare-dimensions">
                {SCORE_DIMENSIONS.map((dimension) => (
                  <DimensionRow
                    key={dimension.key}
                    label={copy.labels[dimension.key]}
                    dimension={dimension.key}
                    countries={orderedCountries}
                    selected={selected}
                    firstLabel={copy.first}
                    secondLabel={copy.second}
                    leaderLabel={copy.dimensionLeader}
                  />
                ))}
              </div>
            </section>
            <section className="panel compare-radar-v2">
              <div className="panel-header"><h2>{copy.radarTitle}</h2></div>
              <RadarVisualization
                series={orderedCountries.map((country) => ({
                  key: country.country_code,
                  name: locale === "en" ? country.name_en : country.name_zh,
                  scores: country.scores,
                }))}
              />
            </section>
          </div>

          <section className="compare-recommendation-v2">
            <div><span className="section-kicker">{copy.recommendation}</span><h2>{result.recommendation}</h2></div>
            <div className="compare-path-heading">
              <h3>{copy.firstMove}</h3>
              <p>{copy.firstMoveHelp}</p>
            </div>
            <ol className="compare-path-list">
              {recommendationCountries.map((country, index) => (
                <li className="compare-path-item" key={country.country_code}>
                  <span className="compare-path-order" aria-hidden="true">{index + 1}</span>
                  <article>
                    <div>
                      <span className="compare-market-slot">{slotByCode.get(country.country_code)}</span>
                      <span className="country-code">{country.country_code}</span>
                    </div>
                    <h3>{locale === "en" ? country.name_en : country.name_zh}</h3>
                    <p>{country.reason}</p>
                    <nav className="compare-path-actions" aria-label={`${country.country_code} ${copy.firstMove}`}>
                      <Link href={`/countries/${country.country_code}`}>{copy.open} <ArrowRight size={15} /></Link>
                      <Link href={`/tools/assistant?country=${country.country_code}`}><Bot size={15} />{copy.continue}</Link>
                    </nav>
                  </article>
                </li>
              ))}
            </ol>
          </section>
          <p className="methodology-note"><Info size={15} /> <strong>{copy.methodology}:</strong> {result.methodology}</p>
        </>
      ) : null}
    </section>
  );
}

function DimensionRow({
  label,
  dimension,
  countries,
  selected,
  firstLabel,
  secondLabel,
  leaderLabel,
}: {
  label: string;
  dimension: ScoreDimensionKey;
  countries: ComparisonResult["countries"];
  selected: ComparisonSelection;
  firstLabel: string;
  secondLabel: string;
  leaderLabel: string;
}) {
  const leaderCodes = getDimensionLeaderCodes(countries, dimension);
  const headingId = `compare-dimension-${dimension}`;
  return (
    <section className="compare-dimension-row" aria-labelledby={headingId}>
      <h3 id={headingId}>{label}</h3>
      <div className="compare-dimension-markets">
        {countries.map((country) => {
          const value = country.scores[dimension];
          const isLeader = leaderCodes.has(country.country_code);
          const marketLabel = country.country_code === selected[0] ? firstLabel : secondLabel;
          return (
            <div key={country.country_code} className={isLeader ? "dimension-market leader" : "dimension-market"}>
              <div className="dimension-market-heading">
                <span>{marketLabel} · {country.country_code}</span>
                {isLeader ? <span className="dimension-leader-badge"><Trophy size={13} />{leaderLabel}</span> : null}
                <b>{value}<small>/100</small></b>
              </div>
              <span
                className="progress-track"
                role="meter"
                aria-label={`${marketLabel} · ${country.country_code} · ${label}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={value}
              >
                <i style={{ width: `${value}%` }} />
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
