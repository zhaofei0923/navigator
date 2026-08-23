"use client";

import { Check, Plus } from "lucide-react";
import { useLocale } from "@/lib/i18n";
import type { CountrySummary } from "@/lib/types";

export function CountryRail({
  countries,
  selectedCode,
  onSelect,
}: {
  countries: CountrySummary[];
  selectedCode: string;
  onSelect: (code: string) => void;
}) {
  const { locale } = useLocale();
  return (
    <div className="country-rail" role="group" aria-label={locale === "en" ? "Select a market" : "选择国家"}>
      {countries.map((country) => {
        const selected = country.code === selectedCode;
        return (
          <button
            key={country.code}
            type="button"
            className={selected ? "country-rail-item country-rail-item-selected" : "country-rail-item"}
            aria-pressed={selected}
            onClick={() => onSelect(country.code)}
          >
            <span>{locale === "en" ? country.name_en : country.name_zh}</span>
            <span className="country-rail-action" aria-hidden="true">
              {selected ? <Check size={16} /> : <Plus size={16} />}
            </span>
          </button>
        );
      })}
    </div>
  );
}
