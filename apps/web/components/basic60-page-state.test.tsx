import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Basic60EmptyState, Basic60ErrorState } from "@/components/basic60-page-state";

describe("Basic60 page states", () => {
  it.each(["zh-CN", "en"] as const)("shows a retry message without backend details in %s", (locale) => {
    const message = "BASIC60_NO_ACTIVE_RELEASE: 私有试用发布门禁 pending; 契约错误";
    render(<Basic60ErrorState message={message} locale={locale} />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(locale === "en" ? "Data is temporarily unavailable" : "暂时无法加载数据");
    expect(alert).toHaveTextContent(locale === "en" ? "Please refresh the page or try again later." : "请刷新页面重试，或稍后再试。");
    expect(alert).not.toHaveTextContent(/BASIC60|Basic|私有试用|发布|门禁|pending|契约|private.?trial/i);
  });

  it.each(["zh-CN", "en"] as const)("uses a normal empty-search hint in %s", (locale) => {
    render(<Basic60EmptyState locale={locale} />);

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(locale === "en" ? "No countries match your filters." : "没有符合筛选条件的国家");
    expect(status).not.toHaveTextContent(/Basic|发布|Published|审核|Approved/i);
  });
});
