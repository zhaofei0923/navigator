import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoginForm } from "@/components/login-form";
import { LocaleProvider } from "@/lib/i18n/client";

const refresh = vi.fn();
let expired = false;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
  useSearchParams: () => new URLSearchParams(expired ? "expired=1" : ""),
}));

function renderForm(locale: "zh-CN" | "en" = "en") {
  return render(
    <LocaleProvider initialLocale={locale}>
      <LoginForm />
    </LocaleProvider>,
  );
}

describe("LoginForm", () => {
  afterEach(() => {
    expired = false;
    vi.unstubAllGlobals();
  });

  it("localizes an expired-session notice", () => {
    expired = true;
    renderForm();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Your demo session has ended. Enter the passphrase again.",
    );
  });

  it("provides a stable hidden username hint for password managers", () => {
    const { container } = renderForm();
    expect(container.querySelector('input[autocomplete="username"]')).toHaveValue(
      "navigator-demo",
    );
  });

  it("maps server status to a localized error without echoing server text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "不应直接回显的服务端文本" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText("Shared demo passphrase"), "wrong-passphrase");
    await user.click(screen.getByRole("button", { name: /Enter Internal Demo/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The demo passphrase is incorrect.",
    );
    expect(screen.queryByText("不应直接回显的服务端文本")).not.toBeInTheDocument();
  });
});
