import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EmptyState, ErrorState, LoadingState } from "@/components/page-state";

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
});
