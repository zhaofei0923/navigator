# Shared UI primitives

Framework context: Next.js 16 App Router with React 19 and TypeScript. The UI uses custom React components, vanilla global CSS, Lucide icons, and Recharts; there is no third-party component library or CSS framework.

This inventory is intentionally limited to reusable controls, page states, navigation primitives, and a compact shared visualization. Route-level compositions and application shells are documented in `layouts.md`; large page-specific or WebGL implementations remain discoverable through `pages.md` instead of being duplicated here.

## LanguageSwitcher

- File: `apps/web/components/language-switcher.tsx`
- Description: Compact bilingual toggle reused by the login experience and authenticated application header.
- Key props: `className?: string`

```tsx
"use client";

import { useLocale, useTranslations } from "@/lib/i18n/client";

export function LanguageSwitcher({ className = "" }: Readonly<{ className?: string }>) {
  const { locale, setLocale } = useLocale();
  const t = useTranslations();
  const nextLocale = locale === "zh-CN" ? "en" : "zh-CN";

  return (
    <button
      type="button"
      className={["button", "button-secondary", className].filter(Boolean).join(" ")}
      aria-label={
        nextLocale === "en" ? t("language.switchToEnglish") : t("language.switchToChinese")
      }
      title={nextLocale === "en" ? t("language.switchToEnglish") : t("language.switchToChinese")}
      onClick={() => setLocale(nextLocale)}
    >
      {locale === "zh-CN" ? <strong lang="zh-CN">中</strong> : <span lang="zh-CN">中</span>}
      <span aria-hidden="true"> / </span>
      {locale === "en" ? <strong lang="en">EN</strong> : <span lang="en">EN</span>}
    </button>
  );
}
```

## LoadingState, ErrorState, EmptyState

- File: `apps/web/components/page-state.tsx`
- Description: Shared localized loading, error/retry, and empty-state primitives used across demo routes and tool results.
- Key props: `LoadingState({ label? })`; `ErrorState({ message, retry? })`; `EmptyState({ message? })`

```tsx
"use client";

import { AlertTriangle, DatabaseZap, LoaderCircle, RefreshCw } from "lucide-react";
import { useLocale } from "@/lib/i18n";

const COPY = {
  "zh-CN": {
    loading: "正在加载合成演示数据…",
    error: "暂时无法显示",
    retry: "重新加载",
    empty: "当前筛选条件下没有演示记录。",
  },
  en: {
    loading: "Loading synthetic demo data…",
    error: "Unable to display this content",
    retry: "Reload",
    empty: "No demo records match the current filters.",
  },
} as const;

export function LoadingState({ label }: { label?: string }) {
  const { locale } = useLocale();
  return (
    <div className="page-state" role="status" aria-live="polite">
      <LoaderCircle className="spin" size={28} aria-hidden="true" />
      <p>{label ?? COPY[locale].loading}</p>
    </div>
  );
}

export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  const { locale } = useLocale();
  return (
    <div className="page-state page-state-error" role="alert">
      <AlertTriangle size={28} aria-hidden="true" />
      <div>
        <strong>{COPY[locale].error}</strong>
        <p>{message}</p>
      </div>
      {retry ? (
        <button className="button button-secondary" type="button" onClick={retry}>
          <RefreshCw size={16} aria-hidden="true" /> {COPY[locale].retry}
        </button>
      ) : null}
    </div>
  );
}

export function EmptyState({ message }: { message?: string }) {
  const { locale } = useLocale();
  return (
    <div className="page-state" role="status">
      <DatabaseZap size={28} aria-hidden="true" />
      <p>{message ?? COPY[locale].empty}</p>
    </div>
  );
}
```

## SectionTabs

- File: `apps/web/components/section-tabs.tsx`
- Description: Reusable localized link-tab navigation with the active route exposed through `aria-current`.
- Key props: `active: string`; `items: ReadonlyArray<{ href: string; label: string }>`

```tsx
"use client";

import Link from "next/link";
import { useLocale } from "@/lib/i18n";

export function SectionTabs({
  active,
  items,
}: {
  active: string;
  items: ReadonlyArray<{ href: string; label: string }>;
}) {
  const { locale } = useLocale();
  return (
    <nav className="section-tabs" aria-label={locale === "en" ? "Page categories" : "页面分类"}>
      {items.map((item) => (
        <Link key={item.href} href={item.href} aria-current={active === item.href ? "page" : undefined}>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
```

## RadarVisualization

- File: `apps/web/components/radar-visualization.tsx`
- Description: Shared responsive five-dimension radar visualization used by market detail and comparison views.
- Key props: `series: Array<{ key, name, scores }>`; `compact?: boolean`

```tsx
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
```
