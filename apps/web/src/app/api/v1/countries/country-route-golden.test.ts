import { describe, expect, test } from "vitest";

import {
  COUNTRY_FALLBACK_GOLDEN,
  COUNTRY_ROUTE_FORBIDDEN_BODY_FRAGMENTS,
  COUNTRY_ROUTE_GOLDEN_FIXTURES,
  COUNTRY_SENSITIVE_GOLDEN_BODY,
  COUNTRY_SENSITIVE_RAW_GOLDEN_BODY,
  COUNTRY_SENSITIVE_GOLDEN_SNAPSHOT,
} from "@navigator/shared-types/test-support/country-route-golden";
import type {
  CountryRouteGoldenFixture,
} from "@navigator/shared-types/test-support/country-route-golden";
import type { CountryCatalogItem } from "@navigator/shared-types/country-api";
import { formatCountryModuleResponse } from "@navigator/shared-types/country-formatter";

import { localizeCountryCard } from "../../../../features/countries/country-service.js";
import { GET as getCountries } from "./route.js";
import { GET as getCountryDetail } from "./[code]/route.js";
import { GET as getCountryModule } from "./[code]/modules/[moduleKey]/route.js";

async function invokeGoldenFixture(
  fixture: CountryRouteGoldenFixture,
) {
  const request = new Request(
    `https://navigator.test${fixture.requestPath}`,
    fixture.headers === undefined ? {} : { headers: fixture.headers },
  );
  if (fixture.route === "list") {
    return getCountries(request);
  }
  if (fixture.route === "detail") {
    return getCountryDetail(request, {
      params: Promise.resolve({ code: fixture.params?.code ?? "" }),
    });
  }
  return getCountryModule(request, {
    params: Promise.resolve({
      code: fixture.params?.code ?? "",
      moduleKey: fixture.params?.moduleKey ?? "",
    }),
  });
}

describe("pre-migration country route golden matrix", () => {
  test("freezes every required migration boundary", () => {
    const ids = COUNTRY_ROUTE_GOLDEN_FIXTURES.map(({ id }) => id);
    const countries = ["ID", "VN", "SA", "AE", "BR", "ZA"] as const;
    const modules = [
      "market-overview", "policy", "risk", "opportunities", "projects",
      "partners", "chinese-companies", "entry-strategy", "ai-advisor", "reports",
    ] as const;
    const invalidQueryKeys = [
      "coverageLevel", "locale", "region", "industryTags", "techTags",
      "textMode", "page-0", "page-alpha", "pageSize-0", "pageSize-alpha",
    ] as const;

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("list-localized-en");
    expect(ids).toContain("list-raw-zh");
    expect(ids).toContain("detail-ZA-localized-en");
    expect(ids).toContain("detail-ID-raw-zh");
    expect(ids).toContain("module-market-overview-localized-en");
    expect(ids).toContain("module-reports-raw-zh");
    expect(ids).toContain("list-all-filters");
    expect(ids).toContain("list-industry-filter-storage");
    expect(ids).toContain("list-industry-all-match-empty");
    expect(ids).toContain("list-invalid-pageSize-alpha");
    expect(ids).toContain("detail-unknown-country");
    expect(ids).toContain("module-invalid-moduleKey");
    for (const country of countries) {
      for (const locale of ["en", "zh"] as const) {
        for (const textMode of ["localized", "raw"] as const) {
          expect(ids).toContain(`detail-${country}-${textMode}-${locale}`);
        }
      }
    }
    for (const moduleKey of modules) {
      for (const locale of ["en", "zh"] as const) {
        for (const textMode of ["localized", "raw"] as const) {
          expect(ids).toContain(`module-${moduleKey}-${textMode}-${locale}`);
        }
      }
    }
    for (const route of ["list", "detail", "module"] as const) {
      for (const invalidQuery of invalidQueryKeys) {
        expect(ids.some((id) => id.startsWith(`${route}-invalid-${invalidQuery}`))).toBe(true);
      }
    }
  });

  test.each(COUNTRY_ROUTE_GOLDEN_FIXTURES)(
    "$id keeps HTTP status and parsed body deeply equal",
    async (fixture) => {
      const response = await invokeGoldenFixture(fixture);
      const body = await response.json();

      expect(response.status).toBe(fixture.expectedStatus);
      expect(body).toEqual(fixture.expectedBody);

      if (response.ok) {
        const serialized = JSON.stringify(body);
        for (const forbidden of COUNTRY_ROUTE_FORBIDDEN_BODY_FRAGMENTS) {
          expect(serialized).not.toContain(forbidden);
        }
      }
    },
  );

  test("freezes the missing-translation fallback body and paths", () => {
    expect(
      localizeCountryCard(
        COUNTRY_FALLBACK_GOLDEN.input as unknown as CountryCatalogItem,
        COUNTRY_FALLBACK_GOLDEN.locale,
      ),
    ).toEqual(COUNTRY_FALLBACK_GOLDEN.expected);
  });

  test("freezes the fully redacted public module body", () => {
    expect(
      formatCountryModuleResponse(
        COUNTRY_SENSITIVE_GOLDEN_SNAPSHOT,
        "policy",
        { locale: "en" },
      ),
    ).toEqual(COUNTRY_SENSITIVE_GOLDEN_BODY);
  });

  test("freezes the fully redacted raw public module body", () => {
    expect(
      formatCountryModuleResponse(
        COUNTRY_SENSITIVE_GOLDEN_SNAPSHOT,
        "policy",
        { locale: "en" },
        "raw",
      ),
    ).toEqual(COUNTRY_SENSITIVE_RAW_GOLDEN_BODY);
  });
});
