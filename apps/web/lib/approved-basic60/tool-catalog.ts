import type { Basic60Locale } from "@/lib/basic60/types";

export const EXPANSION_TOOL_GROUPS = ["advisor", "project-planning", "tenders"] as const;
export type ExpansionToolGroup = typeof EXPANSION_TOOL_GROUPS[number];

export const EXPANSION_TOOL_PATHS: Record<ExpansionToolGroup, string> = {
  advisor: "/tools/assistant",
  "project-planning": "/tools#project-planning",
  tenders: "/tools/tenders",
};

type ToolGroupCopy = Readonly<{ title: string; description: string }>;

export const EXPANSION_TOOL_COPY: Record<Basic60Locale, Record<ExpansionToolGroup, ToolGroupCopy>> = {
  "zh-CN": {
    advisor: { title: "AI出海顾问", description: "辅助开展市场研究、政策分析与出海路径梳理。" },
    "project-planning": { title: "项目方案制作", description: "辅助整理项目设想、技术方案与可研材料。" },
    tenders: { title: "项目投标机会", description: "了解项目与招标机会，梳理投标准备方向。" },
  },
  en: {
    advisor: { title: "AI Expansion Advisor", description: "Support market research, policy analysis and planning your expansion path." },
    "project-planning": { title: "Project Planning", description: "Develop project ideas, technical concepts and feasibility materials." },
    tenders: { title: "Project & Tender Opportunities", description: "Explore project and tender opportunities and plan your bid preparation." },
  },
};
