import type {
  CoverageLevel,
  IndustryTag,
  Locale,
  Region,
  TechTag,
} from "@navigator/shared-types/schema";
import Image from "next/image";
import { useTranslations } from "next-intl";

import { Link } from "../../i18n/navigation";
import {
  buildCountriesResponse,
  getFilterOptions,
  type LocalizedCountryCard,
} from "./country-service";
import { parseCountryFilters } from "./filter-params";

interface CountryExplorerProps {
  locale: Locale;
  searchParams: URLSearchParams;
}

interface SelectOption<TValue extends string> {
  label: string;
  value: TValue;
}

function formatDate(value: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function getCompleteModuleCount(country: LocalizedCountryCard) {
  return country.moduleCoverage.filter((item) => item.status === "COMPLETE")
    .length;
}

function getActiveModuleCount(country: LocalizedCountryCard) {
  return country.moduleCoverage.filter((item) => item.status !== "BUILDING")
    .length;
}

function formatModuleCount(country: LocalizedCountryCard) {
  return `${getCompleteModuleCount(country)}/${country.moduleCoverage.length}`;
}

function getSelectedValue(searchParams: URLSearchParams, key: string) {
  return searchParams.get(key) ?? "";
}

function SelectField<TValue extends string>({
  label,
  name,
  options,
  value,
}: {
  label: string;
  name: string;
  options: SelectOption<TValue>[];
  value: string;
}) {
  const t = useTranslations("countries.filters");

  return (
    <label className="filter-field">
      <span>{label}</span>
      <select aria-label={label} defaultValue={value} name={name}>
        <option value="">{t("all")}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function CoverageBadge({ level }: { level: CoverageLevel }) {
  const t = useTranslations("coverage.level");

  return (
    <span className={`coverage-badge coverage-${level.toLowerCase()}`}>
      {t(level)}
    </span>
  );
}

function CountryResultCard({
  country,
  locale,
}: {
  country: LocalizedCountryCard;
  locale: Locale;
}) {
  const t = useTranslations("countries.card");

  return (
    <article className="country-result" aria-label={country.name}>
      <Link className="country-result-link" href={`/countries/${country.code}`}>
        <span className="flag-code" aria-hidden>
          {country.flagEmoji}
        </span>
        <span className="country-copy">
          <strong>{country.name}</strong>
          <span>{country.summary}</span>
          <small>
            {t("updated")} {formatDate(country.updatedAt, locale)}
          </small>
        </span>
        <span className="country-score">
          <CoverageBadge level={country.coverageLevel} />
          <span>{formatModuleCount(country)}</span>
        </span>
      </Link>
    </article>
  );
}

function ExplorerMap({ countries }: { countries: LocalizedCountryCard[] }) {
  const t = useTranslations("countries.map");

  return (
    <section className="explorer-map" aria-label={t("label")}>
      <div className="map-toolbar">
        <div>
          <h2>{t("title")}</h2>
          <p>{t("description")}</p>
        </div>
        <div className="map-mode-group" aria-label={t("modeLabel")}>
          <span>{t("coverageReadiness")}</span>
          <span>{t("publishedModules")}</span>
          <span>{t("latestUpdate")}</span>
        </div>
      </div>
      <div className="map-canvas">
        <Image
          alt={t("imageAlt")}
          className="map-visual-asset"
          fill
          priority
          sizes="(max-width: 900px) 100vw, 60vw"
          src="/images/energy-data-explorer-map.png"
        />
        <div className="map-grid" />
        {countries.map((country, index) => (
          <div
            className={`map-node map-node-${index + 1}`}
            key={country.code}
          >
            <span>{country.code}</span>
            <strong>{formatModuleCount(country)}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function KeySignals({
  locale,
  selected,
}: {
  locale: Locale;
  selected: LocalizedCountryCard | undefined;
}) {
  const t = useTranslations("countries.signals");

  if (selected === undefined) {
    return (
      <aside className="country-side-panel">
        <h2>{t("emptyTitle")}</h2>
        <p>{t("emptyDescription")}</p>
      </aside>
    );
  }

  const completeModules = getCompleteModuleCount(selected);
  const activeModules = getActiveModuleCount(selected);

  return (
    <aside className="country-side-panel">
      <div className="side-panel-heading">
        <span className="flag-code" aria-hidden>
          {selected.flagEmoji}
        </span>
        <div>
          <h2>{selected.name}</h2>
          <CoverageBadge level={selected.coverageLevel} />
        </div>
      </div>
      <ul className="signal-list">
        <li>
          <strong>{t("coverageLevel")}</strong>
          <span>{t(`coverageValue.${selected.coverageLevel}`)}</span>
        </li>
        <li>
          <strong>{t("completeModules")}</strong>
          <span>
            {t("moduleCount", {
              count: completeModules,
              total: selected.moduleCoverage.length,
            })}
          </span>
        </li>
        <li>
          <strong>{t("activeModules")}</strong>
          <span>
            {t("moduleCount", {
              count: activeModules,
              total: selected.moduleCoverage.length,
            })}
          </span>
        </li>
        <li>
          <strong>{t("updatedAt")}</strong>
          <span>{formatDate(selected.updatedAt, locale)}</span>
        </li>
      </ul>
    </aside>
  );
}

export function CountryExplorer({ locale, searchParams }: CountryExplorerProps) {
  const t = useTranslations("countries");
  const filters = parseCountryFilters({ locale, searchParams });
  const response = buildCountriesResponse(filters);
  const options = getFilterOptions();
  const selected = response.data[0];
  const regionLabels = useTranslations("countryMeta.region");
  const industryLabels = useTranslations("countryMeta.industry");
  const techLabels = useTranslations("countryMeta.tech");
  const coverageLabels = useTranslations("coverage.level");

  const coverageOptions = options.coverageLevels.map((value) => ({
    label: coverageLabels(value),
    value,
  }));
  const regionOptions = options.regions.map((value: Region) => ({
    label: regionLabels(value),
    value,
  }));
  const industryOptions = options.industryTags.map((value: IndustryTag) => ({
    label: industryLabels(value),
    value,
  }));
  const techOptions = options.techTags.map((value: TechTag) => ({
    label: techLabels(value),
    value,
  }));

  return (
    <section className="country-explorer-page">
      <header className="country-page-heading">
        <div>
          <h1>{t("title")}</h1>
          <p>{t("lede")}</p>
        </div>
        <span className="data-pill">{t("dataPolicy")}</span>
      </header>
      <div className="country-explorer-layout">
        <aside className="filter-panel">
          <h2>{t("filters.title")}</h2>
          <p>{t("filters.description")}</p>
          <form className="filter-form" action={`/${locale}/countries`}>
            <SelectField
              label={t("filters.region")}
              name="region"
              options={regionOptions}
              value={getSelectedValue(searchParams, "region")}
            />
            <SelectField
              label={t("filters.industry")}
              name="industryTags"
              options={industryOptions}
              value={getSelectedValue(searchParams, "industryTags")}
            />
            <SelectField
              label={t("filters.technology")}
              name="techTags"
              options={techOptions}
              value={getSelectedValue(searchParams, "techTags")}
            />
            <SelectField
              label={t("filters.coverage")}
              name="coverageLevel"
              options={coverageOptions}
              value={getSelectedValue(searchParams, "coverageLevel")}
            />
            <button className="primary-action" type="submit">
              {t("filters.apply")}
            </button>
            <Link className="secondary-action" href="/countries">
              {t("filters.reset")}
            </Link>
          </form>
        </aside>
        <div className="explorer-main">
          <ExplorerMap countries={response.data} />
          <section className="country-results" aria-label={t("results.label")}>
            <div className="results-heading">
              <h2>{t("results.title")}</h2>
              <span>{t("results.count", { count: response.meta.total })}</span>
            </div>
            <div className="country-result-list">
              {response.data.map((country) => (
                <CountryResultCard
                  country={country}
                  key={country.code}
                  locale={locale}
                />
              ))}
            </div>
          </section>
        </div>
        <KeySignals locale={locale} selected={selected} />
      </div>
    </section>
  );
}
