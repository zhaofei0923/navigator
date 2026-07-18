import { NextResponse } from "next/server";

import {
  parseApiCountryQuery,
  parseCountryCodeParam,
} from "@navigator/shared-types/country-query";

import { proxyCountryApi } from "../../../../../server/country-api-proxy";

interface CountryDetailRouteContext {
  params: Promise<{ code: string }>;
}

export async function GET(
  request: Request,
  context: CountryDetailRouteContext,
): Promise<Response> {
  const query = parseApiCountryQuery({
    acceptLanguage: request.headers.get("accept-language"),
    searchParams: new URL(request.url).searchParams,
  });

  if (Object.keys(query.errors).length > 0) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          details: query.errors,
          message: "Invalid country detail query",
        },
        success: false,
      },
      { status: 400 },
    );
  }

  const { code } = await context.params;
  return proxyCountryApi(request, {
    kind: "detail",
    code: parseCountryCodeParam(code),
    query,
  });
}
