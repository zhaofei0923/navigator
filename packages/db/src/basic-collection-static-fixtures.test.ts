import { describe, expect, test } from "vitest";

import {
  readBasicCollectionAuditFixture,
  type BasicCollectionFixtureScenario,
} from "./basic-collection-test-fixture.js";
import { validateBasicCollectionAuditBundle } from "./collection/basic-collection-validator.js";

const EXPECTED_CLASSIFICATIONS: ReadonlyArray<{
  scenario: BasicCollectionFixtureScenario;
  blockers: readonly string[];
  readyForHumanReview: boolean;
}> = [
  { scenario: "normal", blockers: [], readyForHumanReview: true },
  {
    scenario: "missing",
    blockers: ["MISSING_REQUIRED_FACT"],
    readyForHumanReview: false,
  },
  {
    scenario: "conflict",
    blockers: ["UNRESOLVED_CONFLICT"],
    readyForHumanReview: false,
  },
  {
    scenario: "untrusted",
    blockers: ["UNTRUSTED_INPUT"],
    readyForHumanReview: false,
  },
];

describe("committed Basic collection audit fixtures", () => {
  test.each(EXPECTED_CLASSIFICATIONS)(
    "$scenario fixture is deterministic and has its exact review classification",
    ({ scenario, blockers, readyForHumanReview }) => {
      const firstRead = readBasicCollectionAuditFixture(scenario);
      const secondRead = readBasicCollectionAuditFixture(scenario);
      const result = validateBasicCollectionAuditBundle(firstRead);

      expect(firstRead).toEqual(secondRead);
      expect(result).toMatchObject({
        valid: true,
        blockers,
        readyForHumanReview,
      });
    },
  );

  test.each(EXPECTED_CLASSIFICATIONS)(
    "$scenario fixture covers every required fact path",
    ({ scenario }) => {
      const bundle = readBasicCollectionAuditFixture(scenario);
      const factsByPath = new Map(
        bundle.extractedFacts.facts.map((fact) => [fact.fieldPath, fact]),
      );

      expect(bundle.extractedFacts.facts).toHaveLength(24);
      expect([...factsByPath.keys()].sort()).toEqual(
        requiredFixturePaths().sort(),
      );
      if (scenario === "normal") {
        expect(bundle.extractedFacts.facts.every(({ status }) => status === "candidate"))
          .toBe(true);
      }
      if (scenario === "missing") {
        expect(factsByPath.get("marketOverview.gdp")?.status).toBe("missing");
        expect(bundle.marketOverviewDraft.gdp).toBeNull();
      }
      if (scenario === "conflict") {
        expect(factsByPath.get("marketOverview.population")?.status).toBe("conflict");
        expect(bundle.marketOverviewDraft.population).toBeNull();
      }
    },
  );

  test.each(EXPECTED_CLASSIFICATIONS)(
    "$scenario sentinel is retained only in audit evidence",
    ({ scenario }) => {
      const bundle = readBasicCollectionAuditFixture(scenario);
      const sentinel = `AUDIT_SENTINEL_${scenario.toUpperCase()}`;

      expect(JSON.stringify(bundle.extractedFacts)).toContain(sentinel);
      expect(JSON.stringify(bundle.sourceRegister)).not.toContain(sentinel);
      expect(JSON.stringify(bundle.marketOverviewDraft)).not.toContain(sentinel);
      expect(JSON.stringify(bundle.reviewReport)).not.toContain(sentinel);
    },
  );
});

function requiredFixturePaths(): string[] {
  return [
    "country.code",
    "country.name",
    "country.summary",
    "country.region",
    "country.flagEmoji",
    "country.updatedAt",
    "marketOverview.overview",
    "marketOverview.population",
    "marketOverview.gdp",
    "marketOverview.gdpGrowth",
    "marketOverview.energyDemand",
    "marketOverview.renewableTarget",
    "marketOverview.source",
    "marketOverview.sourceUrl",
    "marketOverview.collectedAt",
    "marketOverview.updatedAt",
    "marketOverview.credibility",
    "marketOverview.countryCode",
    "marketOverview.industryTags",
    "marketOverview.techTags",
    "marketOverview.keyIndicators[0].label",
    "marketOverview.keyIndicators[0].value",
    "marketOverview.keyIndicators[0].unit",
    "marketOverview.keyIndicators[0].year",
  ];
}
