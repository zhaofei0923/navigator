import { NextIntlClientProvider } from "next-intl";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import enMessages from "../../../locales/en.json";
import zhMessages from "../../../locales/zh-CN.json";

import { CountryDetail } from "./country-detail.js";
import { buildCountryDetailResponse } from "./country-service.js";
import type { LocalizedCountryDetail } from "./country-service.js";

function renderCountryDetail(locale: "zh-CN" | "en") {
  const response = buildCountryDetailResponse("ID", { locale });

  if (response === null || response.meta.textMode !== "localized") {
    throw new Error("Expected localized Indonesia detail response");
  }

  return renderToStaticMarkup(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "zh-CN" ? zhMessages : enMessages}
      timeZone="Asia/Shanghai"
    >
      <CountryDetail country={response.data} locale={locale} />
    </NextIntlClientProvider>,
  );
}

describe("CountryDetail visible i18n", () => {
  test("renders the published Chinese market overview and nine placeholders", () => {
    const html = renderCountryDetail("zh-CN");

    expect(html).toContain("印度尼西亚");
    expect(html).toContain("基础覆盖");
    expect(html).toContain("1/10 个模块");
    expect(html).toContain("可再生能源装机达到15,630兆瓦");
    expect(html).toContain("可再生能源占比");
    expect(html.match(/数据建设中/g)).toHaveLength(9);
    expect(html).toContain("外部公开来源");
    expect(html).not.toContain("P1-2 manually curated");
    expect(html).not.toContain("Derived from published country module knowledge chunks");
    expect(html).not.toContain("id_pol_001");
    expect(html).not.toContain("id_know_001");
    expect(html).not.toContain(">tags<");
  });

  test("renders the published English market overview and nine placeholders", () => {
    const html = renderCountryDetail("en");

    expect(html).toContain("Indonesia");
    expect(html).toContain("Basic");
    expect(html).toContain("1/10 modules");
    expect(html).toContain("Installed renewable capacity reached 15,630 MW");
    expect(html).toContain("Renewable energy mix share");
    expect(html.match(/Data Building/g)).toHaveLength(9);
    expect(html).toContain("External public source");
    expect(html).not.toContain("P1-2 manually curated");
    expect(html).not.toContain("Derived from published country module knowledge chunks");
    expect(html).not.toContain("id_pol_001");
    expect(html).not.toContain("id_know_001");
    expect(html).not.toContain(">tags<");
  });

  test("does not expose unknown raw source, unit, or tag values", () => {
    const response = buildCountryDetailResponse("ID", { locale: "zh-CN" });

    if (response === null || response.meta.textMode !== "localized") {
      throw new Error("Expected localized Indonesia detail response");
    }

    const countryWithSyntheticModule: LocalizedCountryDetail = {
      ...response.data,
      moduleCoverage: [
        {
          dataCount: 1,
          moduleKey: "market-overview",
          status: "COMPLETE",
          updatedAt: "2026-01-15T00:00:00Z",
        },
        ...response.data.moduleCoverage.filter(
          (coverage) => coverage.moduleKey !== "market-overview",
        ),
      ],
    };
    const html = renderToStaticMarkup(
      <NextIntlClientProvider
        locale="zh-CN"
        messages={zhMessages}
        timeZone="Asia/Shanghai"
      >
        <CountryDetail
          country={countryWithSyntheticModule}
          locale="zh-CN"
          moduleResponses={{
            "market-overview": {
              data: {
                _i18nFallback: [],
                item: {
                  keyIndicators: [
                    {
                      label: "测试指标",
                      unit: "raw English unit",
                      value: "42",
                    },
                    {
                      label: "测试标签",
                      unit: "tags",
                      value: "pv-module, mystery-tag",
                    },
                  ],
                  overview: "测试概览",
                  source: "Raw English Institution Name",
                  sourceUrl: "https://example.com/source",
                  updatedAt: "2026-01-15T00:00:00Z",
                },
                moduleKey: "market-overview",
                status: "COMPLETE",
              },
              meta: {
                locale: "zh-CN",
                page: 1,
                pageSize: 20,
                textMode: "localized",
                total: 1,
              },
              success: true,
            },
          }}
        />
      </NextIntlClientProvider>,
    );

    expect(html).toContain("外部公开来源");
    expect(html).toContain("数值");
    expect(html).toContain("光伏组件、mystery-tag");
    expect(html).not.toContain("Raw English Institution Name");
    expect(html).not.toContain("raw English unit");
    expect(html).not.toContain("pv-module, mystery-tag");
  });
});
