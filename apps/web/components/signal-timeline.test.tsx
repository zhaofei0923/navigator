import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SignalTimeline } from "@/components/signal-timeline";
import { LocaleProvider } from "@/lib/i18n";
import type { SignalItem } from "@/lib/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const signal: SignalItem = {
  data_origin: "synthetic_demo",
  signal_id: "SIG-TST-001",
  country_code: "TST",
  category: "tender",
  title: "Synthetic tender signal",
  value: 82,
  unit: "score_point",
  trend: "up",
  confidence: 91,
  summary: "A repository-owned synthetic signal.",
  occurred_at: "2026-08-22",
};

describe("SignalTimeline", () => {
  it("localizes headings, category, date, and tender destination in English", () => {
    render(
      <LocaleProvider initialLocale="en">
        <SignalTimeline signals={[signal]} />
      </LocaleProvider>,
    );

    expect(screen.getByRole("columnheader", { name: "Date" })).toBeInTheDocument();
    expect(screen.getByText("Tender")).toBeInTheDocument();
    expect(screen.getByText("Aug 22, 2026")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View Synthetic tender signal" })).toHaveAttribute(
      "href",
      "/tools/tenders?country=TST",
    );
  });
});
