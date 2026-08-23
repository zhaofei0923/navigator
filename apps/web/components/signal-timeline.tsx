"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { formatDate } from "@/lib/format";
import { useLocale } from "@/lib/i18n";
import type { SignalItem } from "@/lib/types";

const SIGNAL_DESTINATIONS: Record<string, string> = {
  policy: "/policies",
  risk: "/risks",
  opportunity: "/opportunities",
  project: "/opportunities",
  tender: "/tools/tenders",
  partner: "/partners",
  政策: "/policies",
  风险: "/risks",
  机会: "/opportunities",
  项目: "/opportunities",
  招标: "/tools/tenders",
  伙伴: "/partners",
};

const COPY = {
  "zh-CN": {
    empty: "暂未提供机会动态。",
    date: "时间",
    type: "类型",
    title: "标题",
    confidence: "置信度",
    view: "查看",
    viewItem: (title: string) => `查看 ${title}`,
  },
  en: {
    empty: "No opportunity signals are available.",
    date: "Date",
    type: "Type",
    title: "Signal",
    confidence: "Confidence",
    view: "View",
    viewItem: (title: string) => `View ${title}`,
  },
} as const;

const CATEGORY_LABELS: Readonly<Record<string, { "zh-CN": string; en: string }>> = {
  policy: { "zh-CN": "政策", en: "Policy" },
  risk: { "zh-CN": "风险", en: "Risk" },
  opportunity: { "zh-CN": "机会", en: "Opportunity" },
  project: { "zh-CN": "项目", en: "Project" },
  tender: { "zh-CN": "招标", en: "Tender" },
  partner: { "zh-CN": "伙伴", en: "Partner" },
  demand: { "zh-CN": "需求", en: "Demand" },
  delivery: { "zh-CN": "交付", en: "Delivery" },
  localization: { "zh-CN": "本地化", en: "Localization" },
  grid: { "zh-CN": "电网", en: "Grid" },
  commercial: { "zh-CN": "商业", en: "Commercial" },
  finance: { "zh-CN": "融资", en: "Finance" },
  critical_power: { "zh-CN": "关键电力", en: "Critical power" },
  market: { "zh-CN": "市场", en: "Market" },
};

function destination(category: string): string {
  return SIGNAL_DESTINATIONS[category.toLowerCase()] || "/opportunities";
}

export function SignalTimeline({ signals }: { signals: SignalItem[] }) {
  const { locale } = useLocale();
  const copy = COPY[locale];
  if (signals.length === 0) {
    return <p className="inline-empty">{copy.empty}</p>;
  }

  return (
    <div className="table-scroll">
      <table className="data-table timeline-table">
        <thead>
          <tr>
            <th>{copy.date}</th>
            <th>{copy.type}</th>
            <th>{copy.title}</th>
            <th>{copy.confidence}</th>
            <th><span className="sr-only">{copy.view}</span></th>
          </tr>
        </thead>
        <tbody>
          {signals.map((signal) => (
            <tr key={signal.signal_id}>
              <td className="timeline-date"><span aria-hidden="true" />{formatDate(signal.occurred_at, locale)}</td>
              <td><span className="type-tag">{CATEGORY_LABELS[signal.category]?.[locale] ?? signal.category}</span></td>
              <td><strong>{signal.title}</strong><small>{signal.summary}</small></td>
              <td>{signal.confidence}%</td>
              <td>
                <Link className="table-action" href={`${destination(signal.category)}?country=${signal.country_code}`} aria-label={copy.viewItem(signal.title)}>
                  <ArrowRight size={17} aria-hidden="true" />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
