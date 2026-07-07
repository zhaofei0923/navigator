import { describe, expect, test } from "vitest";

import { workspaceName } from "./index.js";

describe("@navigator/ai-advisor", () => {
  test("exports its workspace marker", () => {
    expect(workspaceName).toBe("@navigator/ai-advisor");
  });
});
