import { describe, expect, test } from "vitest";

import {
  buildCountriesResponse,
  filterCountryCatalog,
  getFilterOptions,
} from "./country-service.js";

describe("country explorer service", () => {
  test("uses the approved Indonesia seed as the current country catalog", () => {
    const response = buildCountriesResponse({ locale: "en" });

    expect(response.data.map((country) => country.code)).toEqual(["ID"]);
    expect(response.data[0]).toMatchObject({
      coverageLevel: "COMPLETE",
      name: "Indonesia",
      region: "southeast-asia",
    });
  });

  test("keeps module coverage from the seed data", () => {
    const response = buildCountriesResponse({ locale: "en" });
    const aiCoverage = response.data[0]?.moduleCoverage.find(
      (item) => item.moduleKey === "ai-advisor",
    );

    expect(aiCoverage).toEqual({
      dataCount: 20,
      moduleKey: "ai-advisor",
      status: "COMPLETE",
      updatedAt: "2026-01-15T00:00:00Z",
    });
  });

  test("filters countries by coverage level", () => {
    const result = filterCountryCatalog({ coverageLevel: "COMPLETE" });

    expect(result.map((country) => country.code)).toEqual(["ID"]);
  });

  test("filters countries by region and tags", () => {
    const result = filterCountryCatalog({
      industryTags: ["solar"],
      region: "southeast-asia",
      techTags: ["pv-module"],
    });

    expect(result.map((country) => country.code)).toEqual(["ID"]);
  });

  test("builds localized API response with aligned meta", () => {
    const response = buildCountriesResponse({
      coverageLevel: "COMPLETE",
      locale: "en",
    });

    expect(response).toMatchObject({
      success: true,
      meta: {
        locale: "en",
        page: 1,
        pageSize: 20,
        textMode: "localized",
        total: 1,
      },
    });
    expect(response.data.map((country) => country.name)).toEqual(["Indonesia"]);
    expect(response.data[0]).not.toHaveProperty("industryTags");
    expect(response.data[0]).not.toHaveProperty("techTags");
  });

  test("builds raw API response with LocalizedText business fields", () => {
    const response = buildCountriesResponse(
      {
        locale: "en",
      },
      "raw",
    );

    expect(response.meta.textMode).toBe("raw");
    expect(response.data[0]).toMatchObject({
      name: { zh: "印度尼西亚", en: "Indonesia" },
      summary: {
        zh: expect.any(String),
        en: expect.any(String),
      },
    });
    expect(response.data[0]).not.toHaveProperty("industryTags");
    expect(response.data[0]).not.toHaveProperty("techTags");
  });

  test("exposes filter options from the catalog", () => {
    expect(getFilterOptions()).toMatchObject({
      coverageLevels: ["BASIC", "STANDARD", "COMPLETE"],
      regions: ["southeast-asia"],
      industryTags: expect.arrayContaining(["solar", "storage", "ev", "grid"]),
      techTags: expect.arrayContaining(["pv-module", "lfp"]),
    });
  });
});
