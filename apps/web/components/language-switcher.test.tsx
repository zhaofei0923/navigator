import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageSwitcher } from "@/components/language-switcher";
import { LocaleProvider, useTranslations } from "@/lib/i18n/client";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

function TranslatedValue() {
  const t = useTranslations();
  return <output>{t("nav.tools")}</output>;
}

describe("LanguageSwitcher", () => {
  beforeEach(() => {
    refresh.mockClear();
    document.cookie = "navigator_locale=; Path=/; Max-Age=0";
    document.documentElement.lang = "zh-CN";
  });

  it("persists the selected locale and updates translations without replacing the page", async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider initialLocale="zh-CN">
        <LanguageSwitcher />
        <TranslatedValue />
      </LocaleProvider>,
    );

    expect(screen.getByText("出海工具")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "切换到英文" }));

    expect(screen.getByText("Expansion Tools")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Switch to Chinese" })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("en");
    expect(document.cookie).toContain("navigator_locale=en");
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("can restore Chinese from an English session using the same stable URL flow", async () => {
    const user = userEvent.setup();
    document.documentElement.lang = "en";
    render(
      <LocaleProvider initialLocale="en">
        <LanguageSwitcher />
        <TranslatedValue />
      </LocaleProvider>,
    );

    expect(screen.getByText("Expansion Tools")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Switch to Chinese" }));

    expect(screen.getByText("出海工具")).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("zh-CN");
    expect(document.cookie).toContain("navigator_locale=zh-CN");
    expect(refresh).toHaveBeenCalledOnce();
  });
});
