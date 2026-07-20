import { describe, expect, expectTypeOf, test } from "vitest";

import {
  BASIC_PROFILE_CATEGORY_KEYS,
  BASIC_PROFILE_REQUIRED_FIELD_KEYS,
  BASIC_PROFILE_SCHEMA_VERSION,
  parseBasicProfile,
  type BasicProfile,
} from "./basic-profile.js";

const CATEGORY_KEYS = [
  "countryBasics",
  "electricityMarket",
  "energyAccess",
  "renewableCapacity",
  "solarResource",
  "windResource",
  "policyOverview",
  "marketSummary",
] as const;

const REQUIRED_FIELD_KEYS = {
  countryBasics: [
    "countryCode", "countryName", "region", "population", "gdp",
    "gdpPerCapita", "gdpGrowth",
  ],
  electricityMarket: [
    "totalGeneration", "electricityConsumption", "electricityMix",
    "renewableGenerationShare",
  ],
  energyAccess: ["electricityAccess"],
  renewableCapacity: [
    "totalRenewableCapacity", "solarCapacity", "windCapacity", "hydroCapacity",
  ],
  solarResource: ["ghi", "pvout", "solarPotentialSummary"],
  windResource: ["onshoreWindClass", "offshoreWindClass", "resourceSummary"],
  policyOverview: ["summary"],
  marketSummary: ["opportunitySummary"],
} as const;

function localized(zh = "中文", en = "English") {
  return { zh, en };
}

function availableField(key: string, sourceIds = ["official-source"]) {
  return {
    key,
    label: localized(`${key} 标签`, `${key} label`),
    status: "AVAILABLE",
    value: 42,
    unit: "%",
    year: 2025,
    sourceIds,
    checkedAt: "2026-07-20",
    reason: null,
    note: localized("说明", "Note"),
  };
}

function validProfile(): Record<string, unknown> {
  return {
    schemaVersion: "basic-market-profile/v2",
    categories: Object.fromEntries(
      CATEGORY_KEYS.map((categoryKey) => [
        categoryKey,
        {
          fields: REQUIRED_FIELD_KEYS[categoryKey].map((key) => availableField(key)),
        },
      ]),
    ),
    sources: [
      {
        id: "official-source",
        publisher: "Official publisher",
        title: localized("官方来源", "Official source"),
        url: "https://example.gov/data?id=1",
        publishedAt: "2025-12-31T16:00:00+08:00",
        retrievedAt: "2026-07-20T01:02:03.000Z",
        credibility: "OFFICIAL",
      },
    ],
    updatedAt: "2026-07-20T01:02:03Z",
  };
}

function cloneProfile(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(validProfile())) as Record<string, unknown>;
}

function profileCategories(profile: Record<string, unknown>): Record<string, unknown> {
  return profile.categories as Record<string, unknown>;
}

function firstField(
  profile: Record<string, unknown>,
  categoryKey = "countryBasics",
): Record<string, unknown> {
  const category = profileCategories(profile)[categoryKey] as {
    fields: Record<string, unknown>[];
  };
  return category.fields[0]!;
}

