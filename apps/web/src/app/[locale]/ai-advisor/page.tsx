import type { Locale } from "@navigator/shared-types/schema";
import { getTranslations, setRequestLocale } from "next-intl/server";

interface AiAdvisorPageProps {
  params: Promise<{ locale: Locale }>;
}

export default async function AiAdvisorPage({ params }: AiAdvisorPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "ai" });

  return (
    <section className="page-section">
      <h1 className="page-title">{t("title")}</h1>
      <p className="page-lede">{t("lede")}</p>
      <div className="surface">
        <div className="surface-header">
          <h2 className="surface-title">{t("readinessTitle")}</h2>
          <span>{t("buildingHint")}</span>
        </div>
        <div className="signal-grid">
          <div className="signal">
            <strong>{t("answerLanguageValue")}</strong>
            <span>{t("answerLanguageLabel")}</span>
          </div>
          <div className="signal">
            <strong>{t("sourcePolicyValue")}</strong>
            <span>{t("sourcePolicyLabel")}</span>
          </div>
          <div className="signal">
            <strong>{t("emptyStateValue")}</strong>
            <span>{t("noData")}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
