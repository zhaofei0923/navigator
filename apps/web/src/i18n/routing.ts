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

export function getLocalizedPathname(pathname: string, locale: Locale): string {
  const hashStart = pathname.indexOf("#");
  const beforeHash = hashStart >= 0 ? pathname.slice(0, hashStart) : pathname;
  const hash = hashStart >= 0 ? pathname.slice(hashStart) : "";
  const queryStart = beforeHash.indexOf("?");
  const pathOnly =
    queryStart >= 0 ? beforeHash.slice(0, queryStart) : beforeHash;
  const query = queryStart >= 0 ? beforeHash.slice(queryStart) : "";

  const segments = pathOnly.split("/").filter(Boolean);
  const [, ...rest] = segments.length > 0 && isLocale(segments[0] ?? "")
    ? segments
    : ["", ...segments];
  const localizedPath = rest.length > 0 ? `/${locale}/${rest.join("/")}` : `/${locale}`;

  return `${localizedPath}${query}${hash}`;
}
