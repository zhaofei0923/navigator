"use client";

import {
  ArrowRight,
  Compass,
  LogOut,
  Menu,
  ShieldAlert,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import { LanguageSwitcher } from "@/components/language-switcher";
import { homeMarketHref, navigationCountryCode } from "@/lib/approved-basic60/navigation";
import { formatDate } from "@/lib/format";
import { useLocale, useTranslations } from "@/lib/i18n/client";
import type { TranslationKey } from "@/lib/i18n/dictionary";
import { toolHref } from "@/lib/tool-journey";

const DEMO_NAVIGATION = [
  { href: "/", labelKey: "nav.home", matches: ["/"] },
  { href: "/countries", labelKey: "nav.markets", matches: ["/countries"] },
  { href: "/policies", labelKey: "nav.policyRisk", matches: ["/policies", "/risks"] },
  {
    href: "/tools",
    labelKey: "nav.tools",
    matches: ["/tools", "/opportunities", "/tenders"],
  },
  { href: "/partners", labelKey: "nav.partners", matches: ["/partners"] },
] as const satisfies readonly {
  href: string;
  labelKey: TranslationKey;
  matches: readonly string[];
}[];

const PRODUCT_NAVIGATION = [
  { href: "/", labelKey: "nav.home", matches: ["/", "/countries"] },
  { href: "/tools", labelKey: "nav.tools", matches: ["/tools"] },
  { href: "/partners", labelKey: "nav.partners", matches: ["/partners"] },
] as const satisfies readonly {
  href: string;
  labelKey: TranslationKey;
  matches: readonly string[];
}[];

const APPROVED_BASIC60_COPY = {
  "zh-CN": {
    brand: "中国新能源企业出海导航仪",
    home: "Navigator 中国新能源企业出海导航仪首页",
    footer: "Navigator · 中国新能源企业出海导航仪",
  },
  en: {
    brand: "Overseas Navigator for Chinese New Energy Companies",
    home: "Navigator home for Chinese new energy companies",
    footer: "Navigator · Overseas navigation for Chinese new energy companies",
  },
} as const;

export type AppShellDataProfile = "synthetic_demo" | "approved_basic60";

function isActive(pathname: string, matches: readonly string[]) {
  return matches.some((path) => (path === "/" ? pathname === "/" : pathname.startsWith(path)));
}

export function AppShell({
  children,
  dataProfile = "synthetic_demo",
}: Readonly<{
  children: React.ReactNode;
  dataProfile?: AppShellDataProfile;
}>) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useTranslations();
  const { locale } = useLocale();
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const isApprovedBasic60 = dataProfile === "approved_basic60";
  const approvedCopy = APPROVED_BASIC60_COPY[locale];
  const countryCode = isApprovedBasic60
    ? navigationCountryCode(pathname, searchParams.get("country"))
    : null;
  const navigation = isApprovedBasic60 ? PRODUCT_NAVIGATION : DEMO_NAVIGATION;
  const homeHref = isApprovedBasic60 ? toolHref("/", countryCode ?? "") : "/";

  async function logout() {
    setLoggingOut(true);
    await fetch("/api/session", { method: "DELETE" });
    window.location.replace("/login");
  }

  return (
    <div className={isApprovedBasic60 ? "app-frame app-frame-product" : "app-frame"}>
      <header
        className="app-header"
        onKeyDown={(event) => {
          if (event.key === "Escape") setMenuOpen(false);
        }}
      >
        <Link href={homeHref} className="app-brand" aria-label={isApprovedBasic60 ? approvedCopy.home : t("shell.brandHomeAria")}>
          <Compass size={34} strokeWidth={1.65} aria-hidden="true" />
          <span>Navigator <b>{isApprovedBasic60 ? approvedCopy.brand : t("brand.tagline")}</b></span>
        </Link>
        <button
          className="mobile-menu-button"
          type="button"
          aria-label={menuOpen ? t("shell.closeNavigation") : t("shell.openNavigation")}
          aria-expanded={menuOpen}
          aria-controls="primary-navigation"
          onClick={() => setMenuOpen((value) => !value)}
        >
          {menuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
        <nav
          id="primary-navigation"
          className={menuOpen ? "main-nav main-nav-open" : "main-nav"}
          aria-label={t("shell.mainNavigation")}
        >
          {navigation.map((item) => (
            <Link
              key={item.href}
              href={isApprovedBasic60 ? toolHref(item.href, countryCode ?? "") : item.href}
              aria-current={isActive(pathname, item.matches) ? "page" : undefined}
              onClick={() => setMenuOpen(false)}
            >
              {t(item.labelKey)}
            </Link>
          ))}
        </nav>
        <div className="header-actions">
          <LanguageSwitcher />
          <Link className="button button-primary header-compare" href={isApprovedBasic60 ? homeMarketHref(countryCode) : "/tools"}>
            {t("shell.startPlanning")} {" "}
            <ArrowRight size={17} aria-hidden="true" />
          </Link>
          {isApprovedBasic60 ? null : (
            <button
              className="icon-button header-logout"
              type="button"
              aria-label={t("shell.logout")}
              title={t("shell.logout")}
              disabled={loggingOut}
              onClick={logout}
            >
              <LogOut size={19} aria-hidden="true" />
            </button>
          )}
        </div>
      </header>
      {isApprovedBasic60 ? null : (
        <div
          className="demo-warning"
          role="note"
          aria-label={`${t("shell.demoNotice")}: ${t("shell.demoBoundary")}`}
        >
          <ShieldAlert size={18} aria-hidden="true" />
          <strong>{t("shell.demoNotice")}</strong>
          <span>{t("shell.demoBoundary")}</span>
        </div>
      )}
      <main id="main-content" className="app-content">{children}</main>
      <footer className="app-footer">
        {isApprovedBasic60 ? (
          <span>{approvedCopy.footer}</span>
        ) : (
          <>
            <span>{t("shell.syntheticSource")}</span>
            <span aria-hidden="true">|</span>
            <span>{t("shell.baselineDate", { date: formatDate("2026-08-22", locale) })}</span>
          </>
        )}
      </footer>
    </div>
  );
}
