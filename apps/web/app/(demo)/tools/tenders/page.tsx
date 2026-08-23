"use client";

import { ArrowRight, CalendarDays, Search, WalletCards, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { type FormEvent, useMemo, useState } from "react";
import { ToolPageShell, ToolResultState } from "@/components/tool-page-shell";
import { useDemoQuery } from "@/hooks/use-demo-query";
import { formatDate, formatNumber } from "@/lib/format";
import { useLocale } from "@/lib/i18n";
import { comparisonHref, resolveToolCountry, toolMarket } from "@/lib/tool-journey";
import type { CountrySummary, TenderItem } from "@/lib/types";

const COPY = {
  "zh-CN": {
    eyebrow: "合成招标扫描",
    title: "项目招标",
    description: "筛选五国合成招标，查看阶段、预算、截止时间和内部准备动作。",
    search: "搜索招标",
    keyword: "关键词",
    keywordPlaceholder: "标题或摘要",
    countryLabel: "目标市场",
    sectorLabel: "行业",
    stageLabel: "阶段",
    country: "国家：全部",
    sector: "行业：全部",
    stage: "阶段：全部",
    submit: "应用筛选",
    results: "条合成招标",
    budget: "预算区间",
    deadline: "截止日期",
    details: "查看详情",
    close: "关闭详情",
    detailTitle: "招标准备摘要",
    action: "建议动作",
    loading: "正在筛选合成招标…",
    empty: "当前筛选条件下没有合成招标，可调整筛选后重试。",
    compare: "进入双国对比",
    countryProfile: "返回国家详情",
    million: "百万",
    openDetailsAria: (title: string) => `查看${title}详情`,
  },
  en: {
    eyebrow: "SYNTHETIC TENDER SCAN",
    title: "Project Tenders",
    description: "Filter synthetic tenders across five markets and review stage, budget, deadline and internal preparation actions.",
    search: "Search tenders",
    keyword: "Keyword",
    keywordPlaceholder: "Title or summary",
    countryLabel: "Target market",
    sectorLabel: "Sector",
    stageLabel: "Stage",
    country: "Country: All",
    sector: "Sector: All",
    stage: "Stage: All",
    submit: "Apply filters",
    results: "synthetic tenders",
    budget: "Budget range",
    deadline: "Deadline",
    details: "View details",
    close: "Close details",
    detailTitle: "Tender readiness summary",
    action: "Recommended action",
    loading: "Filtering synthetic tenders…",
    empty: "No synthetic tenders match these filters. Adjust the filters and try again.",
    compare: "Open two-market comparison",
    countryProfile: "Return to country profile",
    million: "million",
    openDetailsAria: (title: string) => `View details for ${title}`,
  },
} as const;

type Filters = { keyword: string; country: string; sector: string; stage: string };
const EMPTY_FILTERS: Filters = { keyword: "", country: "all", sector: "all", stage: "all" };

const TENDER_LABELS: Readonly<Record<string, { "zh-CN": string; en: string }>> = {
  battery_storage: { "zh-CN": "储能", en: "Battery storage" },
  critical_power: { "zh-CN": "关键电力", en: "Critical power" },
  demo_watchlist: { "zh-CN": "演示观察清单", en: "Demo watchlist" },
  distributed_energy: { "zh-CN": "分布式能源", en: "Distributed energy" },
  industrial_storage: { "zh-CN": "工业储能", en: "Industrial storage" },
  solar_storage: { "zh-CN": "光储", en: "Solar & storage" },
};

function tenderLabel(value: string, locale: "zh-CN" | "en") {
  return TENDER_LABELS[value]?.[locale] ??
    (locale === "en"
      ? value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase())
      : value);
}

function queryPath(filters: Filters) {
  const params = new URLSearchParams({ limit: "50" });
  if (filters.keyword.trim()) params.set("keyword", filters.keyword.trim());
  if (filters.country !== "all") params.set("country_code", filters.country);
  if (filters.sector !== "all") params.set("sector", filters.sector);
  if (filters.stage !== "all") params.set("stage", filters.stage);
  return `demo/tools/tenders?${params}`;
}

