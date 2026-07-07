import { getRequestConfig } from "next-intl/server";

import { resolveRequestLocale } from "./request-locale";

export default getRequestConfig(async ({ locale: requestedLocale, requestLocale }) => {
  const locale = resolveRequestLocale(requestedLocale, await requestLocale);

  return {
    locale,
    messages: (await import(`../../locales/${locale}.json`)).default,
  };
});
