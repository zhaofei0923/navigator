import type { Locale } from "@navigator/shared-types/schema";
import { defineRouting } from "next-intl/routing";

export const locales = ["zh-CN", "en"] as const satisfies readonly Locale[];
export const DEFAULT_LOCALE = "zh-CN" satisfies Locale;
export const LOCALE_COOKIE_NAME = "NEXT_LOCALE";

export const routing = defineRouting({
  defaultLocale: DEFAULT_LOCALE,
  localeCookie: {
    maxAge: 60 * 60 * 24 * 365,
    name: LOCALE_COOKIE_NAME,
    sameSite: "lax",
  },
  localePrefix: "always",
  locales,
});

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}
