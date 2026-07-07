import { NextResponse } from "next/server";

import {
  MODULE_KEYS,
  type Locale,
  type ModuleKey,
} from "@navigator/shared-types/schema";

import {
  buildCountryModuleResponse,
} from "../../../../../../../features/countries/country-service";
import {
  parseApiCountryQuery,
} from "../../../../../../../features/countries/filter-params";
import { DEFAULT_LOCALE, isLocale } from "../../../../../../../i18n/routing";

interface CountryModuleRouteContext {
  params: Promise<{ code: string; moduleKey: string }>;
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

function isModuleKey(value: string): value is ModuleKey {
  return (MODULE_KEYS as readonly string[]).includes(value);
}

function validationError(details: Record<string, string>) {
  return NextResponse.json(
    {
      error: {
        code: "VALIDATION_ERROR",
        details,
        message: "Invalid country module query",
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
  context: CountryModuleRouteContext,
) {
  const { code, moduleKey } = await context.params;
  const url = new URL(request.url);
  const locale = resolveLocale(url.searchParams, request);
  const query = parseApiCountryQuery({
    locale,
    searchParams: url.searchParams,
  });

  const errors = { ...query.errors };
  const validatedModuleKey = isModuleKey(moduleKey) ? moduleKey : null;
  if (validatedModuleKey === null) {
    errors.moduleKey = moduleKey;
  }

  if (validatedModuleKey === null || Object.keys(errors).length > 0) {
    return validationError(errors);
  }

  const response = buildCountryModuleResponse(
    code,
    validatedModuleKey,
    {
      locale: query.filters.locale,
      page: query.filters.page,
      pageSize: query.filters.pageSize,
    },
    query.textMode,
  );

  if (response === null) {
    return notFoundError();
  }

  return NextResponse.json(response);
}
