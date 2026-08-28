import { describe, expect, it } from "vitest";
import { buildEnergyCompositions, buildMacroChartSeries } from "@/lib/basic60/chart-data";
import type { Basic60Metric } from "@/lib/basic60/types";

function metric(
  metricCode: string,
  value: number | null,
  year = 2024,
  unit = "USD",
  overrides: Partial<Basic60Metric> = {},
): Basic60Metric {
  return {
    metric_code: metricCode,
    label: metricCode,
    value,
    unit,
    period: { start: `${year}-01-01`, end: `${year}-12-31`, label: String(year) },
    value_status: value === null ? "pending" : "available",
    null_reason: value === null ? "not collected" : null,
    quality_status: "passed",
    freshness_status: "current",
    ...overrides,
  };
}

function capacity(total = 100, renewable = 40, share = 40, year = 2025): Basic60Metric[] {
  return [
    metric("electricity_installed_capacity_mw", total, year, "MW"),
    metric("renewable_capacity_mw", renewable, year, "MW"),
    metric("renewable_share_capacity_pct", share, year, "PERCENT"),
  ];
}

function generation(total = 500, renewable = 125, share = 25, year = 2023): Basic60Metric[] {
  return [
    metric("electricity_generation_gwh", total, year, "GWH"),
    metric("renewable_generation_gwh", renewable, year, "GWH"),
    metric("renewable_share_generation_pct", share, year, "PERCENT"),
  ];
}

