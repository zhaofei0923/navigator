import { describe, expect, test } from "vitest";

import { renderBasicNumericTemplate } from "./basic-bilingual-template.js";

describe("BASIC deterministic bilingual numeric template", () => {
  test("preserves the value, unit, year, and source ID tokens exactly", () => {
    const result = renderBasicNumericTemplate({
      value: "00125.40",
      unit: "TWh<gross>",
      year: "02025",
      sourceIds: ["ember-electricity", "official-grid"],
    });

    expect(result).toEqual({
      zh: "02025年该指标为00125.40 TWh<gross>（来源：ember-electricity、official-grid）",
      en: "The indicator was 00125.40 TWh<gross> in 02025 (Sources: ember-electricity, official-grid)",
    });
  });

  test("rejects empty or control-character tokens instead of normalizing them", () => {
    expect(() => renderBasicNumericTemplate({
      value: "  ", unit: "TWh", year: "2025", sourceIds: ["ember-electricity"],
    })).toThrow("BASIC numeric template input is invalid");
    expect(() => renderBasicNumericTemplate({
      value: "1", unit: "TW\nh", year: "2025", sourceIds: ["ember-electricity"],
    })).toThrow("BASIC numeric template input is invalid");
  });

  test("accepts finite numeric value and year tokens", () => {
    expect(renderBasicNumericTemplate({
      value: 125.4, unit: "TWh", year: 2025, sourceIds: ["ember-electricity"],
    })).toEqual({
      zh: "2025年该指标为125.4 TWh（来源：ember-electricity）",
      en: "The indicator was 125.4 TWh in 2025 (Sources: ember-electricity)",
    });
  });
});
