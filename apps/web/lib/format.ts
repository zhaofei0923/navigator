export function formatDate(value: string | undefined): string {
  if (!value) return "未提供";
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "UTC",
  })
    .format(parsed)
    .replaceAll("/", "-");
}

export function formatNumber(value: number, maximumFractionDigits = 0): string {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits }).format(value);
}

export function trendValue(trend: string): number {
  const match = trend.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}
