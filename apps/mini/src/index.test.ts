import { describe, expect, test } from "vitest";

import { workspaceName } from "./index.js";

describe("@navigator/mini", () => {
  test("exports its workspace marker", () => {
    expect(workspaceName).toBe("@navigator/mini");
  });
});
