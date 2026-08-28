import { describe, expect, it } from "vitest";
import { homeMarketHref, navigationCountryCode } from "@/lib/approved-basic60/navigation";

describe("product navigation context", () => {
  it("returns the homepage map with an optional outbound country", () => {
    expect(homeMarketHref()).toBe("/#markets");
    expect(homeMarketHref("bra")).toBe("/?country=BRA#markets");
    expect(homeMarketHref("CHN")).toBe("/#markets");
    expect(homeMarketHref("CN")).toBe("/#markets");
    expect(homeMarketHref("BRA&redirect=external")).toBe("/#markets");
    expect(homeMarketHref("BRA", "/basic60")).toBe("/basic60?country=BRA#markets");
    expect(homeMarketHref(null, "/basic60")).toBe("/basic60#markets");
  });

  it.each(["/countries/BRA", "/basic60/countries/bra", "/approved-basic60/countries/BRA", "/countries/BRA/market-report", "/basic60/countries/bra/market-report", "/approved-basic60/countries/BRA/market-report"])(
    "uses the country detail path before a stale query on %s",
    (pathname) => {
      expect(navigationCountryCode(pathname, "IDN")).toBe("BRA");
    },
  );

  it("uses only an explicit valid query on non-detail routes", () => {
    expect(navigationCountryCode("/tools/assistant", "zaf")).toBe("ZAF");
    expect(navigationCountryCode("/partners")).toBeNull();
    expect(navigationCountryCode("/", "CHN")).toBeNull();
    expect(navigationCountryCode("/countries/CHN", "BRA")).toBeNull();
    expect(navigationCountryCode("/countries/CHN/market-report", "BRA")).toBeNull();
  });

  it.each(["/countries/ZMB", "/basic60/countries/zmb", "/approved-basic60/countries/ZMB", "/countries/ZMB/market-report", "/basic60/countries/zmb/market-report", "/approved-basic60/countries/ZMB/market-report"])(
    "preserves Zambia on the detail and legacy return path %s",
    (pathname) => {
      const code = navigationCountryCode(pathname, "IDN");
      expect(code).toBe("ZMB");
      expect(homeMarketHref(code)).toBe("/?country=ZMB#markets");
      expect(homeMarketHref(code, "/basic60")).toBe("/basic60?country=ZMB#markets");
      expect(navigationCountryCode("/tools", code)).toBe("ZMB");
      expect(navigationCountryCode("/partners", code)).toBe("ZMB");
    },
  );
});
