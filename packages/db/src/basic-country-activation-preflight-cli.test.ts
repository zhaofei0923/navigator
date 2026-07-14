import { describe, expect, test } from "vitest";

import {
  preflightBasicCountryActivation,
  type BasicActivationCountPort,
} from "./seed/basic-country-activation-preflight.js";
import {
  classifyBasicCountryActivationPreflightArgs,
  createIdBasicActivationOperatorSummary,
  runBasicCountryActivationPreflightCli,
} from "./seed/basic-country-activation-preflight-cli.js";

describe("DATA-BASIC-ID preflight CLI", () => {
  test.each([
    { args: ["--", "ID"], expected: "run" },
    { args: ["--", "--help"], expected: "help" },
    { args: [], expected: "invalid" },
    { args: ["ID"], expected: "invalid" },
    { args: ["--help"], expected: "invalid" },
    { args: ["VN"], expected: "invalid" },
    { args: ["id"], expected: "invalid" },
    { args: ["ID", "extra"], expected: "invalid" },
  ])("classifies exact args $args as $expected", ({ args, expected }) => {
    expect(classifyBasicCountryActivationPreflightArgs(args)).toBe(expected);
  });

  test("maps only a generic ID legacy blocker to the cleanup task", async () => {
    const generic = await preflightBasicCountryActivation("ID", {
      async count(model, scope) {
        return model === "policy" && scope === "all" ? 1 : 0;
      },
    });
    const failed = await preflightBasicCountryActivation("ID", {
      async count() {
        throw new Error("sensitive failure");
      },
    });

    expect(createIdBasicActivationOperatorSummary(generic)).toEqual({
      ...generic,
      nextTask: "OPS-DATA-ID-BASIC-CLEANUP",
    });
    expect(createIdBasicActivationOperatorSummary(failed)).toEqual(failed);
  });

  test.each([
    { args: ["--", "--help"], exitCode: 0, stream: "stdout" },
    { args: ["--", "VN"], exitCode: 2, stream: "stderr" },
  ] as const)(
    "handles $args before client construction",
    async ({ args, exitCode, stream }) => {
      const fixture = cliFixture({ constructorError: new Error("must not construct") });

      await expect(
        runBasicCountryActivationPreflightCli(args, fixture.dependencies),
      ).resolves.toBe(exitCode);

      expect(fixture.counts()).toEqual({
        constructorCalls: 0,
        disconnectCalls: 0,
        preflightCalls: 0,
      });
      expect(fixture.stdout).toHaveLength(stream === "stdout" ? 1 : 0);
      expect(fixture.stderr).toHaveLength(stream === "stderr" ? 1 : 0);
    },
  );

  test.each([
    {
      label: "constructor",
      options: { constructorError: new Error("secret constructor") },
      disconnectCalls: 0,
      stream: "stderr",
      error: "PREFLIGHT_LIFECYCLE_FAILED",
    },
    {
      label: "query",
      options: { countError: new Error("secret query") },
      disconnectCalls: 1,
      stream: "stdout",
      error: "COUNT_QUERY_FAILED",
    },
    {
      label: "disconnect",
      options: { disconnectError: new Error("secret disconnect") },
      disconnectCalls: 1,
      stream: "stderr",
      error: "PREFLIGHT_LIFECYCLE_FAILED",
    },
  ] as const)(
    "emits one redacted summary for $label failure",
    async ({ options, disconnectCalls, stream, error }) => {
      const fixture = cliFixture(options);

      await expect(
        runBasicCountryActivationPreflightCli(["--", "ID"], fixture.dependencies),
      ).resolves.toBe(1);

      expect(fixture.counts().disconnectCalls).toBe(disconnectCalls);
      expect(fixture.stdout.length + fixture.stderr.length).toBe(1);
      const output = [...fixture.stdout, ...fixture.stderr][0]!;
      expect(fixture.stdout).toHaveLength(stream === "stdout" ? 1 : 0);
      expect(JSON.parse(output)).toMatchObject({ errors: [error], counts: null });
      expect(output).not.toMatch(/secret|constructor|disconnect/i);
    },
  );

  test("redacts an unexpected preflight rejection after disconnect", async () => {
    const fixture = cliFixture({ preflightError: new Error("secret preflight") });

    await expect(
      runBasicCountryActivationPreflightCli(["--", "ID"], fixture.dependencies),
    ).resolves.toBe(1);

    expect(fixture.counts()).toEqual({
      constructorCalls: 1,
      disconnectCalls: 1,
      preflightCalls: 1,
    });
    expect(JSON.parse(fixture.stderr[0]!)).toMatchObject({
      errors: ["PREFLIGHT_LIFECYCLE_FAILED"],
      counts: null,
    });
    expect(fixture.stderr[0]).not.toContain("secret");
  });

  test.each([
    { count: 0, exitCode: 0, blockerCode: null },
    { count: 1, exitCode: 1, blockerCode: "LEGACY_COUNTRY_DATA_PRESENT" },
  ])("disconnects before emitting $blockerCode", async (expected) => {
    const fixture = cliFixture({ count: expected.count });

    await expect(
      runBasicCountryActivationPreflightCli(["--", "ID"], fixture.dependencies),
    ).resolves.toBe(expected.exitCode);

    expect(fixture.counts()).toEqual({
      constructorCalls: 1,
      disconnectCalls: 1,
      preflightCalls: 1,
    });
    expect(JSON.parse(fixture.stdout[0]!)).toMatchObject({
      blockerCode: expected.blockerCode,
    });
  });
});

function cliFixture(options: {
  constructorError?: unknown;
  countError?: unknown;
  disconnectError?: unknown;
  preflightError?: unknown;
  count?: number;
} = {}) {
  let constructorCalls = 0;
  let disconnectCalls = 0;
  let preflightCalls = 0;
  const stdout: string[] = [];
  const stderr: string[] = [];
  const delegate = {
    async count() {
      if (options.countError !== undefined) throw options.countError;
      return options.count ?? 0;
    },
  };
  const client = {
    marketOverview: delegate,
    policy: delegate,
    risk: delegate,
    opportunity: delegate,
    project: delegate,
    partner: delegate,
    chineseCompany: delegate,
    entryStrategy: delegate,
    report: delegate,
    knowledgeChunk: delegate,
    async $disconnect() {
      disconnectCalls += 1;
      if (options.disconnectError !== undefined) throw options.disconnectError;
    },
  };
  return {
    dependencies: {
      createClient() {
        constructorCalls += 1;
        if (options.constructorError !== undefined) throw options.constructorError;
        return client as never;
      },
      async preflight(countryCode: string, port: BasicActivationCountPort) {
        preflightCalls += 1;
        if (options.preflightError !== undefined) throw options.preflightError;
        return preflightBasicCountryActivation(countryCode, port);
      },
      writeStdout(output: string) { stdout.push(output); },
      writeStderr(output: string) { stderr.push(output); },
    },
    counts: () => ({ constructorCalls, disconnectCalls, preflightCalls }),
    stdout,
    stderr,
  };
}
