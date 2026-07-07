"use client";

import type { Locale } from "@navigator/shared-types/schema";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";

import { Link, usePathname } from "../../i18n/navigation";
import { locales } from "../../i18n/routing";

interface LanguageSwitcherProps {
  locale: Locale;
}

export function LanguageSwitcher({ locale }: LanguageSwitcherProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useTranslations("locale");
  const query = searchParams.toString();
  const currentPath = query === "" ? pathname : `${pathname}?${query}`;

  return (
    <div aria-label={t("label")} className="language-switcher">
      {locales.map((targetLocale) => (
        <Link
          aria-current={targetLocale === locale ? "page" : undefined}
          className="language-link"
          href={currentPath}
          key={targetLocale}
          locale={targetLocale}
        >
          {targetLocale === "zh-CN" ? t("zhCN") : t("en")}
        </Link>
      ))}
    </div>
  );
}
