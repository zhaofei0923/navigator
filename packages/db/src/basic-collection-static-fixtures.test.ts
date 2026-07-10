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
