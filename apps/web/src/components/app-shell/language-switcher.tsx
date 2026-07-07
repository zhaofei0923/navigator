"use client";

import type { Locale } from "@navigator/shared-types/schema";
import { useTranslations } from "next-intl";
import NextLink from "next/link";
import { usePathname } from "next/navigation";

import { getLocaleCookieAssignment } from "../../i18n/locale-cookie";
import {
  getLocalizedPathname,
  locales,
} from "../../i18n/routing";

interface LanguageSwitcherProps {
  locale: Locale;
}

export function LanguageSwitcher({ locale }: LanguageSwitcherProps) {
  const pathname = usePathname();
  const t = useTranslations("locale");

  return (
    <div aria-label={t("label")} className="language-switcher">
      {locales.map((targetLocale) => (
        <NextLink
          aria-current={targetLocale === locale ? "page" : undefined}
          className="language-link"
          href={getLocalizedPathname(pathname, targetLocale)}
          key={targetLocale}
          onClick={() => {
            document.cookie = getLocaleCookieAssignment(targetLocale);
          }}
        >
          {targetLocale === "zh-CN" ? t("zhCN") : t("en")}
        </NextLink>
      ))}
    </div>
  );
}
