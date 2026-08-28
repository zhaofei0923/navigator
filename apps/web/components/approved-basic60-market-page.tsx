import { Suspense } from "react";
import { ApprovedBasic60MarketExperience, type HomeMarket } from "@/components/approved-basic60-market-experience";
import { listBasic60Countries } from "@/lib/basic60/api";
import { isOutboundTargetCountry, normalizeOutboundCountryParam } from "@/lib/basic60/market-scope";
import { toBasic60MarketView } from "@/lib/basic60/market-view";
import { getRequestLocale } from "@/lib/i18n/server";
import type { ApprovedBasic60SearchParams } from "@/lib/approved-basic60/page-context";
import type { Basic60Locale } from "@/lib/basic60/types";

export async function ApprovedBasic60MarketPage({
  searchParams,
  basePath = "",
}: Readonly<{
  searchParams?: ApprovedBasic60SearchParams;
  basePath?: "" | "/basic60";
}> = {}) {
  const [locale, query] = await Promise.all([
    getRequestLocale(),
    searchParams ?? Promise.resolve({} as Record<string, string | string[] | undefined>),
  ]);
  return (
    <Suspense fallback={<ApprovedBasic60MarketExperience countries={[]} locale={locale} dataStatus="loading" basePath={basePath} />}>
      <MarketData locale={locale} query={query} basePath={basePath} />
    </Suspense>
  );
}

async function MarketData({ locale, query, basePath }: Readonly<{
  locale: Basic60Locale;
  query: Record<string, string | string[] | undefined>;
  basePath: "" | "/basic60";
}>) {
  let countries: HomeMarket[] = [];
  let dataStatus: "ready" | "error" | "empty" = "ready";
  try {
    const response = await listBasic60Countries({ coverage_level: "Basic", limit: 100 }, locale);
    countries = response.data.filter(isOutboundTargetCountry).map((country) => {
      const { code, name, alternateName, region, featuredMetrics } = toBasic60MarketView(country, locale);
      return { code, name, alternateName, region, featuredMetrics };
    });
    if (!countries.length) dataStatus = "empty";
  } catch {
    dataStatus = "error";
  }
  const requestedCode = normalizeOutboundCountryParam(
    Array.isArray(query.country) ? query.country[0] : query.country,
  );
  const initialCountryCode = countries.find((country) => country.code === requestedCode)?.code ?? "";
  return (
    <ApprovedBasic60MarketExperience
      countries={countries}
      locale={locale}
      initialCountryCode={initialCountryCode}
      dataStatus={dataStatus}
      basePath={basePath}
    />
  );
}
