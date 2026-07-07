import { useTranslations } from "next-intl";

export default function HomePage() {
  const t = useTranslations("home");

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
