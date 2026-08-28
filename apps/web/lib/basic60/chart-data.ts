import type { Basic60Metric } from "@/lib/basic60/types";

export type MacroChartPoint = {
  year: number;
  periodLabel: string;
  value: number | null;
};

export type MacroChartSeries = {
  code: string;
  kind: "bar" | "line";
  unit: string;
  points: MacroChartPoint[];
  observations: Basic60Metric[];
  latest: MacroChartPoint | null;
  chartable: boolean;
  issue: "empty" | "incompatible" | "duplicate" | null;
};

export type EnergyComposition = {
  key: "capacity" | "generation";
  unit: "MW" | "GWh";
  total: Basic60Metric | null;
  renewable: Basic60Metric | null;
  share: Basic60Metric | null;
  remainder: number | null;
  percentage: number | null;
  periodLabel: string | null;
  status: "ready" | "missing" | "incompatible" | "invalid";
  observations: Basic60Metric[];
};

const MACRO_DEFINITIONS = [
  { code: "gdp_current_usd", kind: "bar", unit: "USD" },
  { code: "gdp_growth_pct", kind: "line", unit: "PERCENT" },
  { code: "gdp_per_capita_current_usd", kind: "line", unit: "USD_PER_PERSON" },
  { code: "inflation_cpi_pct", kind: "line", unit: "PERCENT" },
  { code: "fdi_net_inflows_usd", kind: "bar", unit: "USD" },
  { code: "official_exchange_rate_lcu_per_usd", kind: "line", unit: "LCU_PER_USD" },
] as const;

const ENERGY_DEFINITIONS = [
  {
    key: "capacity",
    unit: "MW",
    total: "electricity_installed_capacity_mw",
    renewable: "renewable_capacity_mw",
    share: "renewable_share_capacity_pct",
  },
  {
    key: "generation",
    unit: "GWh",
    total: "electricity_generation_gwh",
    renewable: "renewable_generation_gwh",
    share: "renewable_share_generation_pct",
  },
] as const;

// A malformed period must not create an unbounded gap-filled chart. Longer
// histories remain readable in the observation table rather than being clipped.
const MAX_CHART_YEARS = 100;
const SHARE_TOLERANCE_PERCENTAGE_POINTS = 0.05;

function annualYear(metric: Basic60Metric): number | null {
  const start = /^(\d{4})-01-01$/.exec(metric.period?.start ?? "");
  if (!start || metric.period?.end !== `${start[1]}-12-31`) return null;
  const year = Number(start[1]);
  return year > 0 ? year : null;
}

function normalizedUnit(metric: Basic60Metric): string {
  return metric.unit.trim().toUpperCase();
}

function availableValue(metric: Basic60Metric): number | null {
  return metric.value_status === "available" &&
    typeof metric.value === "number" &&
    Number.isFinite(metric.value)
    ? metric.value
    : null;
}

function sortedObservations(metrics: readonly Basic60Metric[]): Basic60Metric[] {
  return [...metrics].sort((left, right) => {
    const leftYear = annualYear(left);
    const rightYear = annualYear(right);
    if (leftYear === null) return rightYear === null ? 0 : 1;
    if (rightYear === null) return -1;
    return leftYear - rightYear;
  });
}

function decimalParts(value: number): { coefficient: bigint; exponent: number } {
  const [coefficient, exponent = "0"] = value.toString().split("e");
  const fractionDigits = coefficient.split(".")[1]?.length ?? 0;
  return {
    coefficient: BigInt(coefficient.replace(".", "")),
    exponent: Number(exponent) - fractionDigits,
  };
}

function derivedRemainder(total: number, renewable: number): number {
  const left = decimalParts(total);
  const right = decimalParts(renewable);
  const fractionDigits = Math.max(0, -left.exponent, -right.exponent);
  // Align only this derived value to the inputs' decimal precision. Integer
  // arithmetic also preserves tiny scientific values beyond toFixed's limit.
  const leftUnits = left.coefficient * 10n ** BigInt(left.exponent + fractionDigits);
  const rightUnits = right.coefficient * 10n ** BigInt(right.exponent + fractionDigits);
  return Number(`${leftUnits - rightUnits}e-${fractionDigits}`);
}

