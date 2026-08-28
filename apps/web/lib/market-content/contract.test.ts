import { describe, expect, it } from "vitest";
import { isMarketOverviewEnvelope } from "@/lib/market-content/contract";
import { overviewFixture } from "@/test-support/market-content-fixtures";

describe("single published market-overview contract", () => {
  it.each(["zh-CN", "en"] as const)("accepts matching six, seven and eight paragraph articles in %s", (locale) => {
    for (const count of [6, 7, 8]) expect(isMarketOverviewEnvelope(overviewFixture(locale, "IDN", count), "IDN", locale)).toBe(true);
  });

  it.each([null, [], "text", 1, {}, { meta: {} }])("rejects non-envelope value %s", (value) => {
    expect(isMarketOverviewEnvelope(value, "IDN", "zh-CN")).toBe(false);
  });

  it("requires the same country, locale and country-specific OVERVIEW version", () => {
    expect(isMarketOverviewEnvelope(overviewFixture(), "VNM", "zh-CN")).toBe(false);
    expect(isMarketOverviewEnvelope(overviewFixture(), "IDN", "en")).toBe(false);
    expect(isMarketOverviewEnvelope(overviewFixture("zh-CN", "CHN"), "CHN", "zh-CN")).toBe(false);
    expect(isMarketOverviewEnvelope(overviewFixture(), "idn", "zh-CN")).toBe(false);
    const wrongVersion = overviewFixture();
    wrongVersion.meta.content_version = "OVERVIEW-VNM-20260827-R1";
    expect(isMarketOverviewEnvelope(wrongVersion, "IDN", "zh-CN")).toBe(false);
  });

  it.each(["2026-02-30", "0000-01-01", "not-a-date", "2026-08-27T00:00:00Z"])("rejects invalid as-of date %s", (date) => {
    const overview = overviewFixture();
    overview.meta.as_of = date;
    expect(isMarketOverviewEnvelope(overview, "IDN", "zh-CN")).toBe(false);
  });

  it.each(["MARKET-IDN-20260827-R1", "OVERVIEW-IDN-20260230-R1", "OVERVIEW-IDN-00000101-R1", "OVERVIEW-IDN-20260827-R0", "OVERVIEW-IDN-20260827-R01", "OVERVIEW-IDN-20260827-R" + "1".repeat(80)])("rejects archived or invalid version %s", (version) => {
    const overview = overviewFixture();
    overview.meta.content_version = version;
    expect(isMarketOverviewEnvelope(overview, "IDN", "zh-CN")).toBe(false);
  });

  it("allows an earlier as-of date but not one after the version date", () => {
    const overview = overviewFixture();
    overview.meta.as_of = "2026-08-26";
    expect(isMarketOverviewEnvelope(overview, "IDN", "zh-CN")).toBe(true);
    overview.meta.as_of = "2026-08-28";
    expect(isMarketOverviewEnvelope(overview, "IDN", "zh-CN")).toBe(false);
  });

  it("rejects internal metadata, old cards, scores and report chapters at the public boundary", () => {
    const baseline = overviewFixture();
    for (const value of [
      { ...baseline, source_ref: "not-for-ui" },
      { ...baseline, meta: { ...baseline.meta, review_state: "approved" } },
      { ...baseline, data: { ...baseline.data, evidence: [] } },
      { ...baseline, data: { ...baseline.data, summary: {} } },
      { ...baseline, data: { ...baseline.data, entry_assessments: [] } },
      { ...baseline, data: { ...baseline.data, chapters: [] } },
      { ...baseline, data: { title: "Legacy", introduction: "Old report", chapters: [], disclaimer: "Old" } },
    ]) expect(isMarketOverviewEnvelope(value, "IDN", "zh-CN")).toBe(false);
  });

  it.each([0, 1, 5, 9])("rejects %i paragraphs", (count) => {
    expect(isMarketOverviewEnvelope(overviewFixture("en", "IDN", count), "IDN", "en")).toBe(false);
  });

  it("requires string prose and a non-empty title/disclaimer without coercing values", () => {
    const baseline = overviewFixture("en");
    for (const data of [
      { ...baseline.data, title: "" },
      { ...baseline.data, disclaimer: "\u0085\u001c\u3000" },
      { ...baseline.data, title: 123 },
      { ...baseline.data, paragraphs: [null, ...baseline.data.paragraphs.slice(1)] },
      { ...baseline.data, paragraphs: [{ text: "not prose" }, ...baseline.data.paragraphs.slice(1)] },
      { ...baseline.data, paragraphs: [" \n\t", ...baseline.data.paragraphs.slice(1)] },
      { ...baseline.data, title: "a".repeat(100_001) },
      { ...baseline.data, paragraphs: ["a".repeat(100_001), ...baseline.data.paragraphs.slice(1)] },
      { ...baseline.data, disclaimer: "a".repeat(100_001) },
    ]) expect(isMarketOverviewEnvelope({ ...baseline, data }, "IDN", "en")).toBe(false);
  });

  it.each([[1_499, false], [1_500, true], [2_000, true], [2_001, false]])("checks Chinese body length %i without counting the title or disclaimer", (count, expected) => {
    const overview = overviewFixture();
    overview.data.paragraphs = ["字".repeat(Number(count) - 5), "段", "段", "段", "段", "段"];
    expect(isMarketOverviewEnvelope(overview, "IDN", "zh-CN")).toBe(expected);
  });

  it("counts Unicode code points and matches backend whitespace rules without trimming the original text", () => {
    const overview = overviewFixture();
    overview.data.paragraphs = ["𠀀".repeat(1_495) + "\u001c\u0085\u3000 \n\t", "段", "段", "段", "段", "段"];
    const original = [...overview.data.paragraphs];
    expect(isMarketOverviewEnvelope(overview, "IDN", "zh-CN")).toBe(true);
    expect(overview.data.paragraphs).toEqual(original);
    overview.data.paragraphs[0] = "字".repeat(1_494);
    expect(isMarketOverviewEnvelope(overview, "IDN", "zh-CN")).toBe(false);
    overview.data.paragraphs[0] += "\uFEFF";
    expect(isMarketOverviewEnvelope(overview, "IDN", "zh-CN")).toBe(true);
  });

  it("does not apply the Chinese character limit to English prose", () => {
    const overview = overviewFixture("en");
    overview.data.paragraphs = Array.from({ length: 6 }, (_, index) => `Test paragraph ${index + 1}.`);
    expect(isMarketOverviewEnvelope(overview, "IDN", "en")).toBe(true);
  });
});
