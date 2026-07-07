import { useTranslations } from "next-intl";

export default function CountriesPage() {
  const t = useTranslations("countries");

  return (
    <section className="page-section">
      <h1 className="page-title">{t("title")}</h1>
      <p className="page-lede">{t("lede")}</p>
      <div className="surface">
        <div className="surface-header">
          <h2 className="surface-title">{t("explorerTitle")}</h2>
          <span>{t("selectedCountry")}</span>
        </div>
        <div className="signal-grid">
          <div className="signal">
            <strong>{t("marketPotentialValue")}</strong>
            <span>{t("marketPotentialLabel")}</span>
          </div>
          <div className="signal">
            <strong>{t("policySupportValue")}</strong>
            <span>{t("policySupportLabel")}</span>
          </div>
          <div className="signal">
            <strong>{t("coverageValue")}</strong>
            <span>{t("coverageLabel")}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
