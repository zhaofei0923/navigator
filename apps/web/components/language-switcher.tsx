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
