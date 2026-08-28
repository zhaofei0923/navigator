import "server-only";

import { approvedBasic60CountryParam } from "@/components/approved-basic60-module-page";
import { getRequestLocale } from "@/lib/i18n/server";

export type ApprovedBasic60SearchParams = Promise<
  Record<string, string | string[] | undefined>
>;

export async function approvedBasic60PageContext(
  searchParams: ApprovedBasic60SearchParams,
) {
  const [locale, query] = await Promise.all([getRequestLocale(), searchParams]);
  return {
    locale,
    countryCode: approvedBasic60CountryParam(query.country),
  };
}
