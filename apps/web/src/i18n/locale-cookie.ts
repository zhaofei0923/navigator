import type { Locale } from "@navigator/shared-types/schema";

import { LOCALE_COOKIE_NAME } from "./routing";

const LOCALE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export function getLocaleCookieAssignment(locale: Locale): string {
  return `${LOCALE_COOKIE_NAME}=${locale}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE_SECONDS}; samesite=lax`;
}
