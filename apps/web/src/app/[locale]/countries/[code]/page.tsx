import type { Locale } from "@navigator/shared-types/schema";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { CountryDetail } from "../../../../features/countries/country-detail";
import {
  buildCountryDetailResponse,
} from "../../../../features/countries/country-service";

interface CountryDetailPageProps {
  params: Promise<{ code: string; locale: Locale }>;
}

export default async function CountryDetailPage({
  params,
}: CountryDetailPageProps) {
  const { code, locale } = await params;
  setRequestLocale(locale);
  const response = buildCountryDetailResponse(code, { locale });

  if (response === null) {
    notFound();
  }

  return <CountryDetail country={response.data} locale={locale} />;
}
