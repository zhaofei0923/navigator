import { CalendarClock } from "lucide-react";
import type { Basic60Locale, Basic60Meta } from "@/lib/basic60/types";

const COPY = {
  "zh-CN": { asOf: "数据截至" },
  en: { asOf: "Data as of" },
} as const;

export function Basic60ReleaseStrip({ meta, locale }: { meta: Basic60Meta; locale: Basic60Locale }) {
  const copy = COPY[locale];
  return (
    <dl className="basic60-release-strip" aria-label={copy.asOf}>
      <div><CalendarClock size={16} aria-hidden="true" /><dt>{copy.asOf}</dt><dd>{meta.as_of}</dd></div>
    </dl>
  );
}
