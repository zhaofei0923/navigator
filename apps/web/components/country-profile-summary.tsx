import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import type { Basic60CountryDetail, Basic60Locale } from "@/lib/basic60/types";

const COPY = {
  "zh-CN": {
    identity: "国家档案",
    more: "更多国家档案",
    localNames: "本地名称",
    capitals: "首都",
    languages: "语言",
    currencies: "货币",
    timezones: "时区",
    primaryTimezone: "主要时区",
    administration: "行政区划",
    countryCodes: "国家代码",
    asOf: "数据截至",
    validPeriod: "适用期间",
    to: "至",
    present: "今",
    unavailable: "暂无数据",
  },
  en: {
    identity: "Country profile",
    more: "More country details",
    localNames: "Local names",
    capitals: "Capitals",
    languages: "Languages",
    currencies: "Currencies",
    timezones: "Time zones",
    primaryTimezone: "Primary time zone",
    administration: "Administrative divisions",
    countryCodes: "Country codes",
    asOf: "Data as of",
    validPeriod: "Validity period",
    to: "to",
    present: "Present",
    unavailable: "Not available",
  },
} as const;

const CAPITAL_ROLES: Record<string, Record<Basic60Locale, string>> = {
  official: { "zh-CN": "官方首都", en: "Official capital" },
  administrative: { "zh-CN": "行政首都", en: "Administrative capital" },
  legislative: { "zh-CN": "立法首都", en: "Legislative capital" },
  judicial: { "zh-CN": "司法首都", en: "Judicial capital" },
  constitutional: { "zh-CN": "法定首都", en: "Constitutional capital" },
  de_jure: { "zh-CN": "法定首都", en: "Legal capital" },
  de_facto: { "zh-CN": "实际行政中心", en: "Administrative centre" },
  royal: { "zh-CN": "王室驻地", en: "Royal seat" },
};

export function CountryProfileSummary({ country, asOf, locale }: {
  country: Basic60CountryDetail;
  asOf: string;
  locale: Basic60Locale;
}) {
  const copy = COPY[locale];
  const capitals = [...(country.capitals ?? [])].sort((a, b) => a.display_order - b.display_order);
  const languages = country.languages ?? [];
  const currencies = country.currencies ?? [];
  const languageName = (item: (typeof languages)[number]) => locale === "en"
    ? item.name_en || item.name_local
    : item.name_local || item.name_en;

  return (
    <section className="country-profile-summary" aria-label={copy.identity}>
      <dl className="country-profile-highlights">
        <ProfileHighlight label={copy.capitals} values={capitals.map((item) => item.name)} empty={copy.unavailable} />
        <ProfileHighlight label={copy.languages} values={languages.map(languageName)} empty={copy.unavailable} />
        <ProfileHighlight label={copy.currencies} values={currencies.map((item) => item.code)} empty={copy.unavailable} />
      </dl>
      <details className="country-profile-details">
        <summary className="country-profile-toggle" tabIndex={0}>{copy.more}<ChevronDown size={16} aria-hidden="true" /></summary>
        <dl className="country-profile-grid">
          <ProfileField label={copy.capitals} empty={copy.unavailable}>
            {capitals.map((item, index) => (
              <div className="country-profile-entry" key={`${item.role}-${item.name}-${index}`}>
                <span>{item.name}</span>
                <small>{CAPITAL_ROLES[item.role]?.[locale] ?? copy.capitals}</small>
                <ValidityPeriod from={item.valid_from} to={item.valid_to} locale={locale} />
              </div>
            ))}
          </ProfileField>
          <ProfileField label={copy.languages} empty={copy.unavailable}>
            {languages.map((item, index) => (
              <div className="country-profile-entry" key={`${item.code}-${index}`}>
                <span>{languageName(item)}</span>
                {item.name_local && item.name_en && item.name_local !== item.name_en
                  ? <small>{locale === "en" ? item.name_local : item.name_en}</small>
                  : null}
              </div>
            ))}
          </ProfileField>
          <ProfileField label={copy.currencies} empty={copy.unavailable}>
            {currencies.map((item, index) => (
              <div className="country-profile-entry" key={`${item.code}-${index}`}>
                <span>{item.code} · {item.name_en}</span>
                <ValidityPeriod from={item.valid_from} to={item.valid_to} locale={locale} />
              </div>
            ))}
          </ProfileField>
          <ProfileField label={copy.timezones} empty={copy.unavailable}>
            {country.timezones?.map((item) => (
              <div className="country-profile-entry" key={item.iana_code}>
                <span>{item.iana_code}</span>
                {item.primary ? <small>{copy.primaryTimezone}</small> : null}
              </div>
            ))}
          </ProfileField>
          <ProfileField label={copy.administration} empty={copy.unavailable}>
            {country.admin_structures?.map((item, index) => (
              <div className="country-profile-entry" key={`${item.admin_level}-${item.unit_type}-${index}`}>
                <span>{item.unit_count} · {item.unit_type}</span>
                <small>{locale === "en" ? `Level ${item.admin_level}` : `第${item.admin_level}级行政区`} · {item.as_of_year}</small>
              </div>
            ))}
          </ProfileField>
          <ProfileField label={copy.localNames} empty={copy.unavailable}>
            {country.local_names?.map((item, index) => (
              <div className="country-profile-entry" key={`${item.locale}-${item.text}-${index}`}>
                <span>{item.text}</span><small>{item.locale}</small>
              </div>
            ))}
          </ProfileField>
          <ProfileField label={copy.countryCodes} empty={copy.unavailable}>
            <div className="country-profile-entry"><span>ISO2 · {country.iso2}</span><span>ISO3 · {country.code}</span></div>
          </ProfileField>
          <ProfileField label={copy.asOf} empty={copy.unavailable}>
            {asOf ? <time dateTime={asOf}>{asOf}</time> : null}
          </ProfileField>
        </dl>
      </details>
    </section>
  );
}

function ProfileHighlight({ label, values, empty }: { label: string; values: string[]; empty: string }) {
  const presentValues = values.filter(Boolean);
  return (
    <div className="country-profile-highlight">
      <dt>{label}</dt>
      <dd title={presentValues.join(" · ") || undefined}>
        {presentValues[0] || empty}{presentValues.length > 1 ? <span className="country-profile-extra">+{presentValues.length - 1}</span> : null}
      </dd>
    </div>
  );
}

function ProfileField({ label, empty, children }: { label: string; empty: string; children: ReactNode }) {
  const hasContent = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return <div className="country-profile-field"><dt>{label}</dt><dd>{hasContent ? children : <span className="basic60-muted">{empty}</span>}</dd></div>;
}

function ValidityPeriod({ from, to, locale }: { from: string | null; to: string | null; locale: Basic60Locale }) {
  if (!from && !to) return null;
  const copy = COPY[locale];
  return <small>{copy.validPeriod} · {from || "—"} {copy.to} {to || copy.present}</small>;
}
