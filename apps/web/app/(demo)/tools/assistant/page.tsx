"use client";

import { Bot, LoaderCircle, Send } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  ControlledAiBadge,
  ResultList,
  ToolPageShell,
  ToolResultState,
} from "@/components/tool-page-shell";
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
import type { AssistantPreview, AssistantQuestionType, CountrySummary } from "@/lib/types";

const COPY = {
  "zh-CN": {
    eyebrow: "受控 AI 演示",
    title: "AI 出海助手",
    description: "选择一个演示国家和业务问题，获得基于固定合成记录的结构化建议。",
    country: "目标市场",
    question: "希望助手协助什么？",
    submit: "生成演示建议",
    loading: "正在组织合成建议…",
    summary: "助手摘要",
    actions: "建议行动",
    evidence: "关联合成记录",
    limitations: "演示限制",
    empty: "选择一个受控问题后，结构化演示建议将在这里显示。",
    nextConcept: "继续形成光储方案",
    compare: "加入双国对比",
    options: {
      market_entry: "市场进入路径",
      policy_risk: "政策与风险检查",
      partner_strategy: "合作伙伴策略",
      tender_readiness: "招标准备度",
    },
  },
  en: {
    eyebrow: "CONTROLLED AI DEMO",
    title: "AI Expansion Assistant",
    description: "Choose a demo market and a business question to receive structured guidance based on fixed synthetic records.",
    country: "Target market",
    question: "What should the assistant help with?",
    submit: "Generate demo guidance",
    loading: "Structuring synthetic guidance…",
    summary: "Assistant summary",
    actions: "Recommended actions",
    evidence: "Related synthetic records",
    limitations: "Demo limitations",
    empty: "Choose a controlled question and your structured demo guidance will appear here.",
    nextConcept: "Continue to solar & storage",
    compare: "Add to two-market comparison",
    options: {
      market_entry: "Market-entry path",
      policy_risk: "Policy and risk check",
      partner_strategy: "Partner strategy",
      tender_readiness: "Tender readiness",
    },
  },
} as const;

const QUESTION_TYPES: AssistantQuestionType[] = [
  "market_entry",
  "policy_risk",
  "partner_strategy",
  "tender_readiness",
];

type AssistantRequest = {
  country_code: string;
  question_type: AssistantQuestionType;
};

export default function AssistantToolPage() {
  const { locale } = useLocale();
  const copy = COPY[locale];
  const searchParams = useSearchParams();
  const countries = useDemoQuery<CountrySummary[]>("countries");
  const [countryCode, setCountryCode] = useState("");
  const [questionType, setQuestionType] = useState<AssistantQuestionType>("market_entry");
  const [result, setResult] = useState<AssistantPreview | null>(null);
  const [resultLocale, setResultLocale] = useState<SupportedLocale | null>(null);
  const [lastRequest, setLastRequest] = useState<AssistantRequest | null>(null);
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
    void demoApi<AssistantPreview>(`demo/tools/assistant/preview?locale=${locale}`, {
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
        setError(reason instanceof Error ? reason.message : locale === "en" ? "Unable to generate guidance." : "暂时无法生成建议。");
      });
    return () => controller.abort();
  }, [lastRequest, lastRequestLocale, locale]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!effectiveCountryCode) return;
    const request: AssistantRequest = {
      country_code: effectiveCountryCode,
      question_type: questionType,
    };
    setLastRequest(request);
    setLastRequestLocale(locale);
    setLoading(true);
    setError(null);
    const requestId = ++requestSequence.current;
    try {
      const response = await demoApi<AssistantPreview>(`demo/tools/assistant/preview?locale=${locale}`, {
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
      setError(reason instanceof Error ? reason.message : locale === "en" ? "Unable to generate guidance." : "暂时无法生成建议。");
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }

  return (
    <ToolPageShell
      eyebrow={copy.eyebrow}
      title={copy.title}
      description={copy.description}
      currentStep="assistant"
      market={market}
      relatedActions={[
        {
          href: toolHref(TOOL_PATHS["solar-storage"], effectiveCountryCode),
          label: copy.nextConcept,
          primary: true,
        },
        { href: comparisonHref(effectiveCountryCode), label: copy.compare },
      ]}
    >
      <div className="tool-workspace">
        <form className="tool-form panel" onSubmit={submit}>
          <label>
            <span>{copy.country}</span>
            <select value={effectiveCountryCode} onChange={(event) => setCountryCode(event.target.value)} disabled={countries.loading}>
              {(countries.data || []).map((country) => (
                <option value={country.code} key={country.code}>
                  {locale === "en" ? country.name_en : country.name_zh}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="tool-choice-group">
            <legend>{copy.question}</legend>
            <ControlledAiBadge />
            {QUESTION_TYPES.map((type) => (
              <label className={questionType === type ? "tool-choice active" : "tool-choice"} key={type}>
                <input
                  type="radio"
                  name="question-type"
                  value={type}
                  checked={questionType === type}
                  onChange={() => setQuestionType(type)}
                />
                <span>{copy.options[type]}</span>
              </label>
            ))}
          </fieldset>
          <button className="button button-primary button-wide button-large" type="submit" disabled={loading || refreshing || !effectiveCountryCode}>
            {loading || refreshing ? <LoaderCircle className="spin" size={18} /> : <Send size={18} />}
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
              <div className="tool-result-hero">
                <span><Bot size={20} /> {copy.summary}</span>
                <h2>{visibleResult.summary}</h2>
              </div>
              <ResultList title={copy.actions} items={visibleResult.actions} ordered />
              <ResultList title={copy.evidence} items={visibleResult.related_items} />
              <ResultList title={copy.limitations} items={visibleResult.limitations} />
            </>
          ) : (
            <ToolResultState status="empty" message={copy.empty} />
          )}
        </div>
      </div>
    </ToolPageShell>
  );
}