export function buildMacroChartSeries(metrics: readonly Basic60Metric[]): MacroChartSeries[] {
  return MACRO_DEFINITIONS.map((definition) => {
    const observations = sortedObservations(
      metrics.filter((metric) => metric.metric_code === definition.code),
    );
    const series: MacroChartSeries = {
      ...definition,
      points: [],
      observations,
      latest: null,
      chartable: false,
      issue: "empty",
    };
    if (observations.length === 0) return series;

    const byYear = new Map<number, Basic60Metric>();
    for (const observation of observations) {
      const year = annualYear(observation);
      if (year === null || normalizedUnit(observation) !== definition.unit) {
        return { ...series, issue: "incompatible" };
      }
      if (byYear.has(year)) return { ...series, issue: "duplicate" };
      byYear.set(year, observation);
    }

    const years = [...byYear.keys()];
    const firstYear = years[0];
    const lastYear = years[years.length - 1];
    if (lastYear - firstYear + 1 > MAX_CHART_YEARS) {
      return { ...series, issue: "incompatible" };
    }
    for (let year = firstYear; year <= lastYear; year += 1) {
      const observation = byYear.get(year);
      const point: MacroChartPoint = {
        year,
        periodLabel: String(year),
        value: observation ? availableValue(observation) : null,
      };
      series.points.push(point);
      if (point.value !== null) series.latest = point;
    }
    series.chartable = series.latest !== null;
    series.issue = series.chartable ? null : "empty";
    return series;
  });
}

export function buildEnergyCompositions(metrics: readonly Basic60Metric[]): EnergyComposition[] {
  return ENERGY_DEFINITIONS.map((definition) => {
    const codes: readonly string[] = [definition.total, definition.renewable, definition.share];
    const observations = sortedObservations(
      metrics.filter((metric) => codes.includes(metric.metric_code)),
    );
    const groups = codes.map((code) => observations.filter((metric) => metric.metric_code === code));
    const [total, renewable, share] = groups.map((group) => group.at(-1) ?? null);
    const composition: EnergyComposition = {
      key: definition.key,
      unit: definition.unit,
      total,
      renewable,
      share,
      remainder: null,
      percentage: null,
      periodLabel: null,
      status: "missing",
      observations,
    };

    // An undated record cannot safely be treated as older than the selected
    // snapshot, even when other records contain a complete previous-year tuple.
    if (observations.some((metric) => annualYear(metric) === null)) {
      return { ...composition, status: "incompatible" };
    }
    if (groups.some((group) => {
      const latest = group.at(-1);
      return latest && group.filter((metric) => annualYear(metric) === annualYear(latest)).length > 1;
    })) {
      return { ...composition, status: "invalid" };
    }
    if (!total || !renewable || !share) return composition;

    const year = annualYear(total);
    if (
      year !== annualYear(renewable) ||
      year !== annualYear(share) ||
      normalizedUnit(total) !== definition.unit.toUpperCase() ||
      normalizedUnit(renewable) !== definition.unit.toUpperCase() ||
      normalizedUnit(share) !== "PERCENT"
    ) {
      return { ...composition, status: "incompatible" };
    }
    composition.periodLabel = String(year);
    if ([total, renewable, share].some((metric) =>
      metric.value_status === "available" && metric.value !== null && !Number.isFinite(metric.value),
    )) {
      return { ...composition, status: "invalid" };
    }
    const totalValue = availableValue(total);
    const renewableValue = availableValue(renewable);
    const shareValue = availableValue(share);
    if (totalValue === null || renewableValue === null || shareValue === null) return composition;
    if (
      totalValue <= 0 ||
      renewableValue < 0 ||
      renewableValue > totalValue ||
      shareValue < 0 ||
      shareValue > 100 ||
      Math.abs((renewableValue / totalValue) * 100 - shareValue) >
        SHARE_TOLERANCE_PERCENTAGE_POINTS + 1e-9
    ) {
      return { ...composition, status: "invalid" };
    }

    return {
      ...composition,
      remainder: derivedRemainder(totalValue, renewableValue),
      percentage: shareValue,
      status: "ready",
    };
  });
}
