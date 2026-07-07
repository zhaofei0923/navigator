import type { Locale } from "@navigator/shared-types/schema";

import { DEFAULT_LOCALE, isLocale } from "./routing";

export function resolveRequestLocale(
  explicitLocale: string | undefined,
  requestLocale: string | undefined,
): Locale {
  const candidate = explicitLocale ?? requestLocale;

  return candidate !== undefined && isLocale(candidate)
    ? candidate
    : DEFAULT_LOCALE;
}