describe("BASIC v2 profile contract", () => {
  test("exports the approved schema version and all eight ordered category keys", () => {
    expect(BASIC_PROFILE_SCHEMA_VERSION).toBe("basic-market-profile/v2");
    expect(BASIC_PROFILE_CATEGORY_KEYS).toEqual(CATEGORY_KEYS);
    expect(BASIC_PROFILE_REQUIRED_FIELD_KEYS).toEqual(REQUIRED_FIELD_KEYS);
    expect(Object.isFrozen(BASIC_PROFILE_REQUIRED_FIELD_KEYS)).toBe(true);
    expect(Object.values(BASIC_PROFILE_REQUIRED_FIELD_KEYS).every(Object.isFrozen))
      .toBe(true);
    expectTypeOf(BASIC_PROFILE_SCHEMA_VERSION).toEqualTypeOf<
      "basic-market-profile/v2"
    >();
    expectTypeOf(parseBasicProfile(validProfile())).toEqualTypeOf<
      BasicProfile | null
    >();
  });

  test("accepts an exact eight-category profile with cited AVAILABLE fields", () => {
    const input = validProfile();

    expect(parseBasicProfile(input)).toEqual(input);
  });

  test("accepts NOT_AVAILABLE only with checked sources and a bilingual reason", () => {
    const input = cloneProfile();
    Object.assign(firstField(input, "energyAccess"), {
      status: "NOT_AVAILABLE",
      value: null,
      unit: null,
      year: null,
      sourceIds: ["official-source"],
      checkedAt: "2026-07-20",
      reason: localized("官方来源暂无数据", "No data in the official source"),
      note: null,
    });

    expect(parseBasicProfile(input)).toEqual(input);
  });

  test("normalizes omitted and null legacy profiles to null", () => {
    expect(parseBasicProfile(undefined)).toBeNull();
    expect(parseBasicProfile(null)).toBeNull();
  });

  test.each([
    ["unknown top-level key", (input: Record<string, unknown>) => { input.extra = true; }],
    ["missing top-level key", (input: Record<string, unknown>) => { delete input.updatedAt; }],
    ["unknown category", (input: Record<string, unknown>) => { profileCategories(input).other = { fields: [] }; }],
    ["missing category", (input: Record<string, unknown>) => { delete profileCategories(input).windResource; }],
    ["unknown category key", (input: Record<string, unknown>) => {
      (profileCategories(input).countryBasics as Record<string, unknown>).extra = true;
    }],
    ["unknown field key", (input: Record<string, unknown>) => { firstField(input).extra = true; }],
    ["missing field key", (input: Record<string, unknown>) => { delete firstField(input).note; }],
    ["unknown source key", (input: Record<string, unknown>) => {
      ((input.sources as Record<string, unknown>[])[0]!).extra = true;
    }],
    ["missing source key", (input: Record<string, unknown>) => {
      delete ((input.sources as Record<string, unknown>[])[0]!).title;
    }],
  ])("rejects an input with an %s", (_label, mutate) => {
    const input = cloneProfile();
    mutate(input);

    expect(parseBasicProfile(input)).toBeNull();
  });

  test.each([
    ["missing value", (field: Record<string, unknown>) => { field.value = null; }],
    ["missing citation", (field: Record<string, unknown>) => { field.sourceIds = []; }],
    ["duplicate citation", (field: Record<string, unknown>) => {
      field.sourceIds = ["official-source", "official-source"];
    }],
    ["reason", (field: Record<string, unknown>) => { field.reason = localized(); }],
  ])("rejects an AVAILABLE field with %s", (_label, mutate) => {
    const input = cloneProfile();
    mutate(firstField(input));

    expect(parseBasicProfile(input)).toBeNull();
  });

  test.each([
    ["a value", (field: Record<string, unknown>) => { field.value = "known"; }],
    ["a unit", (field: Record<string, unknown>) => { field.unit = "%"; }],
    ["a year", (field: Record<string, unknown>) => { field.year = 2025; }],
    ["no checked source", (field: Record<string, unknown>) => { field.sourceIds = []; }],
    ["no reason", (field: Record<string, unknown>) => { field.reason = null; }],
    ["a monolingual reason", (field: Record<string, unknown>) => {
      field.reason = localized("有原因", "   ");
    }],
  ])("rejects a NOT_AVAILABLE field with %s", (_label, mutate) => {
    const input = cloneProfile();
    const field = firstField(input);
    Object.assign(field, {
      status: "NOT_AVAILABLE",
      value: null,
      unit: null,
      year: null,
      reason: localized("暂无数据", "Not available"),
    });
    mutate(field);

    expect(parseBasicProfile(input)).toBeNull();
  });

  test("requires lower-camel unique field keys within each category", () => {
    const invalidTokens = ["Population", "population-rate", "population_rate", " population"];
    for (const key of invalidTokens) {
      const input = cloneProfile();
      firstField(input).key = key;
      expect(parseBasicProfile(input)).toBeNull();
    }

    const duplicate = cloneProfile();
    const category = profileCategories(duplicate).countryBasics as {
      fields: Record<string, unknown>[];
    };
    category.fields.push(availableField(category.fields[0]!.key as string));
    expect(parseBasicProfile(duplicate)).toBeNull();
  });

  test.each(CATEGORY_KEYS)(
    "rejects %s when its required fields are empty or partial",
    (categoryKey) => {
      const empty = cloneProfile();
      (profileCategories(empty)[categoryKey] as { fields: unknown[] }).fields = [];
      expect(parseBasicProfile(empty)).toBeNull();

      const partial = cloneProfile();
      (profileCategories(partial)[categoryKey] as { fields: unknown[] }).fields.pop();
      expect(parseBasicProfile(partial)).toBeNull();
    },
  );

  test.each(CATEGORY_KEYS)(
    "rejects an unapproved extra field in %s",
    (categoryKey) => {
      const input = cloneProfile();
      (profileCategories(input)[categoryKey] as { fields: unknown[] }).fields.push(
        availableField("unapprovedField"),
      );

      expect(parseBasicProfile(input)).toBeNull();
    },
  );

  test.each(["cleanCooking", "energyAccessSummary"])(
    "rejects non-electricity energyAccess field key %s",
    (key) => {
      const input = cloneProfile();
      firstField(input, "energyAccess").key = key;

      expect(parseBasicProfile(input)).toBeNull();
    },
  );

  test("rejects an out-of-contract field key outside energy access", () => {
    const input = cloneProfile();
    firstField(input, "countryBasics").key = "cleanCooking";

    expect(parseBasicProfile(input)).toBeNull();
  });

  test.each([
    ["empty string", ""],
    ["whitespace string", "   "],
    ["positive infinity", Number.POSITIVE_INFINITY],
    ["negative infinity", Number.NEGATIVE_INFINITY],
    ["NaN", Number.NaN],
  ])("rejects an AVAILABLE %s value", (_label, value) => {
    const input = cloneProfile();
    firstField(input).value = value;

    expect(parseBasicProfile(input)).toBeNull();
  });

  test("accepts non-empty string and bilingual AVAILABLE values", () => {
    const stringValue = cloneProfile();
    firstField(stringValue).value = "42 TWh";
    expect(parseBasicProfile(stringValue)).not.toBeNull();

    const localizedValue = cloneProfile();
    firstField(localizedValue).value = localized("四十二", "Forty-two");
    expect(parseBasicProfile(localizedValue)).not.toBeNull();
  });

  test("requires every citation to reference one exactly-once source record", () => {
    const missing = cloneProfile();
    firstField(missing).sourceIds = ["missing-source"];
    expect(parseBasicProfile(missing)).toBeNull();

    const duplicate = cloneProfile();
    (duplicate.sources as unknown[]).push(
      JSON.parse(JSON.stringify((duplicate.sources as unknown[])[0])) as unknown,
    );
    expect(parseBasicProfile(duplicate)).toBeNull();
  });

  test.each([
    "javascript:alert(1)",
    "file:///etc/passwd",
    "ftp://example.gov/data",
    "//example.gov/data",
  ])("rejects unsafe source URL %s", (url) => {
    const input = cloneProfile();
    ((input.sources as Record<string, unknown>[])[0]!).url = url;

    expect(parseBasicProfile(input)).toBeNull();
  });

  test.each([
    ["field checkedAt", (input: Record<string, unknown>) => { firstField(input).checkedAt = "2026-02-30"; }],
    ["profile updatedAt", (input: Record<string, unknown>) => { input.updatedAt = "2026-07-20"; }],
    ["source publishedAt", (input: Record<string, unknown>) => {
      ((input.sources as Record<string, unknown>[])[0]!).publishedAt = "2025-01-01";
    }],
    ["source retrievedAt", (input: Record<string, unknown>) => {
      ((input.sources as Record<string, unknown>[])[0]!).retrievedAt = "not-a-date";
    }],
  ])("rejects an invalid %s", (_label, mutate) => {
    const input = cloneProfile();
    mutate(input);

    expect(parseBasicProfile(input)).toBeNull();
  });

  test.each(["0000", "0001", "0099"])(
    "rejects pre-0100 year %s for calendar dates and RFC3339 timestamps",
    (year) => {
      const calendar = cloneProfile();
      firstField(calendar).checkedAt = `${year}-01-01`;
      expect(parseBasicProfile(calendar)).toBeNull();

      const timestamp = cloneProfile();
      timestamp.updatedAt = `${year}-01-01T00:00:00Z`;
      expect(parseBasicProfile(timestamp)).toBeNull();
    },
  );

  test("accepts year 0100 for calendar dates and RFC3339 timestamps", () => {
    const input = cloneProfile();
    firstField(input).checkedAt = "0100-01-01";
    input.updatedAt = "0100-01-01T00:00:00Z";

    expect(parseBasicProfile(input)).not.toBeNull();
  });

  test.each([
    ["1900", false],
    ["2000", true],
  ] as const)(
    "applies Gregorian leap-century rules to year %s",
    (year, accepted) => {
      const calendar = cloneProfile();
      firstField(calendar).checkedAt = `${year}-02-29`;
      expect(parseBasicProfile(calendar) !== null).toBe(accepted);

      const timestamp = cloneProfile();
      timestamp.updatedAt = `${year}-02-29T00:00:00Z`;
      expect(parseBasicProfile(timestamp) !== null).toBe(accepted);
    },
  );
});
