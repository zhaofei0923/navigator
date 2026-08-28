import { ArrowLeft, ArrowRight, Bot, BriefcaseBusiness, Building2, Construction, FileText, Globe2, SunMedium } from "lucide-react";
import Link from "next/link";
import { homeMarketHref } from "@/lib/approved-basic60/navigation";
import { EXPANSION_TOOL_COPY, EXPANSION_TOOL_GROUPS, EXPANSION_TOOL_PATHS, type ExpansionToolGroup } from "@/lib/approved-basic60/tool-catalog";
import { normalizeOutboundCountryParam } from "@/lib/basic60/market-scope";
import type { Basic60Locale } from "@/lib/basic60/types";
import { TOOL_PATHS, toolHref, type JourneyStep } from "@/lib/tool-journey";

export type ApprovedBasic60ModuleKind = "partners";

const COPY = {
  "zh-CN": {
    toolsTitle: "出海工具",
    toolsIntro: "从市场与政策研究，到项目方案与投标机会，按你的业务阶段找到下一步。",
    groups: "三个出海工具方向",
    planned: "即将上线",
    learn: "了解功能",
    market: "目标市场",
    noMarket: "尚未选择目标市场",
    chooseMarket: "选择目标市场",
    countryData: "查看国家数据",
    home: "返回首页地图",
    backTools: "返回出海工具",
    planningIntro: "将项目设想逐步整理为技术方案和可研材料。选择适合当前阶段的准备工作。",
    toolsBoundary: "这些工具正在建设中。你可以先了解目标市场，为后续研究与项目准备积累信息。",
    featureBoundary: "该功能正在建设中，尚不提供分析、测算或结果生成。",
    next: "继续探索",
    partnersTitle: "合作伙伴",
    partnersIntro: "了解合作伙伴与专业服务资源，为业务拓展和项目推进寻找协作支持。",
    partnersEmptyTitle: "合作伙伴服务即将上线",
    partnersEmptyBody: "伙伴名录与对接功能正在建设中。你可以先了解目标市场，为后续协作做好准备。",
    partners: "了解合作伙伴",
    tools: "了解出海工具",
    featureTitle: {
      assistant: "AI出海顾问",
      "solar-storage": "光储方案",
      feasibility: "可研报告",
      tenders: "项目投标机会",
    },
    featureBody: {
      assistant: "辅助开展市场研究、政策分析与出海路径梳理。",
      "solar-storage": "围绕用能需求与项目设想，准备光伏和储能方案。",
      feasibility: "将市场信息、技术方案与项目设想整理为可研材料。",
      tenders: "了解项目与招标机会，梳理投标准备方向。",
    },
    featurePlanned: {
      assistant: "市场研究、政策分析与出海建议功能正在建设中。",
      "solar-storage": "容量配置、方案测算与技术方案制作功能正在建设中。",
      feasibility: "可研材料组织、报告编写与导出功能正在建设中。",
      tenders: "项目与招标检索、机会跟进和投标准备功能正在建设中。",
    },
  },
  en: {
    toolsTitle: "Expansion tools",
    toolsIntro: "Find your next step in market and policy research, project planning and tender opportunities.",
    groups: "Three expansion tool areas",
    planned: "Coming soon",
    learn: "Explore feature",
    market: "Target market",
    noMarket: "No target market selected",
    chooseMarket: "Choose a target market",
    countryData: "View country data",
    home: "Back to the home map",
    backTools: "Back to expansion tools",
    planningIntro: "Develop project ideas into technical concepts and feasibility materials. Choose the preparation work for your current stage.",
    toolsBoundary: "These tools are in development. Explore your target market while preparing your research and project plans.",
    featureBoundary: "This feature is in development. Analysis, calculations and generated results are not available yet.",
    next: "Explore more",
    partnersTitle: "Partners",
    partnersIntro: "Explore partners and professional services to support business development and project delivery.",
    partnersEmptyTitle: "Partner services are coming soon",
    partnersEmptyBody: "Partner profiles and connection services are in development. Explore your target market while preparing for collaboration.",
    partners: "Explore partners",
    tools: "Explore expansion tools",
    featureTitle: {
      assistant: "AI Expansion Advisor",
      "solar-storage": "Solar & Storage Concept",
      feasibility: "Feasibility Report",
      tenders: "Project & Tender Opportunities",
    },
    featureBody: {
      assistant: "Support market research, policy analysis and planning your expansion path.",
      "solar-storage": "Prepare solar and storage concepts around your energy needs and project ideas.",
      feasibility: "Organise market information, technical concepts and project ideas into feasibility materials.",
      tenders: "Explore project and tender opportunities and plan your bid preparation.",
    },
    featurePlanned: {
      assistant: "Market research, policy analysis and expansion guidance are in development.",
      "solar-storage": "Capacity planning, calculations and technical concept creation are in development.",
      feasibility: "Feasibility materials, report drafting and export are in development.",
      tenders: "Project and tender search, opportunity tracking and bid preparation are in development.",
    },
  },
} as const;

