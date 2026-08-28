"use client";

import { X } from "lucide-react";
import { useState } from "react";
import { Bar, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { type EnergyComposition, type MacroChartPoint, type MacroChartSeries } from "@/lib/basic60/chart-data";
import { availableMetricValue, CHART_COLORS, CHART_COPY, chartMetricLabel, displayChartNumber, energyChartNumber, exactChartNumber, macroChartDomain, macroChartScale, macroChartTicks } from "@/lib/basic60/chart-presentation";
import { basic60UnitLabel } from "@/lib/basic60/presentation";
import type { Basic60Locale } from "@/lib/basic60/types";

export function MacroPlot({ series, locale }: { series: MacroChartSeries; locale: Basic60Locale }) {
  const [selected, setSelected] = useState<MacroChartPoint | null>(null);
  const copy = CHART_COPY[locale];
  const scale = macroChartScale(series, locale);
  const title = chartMetricLabel(series.code, locale);
  const unit = basic60UnitLabel(series.unit, locale);
  const color = series.unit === "PERCENT" ? CHART_COLORS.teal : CHART_COLORS.navy;
  const domain = macroChartDomain(series);
  const latest = series.latest;
  const inspect = (state: { activeTooltipIndex?: number | string | null; activeLabel?: string | number }) => {
    const index = state.activeTooltipIndex === null || state.activeTooltipIndex === undefined ? -1 : Number(state.activeTooltipIndex);
    const point = series.points[index] ?? series.points.find((item) => String(item.year) === String(state.activeLabel));
    if (point) setSelected(point);
  };
  const pointValue = (point: MacroChartPoint) => `${exactChartNumber(point.value, locale)}${point.value !== null ? ` ${unit}` : ""}`;
  return (
    <div className="country-plot-canvas" onKeyDown={(event) => { if (event.key === "Escape") setSelected(null); }}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={30}>
        <ComposedChart data={series.points} margin={{ top: 23, right: 35, bottom: 4, left: 2 }} accessibilityLayer onClick={inspect} onTouchEnd={inspect}>
          <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="year" type="category" allowDuplicatedCategory={false} axisLine={{ stroke: "#d9e0e9" }} tickLine={false} tick={{ fill: CHART_COLORS.axis, fontSize: 11 }} interval="preserveStartEnd" minTickGap={10} tickMargin={10} />
          <YAxis domain={domain} ticks={macroChartTicks(series)} interval={0} tickFormatter={(value: number) => displayChartNumber(value / scale.divisor, locale, 2)} width={58} axisLine={false} tickLine={false} tick={{ fill: CHART_COLORS.axis, fontSize: 11 }} />
          {series.kind === "bar" || series.unit === "PERCENT" ? <ReferenceLine y={0} stroke="#91a0b5" strokeWidth={1} /> : null}
          <Tooltip active={selected ? false : undefined} filterNull={false} cursor={{ stroke: "#a5b7c9", strokeWidth: 1 }} isAnimationActive={false} content={({ active, label }) => {
            const point = series.points.find((item) => String(item.year) === String(label));
            return active && point ? <div className="country-chart-tooltip"><span>{title} · {point.periodLabel}</span><strong>{pointValue(point)}</strong></div> : null;
          }} />
          {series.kind === "bar" ? <Bar dataKey="value" name={title} maxBarSize={36} radius={[2, 2, 0, 0]} isAnimationActive={false}>
            {series.points.map((point) => <Cell key={point.year} fill={point.year === latest?.year ? CHART_COLORS.teal : CHART_COLORS.navy} />)}
          </Bar> : <Line type="linear" dataKey="value" name={title} stroke={color} strokeWidth={2} dot={{ r: 3, fill: color, strokeWidth: 0 }} activeDot={{ r: 5, strokeWidth: 2, fill: "#ffffff", stroke: CHART_COLORS.teal }} connectNulls={false} isAnimationActive={false} />}
          {latest?.value !== null && latest?.value !== undefined ? <ReferenceDot x={latest.year} y={latest.value} r={series.kind === "bar" ? 0 : 4} fill="#ffffff" stroke={CHART_COLORS.teal} strokeWidth={1.5} label={{ value: `${displayChartNumber(latest.value / scale.divisor, locale, scale.divisor === 1 ? 2 : 3)}${series.unit === "PERCENT" ? "%" : ""}`, position: "top", offset: 12, fill: "#287f8b", fontSize: 11 }} /> : null}
        </ComposedChart>
      </ResponsiveContainer>
      {selected ? <div className="country-chart-tooltip country-chart-tooltip-pinned" role="status"><button type="button" aria-label={copy.clear} onClick={() => setSelected(null)}><X size={14} aria-hidden="true" /></button><span>{title} · {selected.periodLabel}</span><strong>{pointValue(selected)}</strong></div> : null}
    </div>
  );
}

export function EnergyPlot({ composition, locale }: { composition: EnergyComposition; locale: Basic60Locale }) {
  const [selected, setSelected] = useState<number | null>(null);
  const copy = CHART_COPY[locale];
  const renewable = availableMetricValue(composition.renewable);
  if (composition.status !== "ready" || renewable === null || composition.remainder === null || composition.percentage === null) {
    return <div className="country-chart-unavailable" role="status">{copy.noChart}</div>;
  }
  const data = [
    { name: copy.renewable, value: renewable, color: CHART_COLORS.renewable },
    { name: copy.remainder, value: composition.remainder, color: CHART_COLORS.remainder },
  ];
  const selectedPart = selected === null ? null : data[selected];
  return (
    <div className="country-energy-visual" onKeyDown={(event) => { if (event.key === "Escape") setSelected(null); }}>
      <div className="country-energy-ring">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={30}>
          <PieChart accessibilityLayer>
            <Pie data={data} dataKey="value" nameKey="name" startAngle={90} endAngle={-270} innerRadius="62%" outerRadius="92%" stroke="transparent" isAnimationActive={false} onClick={(_data, index) => setSelected(index)}>
              {data.map((part) => <Cell key={part.name} fill={part.color} stroke={part.color} />)}
            </Pie>
            <Tooltip active={selectedPart ? false : undefined} isAnimationActive={false} content={({ active, payload }) => {
              const name = payload[0]?.name;
              const part = data.find((item) => item.name === name);
              return active && part ? <div className="country-chart-tooltip"><span>{part.name} · {composition.periodLabel}</span><strong>{exactChartNumber(part.value, locale)} {composition.unit}</strong></div> : null;
            }} />
          </PieChart>
        </ResponsiveContainer>
        <div className="country-energy-ring-label"><strong>{displayChartNumber(composition.percentage, locale)}<small>%</small></strong><span>{copy.renewable}</span></div>
      </div>
      <ul className="country-energy-legend" aria-label={locale === "en" ? "Energy components" : "能源构成"}>
        {data.map((part, index) => <li key={part.name}><button type="button" className={selected === index ? "is-selected" : undefined} aria-pressed={selected === index} onClick={() => setSelected(selected === index ? null : index)}><span className={`country-chart-swatch ${index === 0 ? "is-renewable" : "is-remainder"}`} aria-hidden="true" /><span>{part.name}<strong>{energyChartNumber(part.value, locale)} {composition.unit}</strong></span></button></li>)}
      </ul>
      {selectedPart ? <div className="country-chart-tooltip country-chart-tooltip-pinned" role="status"><button type="button" aria-label={copy.clear} onClick={() => setSelected(null)}><X size={14} aria-hidden="true" /></button><span>{selectedPart.name} · {composition.periodLabel}</span><strong>{exactChartNumber(selectedPart.value, locale)} {composition.unit}</strong>{selected === 1 ? <small>{copy.calculated}</small> : null}</div> : null}
    </div>
  );
}
