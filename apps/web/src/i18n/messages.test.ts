import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

type JsonObject = Record<string, unknown>;

const currentDir = dirname(fileURLToPath(import.meta.url));
const webRoot = join(currentDir, "..", "..");

const fixedKeys = [
  "common.notTranslated",
  "coverage.dataBuilding",
  "coverage.updating",
  "coverage.level.BASIC",
  "coverage.level.STANDARD",
  "coverage.level.COMPLETE",
  "ai.noData",
  "ai.buildingHint",
  "error.notFound",
  "error.internal",
  "error.invalidLocale",
  "countries.detail.riskCategory.political",
  "countries.detail.riskCategory.economic",
  "countries.detail.riskCategory.legal",
  "countries.detail.riskCategory.exchange-rate",
  "countries.detail.riskCategory.operational",
  "countries.detail.riskCategory.social",
  "countries.detail.riskCategory.environmental",
] as const;

const riskCategoryLabels = {
  "zh-CN": {
    political: "政治",
    economic: "经济",
    legal: "法律",
    "exchange-rate": "汇率",
    operational: "运营",
    social: "社会",
    environmental: "环境",
  },
  en: {
    political: "Political",
    economic: "Economic",
    legal: "Legal",
    "exchange-rate": "Exchange rate",
    operational: "Operational",
    social: "Social",
    environmental: "Environmental",
  },
} as const;

function readMessages(locale: "zh-CN" | "en"): JsonObject {
  return JSON.parse(
    readFileSync(join(webRoot, "locales", `${locale}.json`), "utf8"),
  ) as JsonObject;
}

function flattenKeys(value: unknown, prefix = ""): string[] {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    return prefix ? [prefix] : [];
  }

  const objectValue = value as JsonObject;

  return Object.keys(objectValue).flatMap((key) => {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    return flattenKeys(objectValue[key], nextPrefix);
  });
}

function valueAtPath(value: JsonObject, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (current === null || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    return (current as JsonObject)[segment];
  }, value);
}

describe("web locale messages", () => {
  test("zh-CN and en message keys are exactly aligned", () => {
    const zhKeys = flattenKeys(readMessages("zh-CN")).sort();
    const enKeys = flattenKeys(readMessages("en")).sort();

    expect(zhKeys).toEqual(enKeys);
  });

  test("docs/i18n fixed keys are present in both locale files", () => {
    const zhKeys = new Set(flattenKeys(readMessages("zh-CN")));
    const enKeys = new Set(flattenKeys(readMessages("en")));

    for (const key of fixedKeys) {
      expect(zhKeys.has(key), `zh-CN missing ${key}`).toBe(true);
      expect(enKeys.has(key), `en missing ${key}`).toBe(true);
    }
  });

  test("uses the approved localized labels for every risk category token", () => {
    for (const locale of ["zh-CN", "en"] as const) {
      const messages = readMessages(locale);
      for (const [token, label] of Object.entries(riskCategoryLabels[locale])) {
        expect(
          valueAtPath(messages, `countries.detail.riskCategory.${token}`),
          `${locale}:${token}`,
        ).toBe(label);
      }
    }
  });
});
