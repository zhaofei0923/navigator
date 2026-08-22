"use client";

import { ArrowRight, Search, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { EmptyState, ErrorState, LoadingState } from "@/components/page-state";
import { SectionTabs } from "@/components/section-tabs";
import { useDemoQuery } from "@/hooks/use-demo-query";
import { formatDate, formatNumber } from "@/lib/format";
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

const PAGE_CONFIG: Record<
  IntelligenceKind,
  { title: string; description: string; tabs?: ReadonlyArray<{ href: string; label: string }> }
> = {
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
    tabs: [{ href: "/opportunities", label: "项目与机会" }, { href: "/tenders", label: "招标" }],
  },
  tenders: {
    title: "招标",
    description: "查看合成招标阶段、预算区间和截止日期。",
    tabs: [{ href: "/opportunities", label: "项目与机会" }, { href: "/tenders", label: "招标" }],
  },
  partners: {
    title: "伙伴",
    description: "浏览合成合作伙伴能力、类型与匹配度。",
  },
};

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
  const config = PAGE_CONFIG[kind];
  const searchParams = useSearchParams();
  const initialCountry = searchParams.get("country")?.toUpperCase() || "all";
  const countries = useDemoQuery<CountrySummary[]>("countries");
  const [country, setCountry] = useState(initialCountry);
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const path = country === "all" ? kind : `${kind}?country_code=${encodeURIComponent(country)}`;
  const query = useDemoQuery<AnyItem[]>(path);
  const countryNames = useMemo(
    () => new Map(countries.data?.map((item) => [item.code, item.name_zh]) || []),
    [countries.data],
  );
  const categories = useMemo(
    () => Array.from(new Set((query.data || []).map(categoryOf))),
    [query.data],
  );
  const filtered = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase("zh-CN");
    return (query.data || []).filter(
      (item) =>
        (category === "all" || categoryOf(item) === category) &&
        (!keyword || searchableText(item).toLocaleLowerCase("zh-CN").includes(keyword)),
    );
  }, [category, query.data, search]);

  return (
    <section>
      <div className="page-heading">
        <div><h1>{config.title}</h1><p>{config.description}</p></div>
        <Link className="button button-secondary" href="/compare">进入国家对比 <ArrowRight size={16} /></Link>
      </div>
      {config.tabs ? <SectionTabs active={`/${kind}`} items={config.tabs} /> : null}
      <div className="filter-bar" role="search">
        <label className="filter-search">
          <Search size={17} aria-hidden="true" />
          <span className="sr-only">搜索{config.title}</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`搜索${config.title}记录`} />
        </label>
        <label><span className="sr-only">筛选国家</span><select value={country} onChange={(event) => { setCountry(event.target.value); setCategory("all"); }}><option value="all">国家：全部</option>{countries.data?.map((item) => <option key={item.code} value={item.code}>{item.name_zh}</option>)}</select></label>
        <label><span className="sr-only">筛选类别</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">类别：全部</option>{categories.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <span className="result-count">{filtered.length} 条演示记录</span>
      </div>
      {query.loading || countries.loading ? <LoadingState /> : null}
      {query.error ? <ErrorState message={query.error} retry={query.reload} /> : null}
      {!query.loading && !query.error && filtered.length === 0 ? <EmptyState /> : null}
      {filtered.length ? (
        <div className="panel intelligence-table-wrap">
          <div className="table-scroll">
            <table className="data-table intelligence-table">
              <thead><TableHead kind={kind} /></thead>
              <tbody>{filtered.map((item) => <TableRow key={itemId(item)} kind={kind} item={item} countryName={countryNames.get(item.country_code) || item.country_code} />)}</tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function TableHead({ kind }: { kind: IntelligenceKind }) {
  const cells: Record<IntelligenceKind, string[]> = {
    policies: ["国家", "政策", "类别 / 状态", "发布日期", "摘要"],
    risks: ["国家", "风险", "等级 / 可能性", "说明", "缓释建议"],
    opportunities: ["国家", "项目与机会", "类别", "评分", "下一步"],
    tenders: ["国家", "招标", "阶段", "预算区间", "截止日期"],
    partners: ["国家", "伙伴", "类型", "能力", "匹配度"],
  };
  return <tr>{cells[kind].map((cell) => <th key={cell}>{cell}</th>)}</tr>;
}

function TableRow({ kind, item, countryName }: { kind: IntelligenceKind; item: AnyItem; countryName: string }) {
  if (kind === "policies" && "policy_id" in item) {
    return <tr><CountryCell code={item.country_code} name={countryName} /><td><strong>{item.title}</strong></td><td><span className="type-tag">{item.category}</span><span className="status-inline">{item.status}</span></td><td>{formatDate(item.published_at)}</td><td>{item.summary}</td></tr>;
  }
  if (kind === "risks" && "risk_id" in item) {
    return <tr><CountryCell code={item.country_code} name={countryName} /><td><strong className="risk-title"><TriangleAlert size={15} />{item.title}</strong><small>{item.category}</small></td><td><span className="risk-level">严重度 {item.severity}/5</span><small>可能性 {item.likelihood}/5</small></td><td>{item.detail}</td><td>{item.mitigation}</td></tr>;
  }
  if (kind === "opportunities" && "opportunity_id" in item) {
    return <tr><CountryCell code={item.country_code} name={countryName} /><td><strong>{item.title}</strong><small>{item.detail}</small></td><td><span className="type-tag">{item.category}</span></td><td><span className="list-score">{item.score}</span>/100</td><td>{item.next_step}</td></tr>;
  }
  if (kind === "tenders" && "tender_id" in item) {
    return <tr><CountryCell code={item.country_code} name={countryName} /><td><strong>{item.title}</strong><small>{item.sector} · {item.summary}</small></td><td><span className="status-tag">{item.stage}</span></td><td>{item.currency} {formatNumber(item.budget_min_million, 1)}—{formatNumber(item.budget_max_million, 1)} 百万</td><td>{formatDate(item.deadline)}</td></tr>;
  }
  if (kind === "partners" && "partner_id" in item) {
    return <tr><CountryCell code={item.country_code} name={countryName} /><td><strong>{item.name}</strong><small>{item.summary}</small></td><td>{item.partner_type}</td><td><div className="capability-list">{item.capabilities.map((capability) => <span className="capability-tag" key={capability}>{capability}</span>)}</div></td><td><span className="list-score">{item.fit_score}</span>/100</td></tr>;
  }
  return null;
}

function CountryCell({ code, name }: { code: string; name: string }) {
  return <td><Link className="country-table-link" href={`/countries/${code}`}><span>{code}</span>{name}</Link></td>;
}
