import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EnergyPlot, MacroPlot } from "@/components/country-chart-plots";
import { buildEnergyCompositions, buildMacroChartSeries, type EnergyComposition, type MacroChartPoint } from "@/lib/basic60/chart-data";
import type { Basic60Metric } from "@/lib/basic60/types";

type Inspection = { activeTooltipIndex?: number | string | null; activeLabel?: string | number };
type ComposedProps = {
  children: ReactNode;
  data: MacroChartPoint[];
  accessibilityLayer?: boolean;
  onClick: (state: Inspection) => void;
  onTouchEnd: (state: Inspection) => void;
};
type Part = { name: string; value: number; color: string };
type PieProps = {
  children: ReactNode;
  data: Part[];
  onClick: (part: Part, index: number) => void;
};
type TooltipProps = {
  active?: boolean;
  filterNull?: boolean;
  content: (props: { active: boolean; label?: string | number; payload: { name: string }[] }) => ReactNode;
};

const chartMock = vi.hoisted(() => ({
  composed: null as ComposedProps | null,
  pie: null as PieProps | null,
  tooltip: null as TooltipProps | null,
  line: null as { connectNulls?: boolean; isAnimationActive?: boolean; type?: string } | null,
  bar: null as { dataKey?: string; isAnimationActive?: boolean } | null,
  referenceDot: null as { x: number; y: number; label: { value: string } } | null,
  referenceLine: null as { y: number } | null,
}));

// Recharts owns SVG layout and pointer-to-axis hit testing. This mock supplies
// the documented chart event payloads; tests exercise the actual Plot state,
// accessible legend, and tooltip logic rather than claiming visual validation.
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ComposedChart: (props: ComposedProps) => {
    chartMock.composed = props;
    return <div data-testid="macro-chart">
      {props.data.map((point, index) => <button
        key={point.year}
        type="button"
        tabIndex={-1}
        data-testid={`macro-point-${point.year}`}
        onClick={() => props.onClick({ activeTooltipIndex: index, activeLabel: point.year })}
        onTouchEnd={() => props.onTouchEnd({ activeTooltipIndex: String(index), activeLabel: point.year })}
      >{point.year}</button>)}
      {props.children}
    </div>;
  },
  PieChart: ({ children }: { children: ReactNode }) => <div data-testid="energy-chart">{children}</div>,
  Pie: (props: PieProps) => {
    chartMock.pie = props;
    return <div>{props.data.map((part, index) => <button
      key={part.name}
      type="button"
      tabIndex={-1}
      data-testid={`energy-segment-${index}`}
      onClick={() => props.onClick(part, index)}
    >{part.name}</button>)}{props.children}</div>;
  },
  Tooltip: (props: TooltipProps) => { chartMock.tooltip = props; return null; },
  Line: (props: NonNullable<typeof chartMock.line>) => { chartMock.line = props; return null; },
  Bar: (props: NonNullable<typeof chartMock.bar> & { children: ReactNode }) => {
    chartMock.bar = props;
    return <div>{props.children}</div>;
  },
  ReferenceDot: (props: NonNullable<typeof chartMock.referenceDot>) => { chartMock.referenceDot = props; return null; },
  ReferenceLine: (props: NonNullable<typeof chartMock.referenceLine>) => { chartMock.referenceLine = props; return null; },
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Cell: () => null,
}));

function metric(code: string, value: number | null, year = 2024, unit = "USD"): Basic60Metric {
  return {
    metric_code: code,
    label: code,
    value,
    unit,
    period: { start: `${year}-01-01`, end: `${year}-12-31`, label: String(year) },
    value_status: value === null ? "pending" : "available",
    null_reason: value === null ? "not collected" : null,
    quality_status: "passed",
    freshness_status: "current",
  };
}

function macro(values: (number | null)[], code = "gdp_current_usd", unit = "USD") {
  return buildMacroChartSeries(values.map((value, index) => metric(code, value, 2020 + index, unit)))
    .find((entry) => entry.code === code)!;
}

