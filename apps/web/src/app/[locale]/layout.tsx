import type { Locale } from "@navigator/shared-types/schema";
import { hasLocale } from "next-intl";
import { NextIntlClientProvider } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { AppShell } from "../../components/app-shell/app-shell";
import { routing } from "../../i18n/routing";
import "../globals.css";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

interface LocaleLayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

export default async function LocaleLayout({
  children,
  params,
}: LocaleLayoutProps) {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  setRequestLocale(locale);

  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider>
          <AppShell locale={locale as Locale}>{children}</AppShell>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
