import { NextResponse } from "next/server";

import { parseApiCountryQuery } from "@navigator/shared-types/country-query";

import { proxyCountryApi } from "../../../../server/country-api-proxy";

export async function GET(request: Request): Promise<Response> {
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
          message: "Invalid countries query",
        },
        success: false,
      },
      { status: 400 },
    );
  }

  return proxyCountryApi(request, { kind: "list", query });
}
