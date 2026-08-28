import type { CountrySummary } from "@/lib/types";

export const TOOL_JOURNEY_IDS = [
  "assistant",
  "solar-storage",
  "feasibility",
  "tenders",
] as const;

export type JourneyStep = (typeof TOOL_JOURNEY_IDS)[number];

export type RelatedAction = Readonly<{
  href: string;
  label: string;
  primary?: boolean;
}>;

export type ToolMarket = Readonly<{
  code: string;
  name: string;
}>;

export const TOOL_PATHS: Readonly<Record<JourneyStep, string>> = {
  assistant: "/tools/assistant",
  "solar-storage": "/tools/solar-storage",
  feasibility: "/tools/feasibility",
  tenders: "/tools/tenders",
};

export function normalizeCountryParam(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase() ?? "";
  return /^[A-Z]{3}$/.test(normalized) ? normalized : null;
}

export function resolveToolCountry(
  requested: string | null | undefined,
  countries: readonly Pick<CountrySummary, "code">[],
): string {
  if (!countries.length) return "";
  const normalized = normalizeCountryParam(requested);
  return normalized && countries.some((country) => country.code === normalized)
    ? normalized
    : countries[0].code;
}

export function toolHref(path: string, countryCode: string): string {
  const normalized = normalizeCountryParam(countryCode);
  if (!normalized) return path;
  const [target, fragment] = path.split("#", 2);
  const [pathname, query = ""] = target.split("?", 2);
  const params = new URLSearchParams(query);
  params.set("country", normalized);
  return `${pathname}?${params.toString()}${fragment === undefined ? "" : `#${fragment}`}`;
}

export function comparisonHref(countryCode: string): string {
  const normalized = normalizeCountryParam(countryCode);
  return normalized ? `/compare?countries=${normalized}` : "/compare";
}

export function toolMarket(
  countryCode: string,
  countries: readonly CountrySummary[],
  locale: "zh-CN" | "en",
): ToolMarket | null {
  const country = countries.find((item) => item.code === countryCode);
  if (!country) return null;
  return {
    code: country.code,
    name: locale === "en" ? country.name_en : country.name_zh,
  };
}
