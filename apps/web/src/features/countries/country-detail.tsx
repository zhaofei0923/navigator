import {
  MODULE_KEYS,
  type Locale,
  type ModuleCoverageStatus,
  type ModuleKey,
} from "@navigator/shared-types/schema";
import { useTranslations } from "next-intl";

import {
  buildCountryModuleResponse,
  type CountryModuleCoverageSummary,
  type LocalizedCountryDetail,
  type LocalizedCountryModuleResponse,
  type ModuleResponseRecord,
} from "./country-service";

interface CountryDetailProps {
  country: LocalizedCountryDetail;
  locale: Locale;
}

interface ModuleViewModel {
  coverage: CountryModuleCoverageSummary;
  moduleKey: ModuleKey;
  response: LocalizedCountryModuleResponse | null;
}

const PRIMARY_TEXT_FIELDS = [
  "title",
  "name",
] as const;

const SECONDARY_TEXT_FIELDS = [
  "overview",
  "summary",
  "content",
  "description",
  "abstract",
  "energyDemand",
  "renewableTarget",
  "mitigation",
  "businessScope",
  "caseStudy",
  "contactHint",
  "marketSize",
  "timeWindow",
] as const;

function formatDate(value: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function getCoverage(country: LocalizedCountryDetail, moduleKey: ModuleKey) {
  return (
    country.moduleCoverage.find((item) => item.moduleKey === moduleKey) ?? {
      dataCount: 0,
      moduleKey,
      status: "BUILDING" as const,
      updatedAt: country.updatedAt,
    }
  );
}

function getCompleteModuleCount(country: LocalizedCountryDetail) {
  return country.moduleCoverage.filter((item) => item.status === "COMPLETE")
    .length;
}

function readStringField(
  record: ModuleResponseRecord,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim() !== "") {
      return value;
    }
  }

  return undefined;
}

function readRecordArray(value: unknown): ModuleResponseRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (item): item is ModuleResponseRecord =>
      typeof item === "object" && item !== null && !Array.isArray(item),
  );
}

function CoverageBadge({
  level,
}: {
  level: LocalizedCountryDetail["coverageLevel"];
}) {
  const t = useTranslations("coverage.level");

  return (
    <span className={`coverage-badge coverage-${level.toLowerCase()}`}>
      {t(level)}
    </span>
  );
}

function ModuleStatusBadge({ status }: { status: ModuleCoverageStatus }) {
  const t = useTranslations("coverage.status");

  return (
    <span className={`module-status module-status-${status.toLowerCase()}`}>
      {t(status)}
    </span>
  );
}

function ModulePreviewCard({
  item,
  locale,
}: {
  item: ModuleResponseRecord;
  locale: Locale;
}) {
  const t = useTranslations("common");
  const title = readStringField(item, PRIMARY_TEXT_FIELDS);
  const description = readStringField(item, SECONDARY_TEXT_FIELDS);
  const source = readStringField(item, ["source"]);
  const updatedAt = readStringField(item, ["updatedAt"]);

  return (
    <article className="module-preview-card">
      {title !== undefined ? <h3>{title}</h3> : null}
      {description !== undefined ? <p>{description}</p> : null}
      <dl>
        {source !== undefined ? (
          <div>
            <dt>{t("source")}</dt>
            <dd>{source}</dd>
          </div>
        ) : null}
        {updatedAt !== undefined ? (
          <div>
            <dt>{t("updatedAt")}</dt>
            <dd>{formatDate(updatedAt, locale)}</dd>
          </div>
        ) : null}
      </dl>
    </article>
  );
}

function ObjectModuleBody({
  item,
  locale,
}: {
  item: ModuleResponseRecord;
  locale: Locale;
}) {
  const indicators = readRecordArray(item.keyIndicators);
  const steps = readRecordArray(item.steps);

  return (
    <div className="module-object-body">
      <ModulePreviewCard item={item} locale={locale} />
      {indicators.length > 0 ? (
        <div className="indicator-grid">
          {indicators.map((indicator, index) => {
            const label = readStringField(indicator, ["label"]);
            const value = readStringField(indicator, ["value"]);
            const unit = readStringField(indicator, ["unit"]);
            return (
              <div className="indicator-item" key={`${label ?? "indicator"}-${index}`}>
                {label !== undefined ? <span>{label}</span> : null}
                {value !== undefined ? <strong>{value}</strong> : null}
                {unit !== undefined ? <small>{unit}</small> : null}
              </div>
            );
          })}
        </div>
      ) : null}
      {steps.length > 0 ? (
        <ol className="strategy-step-list">
          {steps.map((step, index) => {
            const title = readStringField(step, ["title"]);
            const detail = readStringField(step, ["detail"]);
            return (
              <li key={`${title ?? "step"}-${index}`}>
                {title !== undefined ? <strong>{title}</strong> : null}
                {detail !== undefined ? <span>{detail}</span> : null}
              </li>
            );
          })}
        </ol>
      ) : null}
    </div>
  );
}

