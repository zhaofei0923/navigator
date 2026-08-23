"use client";

import { ErrorState } from "@/components/page-state";
import { useLocale } from "@/lib/i18n";

export default function ErrorBoundary({ reset }: { error: Error; reset: () => void }) {
  const { locale } = useLocale();
  return (
    <section className="page-section">
      <ErrorState
        message={locale === "en" ? "This page encountered an error. Please try again." : "页面遇到异常，请重试。"}
        retry={reset}
      />
    </section>
  );
}
