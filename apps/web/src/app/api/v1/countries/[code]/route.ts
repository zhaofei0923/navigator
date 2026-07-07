import { NextResponse } from "next/server";

import type { Locale } from "@navigator/shared-types/schema";

import {
  buildCountryDetailResponse,
} from "../../../../../features/countries/country-service";
import {
  parseApiCountryQuery,
} from "../../../../../features/countries/filter-params";
import { DEFAULT_LOCALE, isLocale } from "../../../../../i18n/routing";

interface CountryDetailRouteContext {
  params: Promise<{ code: string }>;
}

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

function validationError(details: Record<string, string>) {
  return NextResponse.json(
    {
      error: {
        code: "VALIDATION_ERROR",
        details,
        message: "Invalid country detail query",
      },
      success: false,
    },
    { status: 400 },
  );
}

function notFoundError() {
  return NextResponse.json(
    {
      error: {
        code: "NOT_FOUND",
        details: null,
        message: "Country not found",
      },
      success: false,
    },
    { status: 404 },
  );
}

export async function GET(
  request: Request,
  context: CountryDetailRouteContext,
) {
  const url = new URL(request.url);
  const locale = resolveLocale(url.searchParams, request);
  const query = parseApiCountryQuery({
    locale,
    searchParams: url.searchParams,
  });

  if (Object.keys(query.errors).length > 0) {
    return validationError(query.errors);
  }

  const { code } = await context.params;
  const response = buildCountryDetailResponse(
    code,
    { locale: query.filters.locale },
    query.textMode,
  );

  if (response === null) {
    return notFoundError();
  }

  return NextResponse.json(response);
}
