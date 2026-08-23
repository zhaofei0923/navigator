import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EmptyState, ErrorState, LoadingState } from "@/components/page-state";
import { LocaleProvider } from "@/lib/i18n";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe("page states", () => {
  it("exposes loading and empty states to assistive technology", () => {
    render(<LoadingState label="正在准备测试数据…" />);
    expect(screen.getByRole("status")).toHaveTextContent("正在准备测试数据");
    render(<EmptyState />);
    expect(screen.getAllByRole("status")[1]).toHaveTextContent("没有演示记录");
  });

  it("allows a failed request to be retried", async () => {
    const retry = vi.fn();
    const user = userEvent.setup();
    render(<ErrorState message="连接失败" retry={retry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("连接失败");
    await user.click(screen.getByRole("button", { name: /重新加载/ }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("uses complete English defaults when the locale is English", () => {
    render(
      <LocaleProvider initialLocale="en">
        <LoadingState />
        <EmptyState />
        <ErrorState message="Connection failed" retry={() => undefined} />
      </LocaleProvider>,
    );

    expect(screen.getAllByRole("status")[0]).toHaveTextContent("Loading synthetic demo data");
    expect(screen.getAllByRole("status")[1]).toHaveTextContent("No demo records match");
    expect(screen.getByRole("alert")).toHaveTextContent("Unable to display this content");
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
  });
});