export default function TenderToolPage() {
  const { locale } = useLocale();
  const copy = COPY[locale];
  const searchParams = useSearchParams();
  const countries = useDemoQuery<CountrySummary[]>("countries");
  const initialCountry = resolveToolCountry(searchParams.get("country"), countries.data ?? []);
  const initialFilters: Filters = {
    ...EMPTY_FILTERS,
    country: initialCountry || "all",
  };
  const [draftOverride, setDraft] = useState<Filters | null>(null);
  const [filterOverride, setFilters] = useState<Filters | null>(null);
  const draft = draftOverride ?? initialFilters;
  const filters = filterOverride ?? initialFilters;
  const marketInitialized = Boolean(countries.data?.length);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const tenders = useDemoQuery<TenderItem[]>(marketInitialized ? queryPath(filters) : null);
  const detail = useDemoQuery<TenderItem>(selectedId ? `demo/tools/tenders/${encodeURIComponent(selectedId)}` : null);
  const sectors = useMemo(() => Array.from(new Set((tenders.data || []).map((item) => item.sector))), [tenders.data]);
  const stages = useMemo(() => Array.from(new Set((tenders.data || []).map((item) => item.stage))), [tenders.data]);

  const contextCountryCode = resolveToolCountry(
    draft.country === "all" ? searchParams.get("country") : draft.country,
    countries.data ?? [],
  );
  const market = toolMarket(contextCountryCode, countries.data ?? [], locale);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFilters(draft);
    setSelectedId(null);
  }

  return (
    <ToolPageShell
      eyebrow={copy.eyebrow}
      title={copy.title}
      description={copy.description}
      currentStep="tenders"
      market={market}
      relatedActions={[
        { href: comparisonHref(contextCountryCode), label: copy.compare, primary: true },
        {
          href: contextCountryCode ? `/countries/${contextCountryCode}` : "/countries",
          label: copy.countryProfile,
        },
      ]}
    >
      <div className="tool-workspace tender-tool-workspace">
        <form className="tool-form tender-filter-panel panel" role="search" onSubmit={submit}>
          <label className="filter-search">
            <span>{copy.keyword}</span>
            <span className="filter-input-with-icon">
              <Search size={17} aria-hidden="true" />
              <input value={draft.keyword} onChange={(event) => setDraft({ ...draft, keyword: event.target.value })} placeholder={copy.keywordPlaceholder} />
            </span>
          </label>
          <label><span>{copy.countryLabel}</span>
            <select value={draft.country} onChange={(event) => setDraft({ ...draft, country: event.target.value })}>
              <option value="all">{copy.country}</option>
              {(countries.data || []).map((country) => <option value={country.code} key={country.code}>{locale === "en" ? country.name_en : country.name_zh}</option>)}
            </select>
          </label>
          <label><span>{copy.sectorLabel}</span>
            <select value={draft.sector} onChange={(event) => setDraft({ ...draft, sector: event.target.value })}>
              <option value="all">{copy.sector}</option>
              {sectors.map((sector) => <option value={sector} key={sector}>{tenderLabel(sector, locale)}</option>)}
            </select>
          </label>
          <label><span>{copy.stageLabel}</span>
            <select value={draft.stage} onChange={(event) => setDraft({ ...draft, stage: event.target.value })}>
              <option value="all">{copy.stage}</option>
              {stages.map((stage) => <option value={stage} key={stage}>{tenderLabel(stage, locale)}</option>)}
            </select>
          </label>
          <button className="button button-primary button-wide button-large" type="submit">{copy.submit}</button>
        </form>

        <div className="tool-result tender-results-panel panel" aria-live="polite">
          {countries.error ? <ToolResultState status="error" message={countries.error} /> : null}
          {!countries.error && (!marketInitialized || tenders.loading) ? <ToolResultState status="loading" message={copy.loading} /> : null}
          {!countries.error && tenders.error ? <ToolResultState status="error" message={tenders.error} /> : null}
          {!countries.error && marketInitialized && !tenders.loading && !tenders.error && !tenders.data?.length ? <ToolResultState status="empty" message={copy.empty} /> : null}
          {!countries.error && tenders.data?.length ? (
            <div className={selectedId ? "tender-workspace detail-open" : "tender-workspace"}>
          <section>
            <div className="tender-result-count"><strong>{formatNumber(tenders.data.length, 0, locale)}</strong> {copy.results}</div>
            <div className="tender-card-list">
              {tenders.data.map((tender) => (
                <button
                  className={selectedId === tender.tender_id ? "tender-card active" : "tender-card"}
                  type="button"
                  key={tender.tender_id}
                  onClick={() => setSelectedId(tender.tender_id)}
                  aria-label={copy.openDetailsAria(tender.title)}
                  aria-expanded={selectedId === tender.tender_id}
                  aria-controls={`tender-detail-${tender.tender_id}`}
                >
                  <span className="tender-card-code">{tender.country_code}</span>
                  <span className="tender-card-copy"><span>{tenderLabel(tender.sector, locale)} · {tenderLabel(tender.stage, locale)}</span><strong>{tender.title}</strong><span className="tender-card-summary">{tender.summary}</span></span>
                  <span className="tender-card-meta">
                    <span><WalletCards size={15} /> {tender.currency} {formatNumber(tender.budget_min_million, 1, locale)}–{formatNumber(tender.budget_max_million, 1, locale)} {copy.million}</span>
                    <span><CalendarDays size={15} /> {formatDate(tender.deadline, locale)}</span>
                    <em>{copy.details} <ArrowRight size={15} /></em>
                  </span>
                </button>
              ))}
            </div>
          </section>

          {selectedId ? (
            <aside id={`tender-detail-${selectedId}`} className="tender-detail panel" aria-live="polite">
              <button className="icon-button tender-detail-close" type="button" onClick={() => setSelectedId(null)} aria-label={copy.close}><X size={19} /></button>
              {detail.loading ? <ToolResultState status="loading" message={copy.loading} /> : null}
              {detail.error ? <ToolResultState status="error" message={detail.error} /> : null}
              {detail.data ? (
                <>
                  <span className="section-kicker">{detail.data.country_code} · {tenderLabel(detail.data.stage, locale)}</span>
                  <h2>{detail.data.title}</h2>
                  <p>{detail.data.summary}</p>
                  <dl>
                    <div><dt>{copy.budget}</dt><dd>{detail.data.currency} {formatNumber(detail.data.budget_min_million, 1, locale)}–{formatNumber(detail.data.budget_max_million, 1, locale)} {copy.million}</dd></div>
                    <div><dt>{copy.deadline}</dt><dd>{formatDate(detail.data.deadline, locale)}</dd></div>
                  </dl>
                  <div className="tender-action-box"><strong>{copy.action}</strong><p>{locale === "en" ? "Validate eligibility, prepare a partner shortlist and confirm the internal bid/no-bid checkpoint before the deadline." : "核对资格要求、准备合作伙伴短名单，并在截止日前完成内部投标决策检查。"}</p></div>
                </>
              ) : null}
            </aside>
          ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </ToolPageShell>
  );
}
