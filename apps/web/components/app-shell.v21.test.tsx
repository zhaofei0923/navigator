import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "@/components/app-shell";
import { LocaleProvider } from "@/lib/i18n/client";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/countries/BRA",
  useRouter: () => ({ refresh }),
}));

describe("AppShell v2.1", () => {
  it("exposes the current section, persistent demo boundary and controlled mobile navigation", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <LocaleProvider initialLocale="en">
        <AppShell>
          <h1>Country context</h1>
        </AppShell>
      </LocaleProvider>,
    );

    expect(screen.getByRole("link", { name: "Global Markets" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("note")).toHaveAccessibleName(
      "Demo Data / Non-official Conclusions: Internal preview only · No real sources connected",
    );
    expect(container.querySelector("main#main-content")).toHaveTextContent("Country context");

    const menuButton = screen.getByRole("button", { name: "Open navigation" });
    expect(menuButton).toHaveAttribute("aria-controls", "primary-navigation");
    await user.click(menuButton);
    expect(screen.getByRole("button", { name: "Close navigation" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Open navigation" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });
});
