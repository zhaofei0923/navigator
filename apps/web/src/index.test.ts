import { describe, expect, test } from "vitest";

import { workspaceName } from "./index.js";

describe("@navigator/web", () => {
  test("exports its workspace marker", () => {
    expect(workspaceName).toBe("@navigator/web");
  });
});
