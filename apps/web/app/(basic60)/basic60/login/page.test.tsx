import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LoginPage from "@/app/(basic60)/basic60/login/page";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  redirect: vi.fn((href: string) => { throw new Error("redirect:" + href); }),
}));
vi.mock("@/lib/basic60/session", () => ({ hasValidBasic60Session: mocks.session }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/app/(basic60)/basic60/login/login-page-content", () => ({
  Basic60LoginPageContent: () => <div data-testid="login" />,
}));

describe("private login homepage compatibility", () => {
  beforeEach(() => { mocks.session.mockReset(); mocks.redirect.mockClear(); });

  it("sends an existing session directly to the protected homepage", async () => {
    mocks.session.mockResolvedValue(true);
    await expect(LoginPage()).rejects.toThrow("redirect:/basic60");
    expect(mocks.redirect).toHaveBeenCalledWith("/basic60");
  });

  it("keeps access verification for visitors without a session", async () => {
    mocks.session.mockResolvedValue(false);
    render(await LoginPage());
    expect(screen.getByTestId("login")).toBeInTheDocument();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
