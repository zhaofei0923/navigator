import { beforeEach, describe, expect, it, vi } from "vitest";
import Page from "@/app/(basic60)/basic60/(private)/countries/page";

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  redirect: vi.fn((href: string) => { throw new Error("redirect:" + href); }),
}));
vi.mock("@/lib/approved-basic60/page-context", () => ({ approvedBasic60PageContext: mocks.context }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

describe("Private country list retirement", () => {
  beforeEach(() => { mocks.context.mockReset(); mocks.redirect.mockClear(); });
  it.each([[null, "/basic60#markets"], ["BRA", "/basic60?country=BRA#markets"]])("returns to the protected homepage with context %s", async (countryCode, destination) => {
    mocks.context.mockResolvedValue({ locale: "en", countryCode });
    const searchParams = Promise.resolve(countryCode ? { country: countryCode } : {});
    await expect(Page({ searchParams })).rejects.toThrow("redirect:" + destination);
    expect(mocks.redirect).toHaveBeenCalledWith(destination);
    expect(mocks.context).toHaveBeenCalledWith(searchParams);
  });
});
