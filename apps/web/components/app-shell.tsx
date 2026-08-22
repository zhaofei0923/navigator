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

const NAVIGATION = [
  { href: "/", label: "首页", matches: ["/"] },
  { href: "/countries", label: "国家", matches: ["/countries"] },
  { href: "/policies", label: "政策与风险", matches: ["/policies", "/risks"] },
  {
    href: "/opportunities",
    label: "项目与招标",
    matches: ["/opportunities", "/tenders"],
  },
  { href: "/partners", label: "伙伴", matches: ["/partners"] },
  { href: "/compare", label: "国家对比", matches: ["/compare"] },
] as const;

function isActive(pathname: string, matches: readonly string[]) {
  return matches.some((path) => (path === "/" ? pathname === "/" : pathname.startsWith(path)));
}

export function AppShell({ children }: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  async function logout() {
    setLoggingOut(true);
    await fetch("/api/session", { method: "DELETE" });
    window.location.replace("/login");
  }

  return (
    <div className="app-frame">
      <header className="app-header">
        <Link href="/" className="app-brand" aria-label="Navigator 首页">
          <Compass size={38} strokeWidth={1.65} aria-hidden="true" />
          <span>Navigator <b>新能源企业出海导航仪</b></span>
        </Link>
        <button
          className="mobile-menu-button"
          type="button"
          aria-label={menuOpen ? "关闭导航" : "打开导航"}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((value) => !value)}
        >
          {menuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
        <nav className={menuOpen ? "main-nav main-nav-open" : "main-nav"} aria-label="主导航">
          {NAVIGATION.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(pathname, item.matches) ? "page" : undefined}
              onClick={() => setMenuOpen(false)}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="header-actions">
          <Link className="button button-primary header-compare" href="/compare">
            开始对比 <ArrowRight size={17} aria-hidden="true" />
          </Link>
          <button
            className="icon-button header-logout"
            type="button"
            aria-label="退出内部演示"
            title="退出内部演示"
            disabled={loggingOut}
            onClick={logout}
          >
            <LogOut size={19} aria-hidden="true" />
          </button>
        </div>
      </header>
      <div className="demo-warning" role="note">
        <ShieldAlert size={18} aria-hidden="true" />
        <strong>演示数据 / 非正式结论</strong>
        <span>仅限内部展示 · 不连接真实来源</span>
      </div>
      <main className="app-content">{children}</main>
      <footer className="app-footer">
        <span>合成演示来源</span>
        <span aria-hidden="true">|</span>
        <span>基线日期：2026-08-22</span>
      </footer>
    </div>
  );
}
