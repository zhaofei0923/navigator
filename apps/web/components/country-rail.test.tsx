import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CountryRail } from "@/components/country-rail";
import { LocaleProvider } from "@/lib/i18n";
import type { CountrySummary } from "@/lib/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const scores = {
  market_attractiveness: 70,
  policy_certainty: 60,
  project_activity: 65,
  partner_maturity: 55,
  risk_controllability: 62,
};

const countries: CountrySummary[] = [
  {
    data_origin: "synthetic_demo",
    code: "AAA",
    name_zh: "甲国",
    name_en: "Alpha",
    region: "演示区",
    currency: "TST",
    summary: "测试记录",
    scores,
    dimension_deltas: {},
  },
  {
    data_origin: "synthetic_demo",
    code: "BBB",
    name_zh: "乙国",
    name_en: "Beta",
    region: "演示区",
    currency: "TST",
    summary: "测试记录",
    scores,
    dimension_deltas: {},
  },
];

describe("CountryRail", () => {
  it("announces the selected country and changes selection", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<CountryRail countries={countries} selectedCode="AAA" onSelect={onSelect} />);

    expect(screen.getByRole("button", { name: "甲国" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "乙国" }));
    expect(onSelect).toHaveBeenCalledWith("BBB");
  });

  it("renders only the English market names in English", () => {
    render(
      <LocaleProvider initialLocale="en">
        <CountryRail countries={countries} selectedCode="AAA" onSelect={vi.fn()} />
      </LocaleProvider>,
    );

    expect(screen.getByRole("group", { name: "Select a market" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Alpha" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("甲国")).not.toBeInTheDocument();
  });
});
