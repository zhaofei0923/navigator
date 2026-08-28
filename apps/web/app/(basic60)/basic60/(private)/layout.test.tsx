import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PrivateLayout from "@/app/(basic60)/basic60/(private)/layout";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  redirect: vi.fn((href: string) => { throw new Error("redirect:" + href); }),
}));
vi.mock("@/lib/basic60/session", () => ({ hasValidBasic60Session: mocks.session }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/components/basic60-shell", () => ({
  Basic60Shell: ({ children }: { children: React.ReactNode }) => <div data-testid="protected-shell">{children}</div>,
}));

describe("private product layout", () => {
  beforeEach(() => { mocks.session.mockReset(); mocks.redirect.mockClear(); });

  it("retains its session guard before rendering new navigation modules", async () => {
    mocks.session.mockResolvedValue(false);
    await expect(PrivateLayout({ children: <h1>Tools</h1> })).rejects.toThrow("redirect:/basic60/login?expired=1");
  });

  it("renders the product shell for a valid private session", async () => {
    mocks.session.mockResolvedValue(true);
    render(await PrivateLayout({ children: <h1>Tools</h1> }));
    expect(screen.getByTestId("protected-shell")).toHaveTextContent("Tools");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
