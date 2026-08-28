import { describe, expect, it } from "vitest";
import {
  availableMetricValue,
  CHART_COPY,
  chartMetricLabel,
  chartPeriodLabel,
  displayChartNumber,
  energyChartNumber,
  exactChartNumber,
  macroChartDomain,
  macroChartScale,
  macroChartTicks,
  macroPeriodRange,
} from "@/lib/basic60/chart-presentation";
import type { MacroChartSeries } from "@/lib/basic60/chart-data";
import type { Basic60Locale, Basic60Metric, Basic60Period } from "@/lib/basic60/types";

function series(
  values: (number | null)[],
  unit = "USD",
  kind: "bar" | "line" = "bar",
  firstYear = 2020,
): MacroChartSeries {
  const points = values.map((value, index) => ({
    value,
    year: firstYear + index,
    periodLabel: String(firstYear + index),
  }));
  const latest = [...points].reverse().find((point) => point.value !== null) ?? null;
  return {
    code: "gdp_current_usd",
    kind,
    unit,
    points,
    observations: [],
    latest,
    chartable: latest !== null,
    issue: latest ? null : "empty",
  };
}

const available: Basic60Metric = {
  metric_code: "renewable_capacity_mw",
  label: "Renewable capacity",
  value: 1234.567,
  unit: "MW",
  period: { start: "2025-01-01", end: "2025-12-31", label: "2025" },
  value_status: "available",
  null_reason: null,
  quality_status: "passed",
  freshness_status: "current",
};

