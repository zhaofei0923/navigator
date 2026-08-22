import {
  Activity,
  BarChart3,
  Handshake,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import type { ComponentType } from "react";
import type { CountryScores } from "@/lib/types";
import { SCORE_DIMENSIONS } from "@/lib/types";

const ICONS: Record<(typeof SCORE_DIMENSIONS)[number]["key"], ComponentType<{ size?: number }>> = {
  market_attractiveness: BarChart3,
  policy_certainty: ShieldCheck,
  project_activity: Activity,
  partner_maturity: Handshake,
  risk_controllability: TriangleAlert,
};

export function ScoreStrip({
  scores,
  deltas,
}: {
  scores: CountryScores;
  deltas?: Partial<Record<(typeof SCORE_DIMENSIONS)[number]["key"], number>>;
}) {
  return (
    <div className="score-strip" aria-label="五维评分">
      {SCORE_DIMENSIONS.map(({ key, label }) => {
        const Icon = ICONS[key];
        const delta = deltas?.[key];
        const risk = key === "risk_controllability";
        return (
          <div className="score-cell" key={key}>
            <div className={risk ? "score-label score-label-risk" : "score-label"}>
              <Icon size={18} aria-hidden="true" />
              <span>{label}</span>
            </div>
            <p className={risk ? "score-value score-value-risk" : "score-value"}>
              <strong>{scores[key]}</strong><span>/100</span>
            </p>
            <p className={delta === undefined ? "score-trend score-trend-muted" : delta < 0 ? "score-trend score-trend-down" : "score-trend"}>
              {delta === undefined ? "趋势未提供" : `较上期 ${delta > 0 ? "+" : ""}${delta}`}
            </p>
          </div>
        );
      })}
    </div>
  );
}