const GROUP_ICONS = { advisor: Bot, "project-planning": FileText, tenders: BriefcaseBusiness } as const;
const FEATURE_ICONS = { assistant: Bot, "solar-storage": SunMedium, feasibility: FileText, tenders: BriefcaseBusiness } as const;
const PLANNING_STEPS = ["solar-storage", "feasibility"] as const;

type PageProps = Readonly<{
  locale: Basic60Locale;
  countryCode?: string | null;
  basePath?: "" | "/basic60";
}>;

export function approvedBasic60CountryParam(value: string | string[] | undefined): string | null {
  return normalizeOutboundCountryParam(Array.isArray(value) ? value[0] : value);
}

function MarketContext({ locale, countryCode, basePath = "" }: PageProps) {
  const copy = COPY[locale];
  const code = normalizeOutboundCountryParam(countryCode);
  return <div className="expansion-market-context" aria-label={copy.market}>
    <span>{copy.market}</span><strong>{code ?? copy.noMarket}</strong>
    <Link href={code ? basePath + "/countries/" + code : homeMarketHref(undefined, basePath)}>
      {code ? copy.countryData : copy.chooseMarket}<ArrowRight size={15} aria-hidden="true" />
    </Link>
  </div>;
}

export function ApprovedBasic60ModulePage({ locale, countryCode, basePath = "" }: PageProps & { kind: ApprovedBasic60ModuleKind }) {
  const copy = COPY[locale];
  const code = normalizeOutboundCountryParam(countryCode);
  return <section className="partners-page expansion-module">
    <header className="page-heading">
      <div><h1>{copy.partnersTitle}</h1><p>{copy.partnersIntro}</p></div>
      <MarketContext locale={locale} countryCode={code} basePath={basePath} />
    </header>
    <div className="expansion-unavailable panel" role="status">
      <span className="home-tool-icon"><Building2 size={30} aria-hidden="true" /></span>
      <span className="type-tag">{copy.planned}</span>
      <h2>{copy.partnersEmptyTitle}</h2><p>{copy.partnersEmptyBody}</p>
    </div>
    <NextActions locale={locale} countryCode={code} basePath={basePath} />
  </section>;
}

