import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Basic60LoginPageContent } from "@/app/(basic60)/basic60/login/login-page-content";
import { LocaleProvider } from "@/lib/i18n/client";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

describe("Basic60LoginPageContent market scope", () => {
  it("uses bilingual product branding without changing the access form", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <LocaleProvider initialLocale="zh-CN">
        <Basic60LoginPageContent />
      </LocaleProvider>,
    );

    expect(screen.getByText("中国新能源企业出海导航仪")).toBeInTheDocument();
    expect(screen.getByText(/访问中国以外目标市场/)).toBeInTheDocument();
    expect(screen.queryByText(/60国/)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "登录 Navigator" })).toBeInTheDocument();
    expect(screen.getByLabelText("访问口令")).toBeRequired();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    expect(container).not.toHaveTextContent(/已审核|Basic|演示|Demo|私有试用|非正式|D1|P0/i);

    await user.click(screen.getByRole("button", { name: "切换到英文" }));

    expect(screen.getByText("Overseas Navigator for Chinese New Energy Companies")).toBeInTheDocument();
    expect(screen.getByText(/target markets outside China/)).toBeInTheDocument();
    expect(screen.queryByText(/60-country/)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sign in to Navigator" })).toBeInTheDocument();
    expect(screen.getByLabelText("Access passphrase")).toBeRequired();
    expect(container).not.toHaveTextContent(/reviewed|Basic|demo|trial|non-official|D1|P0/i);
  });
});
