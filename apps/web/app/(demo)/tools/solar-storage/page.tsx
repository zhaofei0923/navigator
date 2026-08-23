"use client";

import { LoaderCircle, SlidersHorizontal, SunMedium } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { ResultList, ToolPageShell, ToolResultState } from "@/components/tool-page-shell";
import { useDemoQuery } from "@/hooks/use-demo-query";
import { demoApi } from "@/lib/api-client";
import { formatNumber } from "@/lib/format";
import { useLocale, type SupportedLocale } from "@/lib/i18n";
import {
  comparisonHref,
  resolveToolCountry,
  TOOL_PATHS,
  toolHref,
  toolMarket,
} from "@/lib/tool-journey";
import type { CountrySummary, SolarStoragePreview, SolarStorageScenario } from "@/lib/types";

const SCENARIOS: SolarStorageScenario[] = ["utility_scale", "commercial_industrial", "island_microgrid"];

type SolarStorageRequest = {
  country_code: string;
  scenario: SolarStorageScenario;
  solar_capacity_mw: number;
  storage_duration_hours: number;
};

const COPY = {
  "zh-CN": {
    eyebrow: "合成概念生成",
    title: "光储概念方案",
    description: "用受控参数快速形成可讨论的光伏与储能概念配置，不替代工程设计或投资测算。",
    country: "目标市场",
    scenario: "应用场景",
    capacity: "光伏容量（MW）",
    duration: "储能时长（小时）",
    submit: "生成概念方案",
    loading: "正在生成合成配置…",
    configuration: "概念配置",
    assumptions: "关键假设",
    risks: "需进一步核实的风险",
    next: "建议下一步",
    empty: "设置受控容量和场景参数后，合成概念方案将在这里显示。",
    nextFeasibility: "继续形成可研草案",
    compare: "加入双国对比",
    hours: (value: number) => `${formatNumber(value, 0, "zh-CN")} 小时`,
    scenarios: {
      utility_scale: "大型地面电站",
      commercial_industrial: "工商业园区",
      island_microgrid: "离网或岛屿微网",
    },
  },
  en: {
    eyebrow: "SYNTHETIC CONCEPT BUILDER",
    title: "Solar & Storage Concept",
    description: "Use controlled parameters to shape a discussion-ready solar and storage concept—not an engineering design or investment calculation.",
    country: "Target market",
    scenario: "Application scenario",
    capacity: "Solar capacity (MW)",
    duration: "Storage duration (hours)",
    submit: "Generate concept",
    loading: "Generating synthetic configuration…",
    configuration: "Concept configuration",
    assumptions: "Key assumptions",
    risks: "Risks to validate",
    next: "Recommended next steps",
    empty: "Set controlled capacity and scenario parameters and the synthetic concept will appear here.",
    nextFeasibility: "Continue to feasibility draft",
    compare: "Add to two-market comparison",
    hours: (value: number) => `${formatNumber(value, 0, "en")} ${value === 1 ? "hour" : "hours"}`,
    scenarios: {
      utility_scale: "Utility-scale plant",
      commercial_industrial: "Commercial & industrial site",
      island_microgrid: "Off-grid or island microgrid",
    },
  },
} as const;

