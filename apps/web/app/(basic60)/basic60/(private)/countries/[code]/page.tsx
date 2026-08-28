import { ArrowLeft, Compass, Users } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Basic60ErrorState } from "@/components/basic60-page-state";
import { CountryEnergyCharts, CountryMacroCharts } from "@/components/country-data-charts";
import { CountryProfileSummary } from "@/components/country-profile-summary";
import { CountryMarketOverview, MarketOverviewLoading } from "@/components/country-market-content";
import { MARKET_REGIONS, marketRegionFor } from "@/lib/approved-basic60/market-regions";
import { homeMarketHref } from "@/lib/approved-basic60/navigation";
import { Basic60ApiError, getBasic60Country } from "@/lib/basic60/api";
import { basic60CountryName } from "@/lib/basic60/presentation";
import { loadCountryMarketOverview } from "@/lib/market-content/api";
import { getRequestLocale } from "@/lib/i18n/server";
import { BASIC60_PRIVATE_RUNTIME_PROFILE, currentRuntimeProfile } from "@/lib/runtime-profile";
import { toolHref } from "@/lib/tool-journey";

const COPY = {
  "zh-CN": {
    back: "返回首页地图",
    tools: "出海工具",
    partners: "合作伙伴",
    next: "继续出海规划",
    retry: "重新加载",
    otherRegion: "其他",
  },
  en: {
    back: "Back to homepage map",
    tools: "Expansion tools",
    partners: "Partners",
    next: "Continue expansion planning",
    retry: "Retry",
    otherRegion: "Other",
  },
} as const;

export default async function Basic60CountryDetailPage({ params }: { params: Promise<{ code: string }> }) {
  const [{ code }, locale] = await Promise.all([params, getRequestLocale()]);
  const normalizedCode = code.toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalizedCode) || normalizedCode === "CHN") notFound();
  const copy = COPY[locale];
  const basePath = currentRuntimeProfile() === BASIC60_PRIVATE_RUNTIME_PROFILE ? "/basic60" : "";
  // Start the independent article request without delaying country charts.
  const overview = loadCountryMarketOverview(normalizedCode, locale);

  let response: Awaited<ReturnType<typeof getBasic60Country>> | null = null;
  try {
    response = await getBasic60Country(normalizedCode, locale);
  } catch (reason: unknown) {
    if (reason instanceof Basic60ApiError && reason.status === 404) notFound();
  }

  if (!response) {
    return (
      <section className="basic60-page country-detail-page">
        <Link className="back-link" href={homeMarketHref(normalizedCode, basePath)}><ArrowLeft size={16} aria-hidden="true" />{copy.back}</Link>
        <Basic60ErrorState locale={locale} />
        <form className="country-detail-retry" action={`${basePath}/countries/${normalizedCode}`} method="get">
          <button className="button button-secondary" type="submit">{copy.retry}</button>
        </form>
      </section>
    );
  }

  const country = response.data;
  const regionCode = marketRegionFor(country.region_code);
  const regionLabel = MARKET_REGIONS.find((region) => region.code === regionCode)?.labels[locale] ?? copy.otherRegion;
  return (
    <section className="basic60-page country-detail-page">
      <Link className="back-link" href={homeMarketHref(country.code, basePath)}><ArrowLeft size={16} aria-hidden="true" />{copy.back}</Link>
      <header className="country-detail-header">
        <div className="country-detail-title">
          <h1>{basic60CountryName(country, locale)}</h1>
          <p className="country-detail-subtitle">{locale === "en" ? country.name_zh : country.name_en} · {regionLabel} · {country.code}</p>
        </div>
        <nav className="country-detail-actions" aria-label={copy.next}>
          <Link className="button button-secondary" href={toolHref(`${basePath}/tools`, country.code)}><Compass size={17} aria-hidden="true" />{copy.tools}</Link>
          <Link className="button button-secondary" href={toolHref(`${basePath}/partners`, country.code)}><Users size={17} aria-hidden="true" />{copy.partners}</Link>
        </nav>
      </header>

      <CountryProfileSummary country={country} asOf={response.meta.as_of} locale={locale} />
      <Suspense fallback={<MarketOverviewLoading locale={locale} />}>
        <CountryMarketOverview result={overview} locale={locale} />
      </Suspense>
      <CountryEnergyCharts metrics={country.energy ?? []} locale={locale} countryCode={country.code} />
      <CountryMacroCharts metrics={country.macro ?? []} locale={locale} countryCode={country.code} />
    </section>
  );
}
