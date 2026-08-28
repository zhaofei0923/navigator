import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LoginPage from "@/app/login/page";

const mocks = vi.hoisted(() => ({
  hasValidDemoSession: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@/lib/demo-session", () => ({
  hasValidDemoSession: mocks.hasValidDemoSession,
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

vi.mock("@/app/login/login-page-content", () => ({
  LoginPageContent: () => <div data-testid="login-content" />,
}));

describe("LoginPage runtime profile", () => {
  beforeEach(() => {
    mocks.hasValidDemoSession.mockReset().mockResolvedValue(false);
    mocks.redirect.mockReset();
    delete process.env.NAVIGATOR_RUNTIME_PROFILE;
  });

  afterEach(() => {
    delete process.env.NAVIGATOR_RUNTIME_PROFILE;
  });

  it("keeps the synthetic login page by default", async () => {
    render(await LoginPage());

    expect(screen.getByTestId("login-content")).toBeInTheDocument();
    expect(mocks.hasValidDemoSession).toHaveBeenCalledOnce();
  });

  it("redirects approved BASIC60 directly without checking a Demo session", async () => {
    process.env.NAVIGATOR_RUNTIME_PROFILE = "approved_basic60_demo";

    expect(await LoginPage()).toBeNull();

    expect(mocks.redirect).toHaveBeenCalledWith("/");
    expect(mocks.hasValidDemoSession).not.toHaveBeenCalled();
  });
});
