import type { Locale } from "@navigator/shared-types/schema";
import { setRequestLocale } from "next-intl/server";

import { CountryExplorer } from "../../../features/countries/country-explorer";

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

  return (
    <CountryExplorer
      locale={locale}
      searchParams={toUrlSearchParams(resolvedSearchParams)}
    />
  );
}
