"use client";

import { Search, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { EmptyState, ErrorState, LoadingState } from "@/components/page-state";
import { SectionTabs } from "@/components/section-tabs";
import { useDemoQuery } from "@/hooks/use-demo-query";
import { formatDate, formatNumber } from "@/lib/format";
import { useLocale } from "@/lib/i18n";
import type {
  CountrySummary,
  OpportunityItem,
  PartnerItem,
  PolicyItem,
  RiskItem,
  TenderItem,
} from "@/lib/types";

type IntelligenceKind = "policies" | "risks" | "opportunities" | "tenders" | "partners";
type AnyItem = PolicyItem | RiskItem | OpportunityItem | TenderItem | PartnerItem;
type Locale = "zh-CN" | "en";

const PAGE_CONFIG: Record<Locale, Record<IntelligenceKind, {
  title: string;
  description: string;
  tabs?: ReadonlyArray<{ href: string; label: string }>;
}>> = {
  "zh-CN": {
    policies: {
      title: "政策",
      description: "查看各演示国家的政策方向、状态与摘要。",
      tabs: [{ href: "/policies", label: "政策" }, { href: "/risks", label: "风险" }],
    },
    risks: {
      title: "风险",
      description: "识别合成国家画像中的风险等级、可能性与缓释建议。",
      tabs: [{ href: "/policies", label: "政策" }, { href: "/risks", label: "风险" }],
    },
    opportunities: {
      title: "项目与机会",
      description: "查看合成项目机会、综合评分与建议的下一步。",
      tabs: [{ href: "/opportunities", label: "项目与机会" }, { href: "/tools/tenders", label: "项目招标" }],
    },
    tenders: {
      title: "项目招标",
      description: "查看合成招标阶段、预算区间和截止日期。",
      tabs: [{ href: "/opportunities", label: "项目与机会" }, { href: "/tools/tenders", label: "项目招标" }],
    },
    partners: { title: "合作伙伴", description: "浏览合成合作伙伴能力、类型与匹配度。" },
  },
  en: {
    policies: {
      title: "Policy",
      description: "Review synthetic policy directions, status, and summaries by market.",
      tabs: [{ href: "/policies", label: "Policy" }, { href: "/risks", label: "Risk" }],
    },
    risks: {
      title: "Risk",
      description: "Review severity, likelihood, and mitigation guidance in synthetic market profiles.",
      tabs: [{ href: "/policies", label: "Policy" }, { href: "/risks", label: "Risk" }],
    },
    opportunities: {
      title: "Projects & Opportunities",
      description: "Explore synthetic project opportunities, scores, and suggested next steps.",
      tabs: [{ href: "/opportunities", label: "Projects & Opportunities" }, { href: "/tools/tenders", label: "Project Tenders" }],
    },
    tenders: {
      title: "Project Tenders",
      description: "Review synthetic tender stages, budget ranges, and deadlines.",
      tabs: [{ href: "/opportunities", label: "Projects & Opportunities" }, { href: "/tools/tenders", label: "Project Tenders" }],
    },
    partners: { title: "Partners", description: "Explore synthetic partner capabilities, types, and fit scores." },
  },
};

const COPY = {
  "zh-CN": {
    search: (title: string) => `搜索${title}`,
    searchPlaceholder: (title: string) => `搜索${title}记录`,
    countryFilter: "筛选国家",
    allCountries: "国家：全部",
    categoryFilter: "筛选类别",
    allCategories: "类别：全部",
    result: (count: number) => `${count} 条演示记录`,
    heads: {
      policies: ["国家", "政策", "类别 / 状态", "发布日期", "摘要"],
      risks: ["国家", "风险", "等级 / 可能性", "说明", "缓释建议"],
      opportunities: ["国家", "项目与机会", "类别", "评分", "下一步"],
      tenders: ["国家", "招标", "阶段", "预算区间", "截止日期"],
      partners: ["国家", "伙伴", "类型", "能力", "匹配度"],
    },
    severity: "严重度",
    likelihood: "可能性",
    million: "百万",
  },
  en: {
    search: (title: string) => `Search ${title}`,
    searchPlaceholder: (title: string) => `Search ${title.toLocaleLowerCase("en")} records`,
    countryFilter: "Filter by market",
    allCountries: "Market: All",
    categoryFilter: "Filter by category",
    allCategories: "Category: All",
    result: (count: number) => `${count} demo records`,
    heads: {
      policies: ["Market", "Policy", "Category / status", "Published", "Summary"],
      risks: ["Market", "Risk", "Severity / likelihood", "Details", "Mitigation"],
      opportunities: ["Market", "Project & opportunity", "Category", "Score", "Next step"],
      tenders: ["Market", "Tender", "Stage", "Budget range", "Deadline"],
      partners: ["Market", "Partner", "Type", "Capabilities", "Fit"],
    },
    severity: "Severity",
    likelihood: "Likelihood",
    million: "million",
  },
} as const;

const ENUM_LABELS: Readonly<Record<string, Record<Locale, string>>> = {
  battery_storage: { "zh-CN": "储能", en: "Battery storage" },
  commercial: { "zh-CN": "商业", en: "Commercial" },
  commercial_energy: { "zh-CN": "商业能源", en: "Commercial energy" },
  corporate_energy: { "zh-CN": "企业能源", en: "Corporate energy" },
  critical_power: { "zh-CN": "关键电力", en: "Critical power" },
  delivery: { "zh-CN": "交付", en: "Delivery" },
  demand: { "zh-CN": "需求", en: "Demand" },
  demo_watchlist: { "zh-CN": "演示观察清单", en: "Demo watchlist" },
  distributed_energy: { "zh-CN": "分布式能源", en: "Distributed energy" },
  energy: { "zh-CN": "能源", en: "Energy" },
  finance: { "zh-CN": "融资", en: "Finance" },
  grid: { "zh-CN": "电网", en: "Grid" },
  industrial_storage: { "zh-CN": "工业储能", en: "Industrial storage" },
  investment: { "zh-CN": "投资", en: "Investment" },
  localization: { "zh-CN": "本地化", en: "Localization" },
  market: { "zh-CN": "市场", en: "Market" },
  microgrid: { "zh-CN": "微电网", en: "Microgrid" },
  power_market: { "zh-CN": "电力市场", en: "Power market" },
  regulatory: { "zh-CN": "监管", en: "Regulatory" },
  scenario_active: { "zh-CN": "情景有效", en: "Scenario active" },
  solar_storage: { "zh-CN": "光储", en: "Solar & storage" },
  synthetic_developer: { "zh-CN": "合成项目开发商", en: "Synthetic developer" },
  synthetic_epc: { "zh-CN": "合成 EPC", en: "Synthetic EPC" },
  synthetic_integrator: { "zh-CN": "合成集成商", en: "Synthetic integrator" },
  synthetic_service_provider: { "zh-CN": "合成服务商", en: "Synthetic service provider" },
  synthetic_technology_partner: { "zh-CN": "合成技术伙伴", en: "Synthetic technology partner" },
};

function labelFor(value: string, locale: Locale): string {
  const known = ENUM_LABELS[value]?.[locale];
  if (known) return known;
  return locale === "en"
    ? value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase())
    : value;
}

