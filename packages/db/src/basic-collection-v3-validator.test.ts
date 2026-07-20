import { describe, expect, test } from "vitest";

import { createBasicCollectionAuditV3Fixture } from "./basic-collection-v3-test-fixture.js";
import { validateBasicCollectionAuditBundleV3 } from "./collection/basic-collection-v3-validator.js";

describe("Basic collection audit v3 validation", () => {
  test("accepts complete profile facts as ready for human review", () => {
    expect(validateBasicCollectionAuditBundleV3(createBasicCollectionAuditV3Fixture()))
      .toMatchObject({
        valid: true,
        readyForHumanReview: true,
        blockers: [],
      });
  });

  test("does not mark an empty or partial required BASIC profile ready", () => {
    const empty = mutableFixture();
    empty.marketOverviewDraft.basicProfile.categories.policyOverview.fields = [];
    empty.extractedFacts.facts.splice(profileFactIndex(empty, "policyOverview"), 1);
    expectInvalid(empty, "valid required basic-market-profile/v2");

    const partial = mutableFixture();
    const solarFields = partial.marketOverviewDraft.basicProfile.categories
      .solarResource.fields;
    const omitted = solarFields.pop();
    if (omitted === undefined) throw new Error("fixture field missing");
    const omittedFact = partial.extractedFacts.facts.findIndex(({ fieldPath }) =>
      fieldPath.endsWith(`solarResource.fields.${omitted.key}`)
    );
    if (omittedFact < 0) throw new Error("fixture fact missing");
    partial.extractedFacts.facts.splice(omittedFact, 1);
    expectInvalid(partial, "valid required basic-market-profile/v2");
  });

  test("requires an exact draft-field to semantic-fact bijection", () => {
    const missing = mutableFixture();
    missing.extractedFacts.facts.splice(profileFactIndex(missing, "countryBasics"), 1);
    expectInvalid(missing, "exactly one fact");

    const unresolved = mutableFixture();
    profileFact(unresolved, "countryBasics").fieldPath =
      "marketOverview.basicProfile.categories.countryBasics.fields.unregisteredField";
    unresolved.extractedFacts.facts.sort((left, right) =>
      left.fieldPath.localeCompare(right.fieldPath),
    );
    expectInvalid(unresolved, "resolve to exactly one");
  });

  test("binds normalizedValue to the complete draft field object", () => {
    const bundle = mutableFixture();
    const fact = profileFact(bundle, "electricityMarket");
    const normalized = record(fact.evidence[0]!.normalizedValue);
    normalized.value = 999;

    expectInvalid(bundle, "complete draft field object");
  });

  test("requires evidence sourceId set equality with field sourceIds", () => {
    const bundle = mutableFixture();
    profileFact(bundle, "solarResource").evidence[0]!.sourceId = "source-2";

    expectInvalid(bundle, "sourceId set");
  });

  test("rejects checkedAt before every referenced source retrieval date", () => {
    const bundle = mutableFixture();
    profileField(bundle, "windResource").checkedAt = "2026-07-08";
    syncNormalizedField(bundle, "windResource");

    expectInvalid(bundle, "checkedAt");
  });

  test("accepts a valid NOT_AVAILABLE profile field without a blocker", () => {
    const bundle = mutableFixture();
    const field = profileField(bundle, "policyOverview");
    field.status = "NOT_AVAILABLE";
    field.value = null;
    field.unit = null;
    field.year = null;
    field.reason = {
      zh: "已检查登记来源，未提供该字段。",
      en: "The registered source was checked and did not provide this field.",
    };
    syncNormalizedField(bundle, "policyOverview");

    expect(validateBasicCollectionAuditBundleV3(bundle)).toMatchObject({
      valid: true,
      readyForHumanReview: true,
      blockers: [],
    });
  });
});

function expectInvalid(value: unknown, message: string): void {
  expect(validateBasicCollectionAuditBundleV3(value)).toMatchObject({
    valid: false,
    readyForHumanReview: false,
    errors: expect.arrayContaining([expect.stringContaining(message)]),
  });
}

function mutableFixture(): DeepMutable<ReturnType<typeof createBasicCollectionAuditV3Fixture>> {
  return structuredClone(createBasicCollectionAuditV3Fixture()) as unknown as
    DeepMutable<ReturnType<typeof createBasicCollectionAuditV3Fixture>>;
}

function profileFactIndex(
  bundle: DeepMutable<ReturnType<typeof createBasicCollectionAuditV3Fixture>>,
  category: string,
): number {
  const index = bundle.extractedFacts.facts.findIndex(({ fieldPath }) =>
    fieldPath.startsWith(`marketOverview.basicProfile.categories.${category}.`)
  );
  if (index < 0) throw new Error(`fixture fact missing for ${category}`);
  return index;
}

function profileFact(
  bundle: DeepMutable<ReturnType<typeof createBasicCollectionAuditV3Fixture>>,
  category: string,
) {
  return bundle.extractedFacts.facts[profileFactIndex(bundle, category)]!;
}

function profileField(
  bundle: DeepMutable<ReturnType<typeof createBasicCollectionAuditV3Fixture>>,
  category: keyof typeof bundle.marketOverviewDraft.basicProfile.categories,
) {
  return bundle.marketOverviewDraft.basicProfile.categories[category].fields[0]!;
}

function syncNormalizedField(
  bundle: DeepMutable<ReturnType<typeof createBasicCollectionAuditV3Fixture>>,
  category: keyof typeof bundle.marketOverviewDraft.basicProfile.categories,
): void {
  profileFact(bundle, category).evidence[0]!.normalizedValue =
    structuredClone(profileField(bundle, category));
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("fixture value must be a record");
  }
  return value as Record<string, unknown>;
}

type DeepMutable<T> = T extends readonly (infer Item)[]
  ? DeepMutable<Item>[]
  : T extends object
    ? { -readonly [Key in keyof T]: DeepMutable<T[Key]> }
    : T;
