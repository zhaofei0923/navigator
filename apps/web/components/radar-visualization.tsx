"use client";

import {
  Legend,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import type { CountryScores } from "@/lib/types";
import { useLocale } from "@/lib/i18n";
import { SCORE_DIMENSIONS } from "@/lib/types";

type Series = { key: string; name: string; scores: CountryScores };

const COLORS = ["#079b98", "#1768d4", "#ef8d00", "#7b61c9"];
const DIMENSIONS = {
  "zh-CN": ["市场吸引力", "政策确定性", "项目活跃度", "合作伙伴成熟度", "风险可控性"],
  en: ["Market", "Policy", "Projects", "Partners", "Risk control"],
} as const;

export default function RadarVisualization({
  series,
  compact = false,
}: {
  series: Series[];
  compact?: boolean;
}) {
  const { locale } = useLocale();
  const data = SCORE_DIMENSIONS.map((dimension, index) => {
    const row: Record<string, string | number> = { dimension: DIMENSIONS[locale][index] };
    for (const item of series) row[item.key] = item.scores[dimension.key];
    return row;
  });

  return (
    <div className={compact ? "radar-chart radar-chart-compact" : "radar-chart"}>
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data} outerRadius={compact ? "65%" : "68%"}>
          <PolarGrid stroke="#d7dee8" />
          <PolarAngleAxis dataKey="dimension" tick={{ fill: "#344a67", fontSize: compact ? 10 : 12 }} />
          <PolarRadiusAxis angle={90} domain={[0, 100]} tickCount={6} tick={{ fill: "#607086", fontSize: 10 }} />
          <Tooltip
            formatter={(value) => [`${value}/100`, locale === "en" ? "Score" : "评分"]}
            contentStyle={{ border: "1px solid #d7dee8", borderRadius: 6, fontSize: 12 }}
          />
          {series.map((item, index) => (
            <Radar
              key={item.key}
              name={item.name}
              dataKey={item.key}
              stroke={COLORS[index % COLORS.length]}
              fill={COLORS[index % COLORS.length]}
              fillOpacity={series.length === 1 ? 0.2 : 0.06}
              strokeWidth={2}
              isAnimationActive
            />
          ))}
          {series.length > 1 ? <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} /> : null}
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}
