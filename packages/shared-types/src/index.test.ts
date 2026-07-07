import { describe, expect, test } from "vitest";

import { workspaceName } from "./index.js";

describe("@navigator/shared-types", () => {
  test("exports its workspace marker", () => {
    expect(workspaceName).toBe("@navigator/shared-types");
  });
});
