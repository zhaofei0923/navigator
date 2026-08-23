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
