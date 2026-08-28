import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { APPROVED_BASIC60_DEMO_RUNTIME_PROFILE, BASIC60_PRIVATE_RUNTIME_PROFILE, SYNTHETIC_DEMO_RUNTIME_PROFILE } from "@/lib/runtime-profile";
import { proxy } from "@/proxy";

afterEach(() => { delete process.env.NAVIGATOR_RUNTIME_PROFILE; });

describe("runtime profile routing boundary", () => {
  it.each([undefined, SYNTHETIC_DEMO_RUNTIME_PROFILE])("preserves the isolated synthetic routes for %s", (profile) => {
    if (profile) process.env.NAVIGATOR_RUNTIME_PROFILE = profile;
    expect(proxy(new NextRequest("http://localhost/policies")).headers.get("x-middleware-next")).toBe("1");
  });

  it("fails closed for unknown profiles", () => {
    process.env.NAVIGATOR_RUNTIME_PROFILE = "future_profile";
    const response = proxy(new NextRequest("http://localhost/policies"));
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store, private");
  });

  it("keeps the private root redirect bounded to its protected homepage", () => {
    process.env.NAVIGATOR_RUNTIME_PROFILE = BASIC60_PRIVATE_RUNTIME_PROFILE;
    const response = proxy(new NextRequest("http://localhost/"));
    expect(response.headers.get("location")).toBe("http://localhost/basic60");
    const home = proxy(new NextRequest(response.headers.get("location")!));
    expect(home.headers.get("x-middleware-next")).toBe("1");
    expect(home.headers.get("location")).toBeNull();
  });

  it.each([
    ["bra", "/basic60?country=BRA"],
    ["CHN", "/basic60"],
    ["invalid", "/basic60"],
  ])("retains only a safe country when entering the private root with %s", (country, destination) => {
    process.env.NAVIGATOR_RUNTIME_PROFILE = BASIC60_PRIVATE_RUNTIME_PROFILE;
    const response = proxy(new NextRequest(`http://localhost/?country=${country}&next=https://outside.test`));
    expect(response.headers.get("location")).toBe("http://localhost" + destination);
  });

  it.each(["/policies", "/tools/assistant", "/api/demo/countries", "/api/session", "/login"])("fails closed for unprefixed %s in the private runtime", (pathname) => {
    process.env.NAVIGATOR_RUNTIME_PROFILE = BASIC60_PRIVATE_RUNTIME_PROFILE;
    expect(proxy(new NextRequest("http://localhost" + pathname)).status).toBe(404);
  });

  it.each([
    "/basic60", "/basic60/login", "/basic60/countries", "/basic60/countries/BRA", "/basic60/countries/BRA/market-report",
    "/basic60/tools", "/basic60/tools/assistant", "/basic60/tools/solar-storage",
    "/basic60/tools/feasibility", "/basic60/tools/tenders", "/basic60/partners",
    "/basic60/api/v1/countries", "/api/health", "/_next/app.js", "/data/world-countries-110m.geojson",
  ])("keeps %s inside the existing private runtime", (pathname) => {
    process.env.NAVIGATOR_RUNTIME_PROFILE = BASIC60_PRIVATE_RUNTIME_PROFILE;
    expect(proxy(new NextRequest("http://localhost" + pathname)).headers.get("x-middleware-next")).toBe("1");
  });

  it.each([
    ["/", "/approved-basic60"],
    ["/countries/BRA", "/approved-basic60/countries/BRA"],
    ["/countries/bra", "/approved-basic60/countries/BRA"],
    ["/countries/BRA/market-report", "/approved-basic60/countries/BRA/market-report"],
    ["/countries/bra/market-report", "/approved-basic60/countries/BRA/market-report"],
    ["/partners", "/approved-basic60/partners"],
    ["/tools", "/approved-basic60/tools"],
    ["/tools/assistant", "/approved-basic60/tools/assistant"],
    ["/tools/solar-storage", "/approved-basic60/tools/solar-storage"],
    ["/tools/feasibility", "/approved-basic60/tools/feasibility"],
    ["/tools/tenders", "/approved-basic60/tools/tenders"],
  ])("rewrites active route %s without falling back to the legacy Demo", (pathname, destination) => {
    process.env.NAVIGATOR_RUNTIME_PROFILE = APPROVED_BASIC60_DEMO_RUNTIME_PROFILE;
    const response = proxy(new NextRequest("http://localhost" + pathname + "?country=BRA"));
    expect(response.headers.get("x-middleware-rewrite")).toBe("http://localhost" + destination + "?country=BRA");
  });

  it.each([
    ["/countries", "/#markets"], ["/compare", "/#markets"],
    ["/policies", "/tools"], ["/risks", "/tools"],
    ["/opportunities", "/tools/tenders"], ["/tenders", "/tools/tenders"],
    ["/basic60", "/"], ["/basic60/login", "/"],
    ["/basic60/countries", "/#markets"], ["/basic60/compare", "/#markets"],
    ["/basic60/countries/BRA", "/countries/BRA"], ["/basic60/tools", "/tools"],
    ["/basic60/countries/bra/market-report", "/countries/BRA/market-report"],
    ["/basic60/tools/tenders", "/tools/tenders"], ["/basic60/partners", "/partners"],
  ])("canonicalizes retired or private alias %s to %s", (pathname, destination) => {
    process.env.NAVIGATOR_RUNTIME_PROFILE = APPROVED_BASIC60_DEMO_RUNTIME_PROFILE;
    const response = proxy(new NextRequest("http://localhost" + pathname));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost" + destination);
    const target = proxy(new NextRequest(response.headers.get("location")!));
    expect(target.headers.get("location")).toBeNull();
    expect(target.status).not.toBe(404);
  });

  it.each([
    ["/compare", "/?country=BRA#markets"],
    ["/countries", "/?country=BRA#markets"],
    ["/policies", "/tools?country=BRA"],
    ["/risks", "/tools?country=BRA"],
    ["/opportunities", "/tools/tenders?country=BRA"],
    ["/tenders", "/tools/tenders?country=BRA"],
    ["/basic60/compare", "/?country=BRA#markets"],
    ["/basic60/partners", "/partners?country=BRA"],
  ])("preserves only a safe country context from %s", (pathname, destination) => {
    process.env.NAVIGATOR_RUNTIME_PROFILE = APPROVED_BASIC60_DEMO_RUNTIME_PROFILE;
    const response = proxy(new NextRequest("http://localhost" + pathname + "?country=bra&countries=IDN,ZAF&next=https://outside.test"));
    expect(response.headers.get("location")).toBe("http://localhost" + destination);
  });

  it.each(["CHN", "CN", "invalid", "BRA&unsafe=1"])("does not carry invalid origin/query country %s into the new homepage", (country) => {
    process.env.NAVIGATOR_RUNTIME_PROFILE = APPROVED_BASIC60_DEMO_RUNTIME_PROFILE;
    const response = proxy(new NextRequest("http://localhost/compare?country=" + encodeURIComponent(country)));
    expect(response.headers.get("location")).toBe("http://localhost/#markets");
  });

  it("redirects login directly to the product root without following an arbitrary next URL", () => {
    process.env.NAVIGATOR_RUNTIME_PROFILE = APPROVED_BASIC60_DEMO_RUNTIME_PROFILE;
    const response = proxy(new NextRequest("http://localhost/login?country=BRA&next=https://outside.test"));
    expect(response.headers.get("location")).toBe("http://localhost/?country=BRA");
  });

  it.each(["/api/health", "/icon.svg", "/favicon.ico", "/_next/app.js", "/data/world-countries-110m.geojson"])("allows the bounded runtime asset %s", (pathname) => {
    process.env.NAVIGATOR_RUNTIME_PROFILE = APPROVED_BASIC60_DEMO_RUNTIME_PROFILE;
    expect(proxy(new NextRequest("http://localhost" + pathname)).headers.get("x-middleware-next")).toBe("1");
  });

  it.each([
    "/approved-basic60", "/approved-basic60/countries", "/approved-basic60/compare",
    "/approved-basic60/tools", "/api/session", "/api/demo/countries",
    "/api/demo/country-comparisons", "/basic60/api/v1/country-comparisons",
    "/basic60/unknown", "/basic60/countries/CHN", "/compare/extra",
    "/countries/CHN", "/countries/CN", "/countries/BRA/extra",
    "/countries/CHN/market-report", "/countries/CN/market-report", "/countries/BRA/market-report/extra",
    "/basic60/countries/CHN/market-report", "/approved-basic60/countries/BRA/market-report",
    "/tools/assistant/extra", "/tools/not-developed", "/countries-not-approved",
    "/data/unapproved.json", "/unknown",
  ])("blocks internal or unsupported surface %s", (pathname) => {
    process.env.NAVIGATOR_RUNTIME_PROFILE = APPROVED_BASIC60_DEMO_RUNTIME_PROFILE;
    const response = proxy(new NextRequest("http://localhost" + pathname));
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store, private");
    expect(response.headers.get("x-middleware-next")).toBeNull();
  });
});
