import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

const WEB_SRC = fileURLToPath(new URL("./", import.meta.url));

function productionSources(directory = WEB_SRC): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return productionSources(path);
    }
    if (
      ![".ts", ".tsx"].includes(extname(entry.name)) ||
      entry.name.endsWith(".test.ts") ||
      entry.name.endsWith(".test.tsx") ||
      entry.name.endsWith(".spec.ts") ||
      entry.name.endsWith(".spec.tsx") ||
      entry.name.endsWith(".test-fixture.ts") ||
      entry.name.endsWith(".test-fixture.tsx")
    ) {
      return [];
    }
    return [path];
  });
}

function relativeSource(path: string): string {
  return path.slice(WEB_SRC.length).replaceAll("\\", "/");
}

describe("Web country production source boundary", () => {
  test("has no production import path back to canonical files or local response builders", () => {
    const violations = productionSources().flatMap((path) => {
      const source = readFileSync(path, "utf8");
      const forbiddenImports = [
        /from\s+["'][^"']*data\/[^"']+\.json["']/u,
        /from\s+["'][^"']*approved-publication[^"']*["']/u,
        /from\s+["'][^"']*country-seed-registry[^"']*["']/u,
        /from\s+["'][^"']*country-service[^"']*["']/u,
      ];
      return forbiddenImports.some((pattern) => pattern.test(source))
        ? [relativeSource(path)]
        : [];
    });

    expect(violations).toEqual([]);
  });

  test("keeps country pages dynamic and components props-only", () => {
    const listPage = readFileSync(
      join(WEB_SRC, "app/[locale]/countries/page.tsx"),
      "utf8",
    );
    const detailPage = readFileSync(
      join(WEB_SRC, "app/[locale]/countries/[code]/page.tsx"),
      "utf8",
    );
    const explorer = readFileSync(
      join(WEB_SRC, "features/countries/country-explorer.tsx"),
      "utf8",
    );
    const detail = readFileSync(
      join(WEB_SRC, "features/countries/country-detail.tsx"),
      "utf8",
    );

    expect(listPage).toContain('export const dynamic = "force-dynamic"');
    expect(detailPage).toContain('export const dynamic = "force-dynamic"');
    expect(listPage).toContain("fetchCountries");
    expect(detailPage).toContain("fetchCountryDetail");
    expect(detailPage).toContain("fetchCountryModule");
    expect(explorer).not.toMatch(/buildCountriesResponse|getFilterOptions/u);
    expect(detail).not.toMatch(/buildCountryModuleResponse/u);
  });
});
