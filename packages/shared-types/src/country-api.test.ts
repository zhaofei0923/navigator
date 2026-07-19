import { describe, expect, expectTypeOf, test } from "vitest";

import * as countryRuntime from "@navigator/shared-types/country-runtime";

import type {
  CountryDataSnapshot,
  CountryReadRepository,
  JsonObject,
  JsonValue,
} from "./country-api.js";

const COUNTRY = {
  code: "ID",
  moduleCoverage: [],
  name: { en: "Indonesia", zh: "印度尼西亚" },
} as const satisfies JsonObject;

const SNAPSHOT = {
  chineseCompanies: [],
  country: COUNTRY,
  entryStrategy: null,
  knowledge: [],
  marketOverview: null,
  opportunities: [],
  partners: [],
  policy: [],
  projects: [],
  reports: [],
  risk: [],
} as const satisfies CountryDataSnapshot;

describe("country API storage contract", () => {
  test("models recursive JSON without mutable or non-JSON values", () => {
    const nested = {
      list: [true, null, { count: 1, label: "value" }],
    } as const satisfies JsonObject;

    expect(nested).toEqual({
      list: [true, null, { count: 1, label: "value" }],
    });
    expectTypeOf(nested).toMatchTypeOf<JsonObject>();
    expectTypeOf<JsonObject[string]>().toEqualTypeOf<JsonValue>();
  });

  test("exposes an async storage-neutral repository port", async () => {
    const repository: CountryReadRepository = {
      async findByCode(code) {
        return code === "ID" ? SNAPSHOT : null;
      },
      async list() {
        return [SNAPSHOT];
      },
    };

    await expect(repository.list()).resolves.toEqual([SNAPSHOT]);
    await expect(repository.findByCode("ID")).resolves.toBe(SNAPSHOT);
    await expect(repository.findByCode("ZZ")).resolves.toBeNull();
  });

  test("keeps the dedicated server runtime export intentionally narrow", () => {
    expect(Object.keys(countryRuntime).sort()).toEqual(
      expect.arrayContaining([
        "RISK_CATEGORIES",
        "formatCountriesResponse",
        "formatCountryDetailResponse",
        "formatCountryModuleResponse",
        "parseApiCountryQuery",
        "parseCountryCodeParam",
      ]),
    );
    expect(countryRuntime).toHaveProperty("RISK_CATEGORIES", [
      "political",
      "economic",
      "legal",
      "exchange-rate",
      "operational",
      "social",
      "environmental",
    ]);
    expect(countryRuntime).not.toHaveProperty("validateEnv");
    expect(countryRuntime).not.toHaveProperty("getCountryCoverageLevel");
  });
});

function compileOnlyReadonlyAssertions(snapshot: CountryDataSnapshot): void {
  // @ts-expect-error Country arrays are recursively readonly at the repository boundary.
  snapshot.policy.push({ id: "forbidden" });
  // @ts-expect-error JSON objects cannot be mutated through the storage-neutral contract.
  snapshot.country.code = "ZZ";
  // @ts-expect-error Date is not a JSON value.
  const invalid: JsonValue = new Date();
  void invalid;
}

void compileOnlyReadonlyAssertions;
