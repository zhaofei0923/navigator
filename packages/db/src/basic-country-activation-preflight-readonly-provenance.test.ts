import { describe, expect, test } from "vitest";

import { analyzePrismaUsage } from "./basic-country-activation-preflight-readonly-analysis.js";

describe("Basic activation Prisma provenance analysis", () => {
  test("rejects every client and delegate provenance alias", () => {
    const analysis = analyzePrismaUsage(`
      const client = new PrismaClient();
      const alias = client;
      let assigned;
      assigned = alias;
      const policyDelegate = assigned.policy;
      const bracketDelegate = alias["risk"];
      const { project: projectDelegate, partner } = assigned;
      policyDelegate.count();
      bracketDelegate["count"]();
      projectDelegate.count();
      partner.count();
      assigned.$disconnect();
      JSON.stringify({ ok: true });
      process.stdout.write("ok");
    `);

    expect(analysis.violations).not.toEqual([]);
    expect(analysis.unrelatedCalls).toEqual(
      expect.arrayContaining(["JSON.stringify", "process.stdout.write"]),
    );
  });

  test("distinguishes shadowed bindings from Prisma aliases", () => {
    const analysis = analyzePrismaUsage(`
      {
        const alias = new PrismaClient();
        alias.policy.count();
        alias.$disconnect();
      }
      {
        const alias = { findMany() {} };
        alias.findMany();
      }
    `);

    expect(analysis.violations).toEqual([]);
    expect(analysis.rootedCalls.filter((call) => call.endsWith(".count"))).toHaveLength(1);
    expect(analysis.unrelatedCalls).toContain("alias.findMany");
  });

  test("recognizes explicit and inferred factory-created Prisma roots", () => {
    const analysis = analyzePrismaUsage(`
      const explicitFactory = (): PrismaClient => new PrismaClient();
      const inferredFactory = () => new PrismaClient();
      const explicitClient = explicitFactory();
      const inferredClient = inferredFactory();
      explicitClient.policy.count();
      inferredClient.risk.count();
      explicitClient.$disconnect();
      inferredClient.$disconnect();
    `);

    expect(analysis.violations).toEqual([]);
    expect(analysis.rootedCalls.filter((call) => call.endsWith(".count"))).toHaveLength(2);
    expect(
      analysis.rootedCalls.filter((call) => call.endsWith(".$disconnect")),
    ).toHaveLength(2);
  });

  test("allows only the exact typed adapter handoff for a client root", () => {
    const analysis = analyzePrismaUsage(`
      export function createPrismaBasicActivationCountPort(client: PrismaClient) {
        client.policy.count();
      }
      const client = new PrismaClient();
      createPrismaBasicActivationCountPort(client);
      client.$disconnect();
    `);

    expect(analysis.violations).toEqual([]);
    expect(analysis.rootedCalls.filter((call) => call.endsWith(".count"))).toHaveLength(1);
    expect(
      analysis.rootedCalls.filter((call) => call.endsWith(".$disconnect")),
    ).toHaveLength(1);
  });

  test("terminates and rejects a self-cycle", () => {
    const analysis = analyzePrismaUsage(`
      let db: PrismaClient;
      db = db.policy;
    `);

    expect(analysis.violations).not.toEqual([]);
  }, 500);

  test("terminates and rejects a multi-symbol cycle", () => {
    const analysis = analyzePrismaUsage(`
      let first: PrismaClient;
      let second: PrismaClient;
      first = second;
      second = first;
    `);

    expect(analysis.violations).not.toEqual([]);
  }, 500);
});