describe("chart number presentation", () => {
  it.each(["zh-CN", "en"] as const)("keeps exact detail values unabridged in %s", (locale) => {
    expect(exactChartNumber(1234567890.125, locale)).toBe("1,234,567,890.125");
    expect(exactChartNumber(-1234567890.125, locale)).toBe("-1,234,567,890.125");
    expect(exactChartNumber(0.000000987654321, locale)).toBe("0.000000987654321");
    expect(exactChartNumber(0, locale)).toBe("0");
    expect(exactChartNumber(1000000000000, locale)).toBe("1,000,000,000,000");
  });

  it("rounds headline values without changing the exact-detail formatter", () => {
    expect(displayChartNumber(1234.56789, "en")).toBe("1,234.57");
    expect(displayChartNumber(1234.56789, "zh-CN", 3)).toBe("1,234.568");
    expect(displayChartNumber(-0.3456, "en", 4)).toBe("-0.3456");
    expect(exactChartNumber(1234.56789, "en")).toBe("1,234.56789");
  });

  it.each(["zh-CN", "en"] as const)("uses two decimal places for energy headlines in %s", (locale) => {
    expect(energyChartNumber(0, locale)).toBe("0.00");
    expect(energyChartNumber(1234, locale)).toBe("1,234.00");
    expect(energyChartNumber(1234.5, locale)).toBe("1,234.50");
    expect(energyChartNumber(1234.567, locale)).toBe("1,234.57");
  });

  it.each([null, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "uses translated missing labels, not zeroes or non-finite strings, for %s",
    (value) => {
      for (const locale of ["zh-CN", "en"] as const) {
        expect(exactChartNumber(value, locale)).toBe(CHART_COPY[locale].unavailable);
        expect(displayChartNumber(value, locale)).toBe(CHART_COPY[locale].unavailable);
        expect(energyChartNumber(value, locale)).toBe(CHART_COPY[locale].unavailable);
      }
    },
  );
});

describe("availableMetricValue", () => {
  it.each([0, -1234.56, 211.4, 1234.567])("preserves the available finite number %s", (value) => {
    expect(availableMetricValue({ ...available, value })).toBe(value);
  });

  it.each([null, undefined])("safely handles an absent metric %s", (metric) => {
    expect(availableMetricValue(metric)).toBeNull();
  });

  it.each(["pending", "unknown", "unavailable", "revoked", ""])(
    "does not use a residual number when the metric state is %s",
    (value_status) => {
      expect(availableMetricValue({ ...available, value_status })).toBeNull();
    },
  );

  it.each([null, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "does not return an unusable supposedly available value %s",
    (value) => {
      expect(availableMetricValue({ ...available, value })).toBeNull();
    },
  );
});

describe("localized indicator and unit labels", () => {
  it.each([
    ["gdp_current_usd", "国内生产总值", "GDP"],
    ["gdp_growth_pct", "GDP增长率", "GDP growth"],
    ["gdp_per_capita_current_usd", "人均GDP", "GDP per capita"],
    ["inflation_cpi_pct", "CPI通胀率", "CPI inflation"],
    ["fdi_net_inflows_usd", "FDI净流入", "FDI net inflows"],
    ["official_exchange_rate_lcu_per_usd", "官方汇率", "Official exchange rate"],
  ])("provides concise names for %s", (code, chinese, english) => {
    expect(chartMetricLabel(code, "zh-CN")).toBe(chinese);
    expect(chartMetricLabel(code, "en")).toBe(english);
  });

  it("does not expose unknown technical field identifiers as labels", () => {
    expect(chartMetricLabel("unregistered_internal_indicator", "zh-CN")).toBe("其他指标");
    expect(chartMetricLabel("unregistered_internal_indicator", "en")).toBe("Other indicator");
  });

  it.each([
    ["PERCENT", "%", "%"],
    ["USD", "USD", "USD"],
    ["USD_PER_PERSON", "USD/人", "USD/person"],
    ["LCU_PER_USD", "本币/USD", "LCU/USD"],
    ["MW", "MW", "MW"],
    ["GWH", "GWh", "GWh"],
  ])("resolves the canonical %s unit", (unit, chinese, english) => {
    expect(macroChartScale(series([1], unit), "zh-CN").unitLabel).toBe(chinese);
    expect(macroChartScale(series([1], unit), "en").unitLabel).toBe(english);
  });

  it("provides matching translated actions and state messages in both locales", () => {
    expect(Object.keys(CHART_COPY["zh-CN"]).sort()).toEqual(Object.keys(CHART_COPY.en).sort());
    expect(CHART_COPY["zh-CN"].viewData).toBe("查看数据");
    expect(CHART_COPY.en.viewData).toBe("View data");
    expect(CHART_COPY["zh-CN"].calculated).toBe("计算值");
    expect(CHART_COPY.en.calculated).toBe("Calculated");
  });
});

describe("macro axis scale", () => {
  it.each([
    [1.6e12, "en", 1e12, "T", "USD · T"],
    [1.6e12, "zh-CN", 1e12, "万亿", "USD · 万亿"],
    [1.6e9, "en", 1e9, "B", "USD · B"],
    [1.6e9, "zh-CN", 1e8, "亿", "USD · 亿"],
    [1.6e6, "en", 1e6, "M", "USD · M"],
    [1.6e6, "zh-CN", 1e4, "万", "USD · 万"],
    [7500, "en", 1e3, "K", "USD · K"],
    [7500, "zh-CN", 1, "", "USD"],
    [12.5, "en", 1, "", "USD"],
    [0, "zh-CN", 1, "", "USD"],
  ] as const)("scales %s USD for %s without rounding source values", (value, locale, divisor, suffix, unitLabel) => {
    const original = series([value]);
    expect(macroChartScale(original, locale)).toEqual({ divisor, suffix, unitLabel });
    expect(original.points[0].value).toBe(value);
  });

  it("uses absolute magnitude for negative FDI and excludes pending points", () => {
    expect(macroChartScale(series([null, -1.6e9, -150]), "en")).toEqual({
      divisor: 1e9,
      suffix: "B",
      unitLabel: "USD · B",
    });
  });

  it.each([211.4, -135.6, 1e9])("never rescales or clips a percent-point value of %s", (value) => {
    const original = series([value], "PERCENT", "line");
    expect(macroChartScale(original, "en")).toEqual({ divisor: 1, suffix: "", unitLabel: "%" });
    expect(macroChartScale(original, "zh-CN")).toEqual({ divisor: 1, suffix: "", unitLabel: "%" });
    expect(original.points[0].value).toBe(value);
    expect(exactChartNumber(value, "en")).toBe(new Intl.NumberFormat("en").format(value));
  });

  it("keeps human-scale per-capita and exchange-rate axes in their canonical units", () => {
    expect(macroChartScale(series([55000], "USD_PER_PERSON", "line"), "en")).toEqual({
      divisor: 1,
      suffix: "",
      unitLabel: "USD/person",
    });
    expect(macroChartScale(series([32000], "LCU_PER_USD", "line"), "zh-CN")).toEqual({
      divisor: 1,
      suffix: "",
      unitLabel: "本币/USD",
    });
  });

  it("provides a safe unscaled axis for an empty series", () => {
    expect(macroChartScale(series([]), "en")).toEqual({ divisor: 1, suffix: "", unitLabel: "USD" });
  });
});

describe("macro axis domains", () => {
  it.each([
    ["positive bars", [10, 20, 30], "USD", "bar"],
    ["negative bars", [-10, -20, -30], "USD", "bar"],
    ["mixed bars", [-10, 20, -30], "USD", "bar"],
    ["zero bars", [0, 0], "USD", "bar"],
    ["high inflation", [20, 211.4, 135], "PERCENT", "line"],
    ["negative growth", [-6.5, 3.2, 0], "PERCENT", "line"],
    ["zero growth", [0, 0], "PERCENT", "line"],
  ] as const)("keeps a non-degenerate finite domain containing all data and zero for %s", (_name, values, unit, kind) => {
    const [lower, upper] = macroChartDomain(series([...values], unit, kind));
    expect(Number.isFinite(lower)).toBe(true);
    expect(Number.isFinite(upper)).toBe(true);
    expect(lower).toBeLessThan(upper);
    expect(lower).toBeLessThanOrEqual(Math.min(0, ...values));
    expect(upper).toBeGreaterThanOrEqual(Math.max(0, ...values));
  });

  it("uses a trend-sensitive domain for a strictly positive per-capita line", () => {
    const [lower, upper] = macroChartDomain(series([10000, 11000], "USD_PER_PERSON", "line"));
    expect(lower).toBeGreaterThan(0);
    expect(lower).toBeLessThan(10000);
    expect(upper).toBeGreaterThan(11000);
  });

  it.each([100, -100, 0])("does not collapse a single-value line at %s", (value) => {
    const [lower, upper] = macroChartDomain(series([value], "LCU_PER_USD", "line"));
    expect(lower).toBeLessThan(upper);
    expect(lower).toBeLessThanOrEqual(value);
    expect(upper).toBeGreaterThanOrEqual(value);
  });

  it("ignores missing points without inserting zero into a continuous-value line domain", () => {
    const input = series([null, 100, null, 110, null], "USD_PER_PERSON", "line");
    expect(macroChartDomain(input)).toEqual(macroChartDomain(series([100, 110], "USD_PER_PERSON", "line")));
    expect(input.points[0].value).toBeNull();
  });

  it("provides a finite fallback domain for empty and entirely missing series", () => {
    expect(macroChartDomain(series([]))).toEqual([0, 1]);
    expect(macroChartDomain(series([null, null], "PERCENT", "line"))).toEqual([0, 1]);
  });
});

describe("rounded macro axis ticks", () => {
  it("uses readable integer ticks instead of the irregular observed percentage endpoints", () => {
    const input = series([-3.39, 6.63], "PERCENT", "line");
    const ticks = macroChartTicks(input);
    expect(ticks.every(Number.isInteger)).toBe(true);
    expect(ticks).toContain(0);
    expect(ticks).not.toContain(-3.39);
    expect(ticks).not.toContain(6.63);
    expect(macroChartDomain(input)).toEqual([ticks[0], ticks[ticks.length - 1]]);
    expect(ticks[0]).toBeLessThanOrEqual(-3.39);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(6.63);
  });

  it("keeps the actual Indonesia growth axis on whole percentage steps with zero visible", () => {
    const input = series([-2.06551183, 3.70288563, 5.30719723, 5.04883118, 5.03257477], "PERCENT", "line");
    expect(macroChartTicks(input)).toEqual([-4, -2, 0, 2, 4, 6, 8]);
  });

  it.each([
    ["positive bars", [3e9, 6e9], "USD", "bar"],
    ["negative bars", [-5e9, -8e9], "USD", "bar"],
    ["mixed growth", [-5.4, 6.63], "PERCENT", "line"],
    ["zero bars", [0, 0], "USD", "bar"],
  ] as const)("includes a visible zero tick for %s", (_name, values, unit, kind) => {
    const ticks = macroChartTicks(series([...values], unit, kind));
    expect(ticks).toContain(0);
    expect(ticks.length).toBeGreaterThan(1);
  });

  it("keeps ticks finite, strictly ascending, equally spaced and aligned with the shared domain", () => {
    const inputs = [
      series([-3.39, null, 6.63], "PERCENT", "line"),
      series([-0.017, 0.039], "PERCENT", "line"),
      series([10000, 11000], "USD_PER_PERSON", "line"),
      series([3e9, 6e9]),
      series([]),
    ];
    for (const input of inputs) {
      const ticks = macroChartTicks(input);
      const interval = ticks[1] - ticks[0];
      expect(ticks.every(Number.isFinite)).toBe(true);
      expect(interval).toBeGreaterThan(0);
      for (let index = 1; index < ticks.length; index += 1) {
        expect(ticks[index]).toBeGreaterThan(ticks[index - 1]);
        expect(ticks[index] - ticks[index - 1]).toBeCloseTo(interval, 10);
      }
      expect(macroChartDomain(input)).toEqual([ticks[0], ticks[ticks.length - 1]]);
    }
  });

  it("keeps per-capita trend ticks close to the data instead of forcing a zero baseline", () => {
    const ticks = macroChartTicks(series([10000, 11000], "USD_PER_PERSON", "line"));
    expect(ticks).not.toContain(0);
    expect(ticks[0]).toBeGreaterThan(0);
    expect(ticks[0]).toBeLessThanOrEqual(10000);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(11000);
  });

  it("scales rounded ticks for display without rescaling or rounding the actual observations", () => {
    const input = series([-1600123456.125, 3400987654.375]);
    const before = structuredClone(input);
    const ticks = macroChartTicks(input);
    const scale = macroChartScale(input, "en");
    const labels = ticks.map((tick) => displayChartNumber(tick / scale.divisor, "en"));
    expect(scale.divisor).toBe(1e9);
    expect(labels).toContain("0");
    expect(labels.every((label) => /^-?\d+(?:\.\d+)?$/.test(label))).toBe(true);
    expect(input).toEqual(before);
    expect(exactChartNumber(input.points[0].value, "en")).toBe("-1,600,123,456.125");
    expect(exactChartNumber(input.points[1].value, "en")).toBe("3,400,987,654.375");
  });
});

describe("period labels and complete reporting ranges", () => {
  it("prefers the actual annual boundaries over a contradictory display label", () => {
    const period = { start: "2023-01-01", end: "2023-12-31", label: "2025" };
    expect(chartPeriodLabel(period, "zh-CN")).toBe("2023");
    expect(chartPeriodLabel(period, "en")).toBe("2023");
  });

  it("uses the actual annual period even if the label is missing", () => {
    const period = { start: "2024-01-01", end: "2024-12-31", label: "" };
    expect(chartPeriodLabel(period, "en")).toBe("2024");
  });

  it.each(["pending", "unknown", "", "BASIC60-PRIVATE-R1", "2024 <script>"])(
    "sanitizes an unsupported period label %s into a translated missing state",
    (label) => {
      const period: Basic60Period = { start: "unknown", end: "unknown", label };
      expect(chartPeriodLabel(period, "zh-CN")).toBe("暂无数据");
      expect(chartPeriodLabel(period, "en")).toBe("Not available");
    },
  );

  it.each(["zh-CN", "en"] as const)("reports no fabricated years when there is no series in %s", (locale) => {
    expect(macroPeriodRange([], locale)).toBe("");
    expect(macroPeriodRange([series([])], locale)).toBe("");
  });

  it("combines the actual earliest and latest years regardless of the input series order", () => {
    const input = [series([3, 4], "USD", "bar", 2023), series([1, 2], "PERCENT", "line", 2020)];
    expect(macroPeriodRange(input, "zh-CN")).toBe("2020—2024");
    expect(macroPeriodRange(input, "en")).toBe("2020–2024");
  });

  it("keeps an explicitly missing latest year in the reporting range", () => {
    const input = series([1, 2, 3, 4, null]);
    expect(input.latest?.year).toBe(2023);
    expect(macroPeriodRange([input], "en")).toBe("2020–2024");
  });

  it("shows a single year once rather than a redundant range", () => {
    expect(macroPeriodRange([series([4], "USD", "bar", 2024)], "zh-CN")).toBe("2024");
  });
});

describe("non-mutating chart presentation", () => {
  it("does not change original points, latest values, or reporting periods while scaling and formatting", () => {
    const input = series([-1.6e9, null, 0, 3.4e9]);
    const before = structuredClone(input);
    for (const point of input.points) Object.freeze(point);
    Object.freeze(input.points);
    Object.freeze(input);
    for (const locale of ["zh-CN", "en"] as Basic60Locale[]) {
      macroChartScale(input, locale);
      macroPeriodRange([input], locale);
      macroChartDomain(input);
      macroChartTicks(input);
      exactChartNumber(input.latest?.value ?? null, locale);
    }
    expect(input).toEqual(before);
  });
});
