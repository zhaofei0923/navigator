import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import HomePage from "@/app/(demo)/page";
import { LocaleProvider } from "@/lib/i18n";
import type { GlobeMarker } from "@/lib/types";

type MockGlobeProps = Readonly<{
  markers: GlobeMarker[];
  selectedCode: string;
  onSelect: (code: string) => void;
}>;

const { markers, push, refresh, reload } = vi.hoisted(() => ({
  markers: [
    {
      data_origin: "synthetic_demo" as const,
      code: "BRA",
      name: "Brazil",
      lat: -10,
      lng: -52,
      summary: "Synthetic Brazil market summary.",
      readiness: 82,
    },
    {
      data_origin: "synthetic_demo" as const,
      code: "SAU",
      name: "Saudi Arabia",
      lat: 24,
      lng: 45,
      summary: "Synthetic Saudi market summary.",
      readiness: 78,
    },
  ],
  push: vi.fn(),
  refresh: vi.fn(),
  reload: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

vi.mock("next/dynamic", () => ({
  default: () =>
    function MockCountryGlobe({ markers: options, selectedCode, onSelect }: MockGlobeProps) {
      return (
        <div data-testid="country-globe" data-selected={selectedCode}>
          {options.map((marker) => (
            <button key={marker.code} type="button" onClick={() => onSelect(marker.code)}>
              Select {marker.name}
            </button>
          ))}
        </div>
      );
    },
}));

vi.mock("@/hooks/use-demo-query", () => ({
  useDemoQuery: () => ({ data: markers, loading: false, error: null, reload }),
}));

function renderHome(locale: "zh-CN" | "en" = "en") {
  return render(
    <LocaleProvider initialLocale={locale}>
      <HomePage />
    </LocaleProvider>,
  );
}

describe("HomePage v2.1 journey", () => {
  it("carries the selected market through the hero and all four task links", async () => {
    const user = userEvent.setup();
    renderHome();

    expect(screen.getByRole("link", { name: /Start this market journey/ })).toHaveAttribute(
      "href",
      "/tools?country=BRA",
    );
    const journey = screen.getByRole("list", { name: /Current-market task journey: BRA/ });
    const initialLinks = within(journey).getAllByRole("link");
    expect(initialLinks).toHaveLength(4);
    expect(initialLinks.map((link) => link.getAttribute("href"))).toEqual([
      "/tools/assistant?country=BRA",
      "/tools/solar-storage?country=BRA",
      "/tools/feasibility?country=BRA",
      "/tools/tenders?country=BRA",
    ]);
    expect(initialLinks[0]).toHaveAttribute("aria-current", "step");
    expect(initialLinks[0]).toHaveAccessibleName(/Current step.*BRA/);
    expect(initialLinks[1]).toHaveAccessibleName(/Next step.*BRA/);

    await user.click(screen.getByRole("button", { name: "Select Saudi Arabia" }));

    const currentMarket = screen.getByText("Current demo market").parentElement;
    expect(currentMarket).not.toBeNull();
    expect(within(currentMarket as HTMLElement).getByText(/Saudi Arabia/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Start this market journey/ })).toHaveAttribute(
      "href",
      "/tools?country=SAU",
    );
    expect(
      screen.getByRole("link", { name: /AI market guidance.*Current step.*SAU/ }),
    ).toHaveAttribute("href", "/tools/assistant?country=SAU");
  });

  it("has one dominant hero action and a quiet market exploration link", () => {
    const { container } = renderHome();

    expect(container.querySelectorAll(".landing-hero .button-primary")).toHaveLength(1);
    const exploration = screen.getByRole("link", { name: /Explore global markets first/ });
    expect(exploration).toHaveAttribute("href", "#markets");
    expect(exploration).not.toHaveClass("button");
  });

  it("renders the complete journey in Chinese without mixed English task copy", () => {
    renderHome("zh-CN");

    expect(screen.getByRole("heading", { name: "从市场判断，到投标准备" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /AI 市场判断.*当前步骤.*BRA/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /光储概念方案.*下一步.*BRA/ })).toBeInTheDocument();
    expect(screen.queryByText("AI market guidance")).not.toBeInTheDocument();
  });
});
