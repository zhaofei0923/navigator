"use client";

import { LoadingState } from "@/components/page-state";
import { useLocale } from "@/lib/i18n";

export default function Loading() {
  const { locale } = useLocale();
  return (
    <LoadingState
      label={locale === "en" ? "Preparing the internal demo…" : "正在准备内部演示…"}
    />
  );
}
