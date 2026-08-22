import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { formatDate } from "@/lib/format";
import type { SignalItem } from "@/lib/types";

const SIGNAL_DESTINATIONS: Record<string, string> = {
  policy: "/policies",
  risk: "/risks",
  opportunity: "/opportunities",
  project: "/opportunities",
  tender: "/tenders",
  partner: "/partners",
  政策: "/policies",
  风险: "/risks",
  机会: "/opportunities",
  项目: "/opportunities",
  招标: "/tenders",
  伙伴: "/partners",
};

function destination(category: string): string {
  return SIGNAL_DESTINATIONS[category.toLowerCase()] || "/opportunities";
}

export function SignalTimeline({ signals }: { signals: SignalItem[] }) {
  if (signals.length === 0) {
    return <p className="inline-empty">暂未提供机会动态。</p>;
  }

  return (
    <div className="table-scroll">
      <table className="data-table timeline-table">
        <thead>
          <tr>
            <th>时间</th>
            <th>类型</th>
            <th>标题</th>
            <th>置信度</th>
            <th><span className="sr-only">查看</span></th>
          </tr>
        </thead>
        <tbody>
          {signals.map((signal) => (
            <tr key={signal.signal_id}>
              <td className="timeline-date"><span aria-hidden="true" />{formatDate(signal.occurred_at)}</td>
              <td><span className="type-tag">{signal.category}</span></td>
              <td><strong>{signal.title}</strong><small>{signal.summary}</small></td>
              <td>{signal.confidence}%</td>
              <td>
                <Link className="table-action" href={`${destination(signal.category)}?country=${signal.country_code}`} aria-label={`查看 ${signal.title}`}>
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