function itemId(item: AnyItem): string {
  if ("policy_id" in item) return item.policy_id;
  if ("risk_id" in item) return item.risk_id;
  if ("opportunity_id" in item) return item.opportunity_id;
  if ("tender_id" in item) return item.tender_id;
  return item.partner_id;
}

function searchableText(item: AnyItem): string {
  if ("name" in item) return `${item.name} ${item.summary} ${item.partner_type} ${item.capabilities.join(" ")}`;
  const nextStep = "next_step" in item ? item.next_step : "";
  const mitigation = "mitigation" in item ? item.mitigation : "";
  const detail = "detail" in item ? item.detail : "";
  const summary = "summary" in item ? item.summary : "";
  return `${item.title} ${summary} ${detail} ${nextStep} ${mitigation}`;
}

function categoryOf(item: AnyItem): string {
  if ("category" in item) return item.category;
  if ("sector" in item) return item.sector;
  return item.partner_type;
}

export function IntelligenceListPage({ kind }: { kind: IntelligenceKind }) {
  const { locale } = useLocale();
  const config = PAGE_CONFIG[locale][kind];
  const copy = COPY[locale];
  const searchParams = useSearchParams();
  const initialCountry = searchParams.get("country")?.toUpperCase() || "all";
  const countries = useDemoQuery<CountrySummary[]>("countries");
  const [country, setCountry] = useState(initialCountry);
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const path = country === "all" ? kind : `${kind}?country_code=${encodeURIComponent(country)}`;
  const query = useDemoQuery<AnyItem[]>(path);
  const countryNames = useMemo(
    () => new Map(countries.data?.map((item) => [item.code, locale === "en" ? item.name_en : item.name_zh]) || []),
    [countries.data, locale],
  );
  const categories = useMemo(
    () => Array.from(new Set((query.data || []).map(categoryOf))),
    [query.data],
  );
  const filtered = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase(locale);
    return (query.data || []).filter(
      (item) =>
        (category === "all" || categoryOf(item) === category) &&
        (!keyword || `${searchableText(item)} ${labelFor(categoryOf(item), locale)}`.toLocaleLowerCase(locale).includes(keyword)),
    );
  }, [category, locale, query.data, search]);

  return (
    <section>
      <div className="page-heading">
        <div><h1>{config.title}</h1><p>{config.description}</p></div>
      </div>
      {config.tabs ? <SectionTabs active={`/${kind}`} items={config.tabs} /> : null}
      <div className="filter-bar" role="search">
        <label className="filter-search">
          <Search size={17} aria-hidden="true" />
          <span className="sr-only">{copy.search(config.title)}</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={copy.searchPlaceholder(config.title)} />
        </label>
        <label>
          <span className="sr-only">{copy.countryFilter}</span>
          <select value={country} onChange={(event) => { setCountry(event.target.value); setCategory("all"); }}>
            <option value="all">{copy.allCountries}</option>
            {countries.data?.map((item) => <option key={item.code} value={item.code}>{locale === "en" ? item.name_en : item.name_zh}</option>)}
          </select>
        </label>
        <label>
          <span className="sr-only">{copy.categoryFilter}</span>
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="all">{copy.allCategories}</option>
            {categories.map((item) => <option key={item} value={item}>{labelFor(item, locale)}</option>)}
          </select>
        </label>
        <span className="result-count">{copy.result(filtered.length)}</span>
      </div>
      {query.loading || countries.loading ? <LoadingState /> : null}
      {query.error ? <ErrorState message={query.error} retry={query.reload} /> : null}
      {!query.loading && !query.error && filtered.length === 0 ? <EmptyState /> : null}
      {filtered.length ? (
        <div className="panel intelligence-table-wrap">
          <div className="table-scroll">
            <table className="data-table intelligence-table">
              <thead><TableHead kind={kind} locale={locale} /></thead>
              <tbody>{filtered.map((item) => (
                <TableRow
                  key={itemId(item)}
                  kind={kind}
                  item={item}
                  countryName={countryNames.get(item.country_code) || item.country_code}
                  locale={locale}
                />
              ))}</tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function TableHead({ kind, locale }: { kind: IntelligenceKind; locale: Locale }) {
  return <tr>{COPY[locale].heads[kind].map((cell) => <th key={cell}>{cell}</th>)}</tr>;
}

function TableRow({
  kind,
  item,
  countryName,
  locale,
}: {
  kind: IntelligenceKind;
  item: AnyItem;
  countryName: string;
  locale: Locale;
}) {
  const copy = COPY[locale];
  if (kind === "policies" && "policy_id" in item) {
    return <tr><CountryCell code={item.country_code} name={countryName} /><td><strong>{item.title}</strong></td><td><span className="type-tag">{labelFor(item.category, locale)}</span><span className="status-inline">{labelFor(item.status, locale)}</span></td><td>{formatDate(item.published_at, locale)}</td><td>{item.summary}</td></tr>;
  }
  if (kind === "risks" && "risk_id" in item) {
    return <tr><CountryCell code={item.country_code} name={countryName} /><td><strong className="risk-title"><TriangleAlert size={15} />{item.title}</strong><small>{labelFor(item.category, locale)}</small></td><td><span className="risk-level">{copy.severity} {formatNumber(item.severity, 0, locale)}/5</span><small>{copy.likelihood} {formatNumber(item.likelihood, 0, locale)}/5</small></td><td>{item.detail}</td><td>{item.mitigation}</td></tr>;
  }
  if (kind === "opportunities" && "opportunity_id" in item) {
    return <tr><CountryCell code={item.country_code} name={countryName} /><td><strong>{item.title}</strong><small>{item.detail}</small></td><td><span className="type-tag">{labelFor(item.category, locale)}</span></td><td><span className="list-score">{formatNumber(item.score, 0, locale)}</span>/100</td><td>{item.next_step}</td></tr>;
  }
  if (kind === "tenders" && "tender_id" in item) {
    return <tr><CountryCell code={item.country_code} name={countryName} /><td><strong>{item.title}</strong><small>{labelFor(item.sector, locale)} · {item.summary}</small></td><td><span className="status-tag">{labelFor(item.stage, locale)}</span></td><td>{item.currency} {formatNumber(item.budget_min_million, 1, locale)}—{formatNumber(item.budget_max_million, 1, locale)} {copy.million}</td><td>{formatDate(item.deadline, locale)}</td></tr>;
  }
  if (kind === "partners" && "partner_id" in item) {
    return <tr><CountryCell code={item.country_code} name={countryName} /><td><strong>{item.name}</strong><small>{item.summary}</small></td><td>{labelFor(item.partner_type, locale)}</td><td><div className="capability-list">{item.capabilities.map((capability) => <span className="capability-tag" key={capability}>{capability}</span>)}</div></td><td><span className="list-score">{formatNumber(item.fit_score, 0, locale)}</span>/100</td></tr>;
  }
  return null;
}

function CountryCell({ code, name }: { code: string; name: string }) {
  return <td><Link className="country-table-link" href={`/countries/${code}`}><span>{code}</span>{name}</Link></td>;
}
