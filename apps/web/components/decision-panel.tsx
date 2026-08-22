import { CheckSquare2, SlidersHorizontal, TriangleAlert } from "lucide-react";
import type { ActionItem, ReasonItem, RiskItem } from "@/lib/types";

export function DecisionPanel({
  reasons,
  risks,
  actions,
}: {
  reasons: ReasonItem[];
  risks: RiskItem[];
  actions: ActionItem[];
}) {
  return (
    <aside className="decision-panel panel" aria-label="决策摘要">
      <DecisionSection title="进入理由" icon={<SlidersHorizontal size={20} />} tone="positive">
        <ul>
          {reasons.length ? reasons.slice(0, 3).map((item) => <li key={item.reason_id}>{item.detail}</li>) : <li>尚未提供进入理由。</li>}
        </ul>
      </DecisionSection>
      <DecisionSection title="主要风险" icon={<TriangleAlert size={20} />} tone="danger">
        <ul>
          {risks.length ? risks.slice(0, 3).map((item) => <li key={item.risk_id}><strong>{item.title}：</strong>{item.detail}</li>) : <li>尚未提供主要风险。</li>}
        </ul>
      </DecisionSection>
      <DecisionSection title="下一步动作" icon={<CheckSquare2 size={20} />} tone="positive">
        <ol>
          {actions.length ? actions.slice(0, 4).map((item) => <li key={item.action_id}><span>{item.priority}</span>{item.title}</li>) : <li><span>—</span>尚未提供下一步动作。</li>}
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
