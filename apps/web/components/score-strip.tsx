"use client";

import {
  Activity,
  BarChart3,
  Handshake,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import type { ComponentType } from "react";
import { useLocale } from "@/lib/i18n";
import type { CountryScores } from "@/lib/types";
import { SCORE_DIMENSIONS } from "@/lib/types";

const ICONS: Record<(typeof SCORE_DIMENSIONS)[number]["key"], ComponentType<{ size?: number }>> = {
  market_attractiveness: BarChart3,
  policy_certainty: ShieldCheck,
  project_activity: Activity,
  partner_maturity: Handshake,
  risk_controllability: TriangleAlert,
};

const COPY = {
  "zh-CN": {
    aria: "五维评分",
    dimensions: ["市场吸引力", "政策确定性", "项目活跃度", "合作伙伴成熟度", "风险可控性"],
    unavailable: "趋势未提供",
    previous: "较上期",
  },
  en: {
    aria: "Five-dimension scores",
    dimensions: ["Market attractiveness", "Policy certainty", "Project activity", "Partner maturity", "Risk controllability"],
    unavailable: "Trend unavailable",
    previous: "vs. previous",
  },
} as const;

export function ScoreStrip({
  scores,
  deltas,
}: {
  scores: CountryScores;
  deltas?: Partial<Record<(typeof SCORE_DIMENSIONS)[number]["key"], number>>;
}) {
  const { locale } = useLocale();
  const copy = COPY[locale];
  const numberFormat = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  return (
    <div className="score-strip" aria-label={copy.aria}>
      {SCORE_DIMENSIONS.map(({ key }, index) => {
        const Icon = ICONS[key];
        const delta = deltas?.[key];
        const risk = key === "risk_controllability";
        return (
          <div className="score-cell" key={key}>
            <div className={risk ? "score-label score-label-risk" : "score-label"}>
              <Icon size={18} aria-hidden="true" />
              <span>{copy.dimensions[index]}</span>
            </div>
            <p className={risk ? "score-value score-value-risk" : "score-value"}>
              <strong>{scores[key]}</strong><span>/100</span>
            </p>
            <p className={delta === undefined ? "score-trend score-trend-muted" : delta < 0 ? "score-trend score-trend-down" : "score-trend"}>
              {delta === undefined ? copy.unavailable : `${copy.previous} ${delta > 0 ? "+" : ""}${numberFormat.format(delta)}`}
            </p>
          </div>
        );
      })}
    </div>
  );
}
