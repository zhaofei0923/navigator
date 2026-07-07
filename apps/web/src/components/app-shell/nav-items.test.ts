import { describe, expect, test } from "vitest";

import { MAIN_NAV_ITEMS } from "./nav-items.js";

describe("main navigation", () => {
  test("contains only the four approved IA sections", () => {
    expect(MAIN_NAV_ITEMS).toEqual([
      { href: "/", labelKey: "nav.home" },
      { href: "/countries", labelKey: "nav.countries" },
      { href: "/ai-advisor", labelKey: "nav.aiAdvisor" },
      { href: "/reports", labelKey: "nav.reports" },
    ]);
  });

  test("does not expose Compare as a top-level navigation entry", () => {
    const serializedNav = JSON.stringify(MAIN_NAV_ITEMS).toLowerCase();

    expect(serializedNav).not.toContain("compare");
    expect(serializedNav).not.toContain("对比");
  });
});
