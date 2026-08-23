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
