import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ComparePage from "./page";

const mocks = vi.hoisted(() => ({ redirect: vi.fn() }));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

describe("retired synthetic comparison route", () => {
  beforeEach(() => {
    mocks.redirect.mockReset();
    mocks.redirect.mockImplementation((href: string) => { throw new Error(`REDIRECT:${href}`); });
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it("returns to the homepage map without loading comparison data", async () => {
    await expect(ComparePage({})).rejects.toThrow("REDIRECT:/#markets");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    { query: { country: "bra" }, destination: "/?country=BRA#markets" },
    { query: { country: "CHN" }, destination: "/#markets" },
    { query: { country: "invalid" }, destination: "/#markets" },
    { query: { country: ["BRA", "ZAF"] }, destination: "/#markets" },
    { query: { countries: "BRA,ZAF" }, destination: "/#markets" },
  ])("canonicalizes $query to $destination without comparison calls", async ({ query, destination }) => {
    await expect(ComparePage({ searchParams: Promise.resolve(query) })).rejects.toThrow(`REDIRECT:${destination}`);
    expect(fetch).not.toHaveBeenCalled();
  });
});
