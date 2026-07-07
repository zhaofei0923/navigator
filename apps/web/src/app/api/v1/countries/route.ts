import { NextResponse } from "next/server";

import type { Locale } from "@navigator/shared-types/schema";

import { DEFAULT_LOCALE, isLocale } from "../../../../i18n/routing";
import {
  buildCountriesResponse,
} from "../../../../features/countries/country-service";
import {
  parseApiCountryQuery,
} from "../../../../features/countries/filter-params";

function resolveLocale(searchParams: URLSearchParams, request: Request): Locale {
  const localeParam = searchParams.get("locale");
  if (localeParam !== null && isLocale(localeParam)) {
    return localeParam;
  }

  const acceptLanguage = request.headers.get("accept-language") ?? "";
  for (const item of acceptLanguage.split(",")) {
    const language = item.split(";")[0]?.trim().toLowerCase();
    if (language === "en" || language?.startsWith("en-")) {
      return "en";
    }
    if (
      language === "zh" ||
      language === "zh-cn" ||
      language?.startsWith("zh-")
    ) {
      return "zh-CN";
    }
  }

  return DEFAULT_LOCALE;
}

export function GET(request: Request) {
  const url = new URL(request.url);
  const locale = resolveLocale(url.searchParams, request);
  const query = parseApiCountryQuery({
    locale,
    searchParams: url.searchParams,
  });

  if (Object.keys(query.errors).length > 0) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          details: query.errors,
          message: "Invalid countries query",
        },
        success: false,
      },
      { status: 400 },
    );
  }

  return NextResponse.json(
    buildCountriesResponse(query.filters, query.textMode),
  );
}
