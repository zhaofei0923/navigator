import { NextResponse } from "next/server";

import {
  parseApiCountryQuery,
  parseCountryCodeParam,
  parseModuleKeyParam,
} from "@navigator/shared-types/country-query";

import { proxyCountryApi } from "../../../../../../../server/country-api-proxy";

interface CountryModuleRouteContext {
  params: Promise<{ code: string; moduleKey: string }>;
}

export async function GET(
  request: Request,
  context: CountryModuleRouteContext,
): Promise<Response> {
  const { code, moduleKey } = await context.params;
  const query = parseApiCountryQuery({
    acceptLanguage: request.headers.get("accept-language"),
    searchParams: new URL(request.url).searchParams,
  });
  const parsedModuleKey = parseModuleKeyParam(moduleKey);
  const errors = { ...query.errors };
  if (parsedModuleKey === null) {
    errors.moduleKey = moduleKey;
  }

  if (parsedModuleKey === null || Object.keys(errors).length > 0) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          details: errors,
          message: "Invalid country module query",
        },
        success: false,
      },
      { status: 400 },
    );
  }

  return proxyCountryApi(request, {
    kind: "module",
    code: parseCountryCodeParam(code),
    moduleKey: parsedModuleKey,
    query,
  });
}
