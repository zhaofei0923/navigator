import { BASIC_PROFILE_CATEGORY_KEYS } from "@navigator/shared-types/basic-profile";
import type { ModuleResponseRecord } from "@navigator/shared-types/country-api";
import { REGIONS, type Locale } from "@navigator/shared-types/schema";
import { useTranslations } from "next-intl";
import React from "react";

import {
  parseLocalizedBasicProfile,
  type LocalizedBasicProfileField,
  type LocalizedBasicProfileSource,
} from "./basic-profile-parser.js";

interface Props {
  locale: Locale;
  profileValue: ModuleResponseRecord["basicProfile"];
}

function formatProfileDate(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function formatFieldValue(value: number | string, locale: Locale): string {
  if (typeof value === "string") return value;
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
}

function BasicProfileFieldRow({
  field,
  locale,
  regionLabels,
  sourceById,
}: {
  field: LocalizedBasicProfileField;
  locale: Locale;
  regionLabels: ReturnType<typeof useTranslations>;
  sourceById: ReadonlyMap<string, LocalizedBasicProfileSource>;
}) {
  const t = useTranslations("countries.detail.basicProfile");
  const region = typeof field.value === "string"
    ? REGIONS.find((candidate) => candidate === field.value)
    : undefined;
  const value = field.value === null
    ? null
    : region === undefined
      ? formatFieldValue(field.value, locale)
      : regionLabels(region);

  return (
    <div className="basic-profile-field">
      <dt>{field.label}</dt>
      <dd>
        <strong>{field.status === "AVAILABLE" ? t("available") : t("notAvailable")}</strong>
        {value !== null ? <span>{value}</span> : null}
        {field.unit !== null ? <span>{field.unit}</span> : null}
        {field.year !== null ? <span>{t("year", { year: field.year })}</span> : null}
        <span>{t("checkedAt", { date: formatProfileDate(field.checkedAt, locale) })}</span>
        {field.note !== null ? <span>{field.note}</span> : null}
        {field.reason !== null ? <span>{field.reason}</span> : null}
        <span>{t("sources")}</span>
        {field.sourceIds.map((sourceId) => {
          const source = sourceById.get(sourceId);
          if (source === undefined) return null;
          return (
            <a href={source.url} key={source.id} rel="noreferrer noopener" target="_blank">
              {source.title} · {source.publisher}
            </a>
          );
        })}
      </dd>
    </div>
  );
}

function BasicProfileSourceDirectory({
  locale,
  sources,
}: {
  locale: Locale;
  sources: readonly LocalizedBasicProfileSource[];
}) {
  const t = useTranslations("countries.detail.basicProfile");

  return (
    <section className="basic-profile-source-directory" aria-labelledby="basic-profile-sources-title">
      <h4 id="basic-profile-sources-title">{t("sourceDirectory")}</h4>
      <ul>
        {sources.map((source) => (
          <li key={source.id}>
            <a href={source.url} rel="noreferrer noopener" target="_blank">
              {source.title} · {source.publisher}
            </a>
            <span>{t(`credibility.${source.credibility}`)}</span>
            <span>{t("retrievedAt", { date: formatProfileDate(source.retrievedAt, locale) })}</span>
            {source.publishedAt !== null ? (
              <span>{t("publishedAt", { date: formatProfileDate(source.publishedAt, locale) })}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function BasicProfileSection({ profileValue, locale }: Props) {
  const profile = parseLocalizedBasicProfile(profileValue);
  const t = useTranslations("countries.detail.basicProfile");
  const regionLabels = useTranslations("countryMeta.region");
  if (profile === null) return null;

  const sourceById = new Map(
    profile.sources.map((source) => [source.id, source]),
  );

  return (
    <section className="basic-profile" aria-labelledby="basic-profile-title">
      <header className="basic-profile-header">
        <div>
          <h3 id="basic-profile-title">{t("title")}</h3>
          <p>{t("description")}</p>
        </div>
        <span>{t("updated", { date: formatProfileDate(profile.updatedAt, locale) })}</span>
      </header>
      <div className="basic-profile-categories">
        {BASIC_PROFILE_CATEGORY_KEYS.map((categoryKey) => (
          <section className="basic-profile-category" key={categoryKey}>
            <h4>{t(`categories.${categoryKey}`)}</h4>
            <dl>{profile.categories[categoryKey].fields.map((field) => (
              <BasicProfileFieldRow
                field={field}
                key={field.key}
                locale={locale}
                regionLabels={regionLabels}
                sourceById={sourceById}
              />
            ))}</dl>
          </section>
        ))}
      </div>
      <BasicProfileSourceDirectory locale={locale} sources={profile.sources} />
    </section>
  );
}
