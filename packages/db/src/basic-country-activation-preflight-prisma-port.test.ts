import { describe, expect, test } from "vitest";

import type { BasicActivationModel } from "./seed/basic-country-activation-preflight.js";
import { createPrismaBasicActivationCountPort } from "./seed/basic-country-activation-preflight-cli.js";

const MODELS = [
  "marketOverview",
  "policy",
  "risk",
  "opportunity",
  "project",
  "partner",
  "chineseCompany",
  "entryStrategy",
  "report",
  "knowledgeChunk",
] as const satisfies readonly BasicActivationModel[];

describe("Prisma Basic activation count port", () => {
  test("maps every model and scope to an exact count filter", async () => {
    const calls: Array<{ delegate: string; args: unknown }> = [];
    const delegate = (name: string) => ({
      async count(args: unknown) {
        calls.push({ delegate: name, args });
        return 0;
      },
    });
    const client = Object.fromEntries(
      MODELS.map((model) => [model, delegate(model)]),
    );
    const port = createPrismaBasicActivationCountPort(client as never);

    for (const model of MODELS) {
      await port.count(model, "all", "VN");
      await port.count(model, "published", "VN");
      await port.count(model, "ai-eligible", "VN");
    }

    expect(calls).toEqual(
      MODELS.flatMap((model) => [
        { delegate: model, args: { where: { countryCode: "VN" } } },
        {
          delegate: model,
          args: { where: { countryCode: "VN", reviewStatus: "published" } },
        },
        {
          delegate: model,
          args: {
            where: {
              countryCode: "VN",
              reviewStatus: "published",
              aiUsable: true,
              credibility: { not: "UNVERIFIED" },
            },
          },
        },
      ]),
    );
  });
});
