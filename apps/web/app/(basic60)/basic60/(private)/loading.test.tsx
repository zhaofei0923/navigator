import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Basic60Loading from "@/app/(basic60)/basic60/(private)/loading";

const getRequestLocale = vi.hoisted(() => vi.fn());
vi.mock("@/lib/i18n/server", () => ({ getRequestLocale }));

describe("market-data loading state", () => {
  it.each(["zh-CN", "en"] as const)("uses normal product copy in %s", async (locale) => {
    getRequestLocale.mockResolvedValue(locale);
    render(await Basic60Loading());

    expect(screen.getByRole("status")).toHaveTextContent(locale === "en" ? "Loading market data…" : "正在加载市场数据…");
    expect(screen.getByRole("status")).not.toHaveTextContent(/BASIC60|私有试用|private.?trial|审核|发布/i);
  });
});
