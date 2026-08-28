"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Bot, BriefcaseBusiness, Building2, FileText, Globe2, RotateCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { CountryGlobeMarker } from "@/components/country-globe";
import { MARKET_REGIONS, marketRegionFor } from "@/lib/approved-basic60/market-regions";
import { homeMarketHref } from "@/lib/approved-basic60/navigation";
import { EXPANSION_TOOL_COPY, EXPANSION_TOOL_GROUPS, EXPANSION_TOOL_PATHS } from "@/lib/approved-basic60/tool-catalog";
import { isOutboundTargetCountry, normalizeOutboundCountryParam } from "@/lib/basic60/market-scope";
import type { Basic60MarketView } from "@/lib/basic60/market-view";
import type { Basic60Locale } from "@/lib/basic60/types";
import { useLocale } from "@/lib/i18n/client";
import { toolHref } from "@/lib/tool-journey";

const CountryGlobe = dynamic(() => import("@/components/country-globe"), {
  ssr: false,
  loading: () => <div className="landing-globe-loading" aria-hidden="true" />,
});

export type HomeMarket = Pick<Basic60MarketView, "code" | "name" | "alternateName" | "region" | "featuredMetrics">;

const COPY = {
  "zh-CN": {
    positioning: "中国新能源企业出海导航仪",
    titleStart: "从看清全球市场，",
    titleEnd: "到推动项目落地",
    intro: "覆盖全球主要新能源市场，提供市场研究、政策分析、出海工具与合作伙伴服务，助力中国新能源企业从市场探索走向项目落地。",
    services: ["市场研究", "政策分析", "出海工具", "合作伙伴"],
    globeTitle: "你的下一站，在哪里？",
    globeHelp: "单击选择国家，双击查看国家数据。",
    marketFilter: "按洲或主要区域及国家筛选",
    region: "洲 / 主要区域",
    allRegions: "全部区域",
    country: "国家",
    chooseCountry: "请选择国家",
    openCountry: "查看国家数据",
    flowTitle: "让出海的下一步更清晰",
    flowIntro: "从一个目标市场出发，逐步了解环境、准备方案、寻找协作资源。",
    flowSteps: [
      { title: "了解目标市场", description: "查看国家概况、经济环境与能源市场，建立对目标市场的认识。", action: "选择目标市场" },
      { title: "使用出海工具", description: "围绕市场与政策研究、项目方案和投标准备，规划下一步行动。", action: "进入出海工具" },
      { title: "寻找合作伙伴", description: "了解合作资源与专业服务，推进业务协作和项目落地。", action: "进入合作伙伴" },
    ],
    toolsTitle: "把出海想法，推进成行动",
    toolsIntro: "围绕研究、方案与机会，找到适合当前阶段的出海工具。",
    planned: "即将上线",
    learn: "了解功能",
    partnersTitle: "让合作，成为落地的下一步",
    partnersIntro: "了解合作伙伴与专业服务资源，为业务拓展和项目推进寻找协作支持。伙伴名录与对接功能正在建设中。",
    partners: "了解合作伙伴",
    closingTitle: "从一个目标市场，开启你的出海规划",
    closingBody: "先了解市场，再规划行动。每一步，都从更清晰的信息开始。",
    closingAction: "开始探索目标市场",
    selectedAction: "查看{country}数据",
    unavailable: "国家数据暂时无法加载",
    loading: "正在加载国家数据",
    loadingHint: "你可以先了解出海工具与合作伙伴服务。",
    noData: "暂无可展示的国家数据",
    retry: "重新加载数据",
    retryHint: "请稍后重试，你仍可了解出海工具与合作伙伴服务。",
  },
  en: {
    positioning: "An overseas navigator for Chinese renewable-energy businesses",
    titleStart: "From global market insight",
    titleEnd: "to project delivery",
    intro: "Covering major renewable-energy markets worldwide, with market research, policy analysis, expansion tools and partner services to help Chinese businesses move from exploration to project delivery.",
    services: ["Market research", "Policy analysis", "Expansion tools", "Partners"],
    globeTitle: "Where will you go next?",
    globeHelp: "Click to select a country. Double-click to view its data.",
    marketFilter: "Filter by continent or major region and country",
    region: "Continent / major region",
    allRegions: "All regions",
    country: "Country",
    chooseCountry: "Select a country",
    openCountry: "View country data",
    flowTitle: "A clearer next step for your expansion",
    flowIntro: "Start with a target market, understand its context, prepare your plans and explore potential partners.",
    flowSteps: [
      { title: "Understand your market", description: "Explore country profiles, the economic environment and energy markets to build your understanding.", action: "Choose a target market" },
      { title: "Use expansion tools", description: "Plan your next steps in market and policy research, project concepts and tender preparation.", action: "Explore expansion tools" },
      { title: "Find partners", description: "Explore resources and professional services to support business collaboration and project delivery.", action: "Explore partners" },
    ],
    toolsTitle: "Turn expansion ideas into action",
    toolsIntro: "Find the right tools for your next stage of research, project planning and opportunity exploration.",
    planned: "Coming soon",
    learn: "Explore feature",
    partnersTitle: "Make collaboration your next step",
    partnersIntro: "Explore partners and professional services to support business development and project delivery. Partner profiles and connection services are in development.",
    partners: "Explore partners",
    closingTitle: "Start your expansion with one target market",
    closingBody: "Understand the market, then plan your next move. Clearer information for every step.",
    closingAction: "Start exploring markets",
    selectedAction: "View data for {country}",
    unavailable: "Country data is temporarily unavailable",
    loading: "Loading country data",
    loadingHint: "You can explore expansion tools and partner services while you wait.",
    noData: "No country data is available yet",
    retry: "Reload country data",
    retryHint: "Please try again later. You can still explore expansion tools and partner services.",
  },
} as const;

