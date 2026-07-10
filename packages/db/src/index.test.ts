import { describe, expect, test } from "vitest";

import {
  buildBasicCountryImportPlan,
  createBasicCountryBundle,
  loadBasicCountryBundle,
  validateBasicCountryBundle,
  workspaceName,
} from "./index.js";

describe("@navigator/db", () => {
  test("exports its workspace marker", () => {
    expect(workspaceName).toBe("@navigator/db");
  });

  test("exports the Basic country seed API", () => {
    expect(createBasicCountryBundle).toBeTypeOf("function");
    expect(loadBasicCountryBundle).toBeTypeOf("function");
    expect(validateBasicCountryBundle).toBeTypeOf("function");
    expect(buildBasicCountryImportPlan).toBeTypeOf("function");
  });
});
