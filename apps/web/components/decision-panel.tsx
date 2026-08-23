"use client";

import { CheckSquare2, SlidersHorizontal, TriangleAlert } from "lucide-react";
import { useLocale } from "@/lib/i18n";
import type { ActionItem, ReasonItem, RiskItem } from "@/lib/types";

const COPY = {
  "zh-CN": {
    aria: "决策摘要",
    reasons: "进入理由",
    noReasons: "尚未提供进入理由。",
    risks: "主要风险",
    noRisks: "尚未提供主要风险。",
    actions: "下一步动作",
    noActions: "尚未提供下一步动作。",
  },
  en: {
    aria: "Decision summary",
    reasons: "Why this market",
    noReasons: "No market-entry reasons are available.",
    risks: "Key risks",
    noRisks: "No key risks are available.",
    actions: "Next actions",
    noActions: "No next actions are available.",
  },
} as const;

export function DecisionPanel({
  reasons,
  risks,
  actions,
}: {
  reasons: ReasonItem[];
  risks: RiskItem[];
  actions: ActionItem[];
}) {
  const { locale } = useLocale();
  const copy = COPY[locale];
  return (
    <aside className="decision-panel panel" aria-label={copy.aria}>
      <DecisionSection title={copy.reasons} icon={<SlidersHorizontal size={20} />} tone="positive">
        <ul>
          {reasons.length ? reasons.slice(0, 3).map((item) => <li key={item.reason_id}>{item.detail}</li>) : <li>{copy.noReasons}</li>}
        </ul>
      </DecisionSection>
      <DecisionSection title={copy.risks} icon={<TriangleAlert size={20} />} tone="danger">
        <ul>
          {risks.length ? risks.slice(0, 3).map((item) => <li key={item.risk_id}><strong>{item.title}{locale === "en" ? ": " : "："}</strong>{item.detail}</li>) : <li>{copy.noRisks}</li>}
        </ul>
      </DecisionSection>
      <DecisionSection title={copy.actions} icon={<CheckSquare2 size={20} />} tone="positive">
        <ol>
          {actions.length ? actions.slice(0, 4).map((item) => <li key={item.action_id}><span>{item.priority}</span>{item.title}</li>) : <li><span>—</span>{copy.noActions}</li>}
        </ol>
      </DecisionSection>
    </aside>
  );
}

function DecisionSection({
  title,
  icon,
  tone,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  tone: "positive" | "danger";
  children: React.ReactNode;
}) {
  return (
    <section className={`decision-section decision-section-${tone}`}>
      <h2>{icon}{title}</h2>
      {children}
    </section>
  );
}
