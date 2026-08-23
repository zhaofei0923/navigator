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
import { usePathname } from "next/navigation";
import { useState } from "react";
import { LanguageSwitcher } from "@/components/language-switcher";
import { formatDate } from "@/lib/format";
import { useLocale, useTranslations } from "@/lib/i18n/client";
import type { TranslationKey } from "@/lib/i18n/dictionary";

const NAVIGATION = [
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

function isActive(pathname: string, matches: readonly string[]) {
  return matches.some((path) => (path === "/" ? pathname === "/" : pathname.startsWith(path)));
}

export function AppShell({ children }: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  const t = useTranslations();
  const { locale } = useLocale();
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  async function logout() {
    setLoggingOut(true);
    await fetch("/api/session", { method: "DELETE" });
    window.location.replace("/login");
  }

  return (
    <div className="app-frame">
      <header
        className="app-header"
        onKeyDown={(event) => {
          if (event.key === "Escape") setMenuOpen(false);
        }}
      >
        <Link href="/" className="app-brand" aria-label={t("shell.brandHomeAria")}>
          <Compass size={34} strokeWidth={1.65} aria-hidden="true" />
          <span>Navigator <b>{t("brand.tagline")}</b></span>
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
          {NAVIGATION.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(pathname, item.matches) ? "page" : undefined}
              onClick={() => setMenuOpen(false)}
            >
              {t(item.labelKey)}
            </Link>
          ))}
        </nav>
        <div className="header-actions">
          <LanguageSwitcher />
          <Link className="button button-primary header-compare" href="/tools">
            {t("shell.startPlanning")} <ArrowRight size={17} aria-hidden="true" />
          </Link>
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
        </div>
      </header>
      <div
        className="demo-warning"
        role="note"
        aria-label={`${t("shell.demoNotice")}: ${t("shell.demoBoundary")}`}
      >
        <ShieldAlert size={18} aria-hidden="true" />
        <strong>{t("shell.demoNotice")}</strong>
        <span>{t("shell.demoBoundary")}</span>
      </div>
      <main id="main-content" className="app-content">{children}</main>
      <footer className="app-footer">
        <span>{t("shell.syntheticSource")}</span>
        <span aria-hidden="true">|</span>
        <span>{t("shell.baselineDate", { date: formatDate("2026-08-22", locale) })}</span>
      </footer>
    </div>
  );
}
