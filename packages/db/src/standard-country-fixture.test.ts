import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import type { StandardCountrySyntheticFixture } from "./standard/standard-fixture-contracts.js";
import { deriveStandardFixtureCoverage } from "./standard/standard-fixture-coverage.js";
import { parseStandardCountryFixture } from "./standard/standard-fixture-parser.js";

const INVALID_FIXTURE = /^STANDARD_FIXTURE_INVALID$/;
const FIXTURE_URL = new URL(
  "../fixtures/standard-country/id-standard-synthetic.json",
  import.meta.url,
);
const STANDARD_SOURCE_URLS = [
  new URL("./standard/standard-fixture-contracts.ts", import.meta.url),
  new URL("./standard/standard-fixture-parser.ts", import.meta.url),
  new URL("./standard/standard-fixture-coverage.ts", import.meta.url),
] as const;

describe("synthetic STANDARD country fixture parser", () => {
  test("parses the synthetic file with exactly one record in each required module", () => {
    const parsed = parseStandardCountryFixture(readFixture());

    expect(parsed).toMatchObject({
      schemaVersion: "standard-country-synthetic-fixture/v1",
      fixtureOnly: true,
      countryCode: "ID",
    });
    expect(parsed.policy).toHaveLength(1);
    expect(parsed.risk).toHaveLength(1);
    expect(parsed.opportunities).toHaveLength(1);
    expect(parsed.policy[0]?.aiUsable).toBe(false);
    expect(parsed.risk[0]?.aiUsable).toBe(false);
    expect(parsed.opportunities[0]?.aiUsable).toBe(false);
  });

  test.each([
    ["null", () => null],
    ["array", () => []],
    ["wrong schema", () => mutateFixture((fixture) => {
      fixture.schemaVersion = "standard-country-synthetic-fixture/v2";
    })],
    ["non-fixture", () => mutateFixture((fixture) => {
      fixture.fixtureOnly = false;
    })],
    ["invalid ISO2", () => mutateFixture((fixture) => {
      fixture.countryCode = "EXX";
    })],
    ["extra top-level key", () => mutateFixture((fixture) => {
      fixture.extra = true;
    })],
    ["missing top-level key", () => mutateFixture((fixture) => {
      delete fixture.risk;
    })],
    ["symbol key", () => {
      const fixture = mutableFixture();
      Object.defineProperty(fixture, Symbol("hidden"), {
        enumerable: true,
        value: "secret-payload",
      });
      return fixture;
    }],
    ["non-plain object", () => Object.assign(Object.create(null), mutableFixture())],
    ["non-JSON-safe value", () => mutateFixture((fixture) => {
      fixture.extra = 1n;
    })],
  ])("rejects %s input with a stable non-payload error", (_label, createInput) => {
    expect(() => parseStandardCountryFixture(createInput())).toThrowError(
      INVALID_FIXTURE,
    );
  });

  test.each([
    "source",
    "sourceUrl",
    "collectedAt",
    "updatedAt",
    "credibility",
    "reviewStatus",
    "aiUsable",
    "countryCode",
    "industryTags",
    "techTags",
  ])("requires metadata field %s on every record", (field) => {
    const fixture = mutableFixture();
    for (const moduleKey of ["policy", "risk", "opportunities"] as const) {
      const candidate = structuredClone(fixture);
      delete firstRecord(candidate, moduleKey)[field];
      expect(() => parseStandardCountryFixture(candidate)).toThrowError(
        INVALID_FIXTURE,
      );
    }
  });

  test("requires exact module-specific record keys", () => {
    const extra = mutableFixture();
    firstRecord(extra, "policy").canonicalId = "forbidden";
    expect(() => parseStandardCountryFixture(extra)).toThrowError(INVALID_FIXTURE);

    const missing = mutableFixture();
    delete firstRecord(missing, "opportunities").timeWindow;
    expect(() => parseStandardCountryFixture(missing)).toThrowError(
      INVALID_FIXTURE,
    );
  });

  test.each(["policy", "risk", "opportunities"] as const)(
    "requires exactly one actual fixture record in %s",
    (moduleKey) => {
      const empty = mutableFixture();
      empty[moduleKey] = [];
      expect(() => parseStandardCountryFixture(empty)).toThrowError(
        INVALID_FIXTURE,
      );

      const twoDistinct = mutableFixture();
      const second = structuredClone(firstRecord(twoDistinct, moduleKey));
      second.fixtureRecordId = `${moduleKey}-synthetic-fixture-2`;
      moduleRecords(twoDistinct, moduleKey).push(second);
      expect(() => parseStandardCountryFixture(twoDistinct)).toThrowError(
        INVALID_FIXTURE,
      );
    },
  );

  test("requires exact bilingual fields, rejects both blank, and permits one blank", () => {
    const extra = mutableFixture();
    const extraTitle = localizedField(firstRecord(extra, "policy"), "title");
    extraTitle.fr = "synthetic fixture";
    expect(() => parseStandardCountryFixture(extra)).toThrowError(INVALID_FIXTURE);

    const bothBlank = mutableFixture();
    localizedField(firstRecord(bothBlank, "risk"), "description").zh = " ";
    localizedField(firstRecord(bothBlank, "risk"), "description").en = "";
    expect(() => parseStandardCountryFixture(bothBlank)).toThrowError(
      INVALID_FIXTURE,
    );

    const fallback = mutableFixture();
    localizedField(firstRecord(fallback, "opportunities"), "title").zh = "";
    expect(parseStandardCountryFixture(fallback).opportunities[0]?.title).toEqual({
      zh: "",
      en: "Synthetic fixture opportunity title",
    });
  });

  test.each([
    ["country mismatch", (record: Record<string, unknown>) => {
      record.countryCode = "AE";
    }],
    ["bad collected timestamp", (record: Record<string, unknown>) => {
      record.collectedAt = "2099-13-01T00:00:00.000Z";
    }],
    ["updated before collected", (record: Record<string, unknown>) => {
      record.updatedAt = "2098-01-01T00:00:00.000Z";
    }],
    ["unsupported credibility", (record: Record<string, unknown>) => {
      record.credibility = "TRUST_ME";
    }],
    ["unsupported review status", (record: Record<string, unknown>) => {
      record.reviewStatus = "approved";
    }],
    ["unsafe URL", (record: Record<string, unknown>) => {
      record.sourceUrl = "javascript:alert(1)";
    }],
    ["non-fixture URL", (record: Record<string, unknown>) => {
      record.sourceUrl = "https://example.com/source";
    }],
    ["blank source", (record: Record<string, unknown>) => {
      record.source = " ";
    }],
    ["AI flag", (record: Record<string, unknown>) => {
      record.aiUsable = true;
    }],
    ["unsupported industry tag", (record: Record<string, unknown>) => {
      record.industryTags = ["unsupported"];
    }],
    ["unsupported technology tag", (record: Record<string, unknown>) => {
      record.techTags = ["unsupported"];
    }],
  ])("rejects invalid metadata: %s", (_label, mutateRecord) => {
    for (const moduleKey of ["policy", "risk", "opportunities"] as const) {
      const fixture = mutableFixture();
      mutateRecord(firstRecord(fixture, moduleKey));
      expect(() => parseStandardCountryFixture(fixture)).toThrowError(
        INVALID_FIXTURE,
      );
    }
  });

  test("validates registered module enums without inventing risk categories", () => {
    const policy = mutableFixture();
    firstRecord(policy, "policy").policyType = "synthetic-type";
    expect(() => parseStandardCountryFixture(policy)).toThrowError(INVALID_FIXTURE);

    const risk = mutableFixture();
    firstRecord(risk, "risk").level = "CRITICAL";
    expect(() => parseStandardCountryFixture(risk)).toThrowError(INVALID_FIXTURE);

    expect(firstRecord(mutableFixture(), "risk").category).toBe(
      "fixture-category",
    );

    const category = mutableFixture();
    firstRecord(category, "risk").category = "political";
    expect(() => parseStandardCountryFixture(category)).toThrowError(
      INVALID_FIXTURE,
    );
  });

  test("rejects real-looking source names and malformed optional content", () => {
    const source = mutableFixture();
    firstRecord(source, "policy").source = "Example Government Agency";
    expect(() => parseStandardCountryFixture(source)).toThrowError(INVALID_FIXTURE);

    const effectiveDate = mutableFixture();
    firstRecord(effectiveDate, "policy").effectiveDate = "not-a-date";
    expect(() => parseStandardCountryFixture(effectiveDate)).toThrowError(
      INVALID_FIXTURE,
    );

    const duplicateTag = mutableFixture();
    firstRecord(duplicateTag, "opportunities").industryTags = ["solar", "solar"];
    expect(() => parseStandardCountryFixture(duplicateTag)).toThrowError(
      INVALID_FIXTURE,
    );
  });

  test("does not invoke accessors while rejecting non-JSON-safe input", () => {
    const fixture = mutableFixture();
    let invoked = false;
    Object.defineProperty(fixture, "schemaVersion", {
      enumerable: true,
      get() {
        invoked = true;
        return "standard-country-synthetic-fixture/v1";
      },
    });

    expect(() => parseStandardCountryFixture(fixture)).toThrowError(INVALID_FIXTURE);
    expect(invoked).toBe(false);
  });

  test("rejects nested non-plain and non-JSON-safe values", () => {
    const nonPlain = mutableFixture();
    const title = localizedField(firstRecord(nonPlain, "policy"), "title");
    firstRecord(nonPlain, "policy").title = Object.assign(
      Object.create(null),
      title,
    );
    expect(() => parseStandardCountryFixture(nonPlain)).toThrowError(
      INVALID_FIXTURE,
    );

    const nonJson = mutableFixture();
    localizedField(firstRecord(nonJson, "risk"), "title").zh = undefined as never;
    expect(() => parseStandardCountryFixture(nonJson)).toThrowError(
      INVALID_FIXTURE,
    );
  });

  test("enforces timestamp, text, and array bounds", () => {
    const nonCanonicalUtc = mutableFixture();
    firstRecord(nonCanonicalUtc, "risk").collectedAt =
      "2099-01-01T00:00:00+00:00";
    expect(() => parseStandardCountryFixture(nonCanonicalUtc)).toThrowError(
      INVALID_FIXTURE,
    );

    const longDisplay = mutableFixture();
    localizedField(firstRecord(longDisplay, "policy"), "body").en =
      `Synthetic fixture ${"x".repeat(16_384)}`;
    expect(() => parseStandardCountryFixture(longDisplay)).toThrowError(
      INVALID_FIXTURE,
    );

    const longSource = mutableFixture();
    firstRecord(longSource, "opportunities").source =
      `synthetic-fixture-${"x".repeat(512)}`;
    expect(() => parseStandardCountryFixture(longSource)).toThrowError(
      INVALID_FIXTURE,
    );

    const longTags = mutableFixture();
    firstRecord(longTags, "risk").industryTags = Array.from(
      { length: 9 },
      () => "solar",
    );
    expect(() => parseStandardCountryFixture(longTags)).toThrowError(
      INVALID_FIXTURE,
    );
  });

  test.each([
    "https://user:secret@policy.synthetic-fixture.invalid/source",
    "https://policy.synthetic-fixture.invalid/source#fragment",
  ])("rejects fixture URL credentials or fragments: %s", (sourceUrl) => {
    const fixture = mutableFixture();
    firstRecord(fixture, "policy").sourceUrl = sourceUrl;
    expect(() => parseStandardCountryFixture(fixture)).toThrowError(
      INVALID_FIXTURE,
    );
  });

  test("does not assign cross-module production identity semantics", () => {
    const fixture = mutableFixture();
    for (const moduleKey of ["policy", "risk", "opportunities"] as const) {
      firstRecord(fixture, moduleKey).fixtureRecordId = "shared-synthetic-fixture-id";
    }
    expect(() => parseStandardCountryFixture(fixture)).not.toThrow();
  });

  test.each(["policy", "risk", "opportunities"] as const)(
    "rejects duplicate fixtureRecordId values within %s only",
    (moduleKey) => {
      const fixture = mutableFixture();
      moduleRecords(fixture, moduleKey).push(
        structuredClone(firstRecord(fixture, moduleKey)),
      );
      expect(() => parseStandardCountryFixture(fixture)).toThrowError(
        INVALID_FIXTURE,
      );
    },
  );
});

