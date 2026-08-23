import type { Metadata } from "next";
import { LocaleProvider } from "@/lib/i18n/client";
import { translate } from "@/lib/i18n/dictionary";
import { getRequestLocale } from "@/lib/i18n/server";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  return {
    title: translate(locale, "metadata.title"),
    description: translate(locale, "metadata.description"),
    robots: { index: false, follow: false, nocache: true },
  };
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await getRequestLocale();
  return (
    <html lang={locale}>
      <body>
        <LocaleProvider initialLocale={locale}>{children}</LocaleProvider>
      </body>
    </html>
  );
}
