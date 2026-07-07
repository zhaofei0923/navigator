import type { Locale } from "@navigator/shared-types/schema";
import { useTranslations } from "next-intl";
import { Suspense } from "react";

import { Link } from "../../i18n/navigation";
import { LanguageSwitcher } from "./language-switcher";
import { MAIN_NAV_ITEMS } from "./nav-items";

interface AppShellProps {
  children: React.ReactNode;
  locale: Locale;
}

export function AppShell({ children, locale }: AppShellProps) {
  const nav = useTranslations("nav");
  const shell = useTranslations("shell");
  const localeText = useTranslations("locale");

  return (
    <div className="app-shell">
      <header className="topbar">
        <Link className="brand" href="/">
          <span aria-hidden className="brand-mark" />
          <span>
            <span className="brand-name">{shell("productName")}</span>
            <span className="brand-tagline">{shell("tagline")}</span>
          </span>
        </Link>
        <nav aria-label={nav("label")} className="main-nav">
          {MAIN_NAV_ITEMS.map((item) => (
            <Link className="main-nav-link" href={item.href} key={item.href}>
              {nav(item.labelKey.replace("nav.", ""))}
            </Link>
          ))}
        </nav>
        <Suspense
          fallback={
            <div
              aria-label={localeText("label")}
              className="language-switcher"
            />
          }
        >
          <LanguageSwitcher locale={locale} />
        </Suspense>
      </header>
      <main>{children}</main>
    </div>
  );
}
