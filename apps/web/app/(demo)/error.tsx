"use client";

import { ErrorState } from "@/components/page-state";

export default function ErrorBoundary({ reset }: { error: Error; reset: () => void }) {
  return (
    <section className="page-section">
      <ErrorState message="页面遇到异常，请重试。" retry={reset} />
    </section>
  );
}
