import { NextIntlClientProvider } from "next-intl";
import React from "react";
import type { AnchorHTMLAttributes, ImgHTMLAttributes, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

import type { LocalizedCountryCard } from "@navigator/shared-types/country-api";
import { MODULE_KEYS } from "@navigator/shared-types/schema";

import enMessages from "../../../locales/en.json";
import zhMessages from "../../../locales/zh-CN.json";

import { CountryExplorer } from "./country-explorer.js";

vi.mock("../../i18n/navigation", () => ({
  Link: ({
    children,
    href,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    children: ReactNode;
    href: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/image", () => ({
  default: ({
    alt,
    fill,
    priority,
    src,
    ...props
  }: ImgHTMLAttributes<HTMLImageElement> & {
    fill?: boolean;
    priority?: boolean;
    src: string;
  }) => (
    <img alt={alt} src={src} {...props} />
  ),
}));

function renderCountryExplorer(locale: "zh-CN" | "en") {
  const country = injectedCountry(locale);
  return renderToStaticMarkup(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "zh-CN" ? zhMessages : enMessages}
      timeZone="Asia/Shanghai"
    >
      <CountryExplorer
        countries={[country]}
        locale={locale}
        searchParams={new URLSearchParams()}
        total={1}
      />
    </NextIntlClientProvider>,
  );
}

describe("CountryExplorer Basic publication", () => {
  test("renders only the BASIC country supplied through props in English", () => {
    const html = renderCountryExplorer("en");

    expect(html).toContain("Injected Country");
    expect(html).not.toContain("Indonesia");
    expect(html).toContain("Opportunity");
    expect(html).toContain("Risk");
    expect(html).toContain("Policy friendliness");
    expect(html).toContain("Recommended priority");
    expect(html).toContain("Basic");
    expect(html).toContain("1/10");
    expect(html).toContain("Data Building");
    expect(html).not.toContain("Start with local channel partners");
  });

  test("renders only the BASIC country supplied through props in Chinese", () => {
    const html = renderCountryExplorer("zh-CN");

    expect(html).toContain("注入国家");
    expect(html).not.toContain("印度尼西亚");
    expect(html).toContain("机会强度");
    expect(html).toContain("风险强度");
    expect(html).toContain("政策友好度");
    expect(html).toContain("推荐优先级");
    expect(html).toContain("基础覆盖");
    expect(html).toContain("1/10");
    expect(html).toContain("数据建设中");
    expect(html).not.toContain("本地渠道伙伴");
  });
});

function injectedCountry(locale: "zh-CN" | "en"): LocalizedCountryCard {
  return {
    _i18nFallback: [],
    code: "ZZ",
    coverageLevel: "BASIC",
    flagEmoji: "ZZ",
    moduleCoverage: MODULE_KEYS.map((moduleKey, index) => ({
      dataCount: index === 0 ? 1 : 0,
      moduleKey,
      status: index === 0 ? "COMPLETE" : "BUILDING",
      updatedAt: "2026-07-19T00:00:00.000Z",
    })),
    name: locale === "en" ? "Injected Country" : "注入国家",
    region: "southeast-asia",
    signals: {
      opportunityLevel: "DATA_BUILDING",
      policyFriendliness: "DATA_BUILDING",
      recommendedEntryMode: null,
      recommendedPriority: "DATA_BUILDING",
      riskLevel: "DATA_BUILDING",
      sourceCount: 0,
      sources: [],
      updatedAt: "2026-07-19T00:00:00.000Z",
    },
    summary: locale === "en" ? "Injected summary" : "注入摘要",
    updatedAt: "2026-07-19T00:00:00.000Z",
  };
}
