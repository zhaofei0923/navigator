import { readFile } from "node:fs/promises";

import { describe, expect, test, vi } from "vitest";

import {
  runCandidateBasicCountryCli,
  type BasicCandidateCliDependencies,
} from "./cli/candidate-basic-country.js";

const CONFIG_PATH = ".cache/basic-country/ID/run-1/candidate-config.json";
const SECRET = "https://outside.invalid/?token=SECRET&cookie=SESSION raw content";

describe("candidate:basic-country CLI", () => {
  test.each([
    [[]],
    [[CONFIG_PATH, "extra.json"]],
    [["--help"]],
    [[""]],
  ])("accepts exactly one positional config path: %j", async (args) => {
    const fixture = cliFixture();

    const exitCode = await runCandidateBasicCountryCli(args, fixture.dependencies);

    expect(exitCode).toBe(1);
    expect(fixture.stderr).toEqual(["basic candidate error\n"]);
    expect(fixture.stdout).toEqual([]);
    expect(fixture.compose).not.toHaveBeenCalled();
    expect(fixture.write).not.toHaveBeenCalled();
  });

  test("writes a ready candidate and emits one fixed success line", async () => {
    const fixture = cliFixture("ready");

    const exitCode = await runCandidateBasicCountryCli(
      [CONFIG_PATH],
      fixture.dependencies,
    );

    expect(exitCode).toBe(0);
    expect(fixture.compose).toHaveBeenCalledWith({
      workspace: fixture.workspace,
      configPath: CONFIG_PATH,
      transport: fixture.transport,
    });
    expect(fixture.write).toHaveBeenCalledWith({
      workspace: fixture.workspace,
      candidate: fixture.candidate,
    });
    expect(fixture.stdout).toEqual(["basic candidate written\n"]);
    expect(fixture.stderr).toEqual([]);
  });

  test("opens one workspace capability and closes it once in finally", async () => {
    const fixture = cliFixture("ready");
    const workspace = Object.freeze({});
    const closeWorkspace = vi.fn(async () => undefined);
    const dependencies = {
      ...fixture.dependencies,
      resolveRepoRoot: undefined,
      openWorkspace: vi.fn(async () => workspace),
      closeWorkspace,
    } as unknown as BasicCandidateCliDependencies;

    const exitCode = await runCandidateBasicCountryCli([CONFIG_PATH], dependencies);

    expect(exitCode).toBe(0);
    expect(fixture.compose).toHaveBeenCalledWith({
      workspace,
      configPath: CONFIG_PATH,
      transport: fixture.transport,
    });
    expect(fixture.write).toHaveBeenCalledWith({
      workspace,
      candidate: fixture.candidate,
    });
    expect(closeWorkspace).toHaveBeenCalledTimes(1);
  });

  test("treats one pnpm separator as syntax rather than a positional argument", async () => {
    const fixture = cliFixture("ready");

    const exitCode = await runCandidateBasicCountryCli(
      ["--", CONFIG_PATH],
      fixture.dependencies,
    );

    expect(exitCode).toBe(0);
    expect(fixture.compose).toHaveBeenCalledWith({
      workspace: fixture.workspace,
      configPath: CONFIG_PATH,
      transport: fixture.transport,
    });
    expect(fixture.stdout).toEqual(["basic candidate written\n"]);
  });

  test("does not write a blocked result and returns a distinct nonzero code", async () => {
    const fixture = cliFixture("blocked");

    const exitCode = await runCandidateBasicCountryCli(
      [CONFIG_PATH],
      fixture.dependencies,
    );

    expect(exitCode).toBe(2);
    expect(fixture.write).not.toHaveBeenCalled();
    expect(fixture.stdout).toEqual([]);
    expect(fixture.stderr).toEqual(["basic candidate blocked\n"]);
  });

  test("does not write a composition error", async () => {
    const fixture = cliFixture("error");

    const exitCode = await runCandidateBasicCountryCli(
      [CONFIG_PATH],
      fixture.dependencies,
    );

    expect(exitCode).toBe(1);
    expect(fixture.write).not.toHaveBeenCalled();
    expect(fixture.stderr).toEqual(["basic candidate error\n"]);
  });

  test.each(["openWorkspace", "closeWorkspace", "createTransport", "compose", "write"] as const)(
    "redacts a failing %s dependency",
    async (dependency) => {
      const fixture = cliFixture("ready");
      fixture.dependencies[dependency] = vi.fn(() => {
        throw new Error(SECRET);
      }) as never;

      const exitCode = await runCandidateBasicCountryCli(
        [CONFIG_PATH],
        fixture.dependencies,
      );

      expect(exitCode).toBe(1);
      expect([...fixture.stdout, ...fixture.stderr].join(""))
        .toBe("basic candidate error\n");
      expect([...fixture.stdout, ...fixture.stderr].join(""))
        .not.toMatch(/outside\.invalid|SECRET|SESSION|raw content|token|cookie/i);
    },
  );

  test("declares the exact package-private and root scripts", async () => {
    const packageJson = JSON.parse(await readFile(
      new URL("../package.json", import.meta.url),
      "utf8",
    )) as { scripts: Record<string, string> };
    const rootPackageJson = JSON.parse(await readFile(
      new URL("../../../package.json", import.meta.url),
      "utf8",
    )) as { scripts: Record<string, string> };

    expect(packageJson.scripts["candidate:basic-country"])
      .toBe("node src/cli/candidate-basic-country.ts");
    expect(rootPackageJson.scripts["candidate:basic-country"])
      .toBe("pnpm --filter @navigator/db candidate:basic-country");
  });
});

function cliFixture(status: "ready" | "blocked" | "error" = "error") {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const transport = Object.freeze({ execute: vi.fn() });
  const workspace = Object.freeze({});
  const candidate = Object.freeze({ artifacts: Object.freeze({}) });
  const composition = Object.freeze({
    status,
    candidate: status === "error" ? null : candidate,
  });
  const compose = vi.fn(async () => composition);
  const write = vi.fn(async () => Object.freeze({ status: "written" as const }));
  const dependencies: BasicCandidateCliDependencies = {
    async openWorkspace() { return workspace; },
    async closeWorkspace() { return undefined; },
    createTransport() { return transport as never; },
    compose: compose as never,
    write: write as never,
    writeStdout(value) { stdout.push(value); },
    writeStderr(value) { stderr.push(value); },
  };
  return {
    dependencies,
    stdout,
    stderr,
    transport,
    workspace,
    candidate,
    compose,
    write,
  };
}
