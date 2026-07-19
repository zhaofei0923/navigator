import type { Locale } from "@navigator/shared-types/schema";
import { parseCountryFilters } from "@navigator/shared-types/country-query";
import { setRequestLocale } from "next-intl/server";

import { CountryExplorer } from "../../../features/countries/country-explorer";
import { fetchCountries } from "../../../server/country-api-client";

export const dynamic = "force-dynamic";

interface CountriesPageProps {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function toUrlSearchParams(
  searchParams: Record<string, string | string[] | undefined>,
) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(searchParams)) {
    if (Array.isArray(value)) {
      params.set(key, value.join(","));
    } else if (value !== undefined) {
      params.set(key, value);
    }
  }

  return params;
}

export default async function CountriesPage({
  params,
  searchParams,
}: CountriesPageProps) {
  const [{ locale }, resolvedSearchParams] = await Promise.all([
    params,
    searchParams,
  ]);
  setRequestLocale(locale);
  const normalizedSearchParams = toUrlSearchParams(resolvedSearchParams);
  const response = await fetchCountries(parseCountryFilters({
    acceptLanguage: locale,
    searchParams: normalizedSearchParams,
  }));

  return (
    <CountryExplorer
      countries={response.data}
      locale={locale}
      searchParams={normalizedSearchParams}
      total={response.meta.total}
    />
  );
}
