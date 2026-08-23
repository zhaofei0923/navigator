type FormatLocale = "zh-CN" | "en";

export function formatDate(value: string | undefined, locale: FormatLocale = "zh-CN"): string {
  if (!value) return locale === "en" ? "Not provided" : "未提供";
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  const formatted = new Intl.DateTimeFormat(locale === "en" ? "en-US" : "zh-CN", {
    year: "numeric",
    month: locale === "en" ? "short" : "2-digit",
    day: locale === "en" ? "numeric" : "2-digit",
    timeZone: "UTC",
  }).format(parsed);
  return locale === "en" ? formatted : formatted.replaceAll("/", "-");
}

export function formatNumber(
  value: number,
  maximumFractionDigits = 0,
  locale: FormatLocale = "zh-CN",
): string {
  return new Intl.NumberFormat(locale === "en" ? "en-US" : "zh-CN", {
    maximumFractionDigits,
  }).format(value);
}

export function trendValue(trend: string): number {
  const match = trend.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}
