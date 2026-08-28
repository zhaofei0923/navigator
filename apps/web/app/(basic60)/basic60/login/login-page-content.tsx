"use client";

import { Compass, LockKeyhole } from "lucide-react";
import { Suspense } from "react";
import { Basic60LoginForm } from "@/components/basic60-login-form";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useLocale } from "@/lib/i18n/client";

const COPY = {
  "zh-CN": {
    scope: "中国新能源企业出海导航仪",
    title: "登录 Navigator",
    intro: "访问中国以外目标市场的国家档案、宏观指标与能源数据，开启出海市场研究。",
    sensitive: "请妥善保管访问口令，保护企业信息安全。",
    preparing: "正在准备安全访问表单…",
  },
  en: {
    scope: "Overseas Navigator for Chinese New Energy Companies",
    title: "Sign in to Navigator",
    intro: "Explore country profiles, macroeconomic indicators and energy data for target markets outside China.",
    sensitive: "Keep your access passphrase secure and protect your business information.",
    preparing: "Preparing the secure access form…",
  },
} as const;

export function Basic60LoginPageContent() {
  const { locale } = useLocale();
  const copy = COPY[locale];
  return (
    <main className="login-page basic60-login-page">
      <section className="login-panel" aria-labelledby="basic60-login-title">
        <div className="login-brand">
          <span className="brand-icon basic60-brand-icon" aria-hidden="true">
            <Compass size={30} strokeWidth={1.8} />
          </span>
          <span>
            Navigator
            <small className="login-scope">{copy.scope}</small>
          </span>
          <span className="login-language"><LanguageSwitcher /></span>
        </div>
        <h1 id="basic60-login-title">{copy.title}</h1>
        <p>{copy.intro}</p>
        <Suspense fallback={<p className="login-boundary">{copy.preparing}</p>}>
          <Basic60LoginForm />
        </Suspense>
        <p className="login-sensitive-note">
          <LockKeyhole size={15} aria-hidden="true" />
          <span>{copy.sensitive}</span>
        </p>
      </section>
    </main>
  );
}
