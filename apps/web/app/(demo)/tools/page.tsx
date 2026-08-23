"use client";

import Link from "next/link";
import { ArrowRight, Bot, BriefcaseBusiness, FileText, Sparkles, SunMedium } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { useDemoQuery } from "@/hooks/use-demo-query";
import { useLocale } from "@/lib/i18n";
import { resolveToolCountry, toolHref, toolMarket } from "@/lib/tool-journey";
import type { CountrySummary } from "@/lib/types";

const COPY = {
  "zh-CN": {
    eyebrow: "出海工具",
    title: "把出海准备变成一组清晰任务",
    intro: "从市场问题开始，形成概念方案、报告草案和招标准备。每个工具都使用同一组五国合成演示数据。",
    start: "打开工具",
    sequence: "建议工作顺序",
    sequenceText: "先用助手明确市场问题，再形成光储概念和可研草案，最后回到招标机会核对行动。",
    market: "当前演示市场",
    loadingMarket: "正在加载演示市场…",
    items: [
      ["01", "AI 出海助手", "用四类受控问题快速形成市场进入和准备建议。", "/tools/assistant"],
      ["02", "光储方案", "按场景、容量和储能时长生成概念配置。", "/tools/solar-storage"],
      ["03", "可研报告", "把关键判断组织成可讨论的报告草案。", "/tools/feasibility"],
      ["04", "项目招标", "筛选招标并查看预算、阶段与准备动作。", "/tools/tenders"],
    ],
  },
  en: {
    eyebrow: "EXPANSION TOOLS",
    title: "Turn expansion preparation into focused tasks",
    intro: "Start with a market question, shape a concept, assemble a feasibility draft and prepare for tenders—all using the same five synthetic demo markets.",
    start: "Open tool",
    sequence: "Recommended sequence",
    sequenceText: "Clarify the market question with the assistant, shape a solar-storage concept and feasibility draft, then validate actions against tender opportunities.",
    market: "Current demo market",
    loadingMarket: "Loading demo markets…",
    items: [
      ["01", "AI Expansion Assistant", "Use four controlled questions to frame market-entry and readiness guidance.", "/tools/assistant"],
      ["02", "Solar & Storage Concept", "Generate a concept by scenario, capacity and storage duration.", "/tools/solar-storage"],
      ["03", "Feasibility Draft", "Organise key considerations into a discussion-ready report draft.", "/tools/feasibility"],
      ["04", "Project Tenders", "Filter tenders and review budget, stage and preparation actions.", "/tools/tenders"],
    ],
  },
} as const;

const ICONS = [Bot, SunMedium, FileText, BriefcaseBusiness] as const;

export default function ToolsPage() {
  const { locale } = useLocale();
  const copy = COPY[locale];
  const searchParams = useSearchParams();
  const countries = useDemoQuery<CountrySummary[]>("countries");
  const [countryOverride, setCountryOverride] = useState("");
  const countryCode = resolveToolCountry(
    countryOverride || searchParams.get("country"),
    countries.data ?? [],
  );
  const market = toolMarket(countryCode, countries.data ?? [], locale);

  return (
    <section className="tools-hub">
      <header className="tools-hero">
        <div>
          <span className="section-kicker">{copy.eyebrow}</span>
          <h1>{copy.title}</h1>
          <p>{copy.intro}</p>
        </div>
        <div className="tools-hero-note">
          <Sparkles size={22} aria-hidden="true" />
          <strong>{copy.sequence}</strong>
          <p>{copy.sequenceText}</p>
          <label className="tools-market-select">
            <span>{copy.market}</span>
            <select
              value={countryCode}
              onChange={(event) => setCountryOverride(event.target.value)}
              disabled={countries.loading || !countries.data?.length}
            >
              {!countries.data?.length ? <option value="">{copy.loadingMarket}</option> : null}
              {(countries.data ?? []).map((country) => (
                <option value={country.code} key={country.code}>
                  {country.code} · {locale === "en" ? country.name_en : country.name_zh}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      <ol className="tools-task-chain" aria-label={copy.sequence}>
        {copy.items.map(([number, title, description, href], index) => {
          const Icon = ICONS[index];
          return (
            <li key={href}>
              <Link className="tool-task-entry" href={toolHref(href, market?.code ?? "")}>
                <span className="tool-task-number">{number}</span>
                <span className="tool-task-icon"><Icon size={24} aria-hidden="true" /></span>
                <span className="tool-task-copy"><strong>{title}</strong><span>{description}</span></span>
                <span className="tool-card-link">{copy.start} <ArrowRight size={17} aria-hidden="true" /></span>
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