export default function SolarStorageToolPage() {
  const { locale } = useLocale();
  const copy = COPY[locale];
  const searchParams = useSearchParams();
  const countries = useDemoQuery<CountrySummary[]>("countries");
  const [countryCode, setCountryCode] = useState("");
  const [scenario, setScenario] = useState<SolarStorageScenario>("utility_scale");
  const [capacity, setCapacity] = useState(100);
  const [duration, setDuration] = useState(4);
  const [result, setResult] = useState<SolarStoragePreview | null>(null);
  const [resultLocale, setResultLocale] = useState<SupportedLocale | null>(null);
  const [lastRequest, setLastRequest] = useState<SolarStorageRequest | null>(null);
  const [lastRequestLocale, setLastRequestLocale] = useState<SupportedLocale | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);

  const effectiveCountryCode = resolveToolCountry(
    countryCode || searchParams.get("country"),
    countries.data ?? [],
  );
  const market = toolMarket(effectiveCountryCode, countries.data ?? [], locale);
  const refreshing = Boolean(lastRequest && lastRequestLocale !== locale);
  const visibleResult = resultLocale === locale ? result : null;
  const visibleError = lastRequestLocale === locale ? error : null;
  const toolError = countries.error ?? visibleError;

  useEffect(() => {
    if (!lastRequest || lastRequestLocale === locale) return;
    const controller = new AbortController();
    const requestId = ++requestSequence.current;
    void demoApi<SolarStoragePreview>(`demo/tools/solar-storage/preview?locale=${locale}`, {
      method: "POST",
      body: JSON.stringify(lastRequest),
      signal: controller.signal,
    })
      .then((response) => {
        if (requestId !== requestSequence.current) return;
        setResult(response.data);
        setResultLocale(locale);
        setLastRequestLocale(locale);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted || requestId !== requestSequence.current) return;
        setResult(null);
        setResultLocale(locale);
        setLastRequestLocale(locale);
        setError(reason instanceof Error ? reason.message : locale === "en" ? "Unable to generate the concept." : "暂时无法生成概念方案。");
      });
    return () => controller.abort();
  }, [lastRequest, lastRequestLocale, locale]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!effectiveCountryCode) return;
    const request: SolarStorageRequest = {
      country_code: effectiveCountryCode,
      scenario,
      solar_capacity_mw: capacity,
      storage_duration_hours: duration,
    };
    setLastRequest(request);
    setLastRequestLocale(locale);
    setLoading(true);
    setError(null);
    const requestId = ++requestSequence.current;
    try {
      const response = await demoApi<SolarStoragePreview>(`demo/tools/solar-storage/preview?locale=${locale}`, {
        method: "POST",
        body: JSON.stringify(request),
      });
      if (requestId !== requestSequence.current) return;
      setResult(response.data);
      setResultLocale(locale);
    } catch (reason: unknown) {
      if (requestId !== requestSequence.current) return;
      setResult(null);
      setResultLocale(locale);
      setError(reason instanceof Error ? reason.message : locale === "en" ? "Unable to generate the concept." : "暂时无法生成概念方案。");
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }

  return (
    <ToolPageShell
      eyebrow={copy.eyebrow}
      title={copy.title}
      description={copy.description}
      currentStep="solar-storage"
      market={market}
      relatedActions={[
        {
          href: toolHref(TOOL_PATHS.feasibility, effectiveCountryCode),
          label: copy.nextFeasibility,
          primary: true,
        },
        { href: comparisonHref(effectiveCountryCode), label: copy.compare },
      ]}
    >
      <div className="tool-workspace">
        <form className="tool-form panel" onSubmit={submit}>
          <label><span>{copy.country}</span>
            <select value={effectiveCountryCode} onChange={(event) => setCountryCode(event.target.value)} disabled={countries.loading}>
              {(countries.data || []).map((country) => <option value={country.code} key={country.code}>{locale === "en" ? country.name_en : country.name_zh}</option>)}
            </select>
          </label>
          <label><span>{copy.scenario}</span>
            <select value={scenario} onChange={(event) => setScenario(event.target.value as SolarStorageScenario)}>
              {SCENARIOS.map((item) => <option value={item} key={item}>{copy.scenarios[item]}</option>)}
            </select>
          </label>
          <div className="tool-form-columns">
            <label><span>{copy.capacity}</span>
              <input type="number" min="0.1" max="1000" step="0.1" value={capacity} onChange={(event) => setCapacity(Number(event.target.value))} required />
            </label>
            <label><span>{copy.duration}</span>
              <input type="number" min="1" max="12" step="1" value={duration} onChange={(event) => setDuration(Number(event.target.value))} required />
            </label>
          </div>
          <div className="concept-preview-line" aria-live="polite">
            <SlidersHorizontal size={17} />
            <span>{formatNumber(capacity, 1, locale)} MW · {copy.hours(duration)} · {copy.scenarios[scenario]}</span>
          </div>
          <button className="button button-primary button-wide button-large" type="submit" disabled={loading || refreshing || !effectiveCountryCode}>
            {loading || refreshing ? <LoaderCircle className="spin" size={18} /> : <SunMedium size={18} />}
            {loading || refreshing ? copy.loading : copy.submit}
          </button>
        </form>

        <div className="tool-result panel" aria-live="polite">
          {countries.loading || loading || refreshing ? (
            <ToolResultState status="loading" message={copy.loading} />
          ) : toolError ? (
            <ToolResultState status="error" message={toolError} />
          ) : visibleResult ? (
            <>
              <div className="tool-result-hero compact-result">
                <span><SunMedium size={20} /> {copy.configuration}</span>
                <h2>
                  {lastRequest
                    ? `${formatNumber(lastRequest.solar_capacity_mw, 1, locale)} MW · ${copy.hours(lastRequest.storage_duration_hours)}`
                    : null}
                </h2>
              </div>
              <ResultList title={copy.configuration} items={visibleResult.configuration} />
              <ResultList title={copy.assumptions} items={visibleResult.assumptions} />
              <ResultList title={copy.risks} items={visibleResult.risks} />
              <ResultList title={copy.next} items={visibleResult.next_steps} ordered />
            </>
          ) : (
            <ToolResultState status="empty" message={copy.empty} />
          )}
        </div>
      </div>
    </ToolPageShell>
  );
}
