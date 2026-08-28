import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "@/components/app-shell";
import { LocaleProvider } from "@/lib/i18n/client";

const refresh = vi.fn();
const navigationState = vi.hoisted(() => ({ pathname: "/countries/BRA", query: "" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigationState.pathname,
  useSearchParams: () => new URLSearchParams(navigationState.query),
  useRouter: () => ({ refresh }),
}));

describe("AppShell v2.1", () => {
  beforeEach(() => {
    navigationState.pathname = "/countries/BRA";
    navigationState.query = "";
  });
  it("exposes the current section, persistent demo boundary and controlled mobile navigation", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <LocaleProvider initialLocale="en">
        <AppShell>
          <h1>Country context</h1>
        </AppShell>
      </LocaleProvider>,
    );

    expect(screen.getByRole("link", { name: "Global Markets" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("note")).toHaveAccessibleName(
      "Demo Data / Non-official Conclusions: Internal preview only · No real sources connected",
    );
    expect(screen.getByRole("button", { name: "Leave internal demo" })).toBeInTheDocument();
    expect(container.querySelector("main#main-content")).toHaveTextContent("Country context");
    expect(container.querySelector(".app-frame-product")).toBeNull();

    const menuButton = screen.getByRole("button", { name: "Open navigation" });
    expect(menuButton).toHaveAttribute("aria-controls", "primary-navigation");
    await user.click(menuButton);
    expect(screen.getByRole("button", { name: "Close navigation" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Open navigation" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("uses product presentation with the complete navigation for approved data", () => {
    const { container } = render(
      <LocaleProvider initialLocale="zh-CN">
        <AppShell dataProfile="approved_basic60">
          <h1>出海目标市场数据</h1>
        </AppShell>
      </LocaleProvider>,
    );

    const navigation = screen.getByRole("navigation", { name: "主导航" });
    expect(container.querySelector(".app-frame")).toHaveClass("app-frame-product");
    expect(within(navigation).getAllByRole("link").map((link) => link.textContent)).toEqual([
      "首页",
      "出海工具",
      "合作伙伴",
    ]);
    expect(screen.getByRole("link", { name: "首页" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.queryByRole("link", { name: "全球市场" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "政策与风险" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "出海工具" })).toHaveAttribute("href", "/tools?country=BRA");
    expect(screen.getByRole("link", { name: "合作伙伴" })).toHaveAttribute(
      "href",
      "/partners?country=BRA",
    );
    expect(screen.getByRole("link", { name: /开始出海规划/ })).toHaveAttribute("href", "/?country=BRA#markets");
    expect(screen.getByRole("link", { name: "首页" })).toHaveAttribute("href", "/?country=BRA");
    expect(screen.getByText("中国新能源企业出海导航仪")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "退出内部演示" })).not.toBeInTheDocument();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    expect(screen.queryByText(/60国/)).not.toBeInTheDocument();
    expect(screen.queryByText("演示数据 / 非正式结论")).not.toBeInTheDocument();

    const footer = container.querySelector(".app-footer");
    expect(footer).not.toBeNull();
    expect(within(footer as HTMLElement).getByText("Navigator · 中国新能源企业出海导航仪")).toBeInTheDocument();
    expect(within(footer as HTMLElement).queryByText("合成演示来源")).not.toBeInTheDocument();
    expect(within(footer as HTMLElement).queryByText(/基线日期/)).not.toBeInTheDocument();
    expect(container).not.toHaveTextContent(/已审核|内部使用|BASIC60|私有试用|非正式结论/i);
  });

  it("describes the approved English scope without a fixed country count", () => {
    const { container } = render(
      <LocaleProvider initialLocale="en">
        <AppShell dataProfile="approved_basic60">
          <h1>Overseas markets</h1>
        </AppShell>
      </LocaleProvider>,
    );

    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    expect(screen.queryByText(/60-country/)).not.toBeInTheDocument();
    expect(screen.getByText("Navigator · Overseas navigation for Chinese new energy companies")).toBeInTheDocument();
    expect(container.querySelector(".app-frame")).toHaveClass("app-frame-product");
    const navigation = screen.getByRole("navigation", { name: "Main navigation" });
    expect(within(navigation).getAllByRole("link")).toHaveLength(3);
    expect(within(navigation).getByRole("link", { name: "Partners" })).toHaveAttribute("href", "/partners?country=BRA");
    expect(container).not.toHaveTextContent(/reviewed|internal use|BASIC60|private trial|non-official/i);
  });

  it("starts without an implicit country and points planning to the homepage map", () => {
    navigationState.pathname = "/";
    render(<LocaleProvider initialLocale="zh-CN"><AppShell dataProfile="approved_basic60"><h1>首页内容</h1></AppShell></LocaleProvider>);

    expect(screen.getByRole("link", { name: "出海工具" })).toHaveAttribute("href", "/tools");
    expect(screen.getByRole("link", { name: "合作伙伴" })).toHaveAttribute("href", "/partners");
    expect(screen.getByRole("link", { name: /开始出海规划/ })).toHaveAttribute("href", "/#markets");
  });

  it("updates all product navigation when the URL country changes", () => {
    navigationState.pathname = "/tools/assistant";
    navigationState.query = "country=bra";
    const view = <LocaleProvider initialLocale="en"><AppShell dataProfile="approved_basic60"><h1>Tools</h1></AppShell></LocaleProvider>;
    const { rerender } = render(view);

    expect(screen.getByRole("link", { name: "Partners" })).toHaveAttribute("href", "/partners?country=BRA");
    navigationState.query = "country=ZAF";
    rerender(<LocaleProvider initialLocale="en"><AppShell dataProfile="approved_basic60"><h1>Tools</h1></AppShell></LocaleProvider>);

    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/?country=ZAF");
    expect(screen.getByRole("link", { name: "Partners" })).toHaveAttribute("href", "/partners?country=ZAF");
    expect(screen.getByRole("link", { name: /Start Expansion Planning/ })).toHaveAttribute("href", "/?country=ZAF#markets");
  });

  it.each(["CHN", "CN", "bad-value"])("does not propagate invalid country context %s", (country) => {
    navigationState.pathname = "/partners";
    navigationState.query = new URLSearchParams({ country }).toString();
    render(<LocaleProvider initialLocale="en"><AppShell dataProfile="approved_basic60"><h1>Partners</h1></AppShell></LocaleProvider>);

    expect(screen.getByRole("link", { name: "Expansion Tools" })).toHaveAttribute("href", "/tools");
    expect(screen.getByRole("link", { name: /Start Expansion Planning/ })).toHaveAttribute("href", "/#markets");
  });

  it("preserves the Chinese synthetic-demo disclaimer and exit control", () => {
    render(
      <LocaleProvider initialLocale="zh-CN">
        <AppShell><h1>市场演示</h1></AppShell>
      </LocaleProvider>,
    );

    expect(screen.getByRole("note")).toHaveTextContent("演示数据 / 非正式结论");
    expect(screen.getByRole("button", { name: "退出内部演示" })).toBeInTheDocument();
    expect(screen.getByText("合成演示来源")).toBeInTheDocument();
  });
});
