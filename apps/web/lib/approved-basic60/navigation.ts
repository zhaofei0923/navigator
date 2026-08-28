import { normalizeOutboundCountryParam } from "@/lib/basic60/market-scope";

export function homeMarketHref(countryCode?: string | null, basePath: "" | "/basic60" = ""): string {
  const country = normalizeOutboundCountryParam(countryCode);
  const home = basePath || "/";
  return country ? `${home}?country=${country}#markets` : `${home}#markets`;
}

export function navigationCountryCode(
  pathname: string,
  countryParam?: string | null,
): string | null {
  const detail = pathname.match(
    /^\/(?:basic60\/|approved-basic60\/)?countries\/([A-Za-z]{3})(?:\/market-report)?\/?$/,
  );
  return normalizeOutboundCountryParam(detail ? detail[1] : countryParam);
}
