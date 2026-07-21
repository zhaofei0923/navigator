import { NextIntlClientProvider } from "next-intl";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import enMessages from "../../../locales/en.json";
import zhMessages from "../../../locales/zh-CN.json";

import { BasicProfileSection } from "./basic-profile.js";
import * as basicProfileFeature from "./basic-profile.js";
import { parseLocalizedBasicProfile } from "./basic-profile-parser.js";
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

function mutableProfile(): Record<string, unknown> {
  const value = profileValue("en");
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected a localized BASIC profile object");
  }
  return structuredClone(value) as unknown as Record<string, unknown>;
}

function objectAt(value: unknown, context: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Expected ${context} object`);
  }
  return value as Record<string, unknown>;
}

function arrayAt(value: unknown, context: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Expected ${context} array`);
  return value;
}

function categoriesOf(profile: Record<string, unknown>) {
  return objectAt(profile.categories, "profile categories");
}

function fieldsOf(
  profile: Record<string, unknown>,
  categoryKey = "countryBasics",
) {
  const category = objectAt(categoriesOf(profile)[categoryKey], categoryKey);
  return arrayAt(category.fields, `${categoryKey} fields`);
}

function firstFieldOf(profile: Record<string, unknown>) {
  return objectAt(fieldsOf(profile)[0], "first field");
}

function firstUnavailableFieldOf(profile: Record<string, unknown>) {
  for (const category of Object.values(categoriesOf(profile))) {
    const fields = arrayAt(objectAt(category, "category").fields, "category fields");
    const field = fields.find((candidate) =>
      objectAt(candidate, "field").status === "NOT_AVAILABLE"
    );
    if (field !== undefined) return objectAt(field, "unavailable field");
  }
  throw new Error("Expected an unavailable field");
}

function sourcesOf(profile: Record<string, unknown>) {
  return arrayAt(profile.sources, "profile sources");
}

describe("BasicProfileSection", () => {
  test("exposes only the country detail renderer", () => {
    expect(Object.keys(basicProfileFeature)).toEqual(["BasicProfileSection"]);
  });

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
    expect(english).toContain(
      'class="basic-profile-status basic-profile-status--available"',
    );
    expect(english).toContain(
      'class="basic-profile-status basic-profile-status--not-available"',
    );
    expect(english).toContain('class="basic-profile-value"');
  });

  test("renders calendar dates unchanged and RFC3339 timestamps in UTC", () => {
    const profile = mutableProfile();
    profile.updatedAt = "2026-07-21T21:30:00-10:00";
    firstFieldOf(profile).checkedAt = "2026-07-20";
    const originalTimezone = process.env.TZ;
    process.env.TZ = "America/Adak";

    try {
      const html = renderProfile(
        profile as unknown as ModuleResponseRecord["basicProfile"],
        "en",
      );
      expect(html).toContain("Profile updated Jul 22, 2026");
      expect(html).toContain("Checked Jul 20, 2026");
    } finally {
      if (originalTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = originalTimezone;
    }
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

  test.each<[
    string,
    (profile: Record<string, unknown>) => void,
  ]>([
    ["an extra profile key", (profile) => { profile.extra = true; }],
    ["an extra category key", (profile) => {
      categoriesOf(profile).extra = { fields: [] };
    }],
    ["a missing category", (profile) => {
      delete categoriesOf(profile).marketSummary;
    }],
    ["an extra category property", (profile) => {
      objectAt(categoriesOf(profile).countryBasics, "countryBasics").extra = true;
    }],
    ["an extra field property", (profile) => { firstFieldOf(profile).extra = true; }],
    ["a missing required field", (profile) => { fieldsOf(profile).pop(); }],
    ["a duplicate required field", (profile) => {
      const fields = fieldsOf(profile);
      fields[fields.length - 1] = structuredClone(fields[0]);
    }],
    ["an unexpected required field key", (profile) => {
      firstFieldOf(profile).key = "unexpectedField";
    }],
    ["an extra source property", (profile) => {
      objectAt(sourcesOf(profile)[0], "source").extra = true;
    }],
    ["a duplicate source ID", (profile) => {
      sourcesOf(profile).push(structuredClone(sourcesOf(profile)[0]));
    }],
    ["duplicate field source IDs", (profile) => {
      const field = firstFieldOf(profile);
      const sourceIds = arrayAt(field.sourceIds, "source IDs");
      field.sourceIds = [sourceIds[0], sourceIds[0]];
    }],
    ["an unresolved field source ID", (profile) => {
      firstFieldOf(profile).sourceIds = ["unknown-source"];
    }],
    ["an unknown credibility", (profile) => {
      objectAt(sourcesOf(profile)[0], "source").credibility = "TRUST_ME";
    }],
    ["an invalid checked calendar date", (profile) => {
      firstFieldOf(profile).checkedAt = "2026-02-30";
    }],
    ["an invalid retrieved timestamp", (profile) => {
      objectAt(sourcesOf(profile)[0], "source").retrievedAt = "2026-07-20";
    }],
    ["an invalid published timestamp", (profile) => {
      objectAt(sourcesOf(profile)[0], "source").publishedAt = "not-a-date";
    }],
    ["an invalid status", (profile) => { firstFieldOf(profile).status = "MISSING"; }],
    ["an AVAILABLE field without a value", (profile) => {
      firstFieldOf(profile).value = null;
    }],
    ["an AVAILABLE field with a reason", (profile) => {
      firstFieldOf(profile).reason = "Unexpected reason";
    }],
    ["a NOT_AVAILABLE field with a value", (profile) => {
      firstUnavailableFieldOf(profile).value = 1;
    }],
    ["a NOT_AVAILABLE field with a unit", (profile) => {
      firstUnavailableFieldOf(profile).unit = "MW";
    }],
    ["a NOT_AVAILABLE field with a year", (profile) => {
      firstUnavailableFieldOf(profile).year = 2025;
    }],
    ["a NOT_AVAILABLE field without a reason", (profile) => {
      firstUnavailableFieldOf(profile).reason = null;
    }],
  ])("fails closed for %s", (_name, mutate) => {
    const profile = mutableProfile();
    mutate(profile);
    expect(parseLocalizedBasicProfile(profile)).toBeNull();
  });
});
