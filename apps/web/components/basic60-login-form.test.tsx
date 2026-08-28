import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Basic60LoginForm } from "@/components/basic60-login-form";
import { LocaleProvider } from "@/lib/i18n/client";

const mocks = vi.hoisted(() => ({ expired: false }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(mocks.expired ? "expired=1" : ""),
}));

const INTERNAL_COPY = /Basic|已审核|私有试用|演示|reviewed|private.trial|demo|non-official/i;

describe.each([
  ["zh-CN", "访问口令", "进入 Navigator"],
  ["en", "Access passphrase", "Enter Navigator"],
] as const)("%s product access form", (locale, label, submit) => {
  beforeEach(() => {
    mocks.expired = false;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function renderForm() {
    return render(
      <LocaleProvider initialLocale={locale}>
        <Basic60LoginForm />
      </LocaleProvider>,
    );
  }

  it("shows a product session-expiry message without changing the access requirements", () => {
    mocks.expired = true;
    const { container } = renderForm();

    expect(screen.getByRole("alert")).toHaveTextContent(
      locale === "en"
        ? "Your session has expired. Sign in again."
        : "登录状态已过期，请重新登录。",
    );
    expect(screen.getByLabelText(label)).toBeRequired();
    expect(screen.getByLabelText(label)).toHaveAttribute("minLength", "12");
    expect(screen.getByRole("button", { name: submit })).toBeEnabled();
    expect(container).not.toHaveTextContent(INTERNAL_COPY);
  });

  it.each([
    [400, "请求格式无效。", "The request is invalid."],
    [401, "口令不正确。", "The passphrase is incorrect."],
    [503, "访问服务尚未配置，请联系管理员。", "Access is not configured. Contact your administrator."],
    [500, "暂时无法验证，请稍后重试。", "Unable to verify access. Try again shortly."],
  ] as const)("keeps the session request contract and product-facing error for %s", async (status, zh, en) => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status }));
    vi.stubGlobal("fetch", fetchMock);
    const { container } = renderForm();

    await user.type(screen.getByLabelText(label), "sample-access-passphrase");
    await user.click(screen.getByRole("button", { name: submit }));

    expect(await screen.findByRole("alert")).toHaveTextContent(locale === "en" ? en : zh);
    expect(fetchMock).toHaveBeenCalledWith("/basic60/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passphrase: "sample-access-passphrase" }),
    });
    expect(screen.getByRole("button", { name: submit })).toBeEnabled();
    expect(container).not.toHaveTextContent(INTERNAL_COPY);
  });

  it("uses a product-facing message after a network error", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connection failed")));
    const { container } = renderForm();

    await user.type(screen.getByLabelText(label), "sample-access-passphrase");
    await user.click(screen.getByRole("button", { name: submit }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      locale === "en"
        ? "Unable to verify access. Try again shortly."
        : "暂时无法验证，请稍后重试。",
    );
    expect(container).not.toHaveTextContent(INTERNAL_COPY);
  });
});