describe("synthetic STANDARD country fixture coverage", () => {
  test.each(["policy", "risk", "opportunities"] as const)(
    "uses shared 0/1/4/5 visible-count thresholds for %s",
    (moduleKey) => {
      const parsed = parseStandardCountryFixture(readFixture());

      for (const [count, expected] of [
        [0, "BUILDING"],
        [1, "PARTIAL"],
        [4, "PARTIAL"],
        [5, "COMPLETE"],
      ] as const) {
        const verdict = deriveStandardFixtureCoverage(
          fixtureWithRecordCount(parsed, moduleKey, count),
          { marketOverview: { status: "PARTIAL", dataCount: 1 } },
        );
        expect(moduleCoverage(verdict, moduleKey)).toEqual({
          moduleKey,
          status: expected,
          dataCount: count,
        });
      }
    },
  );

  test.each([
    ["draft", { reviewStatus: "draft" }],
    ["pending", { reviewStatus: "pending" }],
    ["UNVERIFIED", { credibility: "UNVERIFIED" }],
  ] as const)("excludes %s records from every visible count", (_label, change) => {
    const parsed = parseStandardCountryFixture(readFixture());
    const excluded = {
      ...parsed,
      policy: [{ ...parsed.policy[0]!, ...change }],
      risk: [{ ...parsed.risk[0]!, ...change }],
      opportunities: [{ ...parsed.opportunities[0]!, ...change }],
    } as StandardCountrySyntheticFixture;

    const verdict = deriveStandardFixtureCoverage(excluded, {
      marketOverview: { status: "PARTIAL", dataCount: 1 },
    });
    for (const moduleKey of ["policy", "risk", "opportunities"] as const) {
      expect(moduleCoverage(verdict, moduleKey)).toMatchObject({
        status: "BUILDING",
        dataCount: 0,
      });
    }
  });

  test("derives STANDARD only while market and all three decision modules qualify", () => {
    const parsed = parseStandardCountryFixture(readFixture());
    const standard = deriveStandardFixtureCoverage(parsed, {
      marketOverview: { status: "PARTIAL", dataCount: 1 },
    });
    expect(standard.coverageLevel).toBe("STANDARD");

    for (const moduleKey of ["policy", "risk", "opportunities"] as const) {
      const basic = deriveStandardFixtureCoverage(
        fixtureWithRecordCount(parsed, moduleKey, 0),
        { marketOverview: { status: "PARTIAL", dataCount: 1 } },
      );
      expect(basic.coverageLevel).toBe("BASIC");
    }
  });

  test("never derives COMPLETE when only the four STANDARD modules are complete", () => {
    const parsed = parseStandardCountryFixture(readFixture());
    const allDecisionListsComplete = ([
      "policy",
      "risk",
      "opportunities",
    ] as const).reduce(
      (fixture, moduleKey) => fixtureWithRecordCount(fixture, moduleKey, 5),
      parsed,
    );

    const verdict = deriveStandardFixtureCoverage(allDecisionListsComplete, {
      marketOverview: { status: "COMPLETE", dataCount: 1 },
    });
    expect(verdict.coverageLevel).toBe("STANDARD");
    expect(
      verdict.moduleCoverage.filter((coverage) => coverage.status === "COMPLETE"),
    ).toHaveLength(4);
  });

  test("keeps all non-pilot deep modules and the AI boundary fixed negative", () => {
    const verdict = deriveStandardFixtureCoverage(
      parseStandardCountryFixture(readFixture()),
      { marketOverview: { status: "PARTIAL", dataCount: 1 } },
    );

    expect(verdict.moduleCoverage).toHaveLength(10);
    for (const moduleKey of [
      "projects",
      "partners",
      "chinese-companies",
      "entry-strategy",
      "ai-advisor",
      "reports",
    ] as const) {
      expect(moduleCoverage(verdict, moduleKey)).toEqual({
        moduleKey,
        status: "BUILDING",
        dataCount: 0,
      });
    }
    expect(verdict.knowledge).toEqual([]);
    expect(verdict.aiEligibleKnowledgeIds).toEqual([]);
  });

  test("is permutation-independent and does not mutate coverage inputs", () => {
    const parsed = parseStandardCountryFixture(readFixture());
    const fiveRecords = fixtureWithRecordCount(parsed, "policy", 5);
    const reversed = {
      ...fiveRecords,
      policy: [...fiveRecords.policy].reverse(),
    } as StandardCountrySyntheticFixture;
    const fixtureBefore = structuredClone(reversed);
    const input = { marketOverview: { status: "PARTIAL" as const, dataCount: 1 } };
    const inputBefore = structuredClone(input);

    expect(deriveStandardFixtureCoverage(reversed, input)).toEqual(
      deriveStandardFixtureCoverage(fiveRecords, input),
    );
    expect(reversed).toEqual(fixtureBefore);
    expect(input).toEqual(inputBefore);
  });

  test("never derives AI eligibility from a coverage-only forged AI flag", () => {
    const parsed = parseStandardCountryFixture(readFixture());
    const forged = {
      ...parsed,
      policy: [{ ...parsed.policy[0]!, aiUsable: true }],
      risk: [{ ...parsed.risk[0]!, aiUsable: true }],
      opportunities: [{ ...parsed.opportunities[0]!, aiUsable: true }],
    } as unknown as StandardCountrySyntheticFixture;
    const verdict = deriveStandardFixtureCoverage(forged, {
      marketOverview: { status: "PARTIAL", dataCount: 1 },
    });

    expect(moduleCoverage(verdict, "ai-advisor")).toEqual({
      moduleKey: "ai-advisor",
      status: "BUILDING",
      dataCount: 0,
    });
    expect(verdict.knowledge).toEqual([]);
    expect(verdict.aiEligibleKnowledgeIds).toEqual([]);
  });
});

