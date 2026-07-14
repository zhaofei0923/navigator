import { describe, expect, test } from "vitest";

import { analyzePrismaUsage } from "./basic-country-activation-preflight-readonly-analysis.js";
import { CLIENT_MUTATION_FIXTURES } from "./basic-country-activation-preflight-readonly-client-fixtures.js";
import { TRANSFER_MUTATION_FIXTURES } from "./basic-country-activation-preflight-readonly-transfer-fixtures.js";

describe("Basic activation Prisma mutation rejection", () => {
  test.each([...CLIENT_MUTATION_FIXTURES, ...TRANSFER_MUTATION_FIXTURES])(
    "rejects Prisma-rooted mutation fixture: %s",
    (_label, source) => {
      expect(analyzePrismaUsage(source).violations).not.toEqual([]);
    },
  );
});
