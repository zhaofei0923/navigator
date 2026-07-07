import type { Locale } from "@navigator/shared-types/schema";
import { getTranslations, setRequestLocale } from "next-intl/server";

interface ReportsPageProps {
  params: Promise<{ locale: Locale }>;
}

export default async function ReportsPage({ params }: ReportsPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "reports" });

  return (
    <section className="page-section">
      <h1 className="page-title">{t("title")}</h1>
      <p className="page-lede">{t("lede")}</p>
      <div className="surface">
        <div className="surface-header">
          <h2 className="surface-title">{t("libraryTitle")}</h2>
          <span>{t("accessNote")}</span>
        </div>
        <div className="signal-grid">
          <div className="signal">
            <strong>{t("marketReportsValue")}</strong>
            <span>{t("marketReportsLabel")}</span>
          </div>
          <div className="signal">
            <strong>{t("policyTrackersValue")}</strong>
            <span>{t("policyTrackersLabel")}</span>
          </div>
          <div className="signal">
            <strong>{t("dataPacksValue")}</strong>
            <span>{t("dataPacksLabel")}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
