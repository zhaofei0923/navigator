"use client";

import { Compass, LockKeyhole, ShieldAlert } from "lucide-react";
import { Suspense } from "react";
import { LanguageSwitcher } from "@/components/language-switcher";
import { LoginForm } from "@/components/login-form";
import { useLocale, useTranslations } from "@/lib/i18n/client";

const COPY = {
  "zh-CN": {
    scope: "内部私有演示",
    sensitive:
      "请勿在口令框或后续工具中输入真实客户资料、项目秘密、生产口令或受限材料。",
  },
  en: {
    scope: "Private internal demo",
    sensitive:
      "Do not enter real client information, project secrets, production credentials or restricted material here or in any demo tool.",
  },
} as const;

export function LoginPageContent() {
  const t = useTranslations();
  const { locale } = useLocale();
  const copy = COPY[locale];

  return (
    <main className="login-page">
      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-brand">
          <span className="brand-icon" aria-hidden="true">
            <Compass size={32} strokeWidth={1.8} />
          </span>
          <span>
            Navigator
            <small className="login-scope">{copy.scope}</small>
          </span>
          <span className="login-language">
            <LanguageSwitcher />
          </span>
        </div>
        <h1 id="login-title">{t("login.title")}</h1>
        <p>{t("login.intro")}</p>
        <div className="login-notice" role="note" aria-labelledby="login-boundary-title">
          <div className="login-notice-heading">
            <ShieldAlert size={18} aria-hidden="true" />
            <strong id="login-boundary-title">{t("shell.demoNotice")}</strong>
          </div>
          <p className="login-notice-copy">{t("login.boundary")}</p>
        </div>
        <Suspense fallback={<p className="login-boundary">{t("login.preparing")}</p>}>
          <LoginForm />
        </Suspense>
        <p className="login-sensitive-note">
          <LockKeyhole size={15} aria-hidden="true" />
          <span>{copy.sensitive}</span>
        </p>
      </section>
    </main>
  );
}
