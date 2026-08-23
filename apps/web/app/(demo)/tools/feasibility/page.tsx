"use client";

import { FileText, LoaderCircle } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { ResultList, ToolPageShell, ToolResultState } from "@/components/tool-page-shell";
import { useDemoQuery } from "@/hooks/use-demo-query";
import { demoApi } from "@/lib/api-client";
import { useLocale, type SupportedLocale } from "@/lib/i18n";
import {
  comparisonHref,
  resolveToolCountry,
  TOOL_PATHS,
  toolHref,
  toolMarket,
} from "@/lib/tool-journey";
import type {
  CountrySummary,
  FeasibilityPreview,
  FeasibilityProjectType,
  FeasibilitySectionKey,
} from "@/lib/types";

const PROJECT_TYPES: FeasibilityProjectType[] = ["solar_storage", "microgrid", "battery_storage"];
const SECTION_KEYS: FeasibilitySectionKey[] = ["market_context", "technical_concept", "delivery_plan", "risk_review"];

type FeasibilityRequest = {
  country_code: string;
  project_type: FeasibilityProjectType;
  section_keys: FeasibilitySectionKey[];
};

const COPY = {
  "zh-CN": {
    eyebrow: "结构化草案演示",
    title: "可研报告草案",
    description: "从合成市场信息中生成结构化章节预览，帮助内部团队讨论报告范围与下一步补证。",
    country: "目标市场",
    projectType: "项目类型",
    sections: "报告章节",
    submit: "生成报告草案",
    loading: "正在组织报告结构…",
    openQuestions: "待补充问题",
    limitations: "草案限制",
    empty: "选择项目类型和章节后，结构化可研草案将在这里显示。",
    nextTender: "继续投标准备",
    compare: "加入双国对比",
    projectTypes: { solar_storage: "光储项目", microgrid: "微电网", battery_storage: "独立储能" },
    sectionNames: { market_context: "市场背景", technical_concept: "技术概念", delivery_plan: "交付路径", risk_review: "风险复核" },
  },
  en: {
    eyebrow: "STRUCTURED DRAFT DEMO",
    title: "Feasibility Draft",
    description: "Generate a structured preview from synthetic market information to help internal teams agree the report scope and evidence still required.",
    country: "Target market",
    projectType: "Project type",
    sections: "Report sections",
    submit: "Generate report draft",
    loading: "Structuring the report…",
    openQuestions: "Open questions",
    limitations: "Draft limitations",
    empty: "Choose a project type and sections and the structured feasibility draft will appear here.",
    nextTender: "Continue to tender readiness",
    compare: "Add to two-market comparison",
    projectTypes: { solar_storage: "Solar & storage", microgrid: "Microgrid", battery_storage: "Standalone battery storage" },
    sectionNames: { market_context: "Market context", technical_concept: "Technical concept", delivery_plan: "Delivery plan", risk_review: "Risk review" },
  },
} as const;

