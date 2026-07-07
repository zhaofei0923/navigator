import { useTranslations } from "next-intl";

export default function AiAdvisorPage() {
  const t = useTranslations("ai");

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
