"use client";

import { ArrowRight, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { EmptyState, ErrorState, LoadingState } from "@/components/page-state";
import { useDemoQuery } from "@/hooks/use-demo-query";
import type { CountrySummary } from "@/lib/types";

export default function CountriesPage() {
  const query = useDemoQuery<CountrySummary[]>("countries");
  const [search, setSearch] = useState("");
  const [region, setRegion] = useState("all");
  const regions = useMemo(
    () => Array.from(new Set(query.data?.map((item) => item.region) || [])),
    [query.data],
  );
  const filtered = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase("zh-CN");
    return (query.data || []).filter(
      (country) =>
        (region === "all" || country.region === region) &&
        (!keyword ||
          country.name_zh.toLocaleLowerCase("zh-CN").includes(keyword) ||
          country.name_en.toLocaleLowerCase("en").includes(keyword) ||
          country.code.toLowerCase().includes(keyword)),
    );
  }, [query.data, region, search]);

  return (
    <section>
      <div className="page-heading">
        <div>
          <h1>国家</h1>
          <p>浏览合成国家画像，并进入市场、政策、项目、伙伴与风险全景。</p>
        </div>
        <Link className="button button-primary" href="/compare">开始国家对比 <ArrowRight size={17} /></Link>
      </div>
      <div className="filter-bar" role="search">
        <label className="filter-search">
          <Search size={17} aria-hidden="true" />
          <span className="sr-only">搜索国家</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索国家或代码" />
        </label>
        <label>
          <span className="sr-only">筛选区域</span>
          <select value={region} onChange={(event) => setRegion(event.target.value)}>
            <option value="all">区域：全部</option>
            {regions.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <span className="result-count">{filtered.length} 个演示国家</span>
      </div>
      {query.loading ? <LoadingState /> : null}
      {query.error ? <ErrorState message={query.error} retry={query.reload} /> : null}
      {!query.loading && !query.error && filtered.length === 0 ? <EmptyState /> : null}
      {filtered.length ? (
        <div className="country-list panel">
          <div className="country-list-head" aria-hidden="true">
            <span>国家</span><span>五维概览</span><span>进入准备度</span><span>操作</span>
          </div>
          {filtered.map((country) => (
            <article className="country-row" key={country.code}>
              <div className="country-row-name">
                <span className="country-code">{country.code}</span>
                <div><h2>{country.name_zh}</h2><p>{country.name_en} · {country.region}</p></div>
              </div>
              <div className="mini-score-set" aria-label={`${country.name_zh} 五维评分`}>
                <MiniScore label="市场" value={country.scores.market_attractiveness} />
                <MiniScore label="政策" value={country.scores.policy_certainty} />
                <MiniScore label="项目" value={country.scores.project_activity} />
                <MiniScore label="伙伴" value={country.scores.partner_maturity} />
                <MiniScore label="风险" value={country.scores.risk_controllability} />
              </div>
              <div className="readiness-score"><strong>{country.scores.readiness ?? "—"}</strong><span>/100</span></div>
              <Link className="button button-secondary" href={`/countries/${country.code}`}>查看详情 <ArrowRight size={16} /></Link>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function MiniScore({ label, value }: { label: string; value: number }) {
  return (
    <span className="mini-score">
      <small>{label}</small>
      <span className="progress-track" aria-hidden="true"><i style={{ width: `${value}%` }} /></span>
      <b>{value}</b>
    </span>
  );
}