function ModuleSection({
  locale,
  model,
}: {
  locale: Locale;
  model: ModuleViewModel;
}) {
  const t = useTranslations("countries.detail");
  const moduleLabels = useTranslations("countries.modules");
  const coverageText = useTranslations("coverage");
  const fallbackCount = model.response?.data._i18nFallback.length ?? 0;
  const items = model.response?.data.items ?? [];
  const item = model.response?.data.item;

  return (
    <section className="country-module-section" id={model.moduleKey}>
      <header className="module-section-header">
        <div>
          <h2>{moduleLabels(model.moduleKey)}</h2>
          <span>
            {t("moduleUpdated", {
              date: formatDate(model.coverage.updatedAt, locale),
            })}
          </span>
        </div>
        <ModuleStatusBadge status={model.coverage.status} />
      </header>
      {model.coverage.status === "BUILDING" ? (
        <div className="module-building">
          <strong>{t("buildingTitle")}</strong>
          <p>{t("buildingDescription")}</p>
        </div>
      ) : null}
      {model.coverage.status === "PARTIAL" ? (
        <p className="module-status-note">{coverageText("updating")}</p>
      ) : null}
      {model.coverage.status !== "BUILDING" && item !== undefined ? (
        <ObjectModuleBody item={item} locale={locale} />
      ) : null}
      {model.coverage.status !== "BUILDING" && items.length > 0 ? (
        <div className="module-preview-list">
          {items.slice(0, 2).map((moduleItem) => (
            <ModulePreviewCard
              item={moduleItem}
              key={moduleItem.id ?? JSON.stringify(moduleItem)}
              locale={locale}
            />
          ))}
        </div>
      ) : null}
      {model.coverage.status !== "BUILDING" &&
      item === undefined &&
      items.length === 0 ? (
        <div className="module-building">
          <strong>{t("emptyTitle")}</strong>
          <p>{t("emptyDescription")}</p>
        </div>
      ) : null}
      {fallbackCount > 0 ? (
        <p className="translation-fallback-note">
          {t("fallbackNotice", { count: fallbackCount })}
        </p>
      ) : null}
    </section>
  );
}

export function CountryDetail({ country, locale }: CountryDetailProps) {
  const t = useTranslations("countries.detail");
  const moduleLabels = useTranslations("countries.modules");
  const completeModules = getCompleteModuleCount(country);
  const countryFallbackCount = country._i18nFallback.length;
  const moduleModels = MODULE_KEYS.map((moduleKey) => {
    const coverage = getCoverage(country, moduleKey);
    return {
      coverage,
      moduleKey,
      response:
        coverage.status === "BUILDING"
          ? null
          : buildCountryModuleResponse(country.code, moduleKey, { locale }),
    } satisfies ModuleViewModel;
  });

  return (
    <section className="country-detail-page">
      <header className="country-detail-hero">
        <div>
          <span className="flag-code" aria-hidden>
            {country.flagEmoji}
          </span>
          <h1>{country.name}</h1>
          <p>{country.summary}</p>
          {countryFallbackCount > 0 ? (
            <p className="translation-fallback-note">
              {t("fallbackNotice", { count: countryFallbackCount })}
            </p>
          ) : null}
        </div>
        <aside className="country-detail-score">
          <CoverageBadge level={country.coverageLevel} />
          <strong>
            {t("moduleCount", {
              complete: completeModules,
              total: country.moduleCoverage.length,
            })}
          </strong>
          <span>{t("updated", { date: formatDate(country.updatedAt, locale) })}</span>
        </aside>
      </header>
      <div className="country-detail-layout">
        <nav aria-label={t("moduleNav")} className="country-module-nav">
          {moduleModels.map((model) => (
            <a href={`#${model.moduleKey}`} key={model.moduleKey}>
              <span>{moduleLabels(model.moduleKey)}</span>
              <ModuleStatusBadge status={model.coverage.status} />
            </a>
          ))}
        </nav>
        <div className="country-module-stack">
          {moduleModels.map((model) => (
            <ModuleSection key={model.moduleKey} locale={locale} model={model} />
          ))}
        </div>
      </div>
    </section>
  );
}