const FLOW_ICONS = [Globe2, FileText, Building2] as const;
const TOOL_ICONS = { advisor: Bot, "project-planning": FileText, tenders: BriefcaseBusiness } as const;

export function ApprovedBasic60MarketExperience({
  countries: inputCountries,
  locale: serverLocale,
  initialCountryCode = "",
  dataStatus = "ready",
  basePath = "",
}: Readonly<{
  countries: readonly HomeMarket[];
  locale: Basic60Locale;
  initialCountryCode?: string;
  dataStatus?: "ready" | "error" | "empty" | "loading";
  basePath?: "" | "/basic60";
}>) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { locale: activeLocale } = useLocale();
  const locale = activeLocale || serverLocale;
  const copy = COPY[locale];
  const countries = useMemo(() => inputCountries.filter(isOutboundTargetCountry), [inputCountries]);
  const countryByCode = useMemo(() => new Map(countries.map((country) => [country.code, country])), [countries]);
  const initialCountry = countryByCode.get(normalizeOutboundCountryParam(initialCountryCode) ?? "");
  const [selectedCode, setSelectedCode] = useState(initialCountry?.code ?? "");
  const [regionFilter, setRegionFilter] = useState(initialCountry ? marketRegionFor(initialCountry.region) : "");
  const [focusCode, setFocusCode] = useState(initialCountry?.code ?? "");
  const urlCountryCode = normalizeOutboundCountryParam(searchParams.get("country")) ?? "";
  const initialCode = initialCountry?.code ?? "";
  const [navigationSelection, setNavigationSelection] = useState({ urlCountryCode, initialCode });

  // Adopt an external route/query update without moving the camera again after
  // our own single-click selection has updated the URL.
  if (navigationSelection.urlCountryCode !== urlCountryCode || navigationSelection.initialCode !== initialCode) {
    const code = navigationSelection.urlCountryCode !== urlCountryCode ? urlCountryCode : initialCode;
    const country = countryByCode.get(code);
    setNavigationSelection({ urlCountryCode, initialCode });
    if ((country?.code ?? "") !== selectedCode) {
      setSelectedCode(country?.code ?? "");
      setRegionFilter(country ? marketRegionFor(country.region) : "");
      setFocusCode(country?.code ?? "");
    }
  }
  const selected = countryByCode.get(selectedCode);
  const currentCode = selected?.code ?? "";
  const markers = useMemo<CountryGlobeMarker[]>(() => countries.map((country) => ({
    code: country.code,
    name: country.name,
    detail: MARKET_REGIONS.find((region) => region.code === marketRegionFor(country.region))?.labels[locale],
    metric: country.featuredMetrics[0]
      ? { label: country.featuredMetrics[0].label, value: country.featuredMetrics[0].value }
      : undefined,
  })), [countries, locale]);

  useEffect(() => {
    function restoreSelection() {
      const code = normalizeOutboundCountryParam(new URL(window.location.href).searchParams.get("country"));
      const country = countryByCode.get(code ?? "");
      setSelectedCode(country?.code ?? "");
      setRegionFilter(country ? marketRegionFor(country.region) : "");
      setFocusCode(country?.code ?? "");
    }
    window.addEventListener("popstate", restoreSelection);
    return () => window.removeEventListener("popstate", restoreSelection);
  }, [countryByCode]);

  function persistSelection(code: string) {
    const url = new URL(window.location.href);
    if (code) url.searchParams.set("country", code);
    else url.searchParams.delete("country");
    // Next copies its own history fields and synchronizes useSearchParams when
    // the new state does not carry its internal navigation marker.
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }

  function selectCountry(code: string, locate: boolean) {
    const country = countryByCode.get(code);
    if (code && !country) return;
    setSelectedCode(country?.code ?? "");
    if (country) setRegionFilter(marketRegionFor(country.region));
    setFocusCode(locate ? country?.code ?? "" : "");
    persistSelection(country?.code ?? "");
  }

  function selectRegion(region: string) {
    setRegionFilter(region);
    if (selected && region && marketRegionFor(selected.region) !== region) {
      setSelectedCode("");
      setFocusCode("");
      persistSelection("");
    }
  }

  function openCountry(code: string) {
    if (countryByCode.has(code)) router.push(basePath + "/countries/" + code);
  }

  const countryHref = selected ? basePath + "/countries/" + currentCode : "#markets";
  const flowHrefs = [countryHref, toolHref(basePath + "/tools", currentCode), toolHref(basePath + "/partners", currentCode)];

  return (
    <div className="landing-page approved-basic60-landing navigator-home">
      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-hero-copy">
          <span className="section-kicker">{copy.positioning}</span>
          <h1 id="landing-title"><span>{copy.titleStart}</span><span>{copy.titleEnd}</span></h1>
          <p>{copy.intro}</p>
          <ul className="home-service-summary" aria-label={locale === "en" ? "Our services" : "服务内容"}>
            {copy.services.map((service) => <li key={service}>{service}</li>)}
          </ul>
        </div>
        <div className="landing-globe-card" id="markets" tabIndex={-1}>
          <div className="landing-globe-heading">
            <h2>{copy.globeTitle}</h2>
            <p>{copy.globeHelp}</p>
          </div>
          {dataStatus === "ready" && countries.length ? (
            <>
              <CountryGlobe dataProfile="approved_basic60" markers={markers} selectedCode={currentCode} focusCode={focusCode} locale={locale} height={280} showLocator={false} onSelect={(code) => selectCountry(code, false)} onOpenCountry={openCountry} />
              <div className="home-market-panel">
                <MarketFilters countries={countries} selectedCode={currentCode} regionFilter={regionFilter} locale={locale} onSelect={(code) => selectCountry(code, true)} onRegionChange={selectRegion} />
              </div>
            </>
          ) : (
            <div className="home-data-state" role={dataStatus === "loading" ? "status" : "alert"}>
              <Globe2 size={36} aria-hidden="true" />
              <h3>{dataStatus === "loading" ? copy.loading : dataStatus === "error" ? copy.unavailable : copy.noData}</h3>
              <p>{dataStatus === "loading" ? copy.loadingHint : copy.retryHint}</p>
              {dataStatus !== "loading" && <button className="button button-primary" type="button" onClick={() => router.refresh()}><RotateCw size={17} aria-hidden="true" />{copy.retry}</button>}
            </div>
          )}
        </div>
      </section>

      <section className="home-service-flow" aria-labelledby="flow-title">
        <div className="landing-section-heading"><h2 id="flow-title">{copy.flowTitle}</h2><p>{copy.flowIntro}</p></div>
        <ol className="home-flow-steps">
          {copy.flowSteps.map((step, index) => {
            const Icon = FLOW_ICONS[index];
            return <li key={step.title}>
              <span className="home-flow-heading"><span className="home-flow-number">{String(index + 1).padStart(2, "0")}</span><Icon size={24} aria-hidden="true" /></span>
              <h3>{step.title}</h3><p>{step.description}</p>
              <Link href={flowHrefs[index]}>{index === 0 && selected ? copy.openCountry : step.action}<ArrowRight size={16} aria-hidden="true" /></Link>
            </li>;
          })}
        </ol>
      </section>

      <section className="landing-section home-tools" aria-labelledby="home-tools-title">
        <div className="landing-section-heading"><h2 id="home-tools-title">{copy.toolsTitle}</h2><p>{copy.toolsIntro}</p></div>
        <div className="home-tool-grid">
          {EXPANSION_TOOL_GROUPS.map((group) => {
            const tool = EXPANSION_TOOL_COPY[locale][group];
            const Icon = TOOL_ICONS[group];
            return <article className="home-tool-card" key={group}>
              <div className="home-tool-topline"><span className="home-tool-icon"><Icon size={26} aria-hidden="true" /></span><span className="type-tag">{copy.planned}</span></div>
              <h3>{tool.title}</h3><p>{tool.description}</p>
              <Link href={toolHref(basePath + EXPANSION_TOOL_PATHS[group], currentCode)} aria-label={copy.learn + " · " + tool.title}>{copy.learn}<ArrowRight size={17} aria-hidden="true" /></Link>
            </article>;
          })}
        </div>
      </section>

      <section className="home-partner-band" aria-labelledby="home-partners-title">
        <div className="home-partner-icon"><Building2 size={34} aria-hidden="true" /></div>
        <div><h2 id="home-partners-title">{copy.partnersTitle}</h2><p>{copy.partnersIntro}</p></div>
        <Link className="button button-secondary" href={toolHref(basePath + "/partners", currentCode)}>{copy.partners}<ArrowRight size={17} aria-hidden="true" /></Link>
      </section>

      <section className="home-closing" aria-labelledby="home-closing-title">
        <div><h2 id="home-closing-title">{copy.closingTitle}</h2><p>{copy.closingBody}</p></div>
        <Link className="button button-primary button-large" href={selected ? countryHref : homeMarketHref(undefined, basePath)}>{selected ? copy.selectedAction.replace("{country}", selected.name) : copy.closingAction}<ArrowRight size={18} aria-hidden="true" /></Link>
      </section>
    </div>
  );
}