function energy(renewable = 40): EnergyComposition {
  return buildEnergyCompositions([
    metric("electricity_installed_capacity_mw", 100, 2025, "MW"),
    metric("renewable_capacity_mw", renewable, 2025, "MW"),
    metric("renewable_share_capacity_pct", renewable, 2025, "PERCENT"),
  ])[0];
}

beforeEach(() => {
  chartMock.composed = null;
  chartMock.pie = null;
  chartMock.tooltip = null;
  chartMock.line = null;
  chartMock.bar = null;
  chartMock.referenceDot = null;
  chartMock.referenceLine = null;
});

describe("MacroPlot interaction", () => {
  it("pins exact unscaled values on click and keeps them after the pointer leaves", async () => {
    const user = userEvent.setup();
    render(<MacroPlot series={macro([1e9, 1234567890.125])} locale="en" />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("macro-point-2021"));
    const pinned = screen.getByRole("status");
    expect(pinned).toHaveTextContent("GDP · 2021");
    expect(pinned).toHaveTextContent("1,234,567,890.125 USD");
    expect(chartMock.tooltip?.active).toBe(false);
    fireEvent.mouseLeave(screen.getByTestId("macro-chart"));
    expect(screen.getByRole("status")).toBe(pinned);
  });

  it("pins a touch selection through the chart's string index payload", () => {
    render(<MacroPlot series={macro([-1.25, 211.4], "inflation_cpi_pct", "PERCENT")} locale="zh-CN" />);
    fireEvent.touchEnd(screen.getByTestId("macro-point-2021"), { changedTouches: [{ identifier: 1 }] });
    expect(screen.getByRole("status")).toHaveTextContent("CPI通胀率 · 2021");
    expect(screen.getByRole("status")).toHaveTextContent("211.4 %");
  });

  it("can resolve a year label if the chart event has no index", () => {
    render(<MacroPlot series={macro([3, 8])} locale="en" />);
    act(() => chartMock.composed?.onClick({ activeTooltipIndex: null, activeLabel: "2021" }));
    expect(screen.getByRole("status")).toHaveTextContent("GDP · 2021");
    expect(screen.getByRole("status")).toHaveTextContent("8 USD");
  });

  it("ignores chart background clicks without inventing a selected point", () => {
    render(<MacroPlot series={macro([3, 8])} locale="en" />);
    act(() => chartMock.composed?.onClick({}));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    act(() => chartMock.composed?.onClick({ activeTooltipIndex: 200, activeLabel: "unknown" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("closes pinned values with the translated close button and Escape", async () => {
    const user = userEvent.setup();
    render(<MacroPlot series={macro([3])} locale="zh-CN" />);
    await user.click(screen.getByTestId("macro-point-2020"));
    await user.click(screen.getByRole("button", { name: "关闭数值提示" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("macro-point-2020"));
    screen.getByRole("button", { name: "关闭数值提示" }).focus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(chartMock.tooltip?.active).toBeUndefined();
  });

  it("shows a missing selected year as unavailable without a fabricated zero or unit suffix", async () => {
    const user = userEvent.setup();
    render(<MacroPlot series={macro([10, null, 20])} locale="en" />);
    await user.click(screen.getByTestId("macro-point-2021"));
    const pinned = screen.getByRole("status");
    expect(within(pinned).getByText("Not available", { exact: true })).toBeInTheDocument();
    expect(pinned).not.toHaveTextContent("0 USD");
    expect(pinned).not.toHaveTextContent("Not available USD");
    expect(chartMock.composed?.data[1].value).toBeNull();
    expect(chartMock.tooltip?.filterNull).toBe(false);
  });

  it("keeps a genuine zero selectable and labels the latest zero point", async () => {
    const user = userEvent.setup();
    render(<MacroPlot series={macro([-3, 0], "fdi_net_inflows_usd")} locale="en" />);
    await user.click(screen.getByTestId("macro-point-2021"));
    expect(screen.getByRole("status")).toHaveTextContent("0 USD");
    expect(chartMock.referenceDot).toMatchObject({ x: 2021, y: 0, label: { value: "0" } });
    expect(chartMock.referenceLine?.y).toBe(0);
  });

  it("passes line gaps, negative values and values above 100 through to Recharts unchanged", () => {
    render(<MacroPlot series={macro([-5, null, 211.4], "inflation_cpi_pct", "PERCENT")} locale="en" />);
    expect(chartMock.composed?.data.map((point) => point.value)).toEqual([-5, null, 211.4]);
    expect(chartMock.composed?.accessibilityLayer).toBe(true);
    expect(chartMock.line).toMatchObject({ connectNulls: false, isAnimationActive: false, type: "linear" });
    expect(chartMock.referenceLine?.y).toBe(0);
    expect(chartMock.referenceDot?.label.value).toBe("211.4%");
    expect(chartMock.bar).toBeNull();
  });

  it("uses a bar series for FDI and does not label a pending final year as the latest", () => {
    render(<MacroPlot series={macro([-1e9, 5e9, null], "fdi_net_inflows_usd")} locale="en" />);
    expect(chartMock.bar).toMatchObject({ dataKey: "value", isAnimationActive: false });
    expect(chartMock.referenceDot).toMatchObject({ x: 2021, y: 5e9 });
    expect(chartMock.line).toBeNull();
  });

  it("formats hover content using the same exact value and missing-year rules", () => {
    render(<MacroPlot series={macro([1234.56789, null])} locale="en" />);
    const content = chartMock.tooltip!.content;
    const hover = render(<>{content({ active: true, label: 2020, payload: [] })}</>);
    expect(hover.container).toHaveTextContent("1,234.56789 USD");
    hover.rerender(<>{content({ active: true, label: 2021, payload: [] })}</>);
    expect(hover.container).toHaveTextContent("Not available");
    expect(hover.container).not.toHaveTextContent("0 USD");
    hover.rerender(<>{content({ active: false, label: 2021, payload: [] })}</>);
    expect(hover.container).toBeEmptyDOMElement();
  });
});

describe("EnergyPlot interaction", () => {
  it("plots exactly two composition members, not the total as a third slice", () => {
    render(<EnergyPlot composition={energy()} locale="en" />);
    expect(chartMock.pie?.data.map(({ name, value }) => ({ name, value }))).toEqual([
      { name: "Renewables", value: 40 },
      { name: "Other sources", value: 60 },
    ]);
    expect(screen.getByRole("list", { name: "Energy components" })).toBeInTheDocument();
  });

  it("pins a segment when tapped and retains the value until explicitly dismissed", async () => {
    const user = userEvent.setup();
    render(<EnergyPlot composition={energy()} locale="en" />);
    const segment = screen.getByTestId("energy-segment-0");
    await user.pointer([{ keys: "[TouchA>]", target: segment }, { keys: "[/TouchA]" }]);
    const pinned = screen.getByRole("status");
    expect(pinned).toHaveTextContent("Renewables · 2025");
    expect(pinned).toHaveTextContent("40 MW");
    expect(chartMock.tooltip?.active).toBe(false);
    fireEvent.mouseLeave(screen.getByTestId("energy-chart"));
    expect(screen.getByRole("status")).toBe(pinned);
    await user.click(screen.getByRole("button", { name: "Dismiss value tooltip" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("makes legend components keyboard buttons with a toggled pressed state", async () => {
    const user = userEvent.setup();
    render(<EnergyPlot composition={energy()} locale="en" />);
    const legend = screen.getByRole("list", { name: "Energy components" });
    const renewable = within(legend).getByRole("button", { name: /^Renewables\s*40\.00 MW$/ });
    expect(renewable).toHaveAttribute("aria-pressed", "false");
    renewable.focus();
    await user.keyboard("{Enter}");
    expect(renewable).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("status")).toHaveTextContent("40 MW");
    await user.keyboard(" ");
    expect(renewable).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("marks the remainder as calculated and clears it with Escape from the focused legend", async () => {
    const user = userEvent.setup();
    render(<EnergyPlot composition={energy()} locale="zh-CN" />);
    const legend = screen.getByRole("list", { name: "能源构成" });
    const remainder = within(legend).getByRole("button", { name: /^其他电源\s*60\.00 MW$/ });
    await user.click(remainder);
    expect(screen.getByRole("status")).toHaveTextContent("其他电源 · 2025");
    expect(screen.getByRole("status")).toHaveTextContent("计算值");
    expect(remainder).toHaveAttribute("aria-pressed", "true");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(remainder).toHaveAttribute("aria-pressed", "false");
  });

  it("updates the selected component instead of showing two pinned panels", async () => {
    const user = userEvent.setup();
    render(<EnergyPlot composition={energy()} locale="en" />);
    await user.click(screen.getByTestId("energy-segment-0"));
    await user.click(screen.getByTestId("energy-segment-1"));
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent("Other sources · 2025");
    expect(screen.getByRole("status")).toHaveTextContent("Calculated");
  });

  it.each([0, 100])("keeps a genuine %s percent composition available", (percentage) => {
    render(<EnergyPlot composition={energy(percentage)} locale="en" />);
    expect(screen.getByTestId("energy-chart")).toBeInTheDocument();
    expect(chartMock.pie?.data.map((part) => part.value)).toEqual([percentage, 100 - percentage]);
    expect(screen.queryByText("No data to chart")).not.toBeInTheDocument();
  });

  it.each(["missing", "incompatible", "invalid"] as const)("does not plot a %s composition", (status) => {
    render(<EnergyPlot composition={{ ...energy(), status }} locale="en" />);
    expect(screen.getByRole("status")).toHaveTextContent("No data to chart");
    expect(screen.queryByTestId("energy-chart")).not.toBeInTheDocument();
    expect(chartMock.pie).toBeNull();
  });

  it.each(["renewable", "remainder", "percentage"] as const)(
    "does not turn a missing %s into a zero slice even if status is incorrectly ready",
    (field) => {
      const composition = { ...energy(), [field]: null };
      render(<EnergyPlot composition={composition} locale="zh-CN" />);
      expect(screen.getByRole("status")).toHaveTextContent("暂无可绘制的数据");
      expect(screen.queryByTestId("energy-chart")).not.toBeInTheDocument();
      expect(chartMock.pie).toBeNull();
    },
  );

  it("rejects a pending renewable number rather than using a residual value", () => {
    const composition = energy();
    composition.renewable = { ...composition.renewable!, value_status: "pending" };
    render(<EnergyPlot composition={composition} locale="en" />);
    expect(screen.getByRole("status")).toHaveTextContent("No data to chart");
    expect(chartMock.pie).toBeNull();
  });

  it("uses the exact GWh value and original period in hover content", () => {
    const composition = buildEnergyCompositions([
      metric("electricity_generation_gwh", 1000, 2023, "GWH"),
      metric("renewable_generation_gwh", 123.456789, 2023, "GWH"),
      metric("renewable_share_generation_pct", 12.3456789, 2023, "PERCENT"),
    ])[1];
    render(<EnergyPlot composition={composition} locale="en" />);
    const content = chartMock.tooltip!.content;
    const hover = render(<>{content({ active: true, payload: [{ name: "Renewables" }] })}</>);
    expect(hover.container).toHaveTextContent("Renewables · 2023");
    expect(hover.container).toHaveTextContent("123.456789 GWh");
    hover.rerender(<>{content({ active: true, payload: [{ name: "Unknown segment" }] })}</>);
    expect(hover.container).toBeEmptyDOMElement();
  });
});
