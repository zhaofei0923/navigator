// Explicitly synthetic fixtures for developer tests only. No runtime imports.
import type { Basic60CountryDetail, Basic60Locale } from "@/lib/basic60/types";
import type { MarketOverviewEnvelope } from "@/lib/market-content/types";

export function overviewFixture(locale: Basic60Locale = "zh-CN", code = "IDN", paragraphCount = 6): MarketOverviewEnvelope {
  const zhText = "本段仅为开发测试所使用的合成文字，用于验证国别概览的阅读宽度、段落顺序与排版，不描述实际国家、现行规则、项目或市场机会，也不构成任何业务判断。";
  const paragraphs = Array.from({ length: paragraphCount }, (_, index) => {
    if (locale === "en") return `Synthetic developer-test paragraph ${index + 1}. This text checks country-overview layout and ordering. It does not describe any actual country, project, current rule or business opportunity.`;
    const heading = `测试段落${index + 1}。`;
    return heading + zhText.repeat(8).slice(0, Math.floor(1_800 / paragraphCount) - heading.length);
  });
  return {
    meta: { country_code: code, content_version: `OVERVIEW-${code}-20260827-R1`, as_of: "2026-08-27", locale },
    data: {
      title: locale === "en" ? "Synthetic country market overview" : "开发测试市场概览",
      paragraphs,
      disclaimer: locale === "en" ? "Synthetic developer-test material; not business advice." : "仅用于开发测试，不构成业务建议。",
    },
  };
}

export const marketCountryFixture: Basic60CountryDetail = {
  code: "IDN", iso2: "ID", name_zh: "印度尼西亚", name_en: "Indonesia", region_code: "Southeast Asia", coverage_level: "Basic",
  last_reviewed_at: null, opportunity_level: "pending", policy_friendliness_level: "pending", risk_assessment_status: "unknown", risk_level: null, latest_metrics: [],
};
