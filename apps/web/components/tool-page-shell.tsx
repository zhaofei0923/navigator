"use client";

import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bot,
  DatabaseZap,
  LoaderCircle,
  ShieldAlert,
} from "lucide-react";
import type { ReactNode } from "react";
import { useLocale } from "@/lib/i18n";
import {
  TOOL_JOURNEY_IDS,
  TOOL_PATHS,
  toolHref,
  type JourneyStep,
  type RelatedAction,
  type ToolMarket,
} from "@/lib/tool-journey";

const JOURNEY_COPY = {
  "zh-CN": {
    back: "返回出海工具",
    boundary: "受控合成演示：请勿输入真实客户资料、项目秘密或受限材料。",
    journey: "当前任务流程",
    market: "当前演示市场",
    next: "继续完成任务",
    limit:
      "结果仅用于内部演示和任务准备，不构成投资、工程、法律、财务或正式投标结论。请在任何实际使用前补充真实证据并完成授权复核。",
    steps: {
      assistant: "AI 判断",
      "solar-storage": "光储方案",
      feasibility: "可研草案",
      tenders: "投标准备",
    },
  },
  en: {
    back: "Back to expansion tools",
    boundary:
      "Controlled synthetic demonstration. Do not enter real client information, project secrets or restricted material.",
    journey: "Current task journey",
    market: "Current demo market",
    next: "Continue the task",
    limit:
      "Results support internal demonstration and task preparation only. They are not investment, engineering, legal, financial or formal bid conclusions. Add real evidence and complete authorised review before any actual use.",
    steps: {
      assistant: "AI assessment",
      "solar-storage": "Solar & storage",
      feasibility: "Feasibility draft",
      tenders: "Tender readiness",
    },
  },
} as const;

type ToolPageShellProps = Readonly<{
  eyebrow: string;
  title: string;
  description: string;
  currentStep: JourneyStep;
  market?: ToolMarket | null;
  relatedActions?: readonly RelatedAction[];
  children: ReactNode;
}>;

export function ToolPageShell({
  eyebrow,
  title,
  description,
  currentStep,
  market,
  relatedActions = [],
  children,
}: ToolPageShellProps) {
  const { locale } = useLocale();
  const copy = JOURNEY_COPY[locale];
  const marketCode = market?.code ?? "";
  return (
    <section className="tool-page">
      <Link className="back-link" href={toolHref("/tools", marketCode)}>
        <ArrowLeft size={16} aria-hidden="true" />
        {copy.back}
      </Link>

      <div className="tool-page-intro">
        <header className="tool-page-heading">
          <span className="section-kicker">{eyebrow}</span>
          <h1>{title}</h1>
          <p>{description}</p>
        </header>
        {market ? (
          <div className="tool-market-context" aria-label={copy.market}>
            <span>{copy.market}</span>
            <strong>{market.code} · {market.name}</strong>
          </div>
        ) : null}
      </div>

      <nav className="tool-journey" aria-label={copy.journey}>
        <ol>
          {TOOL_JOURNEY_IDS.map((step, index) => {
            const active = step === currentStep;
            return (
              <li className={active ? "active" : undefined} key={step}>
                <Link
                  href={toolHref(TOOL_PATHS[step], marketCode)}
                  aria-current={active ? "step" : undefined}
                >
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{copy.steps[step]}</strong>
                </Link>
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="tool-boundary" role="note">
        <ShieldAlert size={18} aria-hidden="true" />
        <span>{copy.boundary}</span>
      </div>
      {children}

      <div className="tool-limit-note" role="note">
        <AlertTriangle size={18} aria-hidden="true" />
        <p>{copy.limit}</p>
      </div>

      {relatedActions.length ? (
        <section className="tool-next-actions" aria-labelledby="tool-next-actions-title">
          <div>
            <span className="section-kicker">NEXT</span>
            <h2 id="tool-next-actions-title">{copy.next}</h2>
          </div>
          <div className="tool-next-action-links">
            {relatedActions.map((action) => (
              <Link
                className={action.primary ? "button button-primary" : "button button-secondary"}
                href={action.href}
                key={`${action.href}-${action.label}`}
              >
                {action.label} <ArrowRight size={16} aria-hidden="true" />
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </section>
  );
}

export function ToolResultState({
  status,
  message,
}: Readonly<{
  status: "empty" | "loading" | "error";
  message: string;
}>) {
  const Icon = status === "loading" ? LoaderCircle : status === "error" ? AlertTriangle : DatabaseZap;
  return (
    <div
      className={`tool-result-empty tool-result-state-${status}`}
      role={status === "error" ? "alert" : "status"}
      aria-live="polite"
    >
      <Icon className={status === "loading" ? "spin" : undefined} size={34} aria-hidden="true" />
      <p>{message}</p>
    </div>
  );
}

export function ControlledAiBadge() {
  const { locale } = useLocale();
  return (
    <span className="controlled-ai-badge">
      <Bot size={15} aria-hidden="true" />
      {locale === "en" ? "Controlled template · No free-form chat" : "受控模板 · 非自由对话"}
    </span>
  );
}

export function ResultList({
  title,
  items,
  ordered = false,
}: {
  title: string;
  items: string[];
  ordered?: boolean;
}) {
  if (!items.length) return null;
  const List = ordered ? "ol" : "ul";
  return (
    <section className="tool-result-section">
      <h3>{title}</h3>
      <List>
        {items.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}
      </List>
    </section>
  );
}
