import type { Metadata } from "next";
import { LocaleProvider } from "@/lib/i18n/client";
import { translate } from "@/lib/i18n/dictionary";
import { getRequestLocale } from "@/lib/i18n/server";
import {
  APPROVED_BASIC60_DEMO_RUNTIME_PROFILE,
  BASIC60_PRIVATE_RUNTIME_PROFILE,
  currentRuntimeProfile,
} from "@/lib/runtime-profile";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const runtimeProfile = currentRuntimeProfile();
  const isProductExperience =
    runtimeProfile === APPROVED_BASIC60_DEMO_RUNTIME_PROFILE ||
    runtimeProfile === BASIC60_PRIVATE_RUNTIME_PROFILE;
  return {
    title: isProductExperience
      ? locale === "en"
        ? "Navigator | Overseas navigation for Chinese new energy companies"
        : "Navigator｜中国新能源企业出海导航仪"
      : translate(locale, "metadata.title"),
    description: isProductExperience
      ? locale === "en"
        ? "Country profiles, energy-market data, expansion tools and partner discovery for Chinese new energy companies exploring overseas markets. China is not a target market."
        : "面向中国新能源企业出海，提供目标市场的国家档案与能源数据，并连接出海工具和合作伙伴；中国不作为目标市场。"
      : translate(locale, "metadata.description"),
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