export function ApprovedBasic60ToolsHub({ locale, countryCode, basePath = "" }: PageProps) {
  const copy = COPY[locale];
  const code = normalizeOutboundCountryParam(countryCode);
  return <section className="tools-hub expansion-tools">
    <header className="tools-hero">
      <div><h1>{copy.toolsTitle}</h1><p>{copy.toolsIntro}</p></div>
      <MarketContext locale={locale} countryCode={code} basePath={basePath} />
    </header>
    <ol className="home-tool-grid expansion-tool-groups" aria-label={copy.groups}>
      {EXPANSION_TOOL_GROUPS.map((group) => {
        const tool = EXPANSION_TOOL_COPY[locale][group];
        const Icon = GROUP_ICONS[group];
        return <li className="home-tool-card" key={group}>
          <div className="home-tool-topline"><span className="home-tool-icon"><Icon size={26} aria-hidden="true" /></span><span className="type-tag">{copy.planned}</span></div>
          <h2>{tool.title}</h2><p>{tool.description}</p>
          <Link href={toolHref(basePath + EXPANSION_TOOL_PATHS[group], code ?? "")} aria-label={copy.learn + " · " + tool.title}>{copy.learn}<ArrowRight size={17} aria-hidden="true" /></Link>
        </li>;
      })}
    </ol>
    <section className="project-planning-section" id="project-planning" aria-labelledby="project-planning-title" tabIndex={-1}>
      <div className="landing-section-heading"><h2 id="project-planning-title">{EXPANSION_TOOL_COPY[locale]["project-planning"].title}</h2><p>{copy.planningIntro}</p></div>
      <div className="project-planning-options">
        {PLANNING_STEPS.map((step) => {
          const Icon = FEATURE_ICONS[step];
          return <article className="project-planning-option panel" key={step}>
            <Icon size={27} aria-hidden="true" /><div><h3>{copy.featureTitle[step]}</h3><p>{copy.featureBody[step]}</p><span className="type-tag">{copy.planned}</span></div>
            <Link href={toolHref(basePath + TOOL_PATHS[step], code ?? "")} aria-label={copy.learn + " · " + copy.featureTitle[step]}>{copy.learn}<ArrowRight size={17} aria-hidden="true" /></Link>
          </article>;
        })}
      </div>
    </section>
    <div className="tool-boundary" role="note"><Construction size={18} aria-hidden="true" /><span>{copy.toolsBoundary}</span></div>
    <NextActions locale={locale} countryCode={code} basePath={basePath} showTools={false} />
  </section>;
}

export function ApprovedBasic60ToolPlaceholder({ step, locale, countryCode, basePath = "" }: PageProps & { step: JourneyStep }) {
  const copy = COPY[locale];
  const code = normalizeOutboundCountryParam(countryCode);
  const Icon = FEATURE_ICONS[step];
  const activeGroup: ExpansionToolGroup = step === "assistant" ? "advisor" : step === "tenders" ? "tenders" : "project-planning";
  return <section className="tool-page expansion-tool-page">
    <Link className="back-link" href={toolHref(basePath + "/tools", code ?? "")}><ArrowLeft size={16} aria-hidden="true" />{copy.backTools}</Link>
    <div className="tool-page-intro">
      <header className="tool-page-heading"><h1>{copy.featureTitle[step]}</h1><p>{copy.featureBody[step]}</p></header>
      <MarketContext locale={locale} countryCode={code} basePath={basePath} />
    </div>
    <nav className="tool-journey tool-journey-three" aria-label={copy.groups}>
      <ol>{EXPANSION_TOOL_GROUPS.map((group, index) => <li className={group === activeGroup ? "active" : undefined} key={group}>
        <Link href={toolHref(basePath + EXPANSION_TOOL_PATHS[group], code ?? "")} aria-current={group === activeGroup ? "step" : undefined}>
          <span>{String(index + 1).padStart(2, "0")}</span><strong>{EXPANSION_TOOL_COPY[locale][group].title}</strong>
        </Link>
      </li>)}</ol>
    </nav>
    <section className="expansion-unavailable panel" role="status" aria-label={copy.featureTitle[step]}>
      <span className="home-tool-icon"><Icon size={32} aria-hidden="true" /></span><span className="type-tag">{copy.planned}</span>
      <h2>{copy.featurePlanned[step]}</h2><p>{copy.featureBoundary}</p>
    </section>
    <NextActions locale={locale} countryCode={code} basePath={basePath} />
  </section>;
}

function NextActions({ locale, countryCode, basePath = "", showTools = true }: PageProps & { showTools?: boolean }) {
  const copy = COPY[locale];
  const code = normalizeOutboundCountryParam(countryCode);
  return <section className="tool-next-actions" aria-label={copy.next}>
    <div><h2>{copy.next}</h2></div>
    <div className="tool-next-action-links">
      <Link className="button button-primary" href={homeMarketHref(code, basePath)}><Globe2 size={17} aria-hidden="true" />{copy.home}</Link>
      {showTools ? <Link className="button button-secondary" href={toolHref(basePath + "/tools", code ?? "")}>{copy.tools}<ArrowRight size={16} aria-hidden="true" /></Link> : <Link className="button button-secondary" href={toolHref(basePath + "/partners", code ?? "")}>{copy.partners}<ArrowRight size={16} aria-hidden="true" /></Link>}
    </div>
  </section>;
}
