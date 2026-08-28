import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarketOverviewRetry, MarketOverviewPrint } from "@/components/market-content-actions";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

describe("single-overview client actions", () => {
  beforeEach(() => { router.refresh.mockReset(); });
  afterEach(() => { vi.restoreAllMocks(); });
  it.each(["zh-CN", "en"] as const)("refreshes only the current route for a retry in %s", async (locale) => {
    render(<MarketOverviewRetry locale={locale} />);
    await userEvent.click(screen.getByRole("button", { name: locale === "en" ? "Reload" : "重新加载" }));
    expect(router.refresh).toHaveBeenCalledOnce();
  });
  it.each(["zh-CN", "en"] as const)("uses the browser print dialog without an export API in %s", async (locale) => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    render(<MarketOverviewPrint locale={locale} />);
    await userEvent.click(screen.getByRole("button", { name: locale === "en" ? "Print / Save as PDF" : "打印 / 保存为 PDF" }));
    expect(print).toHaveBeenCalledOnce();
    expect(router.refresh).not.toHaveBeenCalled();
  });
});
