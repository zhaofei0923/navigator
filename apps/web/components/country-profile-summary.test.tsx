import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { CountryProfileSummary } from "@/components/country-profile-summary";
import type { Basic60CountryDetail } from "@/lib/basic60/types";

// A deliberately multi-valued component fixture, not a publishable country record.
const country: Basic60CountryDetail = {
  code: "TST",
  iso2: "TS",
  name_zh: "测试国家",
  name_en: "Test country",
  region_code: "Africa",
  coverage_level: "Basic",
  last_reviewed_at: "2026-08-26T09:00:00+08:00",
  opportunity_level: "pending",
  policy_friendliness_level: "pending",
  risk_assessment_status: "unknown",
  risk_level: null,
  latest_metrics: [],
  capitals: [
    { name: "Legislative City", role: "legislative", display_order: 2, valid_from: null, valid_to: null },
    { name: "Administrative City", role: "administrative", display_order: 1, valid_from: "1994-01-01", valid_to: null },
    { name: "Judicial City", role: "judicial", display_order: 3, valid_from: null, valid_to: "2025-12-31" },
  ],
  local_names: [
    { locale: "en", text: "Test Republic", preferred: true, translation_status: "reviewed" },
    { locale: "af", text: "Toetsrepubliek", preferred: false, translation_status: "reviewed" },
  ],
  languages: [
    { code: "und-01", name_en: "English", name_local: "English", status: "official" },
    { code: "und-02", name_en: "Zulu", name_local: "isiZulu", status: "official" },
  ],
  currencies: [
    { code: "ZAR", name_en: "South African Rand", legal_tender: true, valid_from: null, valid_to: null },
    { code: "USD", name_en: "US Dollar", legal_tender: true, valid_from: "2020-01-01", valid_to: null },
  ],
  timezones: [
    { iana_code: "Africa/Johannesburg", primary: true },
    { iana_code: "Africa/Harare", primary: false },
  ],
  admin_structures: [
    { admin_level: 1, unit_type: "province", unit_count: 9, as_of_year: 2025, status: "reviewed" },
    { admin_level: 2, unit_type: "district", unit_count: 52, as_of_year: 2024, status: "reviewed" },
  ],
};

describe("CountryProfileSummary", () => {
  it.each(["zh-CN", "en"] as const)("keeps the overview compact and exposes complete multi-valued identity only on demand in %s", async (locale) => {
    const { container } = render(<CountryProfileSummary country={country} asOf="2026-08-26" locale={locale} />);
    const overview = container.querySelector(".country-profile-highlights") as HTMLDListElement;
    const disclosure = container.querySelector("details") as HTMLDetailsElement;
    const toggle = screen.getByText(locale === "en" ? "More country details" : "更多国家档案");
    expect(overview.children).toHaveLength(3);
    expect(overview).toHaveTextContent("Administrative City+2");
    expect(overview).toHaveTextContent("English+1");
    expect(overview).toHaveTextContent("ZAR+1");
    expect(overview).not.toHaveTextContent("Legislative City");
    expect(disclosure).not.toHaveAttribute("open");
    expect(toggle.tagName).toBe("SUMMARY");
    expect(screen.getByText("Africa/Johannesburg")).not.toBeVisible();

    const user = userEvent.setup();
    await user.tab();
    expect(toggle).toHaveFocus();
    await user.click(toggle);
    expect(disclosure).toHaveAttribute("open");
    const expanded = within(disclosure);
    for (const text of [
      "Administrative City", "Legislative City", "Judicial City", "English", "Zulu", "isiZulu",
      "ZAR · South African Rand", "USD · US Dollar", "Africa/Johannesburg", "Africa/Harare",
      "9 · province", "52 · district", "Test Republic", "Toetsrepubliek", "ISO2 · TS", "ISO3 · TST", "2026-08-26",
    ]) expect(expanded.getByText(text)).toBeVisible();
    expect(expanded.getByText(locale === "en" ? "Administrative capital" : "行政首都")).toBeVisible();
    expect(expanded.getByText(locale === "en" ? "Legislative capital" : "立法首都")).toBeVisible();
    expect(expanded.getByText(locale === "en" ? "Judicial capital" : "司法首都")).toBeVisible();
    expect(expanded.getByText(locale === "en" ? "Level 2 · 2024" : "第2级行政区 · 2024")).toBeVisible();
    expect(expanded.getByText(locale === "en" ? "Primary time zone" : "主要时区")).toBeVisible();
    expect(disclosure).toHaveTextContent("1994-01-01");
    expect(disclosure).toHaveTextContent("2025-12-31");
    expect(disclosure).toHaveTextContent("2020-01-01");
    expect(disclosure.querySelector("time")).toHaveAttribute("dateTime", "2026-08-26");
    expect(container).not.toHaveTextContent(/BASIC60|Basic|审核|发布|pending|unknown|private.?trial|reviewed|und-01/i);

    await user.click(toggle);
    expect(disclosure).not.toHaveAttribute("open");
    expect(expanded.getByText("Africa/Johannesburg")).not.toBeVisible();
    expect(country.capitals?.[0].name).toBe("Legislative City");
  });

  it.each([
    { label: "null", items: null },
    { label: "undefined", items: undefined },
    { label: "empty", items: [] },
  ])("handles $label optional collections without invented profile values", async ({ items }) => {
    const missing = {
      ...country,
      capitals: items,
      languages: items,
      currencies: items,
      local_names: items,
      timezones: items,
      admin_structures: items,
    };
    const { container } = render(<CountryProfileSummary country={missing} asOf="" locale="en" />);
    await userEvent.click(screen.getByText("More country details"));
    expect(screen.getAllByText("Not available").length).toBeGreaterThanOrEqual(9);
    expect(container).not.toHaveTextContent(/undefined|null|0 ·|NaN/);
    expect(container.querySelector("time")).toBeNull();
    expect(screen.getByText("ISO3 · TST")).toBeVisible();
  });

  it.each(["zh-CN", "en"] as const)("uses public language labels and a safe unknown-capital role fallback in %s", async (locale) => {
    const values = {
      ...country,
      capitals: [{ name: "Capital", role: "unexpected_internal_role", display_order: 1, valid_from: null, valid_to: null }],
      languages: [
        { code: "und-01", name_en: "English fallback", name_local: "", status: "reviewed" },
        { code: "und-02", name_en: "", name_local: "本地语言", status: "reviewed" },
      ],
    };
    const { container } = render(<CountryProfileSummary country={values} asOf="2026-08-26" locale={locale} />);
    await userEvent.click(screen.getByText(locale === "en" ? "More country details" : "更多国家档案"));
    const expanded = within(container.querySelector("details") as HTMLDetailsElement);
    expect(expanded.getByText("English fallback")).toBeVisible();
    expect(expanded.getByText("本地语言")).toBeVisible();
    expect(container).not.toHaveTextContent(/unexpected_internal_role|und-01|reviewed/);
    expect(expanded.getAllByText(locale === "en" ? "Capitals" : "首都")).toHaveLength(2);
  });
});
