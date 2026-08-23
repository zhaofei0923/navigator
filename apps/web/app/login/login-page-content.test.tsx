import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoginPageContent } from "@/app/login/login-page-content";
import { LocaleProvider } from "@/lib/i18n/client";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
  useSearchParams: () => new URLSearchParams(),
}));

function renderLogin(locale: "zh-CN" | "en" = "en") {
  return render(
    <LocaleProvider initialLocale={locale}>
      <LoginPageContent />
    </LocaleProvider>,
  );
}

describe("LoginPageContent v2.1", () => {
  beforeEach(() => {
    refresh.mockClear();
    document.cookie = "navigator_locale=; Path=/; Max-Age=0";
  });

  it("keeps the entry focused on one shared-passphrase action and explicit boundaries", () => {
    const { container } = renderLogin();

    expect(screen.getByText("Private internal demo")).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("Demo Data / Non-official Conclusions");
    expect(screen.getByRole("note")).toHaveTextContent("does not connect to external data");
    expect(screen.getByLabelText("Shared demo passphrase")).toBeRequired();
    expect(screen.getByRole("button", { name: /Enter Internal Demo/ })).toBeInTheDocument();
    expect(container.querySelectorAll(".button-primary")).toHaveLength(1);
    expect(screen.getByText(/Do not enter real client information/)).toBeInTheDocument();
  });

  it("preserves the typed passphrase while switching the interface language", async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText("Shared demo passphrase"), "demo-passphrase");
    await user.click(screen.getByRole("button", { name: "Switch to Chinese" }));

    expect(screen.getByLabelText("共享演示口令")).toHaveValue("demo-passphrase");
    expect(screen.getByText("内部私有演示")).toBeInTheDocument();
    expect(screen.getByText(/请勿在口令框或后续工具中输入真实客户资料/)).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledOnce();
  });
});
