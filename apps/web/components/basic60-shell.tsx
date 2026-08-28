"use client";

import { Compass, LogOut, Menu, Users, Wrench, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import { LanguageSwitcher } from "@/components/language-switcher";
import { navigationCountryCode } from "@/lib/approved-basic60/navigation";
import { useLocale } from "@/lib/i18n/client";
import { toolHref } from "@/lib/tool-journey";

const COPY = {
  "zh-CN": {
    brand: "中国新能源企业出海导航仪",
    home: "首页",
    tools: "出海工具",
    partners: "合作伙伴",
    navigation: "Navigator 主导航",
    open: "打开导航",
    close: "关闭导航",
    logout: "退出登录",
    footer: "Navigator · 中国新能源企业出海导航仪",
  },
  en: {
    brand: "Overseas Navigator for Chinese New Energy Companies",
    home: "Home",
    tools: "Expansion tools",
    partners: "Partners",
    navigation: "Navigator primary navigation",
    open: "Open navigation",
    close: "Close navigation",
    logout: "Sign out",
    footer: "Navigator · Overseas navigation for Chinese new energy companies",
  },
} as const;

const NAVIGATION = [
  { href: "/basic60", icon: Compass, key: "home" as const },
  { href: "/basic60/tools", icon: Wrench, key: "tools" as const },
  { href: "/basic60/partners", icon: Users, key: "partners" as const },
];

export function Basic60Shell({ children }: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const countryCode = navigationCountryCode(pathname, searchParams.get("country"));
  const { locale } = useLocale();
  const copy = COPY[locale];
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  async function logout() {
    setLoggingOut(true);
    await fetch("/basic60/api/session", { method: "DELETE" });
    window.location.replace("/basic60/login");
  }

  return (
    <div className="basic60-frame">
      <header className="basic60-header" onKeyDown={(event) => event.key === "Escape" && setMenuOpen(false)}>
        <Link href={toolHref("/basic60", countryCode ?? "")} className="basic60-brand" aria-label="Navigator">
          <Compass size={28} strokeWidth={1.7} aria-hidden="true" />
          <span>Navigator<small>{copy.brand}</small></span>
        </Link>
        <button
          className="basic60-menu-button"
          type="button"
          aria-expanded={menuOpen}
          aria-controls="basic60-navigation"
          aria-label={menuOpen ? copy.close : copy.open}
          onClick={() => setMenuOpen((value) => !value)}
        >
          {menuOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
        <nav
          id="basic60-navigation"
          className={menuOpen ? "basic60-nav basic60-nav-open" : "basic60-nav"}
          aria-label={copy.navigation}
        >
          {NAVIGATION.map(({ href, icon: Icon, key }) => (
            <Link
              key={href}
              href={toolHref(href, countryCode ?? "")}
              aria-current={
                (key === "home"
                  ? pathname === "/basic60" || pathname.startsWith("/basic60/countries/")
                  : pathname.startsWith(href))
                  ? "page"
                  : undefined
              }
              onClick={() => setMenuOpen(false)}
            >
              <Icon size={17} aria-hidden="true" /> {copy[key]}
            </Link>
          ))}
        </nav>
        <div className="basic60-header-actions">
          <LanguageSwitcher />
          <button
            className="icon-button basic60-logout"
            type="button"
            disabled={loggingOut}
            aria-label={copy.logout}
            title={copy.logout}
            onClick={logout}
          >
            <LogOut size={18} aria-hidden="true" />
          </button>
        </div>
      </header>
      <main id="basic60-main" className="basic60-content">{children}</main>
      <footer className="basic60-footer">
        <span>{copy.footer}</span>
      </footer>
    </div>
  );
}