describe("synthetic STANDARD fixture neutrality and isolation", () => {
  test("parses a structurally equivalent alternate ISO2 without a country branch", () => {
    const alternate = mutableFixture();
    alternate.countryCode = "AE";
    for (const moduleKey of ["policy", "risk", "opportunities"] as const) {
      firstRecord(alternate, moduleKey).countryCode = "AE";
    }

    expect(parseStandardCountryFixture(alternate).countryCode).toBe("AE");
    for (const sourceUrl of STANDARD_SOURCE_URLS) {
      const source = readFileSync(sourceUrl, "utf8");
      expect(source).not.toMatch(/["']ID["']/u);
      expect(source).not.toMatch(/indonesia/iu);
    }
  });

  test("keeps the checked-in fixture synthetic and isolated from real systems", () => {
    const fixtureText = readFileSync(FIXTURE_URL, "utf8");
    expect(fixtureText).not.toMatch(
      /data\/|approval|publication|prisma|knowledgechunk|embedding|ai-index/iu,
    );
    const urls = fixtureText.match(/https?:\/\/[^"\s]+/gu) ?? [];
    expect(urls.length).toBeGreaterThan(0);
    for (const urlText of urls) {
      expect(new URL(urlText).hostname.endsWith(".invalid")).toBe(true);
    }

    const packageIndex = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    expect(packageIndex).not.toMatch(/standard-fixture/iu);
    const packageJson = readFileSync(new URL("../package.json", import.meta.url), "utf8");
    expect(packageJson).not.toMatch(/standard-fixture/iu);
    for (const sourceUrl of STANDARD_SOURCE_URLS) {
      expect(readFileSync(sourceUrl, "utf8")).not.toMatch(
        /@prisma\/client|PrismaClient|\bloader\b|\bcli\b|data\//u,
      );
    }
  });

  test.each([
    "data/real-tree",
    "approval payload",
    "publication payload",
    "Prisma payload",
    "KnowledgeChunk payload",
    "embedding payload",
    "AI-index payload",
  ])("rejects forbidden isolation payload %s even inside an allowed field", (payload) => {
    const fixture = mutableFixture();
    localizedField(firstRecord(fixture, "policy"), "body").en =
      `Synthetic fixture ${payload}`;
    expect(() => parseStandardCountryFixture(fixture)).toThrowError(INVALID_FIXTURE);
  });

  test("allows an explained absent source URL but rejects an unexplained one", () => {
    const explained = mutableFixture();
    const explainedRecord = firstRecord(explained, "policy");
    explainedRecord.source = "synthetic-fixture-source-no-url";
    explainedRecord.sourceUrl = null;
    expect(parseStandardCountryFixture(explained).policy[0]?.sourceUrl).toBeNull();

    const unexplained = mutableFixture();
    firstRecord(unexplained, "policy").sourceUrl = null;
    expect(() => parseStandardCountryFixture(unexplained)).toThrowError(
      INVALID_FIXTURE,
    );
  });

  test("normalizes non-semantic tag order deterministically", () => {
    const left = mutableFixture();
    const right = mutableFixture();
    const leftPolicy = firstRecord(left, "policy");
    const rightPolicy = firstRecord(right, "policy");
    leftPolicy.industryTags = ["wind", "solar"];
    leftPolicy.techTags = ["inverter", "pv-module"];
    rightPolicy.industryTags = ["solar", "wind"];
    rightPolicy.techTags = ["pv-module", "inverter"];

    expect(parseStandardCountryFixture(left)).toEqual(
      parseStandardCountryFixture(right),
    );
  });

  test("returns detached recursively frozen parser and coverage snapshots", () => {
    const input = mutableFixture();
    const original = structuredClone(input);
    const parsed = parseStandardCountryFixture(input);
    const verdict = deriveStandardFixtureCoverage(parsed, {
      marketOverview: { status: "PARTIAL", dataCount: 1 },
    });

    expect(input).toEqual(original);
    for (const value of [
      parsed,
      parsed.policy,
      parsed.policy[0],
      parsed.policy[0]?.title,
      parsed.policy[0]?.industryTags,
      verdict,
      verdict.moduleCoverage,
      verdict.moduleCoverage[0],
      verdict.knowledge,
      verdict.aiEligibleKnowledgeIds,
    ]) {
      expect(Object.isFrozen(value)).toBe(true);
    }
    expect(() => {
      (parsed.policy as unknown[]).push({});
    }).toThrow();
    expect(() => {
      (verdict.moduleCoverage as unknown[]).reverse();
    }).toThrow();
  });
});

function readFixture(): unknown {
  const parsed: unknown = JSON.parse(readFileSync(FIXTURE_URL, "utf8"));
  return parsed;
}

function mutableFixture(): Record<string, unknown> {
  return structuredClone(readFixture()) as Record<string, unknown>;
}

function mutateFixture(
  mutate: (fixture: Record<string, unknown>) => void,
): unknown {
  const fixture = mutableFixture();
  mutate(fixture);
  return fixture;
}

function moduleRecords(
  fixture: Record<string, unknown>,
  moduleKey: "policy" | "risk" | "opportunities",
): Array<Record<string, unknown>> {
  return fixture[moduleKey] as Array<Record<string, unknown>>;
}

function firstRecord(
  fixture: Record<string, unknown>,
  moduleKey: "policy" | "risk" | "opportunities",
): Record<string, unknown> {
  return moduleRecords(fixture, moduleKey)[0]!;
}

function localizedField(
  record: Record<string, unknown>,
  field: string,
): Record<string, string> {
  return record[field] as Record<string, string>;
}

function fixtureWithRecordCount(
  fixture: StandardCountrySyntheticFixture,
  moduleKey: "policy" | "risk" | "opportunities",
  count: number,
): StandardCountrySyntheticFixture {
  const record = fixture[moduleKey][0];
  const records = record === undefined
    ? []
    : Array.from({ length: count }, (_, index) => ({
      ...record,
      fixtureRecordId: `${moduleKey}-coverage-only-${index}`,
    }));
  return { ...fixture, [moduleKey]: records } as StandardCountrySyntheticFixture;
}

function moduleCoverage(
  verdict: ReturnType<typeof deriveStandardFixtureCoverage>,
  moduleKey: string,
) {
  return verdict.moduleCoverage.find((coverage) => coverage.moduleKey === moduleKey);
}
