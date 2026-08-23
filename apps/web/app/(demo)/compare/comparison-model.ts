import type {
  ComparisonCountry,
  CountrySummary,
  ScoreDimensionKey,
} from "@/lib/types";

export type ComparisonSelection = [string, string];

const COMPARISON_TREND_LABELS = {
  "zh-CN": {
    above_group: "高于本组均值",
    near_group: "接近本组均值",
    below_group: "低于本组均值",
  },
  en: {
    above_group: "Above group average",
    near_group: "Near group average",
    below_group: "Below group average",
  },
} as const;

export function comparisonTrendLabel(trend: string, locale: "zh-CN" | "en"): string {
  const labels = COMPARISON_TREND_LABELS[locale];
  return labels[trend as keyof typeof labels] ?? trend;
}

export function resolveComparisonSelection(
  countries: CountrySummary[],
  requestedCountries: string | null,
): ComparisonSelection | null {
  if (countries.length < 2) return null;

  const availableCodes = new Set(countries.map((country) => country.code));
  const selected = Array.from(
    new Set(
      (requestedCountries ?? "")
        .split(",")
        .map((code) => code.trim().toUpperCase())
        .filter((code) => availableCodes.has(code)),
    ),
  );

  for (const country of countries) {
    if (selected.length >= 2) break;
    if (!selected.includes(country.code)) selected.push(country.code);
  }

  return selected.length >= 2 ? [selected[0], selected[1]] : null;
}

export function getDimensionLeaderCodes(
  countries: ComparisonCountry[],
  dimension: ScoreDimensionKey,
): Set<string> {
  if (!countries.length) return new Set();
  const leadingScore = Math.max(...countries.map((country) => country.scores[dimension]));
  return new Set(
    countries
      .filter((country) => country.scores[dimension] === leadingScore)
      .map((country) => country.country_code),
  );
}

export function orderComparisonCountries(
  countries: ComparisonCountry[],
  selected: ComparisonSelection,
): ComparisonCountry[] {
  const countryByCode = new Map(countries.map((country) => [country.country_code, country]));
  return selected
    .map((code) => countryByCode.get(code))
    .filter((country): country is ComparisonCountry => Boolean(country));
}
