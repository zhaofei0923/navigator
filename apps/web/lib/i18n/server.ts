import "server-only";

import { cookies } from "next/headers";
import { LOCALE_COOKIE_NAME, normalizeLocale } from "@/lib/i18n/config";

export async function getRequestLocale() {
  const cookieStore = await cookies();
  return normalizeLocale(cookieStore.get(LOCALE_COOKIE_NAME)?.value);
}
