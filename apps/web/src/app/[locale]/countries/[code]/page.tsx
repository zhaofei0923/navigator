import type {
  LocalizedCountryModuleResponse,
} from "@navigator/shared-types/country-api";
import type { Locale, ModuleKey } from "@navigator/shared-types/schema";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { CountryDetail } from "../../../../features/countries/country-detail";
import {
  fetchCountryDetail,
  fetchCountryModule,
} from "../../../../server/country-api-client";

export const dynamic = "force-dynamic";

interface CountryDetailPageProps {
  params: Promise<{ code: string; locale: Locale }>;
}

export default async function CountryDetailPage({
  params,
}: CountryDetailPageProps) {
  const { code, locale } = await params;
  setRequestLocale(locale);
  const response = await fetchCountryDetail(code, locale);

  if (response === null) {
    notFound();
  }

  const activeModuleKeys = response.data.moduleCoverage
    .filter(({ status }) => status !== "BUILDING")
    .map(({ moduleKey }) => moduleKey);
  const moduleEntries = await Promise.all(
    activeModuleKeys.map(async (moduleKey) => {
      const moduleResponse = await fetchCountryModule(
        response.data.code,
        moduleKey,
        locale,
      );
      if (moduleResponse === null) {
        notFound();
      }
      return [moduleKey, moduleResponse] as const;
    }),
  );
  const moduleResponses = Object.fromEntries(moduleEntries) as Partial<
    Record<ModuleKey, LocalizedCountryModuleResponse>
  >;

  return (
    <CountryDetail
      country={response.data}
      locale={locale}
      moduleResponses={moduleResponses}
    />
  );
}
