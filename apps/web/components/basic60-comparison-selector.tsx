"use client";

import { GitCompareArrows } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { isOutboundTargetCountry, outboundComparisonCodes } from "@/lib/basic60/market-scope";
import type { Basic60Locale } from "@/lib/basic60/types";

export type Basic60CountryOption = { code: string; label: string };

const COPY = {
  "zh-CN": { slots: ["国家 A", "国家 B", "国家 C（可选）", "国家 D（可选）"], placeholder: "请选择国家", submit: "生成指标比较", error: "请选择2—4个不同国家。" },
  en: { slots: ["Country A", "Country B", "Country C (optional)", "Country D (optional)"], placeholder: "Select a country", submit: "Compare indicators", error: "Select 2–4 different countries." },
} as const;

export function Basic60ComparisonSelector({
  options,
  initialCodes,
  locale,
  comparisonPath = "/basic60/compare",
}: {
  options: Basic60CountryOption[];
  initialCodes: string[];
  locale: Basic60Locale;
  comparisonPath?: string;
}) {
  const router = useRouter();
  const copy = COPY[locale];
  const targetOptions = options.filter(isOutboundTargetCountry);
  const availableCodes = new Set(targetOptions.map((option) => option.code));
  const [codes, setCodes] = useState(() => {
    const initialTargets = outboundComparisonCodes(initialCodes).filter((code) => availableCodes.has(code));
    return [0, 1, 2, 3].map((index) => initialTargets[index] ?? "");
  });
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const selected = codes.filter(Boolean);
    if (selected.length < 2 || new Set(selected).size !== selected.length || selected.some((code) => !availableCodes.has(code))) {
      setError(copy.error);
      return;
    }
    const params = new URLSearchParams();
    selected.forEach((code) => params.append("countries", code));
    router.push(`${comparisonPath}?${params}`);
  }

  return (
    <form className="basic60-compare-selector" onSubmit={submit}>
      <div className="basic60-compare-selects">
        {copy.slots.map((label, index) => (
          <label key={label}>
            <span>{label}</span>
            <select
              value={codes[index]}
              aria-required={index < 2}
              onChange={(event) => {
                const next = [...codes];
                next[index] = event.target.value;
                setCodes(next);
                setError(null);
              }}
            >
              <option value="">{copy.placeholder}</option>
              {targetOptions.map((option) => (
                <option
                  value={option.code}
                  key={option.code}
                  disabled={codes.some((code, codeIndex) => codeIndex !== index && code === option.code)}
                >
                  {option.code} · {option.label}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button className="button button-primary" type="submit"><GitCompareArrows size={17} />{copy.submit}</button>
    </form>
  );
}
