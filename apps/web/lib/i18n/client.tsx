"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  startTransition,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE_MAX_AGE_SECONDS,
  LOCALE_COOKIE_NAME,
  type SupportedLocale,
} from "@/lib/i18n/config";
import { translate, type TranslationKey, type TranslationValues } from "@/lib/i18n/dictionary";

type LocaleContextValue = Readonly<{
  locale: SupportedLocale;
  setLocale: (locale: SupportedLocale) => void;
}>;

const FALLBACK_LOCALE_CONTEXT: LocaleContextValue = {
  locale: DEFAULT_LOCALE,
  setLocale: () => undefined,
};

const LocaleContext = createContext<LocaleContextValue>(FALLBACK_LOCALE_CONTEXT);

export function LocaleProvider({
  children,
  initialLocale,
}: Readonly<{ children: React.ReactNode; initialLocale: SupportedLocale }>) {
  const router = useRouter();
  const [locale, setLocaleState] = useState<SupportedLocale>(initialLocale);

  const setLocale = useCallback(
    (nextLocale: SupportedLocale) => {
      if (nextLocale === locale) return;

      const secure = window.location.protocol === "https:" ? "; Secure" : "";
      document.cookie = `${LOCALE_COOKIE_NAME}=${encodeURIComponent(nextLocale)}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
      document.documentElement.lang = nextLocale;
      setLocaleState(nextLocale);

      // Refresh server-rendered metadata without replacing the URL or resetting client state.
      startTransition(() => router.refresh());
    },
    [locale, router],
  );

  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  return useContext(LocaleContext);
}

export function useTranslations(): (
  key: TranslationKey,
  values?: TranslationValues,
) => string {
  const { locale } = useLocale();
  return useCallback(
    (key: TranslationKey, values?: TranslationValues) => translate(locale, key, values),
    [locale],
  );
}