describe("buildMacroChartSeries", () => {
  it("always returns the six supported series in the approved display order", () => {
    const series = buildMacroChartSeries([]);
    expect(series.map(({ code, kind, unit }) => ({ code, kind, unit }))).toEqual([
      { code: "gdp_current_usd", kind: "bar", unit: "USD" },
      { code: "gdp_growth_pct", kind: "line", unit: "PERCENT" },
      { code: "gdp_per_capita_current_usd", kind: "line", unit: "USD_PER_PERSON" },
      { code: "inflation_cpi_pct", kind: "line", unit: "PERCENT" },
      { code: "fdi_net_inflows_usd", kind: "bar", unit: "USD" },
      { code: "official_exchange_rate_lcu_per_usd", kind: "line", unit: "LCU_PER_USD" },
    ]);
    expect(series.every((entry) => entry.issue === "empty" && !entry.chartable)).toBe(true);
  });

  it("sorts actual annual periods and represents missing interior years as null", () => {
    const [series] = buildMacroChartSeries([
      metric("gdp_current_usd", 14, 2024),
      metric("gdp_current_usd", 10, 2020),
      metric("gdp_current_usd", 12, 2022),
    ]);
    expect(series.points).toEqual([
      { year: 2020, periodLabel: "2020", value: 10 },
      { year: 2021, periodLabel: "2021", value: null },
      { year: 2022, periodLabel: "2022", value: 12 },
      { year: 2023, periodLabel: "2023", value: null },
      { year: 2024, periodLabel: "2024", value: 14 },
    ]);
    expect(series.latest).toEqual(series.points[4]);
    expect(series.chartable).toBe(true);
    expect(series.issue).toBeNull();
  });

  it("uses the period boundaries instead of a misleading display label", () => {
    const input = metric("gdp_current_usd", 10, 2023);
    input.period.label = "2025";
    expect(buildMacroChartSeries([input])[0].points[0]).toEqual({
      year: 2023,
      periodLabel: "2023",
      value: 10,
    });
  });

  it("does not extrapolate to years outside the observations", () => {
    const [series] = buildMacroChartSeries([metric("gdp_current_usd", 10, 2022)]);
    expect(series.points).toHaveLength(1);
    expect(series.latest?.year).toBe(2022);
  });

  it("keeps pending and unavailable values null and selects the latest valid point", () => {
    const [series] = buildMacroChartSeries([
      metric("gdp_current_usd", 100, 2022),
      metric("gdp_current_usd", 999, 2023, "USD", { value_status: "unavailable" }),
      metric("gdp_current_usd", null, 2024),
    ]);
    expect(series.points.map((point) => point.value)).toEqual([100, null, null]);
    expect(series.latest?.year).toBe(2022);
    expect(series.observations[1].value).toBe(999);
  });

  it("keeps an entirely pending series empty without changing its years into zeroes", () => {
    const [series] = buildMacroChartSeries([
      metric("gdp_current_usd", null, 2020),
      metric("gdp_current_usd", null, 2024),
    ]);
    expect(series.points).toHaveLength(5);
    expect(series.points.every((point) => point.value === null)).toBe(true);
    expect(series).toMatchObject({ chartable: false, issue: "empty", latest: null });
  });

  it.each([
    ["gdp_current_usd", "USD", 0],
    ["gdp_growth_pct", "PERCENT", -6.4],
    ["fdi_net_inflows_usd", "USD", -9100000],
    ["inflation_cpi_pct", "PERCENT", 211.4],
  ])("preserves the numerical meaning of %s", (code, unit, value) => {
    const series = buildMacroChartSeries([metric(code, value, 2024, unit)])
      .find((entry) => entry.code === code);
    expect(series?.points[0].value).toBe(value);
    expect(series?.latest?.value).toBe(value);
    expect(series?.chartable).toBe(true);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "does not plot a non-finite macro value (%s)",
    (value) => {
      const [series] = buildMacroChartSeries([
        metric("gdp_current_usd", 5, 2023),
        metric("gdp_current_usd", value, 2024),
      ]);
      expect(series.points[1].value).toBeNull();
      expect(series.latest?.year).toBe(2023);
      expect(series.observations[1].value).toBe(value);
    },
  );

  it.each(["EUR", "USD_MILLION", ""])(
    "does not combine incompatible or invalid units (%s)",
    (unit) => {
      const [series] = buildMacroChartSeries([
        metric("gdp_current_usd", 5, 2023),
        metric("gdp_current_usd", 6, 2024, unit),
      ]);
      expect(series).toMatchObject({ chartable: false, issue: "incompatible", points: [], latest: null });
      expect(series.observations).toHaveLength(2);
    },
  );

  it("recognizes case-only unit differences without converting magnitudes", () => {
    const [series] = buildMacroChartSeries([
      metric("gdp_current_usd", 5, 2023, "usd"),
      metric("gdp_current_usd", 6, 2024, " USD "),
    ]);
    expect(series.unit).toBe("USD");
    expect(series.points.map((point) => point.value)).toEqual([5, 6]);
    expect(series.chartable).toBe(true);
  });

  it.each([10, 15, null])("rejects duplicate annual observations even if a duplicate is %s", (value) => {
    const [series] = buildMacroChartSeries([
      metric("gdp_current_usd", 10, 2024),
      metric("gdp_current_usd", value, 2024),
    ]);
    expect(series).toMatchObject({ chartable: false, issue: "duplicate", points: [], latest: null });
    expect(series.observations).toHaveLength(2);
  });

  it.each([
    { start: "pending", end: "pending", label: "pending" },
    { start: "2024-01-01", end: "2023-12-31", label: "2024" },
    { start: "2024-01-01", end: "2024-06-30", label: "2024" },
    { start: "2024-13-01", end: "2024-12-31", label: "2024" },
    { start: "2024-02-01", end: "2024-12-31", label: "2024" },
    { start: "0000-01-01", end: "0000-12-31", label: "0" },
    { start: "999999999-01-01", end: "999999999-12-31", label: "999999999" },
  ])("rejects invalid or nonannual period $start to $end", (period) => {
    const [series] = buildMacroChartSeries([metric("gdp_current_usd", 5, 2024, "USD", { period })]);
    expect(series).toMatchObject({ chartable: false, issue: "incompatible", points: [] });
    expect(series.observations[0].period).toEqual(period);
  });

  it("bounds chart expansion without dropping the original outlying observations", () => {
    const early = metric("gdp_current_usd", 1, 2020, "USD", {
      period: { start: "0001-01-01", end: "0001-12-31", label: "1" },
    });
    const [series] = buildMacroChartSeries([early, metric("gdp_current_usd", 5, 9999)]);
    expect(series.points).toEqual([]);
    expect(series.issue).toBe("incompatible");
    expect(series.observations).toHaveLength(2);
  });

  it("separates metric families and ignores unrelated metrics", () => {
    const series = buildMacroChartSeries([
      metric("gdp_current_usd", 100),
      metric("gdp_growth_pct", 5, 2024, "PERCENT"),
      metric("unrecognized_metric", 500),
      ...capacity(),
    ]);
    expect(series[0].points[0].value).toBe(100);
    expect(series[1].points[0].value).toBe(5);
    expect(series.slice(2).every((entry) => entry.observations.length === 0)).toBe(true);
  });
});

describe("buildEnergyCompositions", () => {
  it("builds independent capacity and generation compositions using their own periods and units", () => {
    const [installed, generated] = buildEnergyCompositions([
      ...generation(),
      ...capacity(),
      metric("electricity_demand_gwh", null, 2024, "GWH"),
    ]);
    expect(installed).toMatchObject({
      key: "capacity", unit: "MW", remainder: 60, percentage: 40, periodLabel: "2025", status: "ready",
    });
    expect(generated).toMatchObject({
      key: "generation", unit: "GWh", remainder: 375, percentage: 25, periodLabel: "2023", status: "ready",
    });
    expect(installed.observations).toHaveLength(3);
    expect(generated.observations).toHaveLength(3);
  });

  it("returns two explicitly missing compositions without fabricating any zeroes", () => {
    const compositions = buildEnergyCompositions([]);
    expect(compositions).toHaveLength(2);
    expect(compositions.every((entry) =>
      entry.status === "missing" && entry.remainder === null && entry.percentage === null &&
      entry.total === null && entry.renewable === null && entry.share === null,
    )).toBe(true);
  });

  it.each([0, 1, 2])("requires every published member, including member %s", (index) => {
    const observations = capacity();
    observations.splice(index, 1);
    const [composition] = buildEnergyCompositions(observations);
    expect(composition).toMatchObject({ status: "missing", remainder: null, percentage: null });
    expect(composition.observations).toHaveLength(2);
  });

  it.each([0, 1, 2])("does not use a pending member %s, even if it still carries a number", (index) => {
    const observations = capacity();
    observations[index].value_status = "pending";
    const [composition] = buildEnergyCompositions(observations);
    expect(composition).toMatchObject({ status: "missing", remainder: null, percentage: null });
  });

  it("does not infer a share that is explicitly null", () => {
    const observations = capacity();
    observations[2].value = null;
    const [composition] = buildEnergyCompositions(observations);
    expect(composition.status).toBe("missing");
    expect(composition.percentage).toBeNull();
  });

  it.each([0, 100])("accepts the genuine %s percent boundary", (percentage) => {
    const [composition] = buildEnergyCompositions(capacity(100, percentage, percentage));
    expect(composition.status).toBe("ready");
    expect(composition.percentage).toBe(percentage);
    expect(composition.remainder).toBe(100 - percentage);
  });

  it.each([
    [0, 0, 0],
    [-100, 0, 0],
    [100, -1, 0],
    [100, 101, 100],
    [100, 40, -1],
    [100, 40, 101],
    [100, 40, 41],
  ])("rejects an invalid tuple total=%s renewable=%s share=%s", (total, renewable, share) => {
    const [composition] = buildEnergyCompositions(capacity(total, renewable, share));
    expect(composition).toMatchObject({ status: "invalid", remainder: null, percentage: null });
  });

  it("permits rounding-compatible published shares but does not replace them with the calculation", () => {
    const [composition] = buildEnergyCompositions(capacity(3, 1, 33.33));
    expect(composition.status).toBe("ready");
    expect(composition.remainder).toBe(2);
    expect(composition.percentage).toBe(33.33);
  });

  it("accepts the 0.05 percentage-point boundary and rejects larger differences", () => {
    expect(buildEnergyCompositions(capacity(100, 40, 40.05))[0].status).toBe("ready");
    expect(buildEnergyCompositions(capacity(100, 40, 40.051))[0].status).toBe("invalid");
  });

  it.each([
    [10.3, 3.1, 7.2],
    [5.67890123, 1.2345, 4.44440123],
    [0.00003, 0.00001, 0.00002],
    [1.03e-7, 3.1e-8, 7.2e-8],
    [1.03e22, 3.1e21, 7.2e21],
    [1.03e-200, 3.1e-201, 7.2e-201],
    [10.3, 10.3, 0],
    [10.3, 0, 10.3],
    [Number.MIN_VALUE, 0, Number.MIN_VALUE],
  ])("derives %s minus %s at the input decimal precision", (total, renewable, remainder) => {
    const [composition] = buildEnergyCompositions(capacity(total, renewable, (renewable / total) * 100));
    expect(composition.status).toBe("ready");
    expect(composition.remainder).toBe(remainder);
    if (total > renewable) expect(composition.remainder).toBeGreaterThan(0);
  });

  it("removes only the derived remainder's binary tail and preserves original observations and share", () => {
    const observations = capacity(10.3, 3.1, 30.1);
    const before = structuredClone(observations);
    const [composition] = buildEnergyCompositions(observations);
    expect(composition.remainder).toBe(7.2);
    expect(composition.total).toBe(observations[0]);
    expect(composition.renewable).toBe(observations[1]);
    expect(composition.share).toBe(observations[2]);
    expect(composition.percentage).toBe(30.1);
    expect(observations).toEqual(before);
  });

  it.each([0, 1, 2])("rejects a stale period in tuple member %s", (index) => {
    const observations = capacity();
    observations[index].period = { start: "2024-01-01", end: "2024-12-31", label: "2024" };
    const [composition] = buildEnergyCompositions(observations);
    expect(composition).toMatchObject({ status: "incompatible", remainder: null, percentage: null, periodLabel: null });
  });

  it("uses the newest tuple rather than input ordering when all members agree", () => {
    const [composition] = buildEnergyCompositions([...capacity(200, 100, 50, 2025), ...capacity(100, 40, 40, 2024)]);
    expect(composition).toMatchObject({ status: "ready", periodLabel: "2025", remainder: 100, percentage: 50 });
    expect(composition.total?.value).toBe(200);
    expect(composition.observations).toHaveLength(6);
  });

  it("does not fall back to an older common year when the newest total is newer", () => {
    const [composition] = buildEnergyCompositions([
      ...capacity(100, 40, 40, 2024),
      metric("electricity_installed_capacity_mw", 200, 2025, "MW"),
    ]);
    expect(composition.total?.period.label).toBe("2025");
    expect(composition).toMatchObject({ status: "incompatible", remainder: null, percentage: null });
  });

  it("does not fall back to an older share when the latest complete tuple has a pending share", () => {
    const newest = capacity(200, 100, 50, 2025);
    newest[2].value_status = "pending";
    const [composition] = buildEnergyCompositions([...capacity(100, 40, 40, 2024), ...newest]);
    expect(composition.share?.period.label).toBe("2025");
    expect(composition.status).toBe("missing");
  });

  it.each([0, 1, 2])("does not chart duplicate latest observations for tuple member %s", (index) => {
    const observations = capacity();
    observations.push({ ...observations[index] });
    const [composition] = buildEnergyCompositions(observations);
    expect(composition).toMatchObject({ status: "invalid", remainder: null, percentage: null });
    expect(composition.observations).toHaveLength(4);
  });

  it("does not let duplicate historical records override the newest unambiguous tuple", () => {
    const historical = capacity(100, 40, 40, 2024);
    const [composition] = buildEnergyCompositions([...historical, historical[0], ...capacity(200, 100, 50, 2025)]);
    expect(composition.status).toBe("ready");
    expect(composition.total?.value).toBe(200);
    expect(composition.observations).toHaveLength(7);
  });

  it.each([0, 1, 2])("rejects an incompatible unit for tuple member %s", (index) => {
    const observations = capacity();
    observations[index].unit = index === 2 ? "RATIO" : "GWH";
    expect(buildEnergyCompositions(observations)[0].status).toBe("incompatible");
  });

  it("accepts the API's uppercase GWH as well as the display spelling GWh", () => {
    const observations = generation();
    observations[0].unit = "GWh";
    observations[1].unit = "gwh";
    expect(buildEnergyCompositions(observations)[1].status).toBe("ready");
    expect(buildEnergyCompositions(observations)[1].unit).toBe("GWh");
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects non-finite energy values (%s)",
    (value) => {
      for (let index = 0; index < 3; index += 1) {
        const observations = capacity();
        observations[index].value = value;
        expect(buildEnergyCompositions(observations)[0].status).toBe("invalid");
      }
    },
  );

  it("does not infer the date of an undated record from an older complete tuple", () => {
    const observations = capacity();
    observations.push(metric("renewable_capacity_mw", 50, 2025, "MW", {
      period: { start: "unknown", end: "unknown", label: "unknown" },
    }));
    expect(buildEnergyCompositions(observations)[0].status).toBe("incompatible");
  });

  it("calculates large finite shares without overflowing an intermediate multiplication", () => {
    const [composition] = buildEnergyCompositions(capacity(1e307, 5e306, 50));
    expect(composition).toMatchObject({ status: "ready", remainder: 5e306, percentage: 50 });
  });
});

describe("immutable chart adaptation", () => {
  it("does not sort or modify the input array, original values, periods, or status fields", () => {
    const observations = [
      metric("gdp_current_usd", 6, 2024),
      ...capacity(),
      metric("gdp_current_usd", 3, 2020),
      ...generation(),
    ];
    const before = structuredClone(observations);
    for (const observation of observations) {
      Object.freeze(observation.period);
      Object.freeze(observation);
    }
    Object.freeze(observations);
    const macro = buildMacroChartSeries(observations);
    const energy = buildEnergyCompositions(observations);
    expect(observations).toEqual(before);
    expect(macro[0].observations[0]).toBe(observations[4]);
    expect(energy[0].total).toBe(observations[1]);
    expect(energy[0].observations).not.toBe(observations);
  });
});
