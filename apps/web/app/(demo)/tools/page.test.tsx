import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ToolsPage from "@/app/(demo)/tools/page";
import { LocaleProvider } from "@/lib/i18n";

const mocks = vi.hoisted(() => ({ query: "country=BRA" }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(mocks.query),
}));

vi.mock("@/hooks/use-demo-query", () => ({
  useDemoQuery: () => ({
    data: [
      {
        data_origin: "synthetic_demo",
        code: "IDN",
        name_zh: "印度尼西亚",
        name_en: "Indonesia",
      },
      {
        data_origin: "synthetic_demo",
        code: "BRA",
        name_zh: "巴西",
        name_en: "Brazil",
      },
    ],
    loading: false,
    error: null,
    reload: vi.fn(),
  }),
}));

describe("ToolsPage market journey", () => {
  beforeEach(() => {
    mocks.query = "country=BRA";
  });

  it("passes a valid requested market through every task entry", () => {
    render(
      <LocaleProvider initialLocale="zh-CN">
        <ToolsPage />
      </LocaleProvider>,
    );

    expect(screen.getByRole("combobox", { name: "当前演示市场" })).toHaveValue("BRA");
    expect(screen.getByRole("link", { name: /AI 出海助手/ })).toHaveAttribute(
      "href",
      "/tools/assistant?country=BRA",
    );
    expect(screen.getByRole("link", { name: /光储方案/ })).toHaveAttribute(
      "href",
      "/tools/solar-storage?country=BRA",
    );
    expect(screen.getByRole("link", { name: /可研报告/ })).toHaveAttribute(
      "href",
      "/tools/feasibility?country=BRA",
    );
    expect(screen.getByRole("link", { name: /项目招标/ })).toHaveAttribute(
      "href",
      "/tools/tenders?country=BRA",
    );
  });

  it("falls back to the first synthetic market for an invalid parameter", () => {
    mocks.query = "country=USA";
    render(
      <LocaleProvider initialLocale="en">
        <ToolsPage />
      </LocaleProvider>,
    );

    expect(screen.getByRole("combobox", { name: "Current demo market" })).toHaveValue("IDN");
    expect(screen.getByRole("link", { name: /AI Expansion Assistant/ })).toHaveAttribute(
      "href",
      "/tools/assistant?country=IDN",
    );
  });
});