export default function FeasibilityToolPage() {
  const { locale } = useLocale();
  const copy = COPY[locale];
  const searchParams = useSearchParams();
  const countries = useDemoQuery<CountrySummary[]>("countries");
  const [countryCode, setCountryCode] = useState("");
  const [projectType, setProjectType] = useState<FeasibilityProjectType>("solar_storage");
  const [sections, setSections] = useState<FeasibilitySectionKey[]>([...SECTION_KEYS]);
  const [result, setResult] = useState<FeasibilityPreview | null>(null);
  const [resultLocale, setResultLocale] = useState<SupportedLocale | null>(null);
  const [lastRequest, setLastRequest] = useState<FeasibilityRequest | null>(null);
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
    void demoApi<FeasibilityPreview>(`demo/tools/feasibility-report/preview?locale=${locale}`, {
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
        setError(reason instanceof Error ? reason.message : locale === "en" ? "Unable to generate the report draft." : "暂时无法生成报告草案。");
      });
    return () => controller.abort();
  }, [lastRequest, lastRequestLocale, locale]);

  function toggleSection(section: FeasibilitySectionKey) {
    setSections((current) =>
      current.includes(section)
        ? current.length === 1 ? current : current.filter((item) => item !== section)
        : [...current, section],
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!effectiveCountryCode || !sections.length) return;
    const request: FeasibilityRequest = {
      country_code: effectiveCountryCode,
      project_type: projectType,
      section_keys: sections,
    };
    setLastRequest(request);
    setLastRequestLocale(locale);
    setLoading(true);
    setError(null);
    const requestId = ++requestSequence.current;
    try {
      const response = await demoApi<FeasibilityPreview>(`demo/tools/feasibility-report/preview?locale=${locale}`, {
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
      setError(reason instanceof Error ? reason.message : locale === "en" ? "Unable to generate the report draft." : "暂时无法生成报告草案。");
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }

  return (
    <ToolPageShell
      eyebrow={copy.eyebrow}
      title={copy.title}
      description={copy.description}
      currentStep="feasibility"
      market={market}
      relatedActions={[
        {
          href: toolHref(TOOL_PATHS.tenders, effectiveCountryCode),
          label: copy.nextTender,
          primary: true,
        },
        { href: comparisonHref(effectiveCountryCode), label: copy.compare },
      ]}
    >
      <div className="tool-workspace report-workspace">
        <form className="tool-form panel" onSubmit={submit}>
          <label><span>{copy.country}</span>
            <select value={effectiveCountryCode} onChange={(event) => setCountryCode(event.target.value)} disabled={countries.loading}>
              {(countries.data || []).map((country) => <option value={country.code} key={country.code}>{locale === "en" ? country.name_en : country.name_zh}</option>)}
            </select>
          </label>
          <label><span>{copy.projectType}</span>
            <select value={projectType} onChange={(event) => setProjectType(event.target.value as FeasibilityProjectType)}>
              {PROJECT_TYPES.map((item) => <option value={item} key={item}>{copy.projectTypes[item]}</option>)}
            </select>
          </label>
          <fieldset className="tool-choice-group checkbox-group">
            <legend>{copy.sections}</legend>
            {SECTION_KEYS.map((section) => (
              <label className={sections.includes(section) ? "tool-choice active" : "tool-choice"} key={section}>
                <input type="checkbox" checked={sections.includes(section)} onChange={() => toggleSection(section)} />
                <span>{copy.sectionNames[section]}</span>
              </label>
            ))}
          </fieldset>
          <button className="button button-primary button-wide button-large" type="submit" disabled={loading || refreshing || !effectiveCountryCode || !sections.length}>
            {loading || refreshing ? <LoaderCircle className="spin" size={18} /> : <FileText size={18} />}
            {loading || refreshing ? copy.loading : copy.submit}
          </button>
        </form>

        <article className="tool-result report-preview panel" aria-live="polite">
          {countries.loading || loading || refreshing ? (
            <ToolResultState status="loading" message={copy.loading} />
          ) : toolError ? (
            <ToolResultState status="error" message={toolError} />
          ) : visibleResult ? (
            <>
              <div className="report-preview-heading">
                <span>synthetic_demo</span>
                <h2>{visibleResult.title}</h2>
                <p>{locale === "en" ? "Internal discussion draft · Non-official conclusion" : "内部讨论草案 · 非正式结论"}</p>
              </div>
              <div className="report-sections">
                {visibleResult.sections.map((section, index) => (
                  <section key={section.key}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <div><h3>{section.title}</h3><p>{section.content}</p></div>
                  </section>
                ))}
              </div>
              <ResultList title={copy.openQuestions} items={visibleResult.open_questions} />
              <ResultList title={copy.limitations} items={visibleResult.limitations} />
            </>
          ) : (
            <ToolResultState status="empty" message={copy.empty} />
          )}
        </article>
      </div>
    </ToolPageShell>
  );
}
