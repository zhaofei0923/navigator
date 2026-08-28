import { normalizeCountryParam } from "@/lib/tool-journey";

// China is the origin market for this product, not an outbound destination.
export const ORIGIN_COUNTRY_CODE = "CHN";

export function normalizeOutboundCountryParam(
  value: string | null | undefined,
): string | null {
  const code = normalizeCountryParam(value);
  return code && code !== ORIGIN_COUNTRY_CODE ? code : null;
}

export function isOutboundTargetCountry(country: Readonly<{ code: string }>): boolean {
  return normalizeOutboundCountryParam(country.code) !== null;
}

export function outboundComparisonCodes(value: string | string[] | undefined): string[] {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  const codes = values
    .flatMap((entry) => entry.split(","))
    .map(normalizeOutboundCountryParam)
    .filter((code): code is string => code !== null);
  return [...new Set(codes)].slice(0, 4);
}
