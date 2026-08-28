import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ApprovedBasic60Layout from "@/app/(approved-basic60)/approved-basic60/layout";

vi.mock("@/components/app-shell", () => ({
  AppShell: ({
    children,
    dataProfile,
  }: Readonly<{ children: React.ReactNode; dataProfile: string }>) => (
    <div data-profile={dataProfile}>{children}</div>
  ),
}));

describe("ApprovedBasic60Layout", () => {
  it("renders the approved Demo directly without a session gate", () => {
    render(
      <ApprovedBasic60Layout>
        <h1>Approved Demo</h1>
      </ApprovedBasic60Layout>,
    );

    expect(screen.getByRole("heading", { name: "Approved Demo" })).toBeInTheDocument();
    expect(screen.getByText("Approved Demo").parentElement).toHaveAttribute(
      "data-profile",
      "approved_basic60",
    );
  });
});
