import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import { GET } from "./route.js";

const P1_6D_ARTIFACT_FILE_NAMES = [
  "source-register.json",
  "extracted-facts.json",
  "market-overview.draft.json",
  "review-report.json",
] as const;

const P1_6D_FORBIDDEN_RESPONSE_KEYS = [
  "boundaryVerdict",
  "artifacts",
  "stages",
  "sourceRegister",
  "extractedFacts",
  "reviewReport",
  "rawCache",
  "cachePath",
] as const;

const P1_6D_SERIALIZED_PATH_MARKERS = [
  "data/staging",
  "collection-manifest.json",
  ".cache/basic-country",
] as const;

const P1_6D_PRODUCTION_IDENTIFIER_PATTERNS = [
  /\bboundaryVerdict\b/,
  /\bartifacts\b/,
  /\bstages\b/,
  /\bsourceRegister\b/,
  /\bextractedFacts\b/,
  /\breviewReport\b/,
  /\brawCache\b/,
  /\bcachePath\b/,
] as const;

function collectOwnKeys(
  value: unknown,
  keys = new Set<string>(),
  visited = new WeakSet<object>(),
): Set<string> {
  if (value === null || typeof value !== "object" || visited.has(value)) {
    return keys;
  }

  visited.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      collectOwnKeys(item, keys, visited);
    }
    return keys;
  }

  for (const key of Object.keys(value)) {
    keys.add(key);
    collectOwnKeys(
      (value as Record<string, unknown>)[key],
      keys,
      visited,
    );
  }

  return keys;
}

function expectNoP1_6DFields(value: unknown) {
  const responseKeys = collectOwnKeys(value);

  for (const forbiddenKey of P1_6D_FORBIDDEN_RESPONSE_KEYS) {
    expect(responseKeys).not.toContain(forbiddenKey);
  }

  const serialized = JSON.stringify(value) ?? "";

  for (const fileName of P1_6D_ARTIFACT_FILE_NAMES) {
    expect(serialized).not.toContain(fileName);
  }

  for (const pathMarker of P1_6D_SERIALIZED_PATH_MARKERS) {
    expect(serialized).not.toContain(pathMarker);
  }
}

function expectNoP1_6DWebImportsOrFields(source: string) {
  expect(source).not.toMatch(
    /(?:from|import)\s*["'][^"']*@navigator\/db(?:["'/])/,
  );
  expect(source).not.toMatch(/\bbasic-offline-dry-run\b/);

  for (const fileName of P1_6D_ARTIFACT_FILE_NAMES) {
    expect(source).not.toContain(fileName);
  }

  for (const pattern of P1_6D_PRODUCTION_IDENTIFIER_PATTERNS) {
    expect(source).not.toMatch(pattern);
  }

  for (const pathMarker of P1_6D_SERIALIZED_PATH_MARKERS) {
    expect(source).not.toContain(pathMarker);
  }
}

describe("GET /api/v1/countries/:code", () => {
  test("returns localized country detail with module coverage", async () => {
    const response = await GET(
      new Request("https://navigator.test/api/v1/countries/ID?locale=en"),
      { params: Promise.resolve({ code: "ID" }) },
    );
    const body = (await response.json()) as {
      success: boolean;
      data: {
        code: string;
        coverageLevel: string;
        name: string;
        moduleCoverage: Array<{ status: string }>;
      };
      meta: { locale: string; textMode: string };
    };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      data: { code: "ID", coverageLevel: "BASIC", name: "Indonesia" },
      meta: { locale: "en", textMode: "localized" },
    });
    expect(body.data.moduleCoverage).toHaveLength(10);
    expect(body.data.moduleCoverage.filter(({ status }) => status === "BUILDING"))
      .toHaveLength(9);
    expect(body.data).not.toHaveProperty("industryTags");
    expect(body.data).not.toHaveProperty("techTags");
    expectNoP1_6DFields(body);
  });

  test("returns raw LocalizedText detail when requested", async () => {
    const response = await GET(
      new Request(
        "https://navigator.test/api/v1/countries/ID?locale=en&textMode=raw",
      ),
      { params: Promise.resolve({ code: "ID" }) },
    );
    const body = (await response.json()) as {
      data: {
        moduleCoverage: unknown[];
        name: { zh: string; en: string };
        _i18nFallback?: string[];
      };
      meta: { textMode: string };
    };

    expect(body.meta.textMode).toBe("raw");
    expect(body.data.name).toEqual({ zh: "印度尼西亚", en: "Indonesia" });
    expect(body.data._i18nFallback).toBeUndefined();
    expectNoP1_6DFields(body);
    expect(body.data.moduleCoverage).toHaveLength(10);
  });

  test("returns Vietnam's published Basic detail in Chinese", async () => {
    const response = await GET(
      new Request("https://navigator.test/api/v1/countries/VN?locale=zh-CN"),
      { params: Promise.resolve({ code: "VN" }) },
    );
    const body = (await response.json()) as {
      data: { code: string; name: string; moduleCoverage: Array<{ status: string }> };
    };

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({ code: "VN", name: "越南" });
    expect(body.data.moduleCoverage.filter(({ status }) => status === "BUILDING"))
      .toHaveLength(9);
  });

  test("keeps the route outside the P1-6D audit boundary", () => {
    const sources = [
      readFileSync(new URL("./route.ts", import.meta.url), "utf8"),
      readFileSync(
        new URL(
          "../../../../../features/countries/country-service.ts",
          import.meta.url,
        ),
        "utf8",
      ),
      readFileSync(
        new URL(
          "../../../../../features/countries/country-seed-registry.ts",
          import.meta.url,
        ),
        "utf8",
      ),
    ];

    for (const source of sources) {
      expectNoP1_6DWebImportsOrFields(source);
    }
  });

  test.each([
    ["locale", "fr", 400, "VALIDATION_ERROR"],
    ["textMode", "compact", 400, "VALIDATION_ERROR"],
  ])("validates %s query values", async (key, value, status, code) => {
    const response = await GET(
      new Request(
        `https://navigator.test/api/v1/countries/ID?${key}=${value}`,
      ),
      { params: Promise.resolve({ code: "ID" }) },
    );
    const body = (await response.json()) as {
      error: { code: string; details?: Record<string, string> };
      success: boolean;
    };

    expect(response.status).toBe(status);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe(code);
  });

  test("returns NOT_FOUND for unknown country code", async () => {
    const response = await GET(
      new Request("https://navigator.test/api/v1/countries/ZZ?locale=en"),
      { params: Promise.resolve({ code: "ZZ" }) },
    );
    const body = (await response.json()) as {
      error: { code: string };
      success: boolean;
    };

    expect(response.status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("NOT_FOUND");
  });
});
