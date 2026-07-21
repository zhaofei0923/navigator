import { NextIntlClientProvider } from "next-intl";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import enMessages from "../../../locales/en.json";
import zhMessages from "../../../locales/zh-CN.json";

import { BasicProfileSection } from "./basic-profile.js";
import { buildCountryModuleResponse } from "./country-service.test-fixture.js";
import type {
  JsonObject,
  JsonValue,
  ModuleResponseRecord,
} from "@navigator/shared-types/country-api";
import type { Locale } from "@navigator/shared-types/schema";

function profileValue(locale: Locale) {
  const response = buildCountryModuleResponse("ID", "market-overview", { locale });

  if (
    response === null ||
    response.meta.textMode !== "localized" ||
    response.data.item === undefined
  ) {
    throw new Error("Expected localized Indonesia market overview response");
  }

  return response.data.item.basicProfile;
}

function renderProfile(
  value: ModuleResponseRecord["basicProfile"],
  locale: Locale,
) {
  return renderToStaticMarkup(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "zh-CN" ? zhMessages : enMessages}
      timeZone="Asia/Shanghai"
    >
      <BasicProfileSection locale={locale} profileValue={value} />
    </NextIntlClientProvider>,
  );
}

describe("BasicProfileSection", () => {
  test("renders a localized profile with cited available and unavailable fields", () => {
    const chinese = renderProfile(profileValue("zh-CN"), "zh-CN");
    const english = renderProfile(profileValue("en"), "en");

    expect(chinese).toContain("通电率");
    expect(chinese).toContain("99.9");
    expect(chinese).toContain("暂无数据");
    expect(chinese).toContain("核查于");
    expect(chinese).toContain("World Bank");
    expect(chinese).toContain('target="_blank"');
    expect(english).toContain("Access to electricity");
    expect(english).toContain("Not available");
  });

  test("omits absent and invalid legacy profiles", () => {
    expect(renderProfile(undefined, "en")).toBe("");
    expect(
      renderProfile({ schemaVersion: "basic-market-profile/v1" }, "en"),
    ).toBe("");
  });

  test("omits a profile whose RFC3339 date has invalid calendar parts", () => {
    const profile = profileValue("en");
    if (
      profile === null ||
      typeof profile !== "object" ||
      Array.isArray(profile)
    ) {
      throw new Error("Expected a localized BASIC profile object");
    }

    expect(renderProfile({
      ...profile,
      updatedAt: "2026-02-30T12:30:00Z",
    }, "en")).toBe("");
  });

  test("omits a profile with a credential-bearing source URL", () => {
    const profile = profileValue("en");
    if (
      profile === null ||
      typeof profile !== "object" ||
      Array.isArray(profile)
    ) {
      throw new Error("Expected a localized BASIC profile object");
    }

    const profileRecord = profile as JsonObject;
    const sources = profileRecord.sources;
    if (!Array.isArray(sources) || sources.length === 0) {
      throw new Error("Expected a localized BASIC profile with sources");
    }

    const [firstSource, ...remainingSources] = sources as readonly JsonValue[];
    if (
      firstSource === undefined ||
      firstSource === null ||
      typeof firstSource !== "object" ||
      Array.isArray(firstSource)
    ) {
      throw new Error("Expected a BASIC profile source object");
    }

    const sourceRecord = firstSource as JsonObject;
    const invalidSources: readonly JsonValue[] = [
      { ...sourceRecord, url: "https://user:pass@example.com/profile" },
      ...remainingSources,
    ];

    expect(renderProfile({
      ...profileRecord,
      sources: invalidSources,
    }, "en")).toBe("");
  });
});
