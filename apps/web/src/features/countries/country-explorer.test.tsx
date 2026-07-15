import { NextIntlClientProvider } from "next-intl";
import React from "react";
import type { AnchorHTMLAttributes, ImgHTMLAttributes, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

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
  return renderToStaticMarkup(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "zh-CN" ? zhMessages : enMessages}
      timeZone="Asia/Shanghai"
    >
      <CountryExplorer locale={locale} searchParams={new URLSearchParams()} />
    </NextIntlClientProvider>,
  );
}

describe("CountryExplorer Basic publication", () => {
  test("renders BASIC coverage and data-building signals in English", () => {
    const html = renderCountryExplorer("en");

    expect(html).toContain("Opportunity");
    expect(html).toContain("Risk");
    expect(html).toContain("Policy friendliness");
    expect(html).toContain("Recommended priority");
    expect(html).toContain("Basic");
    expect(html).toContain("1/10");
    expect(html).toContain("Data Building");
    expect(html).not.toContain("Start with local channel partners");
  });

  test("renders BASIC coverage and data-building signals in Chinese", () => {
    const html = renderCountryExplorer("zh-CN");

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