function MarketFilters({ countries, selectedCode, regionFilter, locale, onSelect, onRegionChange }: Readonly<{
  countries: readonly HomeMarket[];
  selectedCode: string;
  regionFilter: string;
  locale: Basic60Locale;
  onSelect: (code: string) => void;
  onRegionChange: (region: string) => void;
}>) {
  const copy = COPY[locale];
  const availableRegions = new Set(countries.map((country) => marketRegionFor(country.region)));
  const regions = MARKET_REGIONS.filter((region) => availableRegions.has(region.code));
  const options = countries.filter((country) => !regionFilter || marketRegionFor(country.region) === regionFilter).toSorted((a, b) => a.name.localeCompare(b.name, locale));
  return <fieldset className="landing-market-filters">
    <legend className="sr-only">{copy.marketFilter}</legend>
    <label><span>{copy.region}</span><select value={regionFilter} onChange={(event) => onRegionChange(event.target.value)}><option value="">{copy.allRegions}</option>{regions.map((region) => <option value={region.code} key={region.code}>{region.labels[locale]}</option>)}</select></label>
    <label><span>{copy.country}</span><select value={selectedCode} onChange={(event) => onSelect(event.target.value)}><option value="">{copy.chooseCountry}</option>{options.map((country) => <option value={country.code} key={country.code}>{country.name}</option>)}</select></label>
  </fieldset>;
}
