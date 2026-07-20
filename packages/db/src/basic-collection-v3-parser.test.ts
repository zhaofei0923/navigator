import { describe, expect, test } from "vitest";

import { createBasicCollectionAuditV3Fixture } from "./basic-collection-v3-test-fixture.js";
import { parseBasicCollectionAuditBundleV3 } from "./collection/basic-collection-v3-parser.js";

describe("Basic collection audit v3 parser", () => {
  test("parses an exact v3 bundle as a detached frozen snapshot", () => {
    const bundle = createBasicCollectionAuditV3Fixture();
    const result = parseBasicCollectionAuditBundleV3(bundle);

    expect(result.errors).toEqual([]);
    expect(result.data).toEqual(bundle);
    expect(result.data).not.toBe(bundle);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.data?.marketOverviewDraft.basicProfile)).toBe(true);
  });

  test("requires the one exact basicProfile draft property", () => {
    const missing = mutableFixture();
    delete (missing.marketOverviewDraft as Partial<typeof missing.marketOverviewDraft>)
      .basicProfile;
    const extra = mutableFixture();
    Object.assign(extra.marketOverviewDraft, { profileAlias: {} });

    expect(parseBasicCollectionAuditBundleV3(missing)).toMatchObject({
      data: null,
      errors: expect.arrayContaining([expect.stringContaining("basicProfile")]),
    });
    expect(parseBasicCollectionAuditBundleV3(extra)).toMatchObject({
      data: null,
      errors: expect.arrayContaining([expect.stringContaining("exactly")]),
    });
  });

  test("rejects a profile path outside the exact category and lower-camel grammar", () => {
    const bundle = mutableFixture();
    const fact = profileFact(bundle, "countryBasics");
    fact.fieldPath =
      "marketOverview.basicProfile.categories.country-basics.fields.CountryName";

    expect(parseBasicCollectionAuditBundleV3(bundle)).toMatchObject({
      data: null,
      errors: expect.arrayContaining([expect.stringContaining("fieldPath")]),
    });
  });
});

function mutableFixture(): DeepMutable<ReturnType<typeof createBasicCollectionAuditV3Fixture>> {
  return structuredClone(createBasicCollectionAuditV3Fixture()) as unknown as
    DeepMutable<ReturnType<typeof createBasicCollectionAuditV3Fixture>>;
}

function profileFact(
  bundle: DeepMutable<ReturnType<typeof createBasicCollectionAuditV3Fixture>>,
  category: string,
) {
  const fact = bundle.extractedFacts.facts.find(({ fieldPath }) =>
    fieldPath.startsWith(`marketOverview.basicProfile.categories.${category}.`)
  );
  if (fact === undefined) throw new Error(`fixture fact missing for ${category}`);
  return fact;
}

type DeepMutable<T> = T extends readonly (infer Item)[]
  ? DeepMutable<Item>[]
  : T extends object
    ? { -readonly [Key in keyof T]: DeepMutable<T[Key]> }
    : T;
