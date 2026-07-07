import type { Locale } from "@navigator/shared-types/schema";
import { getTranslations, setRequestLocale } from "next-intl/server";

interface HomePageProps {
  params: Promise<{ locale: Locale }>;
}

export default async function HomePage({ params }: HomePageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "home" });

  return (
    <section className="page-section">
      <h1 className="page-title">{t("title")}</h1>
      <p className="page-lede">{t("lede")}</p>
      <div className="surface">
        <div className="surface-header">
          <h2 className="surface-title">{t("explorerTitle")}</h2>
          <span>{t("updated")}</span>
        </div>
        <div className="signal-grid">
          <div className="signal">
            <strong>{t("countriesValue")}</strong>
            <span>{t("countriesLabel")}</span>
          </div>
          <div className="signal">
            <strong>{t("modulesValue")}</strong>
            <span>{t("modulesLabel")}</span>
          </div>
          <div className="signal">
            <strong>{t("sourcesValue")}</strong>
            <span>{t("sourcesLabel")}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
