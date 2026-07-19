import type {
  CoverageLevel,
  IndustryTag,
  Locale,
  Region,
  TechTag,
} from "@navigator/shared-types/schema";
import {
  COVERAGE_LEVELS,
  INDUSTRY_TAGS,
  REGIONS,
  TECH_TAGS,
} from "@navigator/shared-types/schema";
import type { LocalizedCountryCard } from "@navigator/shared-types/country-api";
import Image from "next/image";
import { useTranslations } from "next-intl";
import React from "react";

import { Link } from "../../i18n/navigation";
interface CountryExplorerProps {
  countries: LocalizedCountryCard[];
  locale: Locale;
  searchParams: URLSearchParams;
  total: number;
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
  const signalValue = useTranslations("countries.signals.signalValue");

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
          <span className="country-card-signals">
            {t("opportunity")} {signalValue(country.signals.opportunityLevel)} ·{" "}
            {t("risk")} {signalValue(country.signals.riskLevel)}
          </span>
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

function SignalLevelValue({
  value,
}: {
  value: LocalizedCountryCard["signals"]["opportunityLevel"];
}) {
  const t = useTranslations("countries.signals.signalValue");
  return <span>{t(value)}</span>;
}

function PriorityValue({
  value,
}: {
  value: LocalizedCountryCard["signals"]["recommendedPriority"];
}) {
  const t = useTranslations("countries.signals.priorityValue");
  return <span>{t(value)}</span>;
}

function RecommendedEntryModeValue({
  value,
}: {
  value: LocalizedCountryCard["signals"]["recommendedEntryMode"];
}) {
  const t = useTranslations("countries.signals.signalValue");
  return <span>{value ?? t("DATA_BUILDING")}</span>;
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
          <strong>{t("opportunityLevel")}</strong>
          <SignalLevelValue value={selected.signals.opportunityLevel} />
        </li>
        <li>
          <strong>{t("riskLevel")}</strong>
          <SignalLevelValue value={selected.signals.riskLevel} />
        </li>
        <li>
          <strong>{t("policyFriendliness")}</strong>
          <SignalLevelValue value={selected.signals.policyFriendliness} />
        </li>
        <li>
          <strong>{t("recommendedPriority")}</strong>
          <PriorityValue value={selected.signals.recommendedPriority} />
        </li>
        <li>
          <strong>{t("updatedAt")}</strong>
          <span>{formatDate(selected.signals.updatedAt, locale)}</span>
        </li>
        <li>
          <strong>{t("recommendedEntryMode")}</strong>
          <RecommendedEntryModeValue
            value={selected.signals.recommendedEntryMode}
          />
        </li>
      </ul>
    </aside>
  );
}

export function CountryExplorer({
  countries,
  locale,
  searchParams,
  total,
}: CountryExplorerProps) {
  const t = useTranslations("countries");
  const selected = countries[0];
  const regionLabels = useTranslations("countryMeta.region");
  const industryLabels = useTranslations("countryMeta.industry");
  const techLabels = useTranslations("countryMeta.tech");
  const coverageLabels = useTranslations("coverage.level");

  const coverageOptions = COVERAGE_LEVELS.map((value) => ({
    label: coverageLabels(value),
    value,
  }));
  const regionOptions = REGIONS.map((value: Region) => ({
    label: regionLabels(value),
    value,
  }));
  const industryOptions = INDUSTRY_TAGS.map((value: IndustryTag) => ({
    label: industryLabels(value),
    value,
  }));
  const techOptions = TECH_TAGS.map((value: TechTag) => ({
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
          <ExplorerMap countries={countries} />
          <section className="country-results" aria-label={t("results.label")}>
            <div className="results-heading">
              <h2>{t("results.title")}</h2>
              <span>{t("results.count", { count: total })}</span>
            </div>
            <div className="country-result-list">
              {countries.map((country) => (
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
