import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateMetadata } from "@/app/layout";
import { translate } from "@/lib/i18n/dictionary";

const mocks = vi.hoisted(() => ({
  getRequestLocale: vi.fn(),
  currentRuntimeProfile: vi.fn(),
}));

vi.mock("@/lib/i18n/server", () => ({
  getRequestLocale: mocks.getRequestLocale,
}));

vi.mock("@/lib/runtime-profile", () => ({
  APPROVED_BASIC60_DEMO_RUNTIME_PROFILE: "approved_basic60_demo",
  BASIC60_PRIVATE_RUNTIME_PROFILE: "basic60_private",
  currentRuntimeProfile: mocks.currentRuntimeProfile,
}));

describe("Root metadata market scope", () => {
  beforeEach(() => {
    mocks.getRequestLocale.mockReset().mockResolvedValue("zh-CN");
    mocks.currentRuntimeProfile.mockReset().mockReturnValue("approved_basic60_demo");
  });

  it.each(["approved_basic60_demo", "basic60_private"])("uses Chinese product metadata for %s", async (profile) => {
    mocks.currentRuntimeProfile.mockReturnValue(profile);
    const metadata = await generateMetadata();

    expect(metadata.title).toBe("Navigator｜中国新能源企业出海导航仪");
    expect(metadata.description).toContain("中国不作为目标市场");
    expect(metadata.description).not.toContain("60国");
    expect(metadata.description).not.toMatch(/已审核|内部使用|Basic|私有试用|演示/i);
    expect(metadata.robots).toEqual({ index: false, follow: false, nocache: true });
  });

  it.each(["approved_basic60_demo", "basic60_private"])("uses English product metadata for %s", async (profile) => {
    mocks.getRequestLocale.mockResolvedValue("en");
    mocks.currentRuntimeProfile.mockReturnValue(profile);

    const metadata = await generateMetadata();

    expect(metadata.title).toBe("Navigator | Overseas navigation for Chinese new energy companies");
    expect(metadata.description).toContain("China is not a target market");
    expect(metadata.title).not.toContain("60-country");
    expect(metadata.description).not.toMatch(/reviewed|internal use|Basic|trial|demo/i);
  });

  it.each(["zh-CN", "en"] as const)("preserves synthetic-demo metadata in %s", async (locale) => {
    mocks.getRequestLocale.mockResolvedValue(locale);
    mocks.currentRuntimeProfile.mockReturnValue("synthetic_demo");

    const metadata = await generateMetadata();

    expect(metadata.title).toBe(translate(locale, "metadata.title"));
    expect(metadata.description).toBe(translate(locale, "metadata.description"));
  });
});
