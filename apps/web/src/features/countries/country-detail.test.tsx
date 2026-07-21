import { NextIntlClientProvider } from "next-intl";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import enMessages from "../../../locales/en.json";
import zhMessages from "../../../locales/zh-CN.json";

import { CountryDetail } from "./country-detail.js";
import {
  buildCountryDetailResponse,
  buildCountryModuleResponse,
} from "./country-service.test-fixture.js";
import type { LocalizedCountryDetail } from "@navigator/shared-types/country-api";

function renderCountryDetail(code: string, locale: "zh-CN" | "en") {
  const response = buildCountryDetailResponse(code, { locale });

  if (response === null || response.meta.textMode !== "localized") {
    throw new Error("Expected localized Indonesia detail response");
  }
  const marketOverview = buildCountryModuleResponse(
    code,
    "market-overview",
    { locale },
  );
  if (marketOverview === null || marketOverview.meta.textMode !== "localized") {
    throw new Error("Expected localized market overview response");
  }

  return renderToStaticMarkup(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "zh-CN" ? zhMessages : enMessages}
      timeZone="Asia/Shanghai"
    >
      <CountryDetail
        country={response.data}
        locale={locale}
        moduleResponses={{ "market-overview": marketOverview }}
      />
    </NextIntlClientProvider>,
  );
}

describe("CountryDetail visible i18n", () => {
  test("does not rebuild a missing module response from canonical data", () => {
    const response = buildCountryDetailResponse("ID", { locale: "en" });
    if (response === null || response.meta.textMode !== "localized") {
      throw new Error("Expected localized Indonesia detail response");
    }

    const html = renderToStaticMarkup(
      <NextIntlClientProvider
        locale="en"
        messages={enMessages}
        timeZone="Asia/Shanghai"
      >
        <CountryDetail
          country={response.data}
          locale="en"
          moduleResponses={{}}
        />
      </NextIntlClientProvider>,
    );

    expect(html).toContain(
      "The module is active, but no published records are available for this view.",
    );
    expect(html).not.toContain(
      "Energy and mineral investment reached USD 31.7 billion in 2025, including USD 4.6 billion in electricity and USD 2.4 billion in renewables and conservation.",
    );
  });

  test("renders the published Chinese market overview and nine placeholders", () => {
    const html = renderCountryDetail("ID", "zh-CN");

    expect(html).toContain("印度尼西亚");
    expect(html).toContain("基础覆盖");
    expect(html).toContain("1/10 个模块");
    expect(html).toContain(
      "2025年能源与矿产领域投资为317亿美元，其中电力46亿美元、可再生能源与节能24亿美元。",
    );
    expect(html).toContain("可再生能源占比");
    expect(html).toContain("<strong>15.75</strong>");
    expect(html).toContain("<strong>1584</strong>");
    expect(html).toContain("BASIC 八类数据");
    for (const label of [
      "国家基础", "电力市场", "能源可及性", "可再生能源装机",
      "太阳能资源", "风能资源", "政策概览", "市场摘要",
    ]) expect(html).toContain(label);
    expect(html).toContain("285,721,236");
    expect(html).toContain("5,059.63");
    expect(html).toContain("99.9");
    expect(html).toContain("暂无数据");
    expect(html).toContain("未提供已审核的Ember不可变标准化快照");
    expect(html).toContain("印尼国家电力总规划");
    expect(html).toContain(
      'href="https://www.iea.org/policies/30494-national-electricity-general-plan"',
    );
    expect(html.match(/数据建设中/g)).toHaveLength(9);
    expect(html).toContain("外部公开来源");
    expect(html).not.toContain("P1-2 manually curated");
    expect(html).not.toContain("Derived from published country module knowledge chunks");
    expect(html).not.toContain("id_pol_001");
    expect(html).not.toContain("id_know_001");
    expect(html).not.toContain(">tags<");
  });

  test("renders the published English market overview and nine placeholders", () => {
    const html = renderCountryDetail("ID", "en");

    expect(html).toContain("Indonesia");
    expect(html).toContain("Basic");
    expect(html).toContain("1/10 modules");
    expect(html).toContain(
      "Energy and mineral investment reached USD 31.7 billion in 2025, including USD 4.6 billion in electricity and USD 2.4 billion in renewables and conservation.",
    );
    expect(html).toContain("Renewable energy mix share");
    expect(html).toContain("<strong>15.75</strong>");
    expect(html).toContain("<strong>1584</strong>");
    expect(html).toContain("BASIC data profile");
    expect(html).toContain("Country basics");
    expect(html).toContain("Electricity market");
    expect(html).toContain("Energy access");
    expect(html).toContain("Not available");
    expect(html).toContain(
      "A reviewed immutable normalized Ember snapshot was not provided",
    );
    expect(html).toContain(
      'href="https://www.iea.org/policies/30494-national-electricity-general-plan"',
    );
    expect(html.match(/Data Building/g)).toHaveLength(9);
    expect(html).toContain("External public source");
    expect(html).not.toContain("P1-2 manually curated");
    expect(html).not.toContain("Derived from published country module knowledge chunks");
    expect(html).not.toContain("id_pol_001");
    expect(html).not.toContain("id_know_001");
    expect(html).not.toContain(">tags<");
  });

  test("keeps the legacy overview visible when the BASIC profile is null", () => {
    const response = buildCountryDetailResponse("ID", { locale: "en" });
    const marketOverview = buildCountryModuleResponse(
      "ID",
      "market-overview",
      { locale: "en" },
    );
    if (
      response === null ||
      response.meta.textMode !== "localized" ||
      marketOverview === null ||
      marketOverview.meta.textMode !== "localized" ||
      marketOverview.data.item === undefined
    ) {
      throw new Error("Expected localized Indonesia responses");
    }

    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="en" messages={enMessages} timeZone="Asia/Shanghai">
        <CountryDetail
          country={response.data}
          locale="en"
          moduleResponses={{
            "market-overview": {
              ...marketOverview,
              data: {
                ...marketOverview.data,
                item: { ...marketOverview.data.item, basicProfile: null },
              },
            },
          }}
        />
      </NextIntlClientProvider>,
    );

    expect(html).toContain(
      "Energy and mineral investment reached USD 31.7 billion in 2025, including USD 4.6 billion in electricity and USD 2.4 billion in renewables and conservation.",
    );
    expect(html).not.toContain("BASIC data profile");
  });

  test("renders Vietnam's published bilingual overview with the same nine placeholders", () => {
    const chinese = renderCountryDetail("VN", "zh-CN");
    const english = renderCountryDetail("VN", "en");

    expect(chinese).toContain("越南");
    expect(chinese).toContain("总装机容量为82,387兆瓦");
    expect(chinese.match(/数据建设中/g)).toHaveLength(9);
    expect(english).toContain("Viet Nam");
    expect(english).toContain("Total installed capacity was 82,387 MW");
    expect(english.match(/Data Building/g)).toHaveLength(9);
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
