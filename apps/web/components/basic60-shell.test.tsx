import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Basic60Shell } from "@/components/basic60-shell";
import { LocaleProvider } from "@/lib/i18n/client";

const navigationState = vi.hoisted(() => ({ pathname: "/basic60/countries/BRA", query: "" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigationState.pathname,
  useSearchParams: () => new URLSearchParams(navigationState.query),
  useRouter: () => ({ refresh: vi.fn() }),
}));

describe("Basic60Shell", () => {
  beforeEach(() => {
    navigationState.pathname = "/basic60/countries/BRA";
    navigationState.query = "";
  });
  it("uses Chinese product branding while preserving the existing navigation and access control", () => {
    const { container } = render(<LocaleProvider initialLocale="zh-CN"><Basic60Shell><p>国家内容</p></Basic60Shell></LocaleProvider>);
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "首页" })).toHaveAttribute("href", "/basic60?country=BRA");
    expect(screen.getByRole("link", { name: "出海工具" })).toHaveAttribute("href", "/basic60/tools?country=BRA");
    expect(screen.getByRole("link", { name: "合作伙伴" })).toHaveAttribute("href", "/basic60/partners?country=BRA");
    expect(screen.queryByRole("link", { name: /国家比较/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /政策|AI|搜索/ })).not.toBeInTheDocument();
    expect(screen.getByText("中国新能源企业出海导航仪")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "退出登录" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Navigator" })).toHaveAttribute("href", "/basic60?country=BRA");
    expect(screen.getByText("Navigator · 中国新能源企业出海导航仪")).toBeInTheDocument();
    expect(screen.queryByText(/60国/)).not.toBeInTheDocument();
    expect(container).not.toHaveTextContent(/已审核|Basic|私有试用|非正式结论|D1|P0/i);
  });

  it("uses English product branding without internal release labels", () => {
    const { container } = render(<LocaleProvider initialLocale="en"><Basic60Shell><p>Country content</p></Basic60Shell></LocaleProvider>);

    expect(screen.getByText("Overseas Navigator for Chinese New Energy Companies")).toBeInTheDocument();
    expect(screen.queryByText(/60-country/)).not.toBeInTheDocument();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Navigator primary navigation" })).toBeInTheDocument();
    expect(screen.getByText("Navigator · Overseas navigation for Chinese new energy companies")).toBeInTheDocument();
    expect(within(screen.getByRole("navigation")).getAllByRole("link")).toHaveLength(3);
    expect(screen.getByRole("link", { name: "Partners" })).toHaveAttribute("href", "/basic60/partners?country=BRA");
    expect(container).not.toHaveTextContent(/reviewed|Basic|private trial|non-official|D1|P0/i);
  });

  it("keeps the private homepage unselected until a country is supplied", () => {
    navigationState.pathname = "/basic60";
    render(<LocaleProvider initialLocale="en"><Basic60Shell><h1>Home</h1></Basic60Shell></LocaleProvider>);
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/basic60");
    expect(screen.getByRole("link", { name: "Expansion tools" })).toHaveAttribute("href", "/basic60/tools");
    expect(screen.getByRole("link", { name: "Partners" })).toHaveAttribute("href", "/basic60/partners");
  });
});
