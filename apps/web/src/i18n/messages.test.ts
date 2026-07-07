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
] as const;

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
});
