import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

const injectedFailure = vi.hoisted(() => ({ call: 0, failOn: null as number | null }));
const injectedCloseFailure = vi.hoisted(() => ({ enabled: false }));

vi.mock("./cli/basic-candidate-workspace.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./cli/basic-candidate-workspace.js")>();
  return {
    ...actual,
    async closeBasicCandidateWorkspace(
      ...args: Parameters<typeof actual.closeBasicCandidateWorkspace>
    ): ReturnType<typeof actual.closeBasicCandidateWorkspace> {
      await actual.closeBasicCandidateWorkspace(...args);
      if (injectedCloseFailure.enabled) {
        throw new Error("injected post-commit close failure");
      }
    },
  };
});

vi.mock("./cli/basic-publication-owned-file.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./cli/basic-publication-owned-file.js")>();
  return {
    ...actual,
    async writeBasicPublicationOwnedFile(
      ...args: Parameters<typeof actual.writeBasicPublicationOwnedFile>
    ): ReturnType<typeof actual.writeBasicPublicationOwnedFile> {
      injectedFailure.call += 1;
      if (injectedFailure.call === injectedFailure.failOn) {
        return actual.writeBasicPublicationOwnedFile(
          args[0], args[1], args[2], args[3],
          async () => { throw new Error("injected post-create publication failure"); },
        );
      }
      return actual.writeBasicPublicationOwnedFile(...args);
    },
  };
});

import { createBasicCountryPublicationV3Fixture } from "./basic-publication-v3-test-fixture.js";
import {
  parseBasicPublicationArguments,
  publishBasicCountry,
  runBasicPublicationCli,
} from "./cli/publish-basic-country.js";
import { writeApprovedBasicPublication } from "./cli/basic-publication-writer.js";

const roots = new Set<string>();

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.clear();
  injectedFailure.call = 0;
  injectedFailure.failOn = null;
  injectedCloseFailure.enabled = false;
});

describe("approved BASIC publication CLI", () => {
  test("prints exact single-country help without writing", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    expect(await runBasicPublicationCli(["--help"], {
      writeStdout(value) { stdout.push(value); },
      writeStderr(value) { stderr.push(value); },
    })).toBe(0);
    expect(stdout.join("")).toContain(
      "pnpm basic:publish --country=ID --run-id=<runId> --approval-file=<path>",
    );
    expect(stderr).toEqual([]);
  });

  test("accepts exactly one ISO2, run and canonical repo-relative receipt path", () => {
    expect(parseBasicPublicationArguments([
      "--country=XZ",
      "--run-id=run-001",
      "--approval-file=data/approvals/example-land/run-001.json",
    ])).toEqual({
      countryCode: "XZ",
      runId: "run-001",
      countryDirectory: "example-land",
      approvalFile: "data/approvals/example-land/run-001.json",
    });
    for (const approvalFile of [
      "/tmp/run-001.json",
      "data/approvals/example-land/../example-land/run-001.json",
      "data/approvals/alias/run-001.json/",
    ]) {
      expect(() => parseBasicPublicationArguments([
        "--country=XZ", "--run-id=run-001", `--approval-file=${approvalFile}`,
      ])).toThrow("basic publication input is invalid");
    }
    expect(() => parseBasicPublicationArguments([
      "--country=XZ,YY",
      "--run-id=run-001",
      "--approval-file=data/approvals/example-land/run-001.json",
    ])).toThrow("basic publication input is invalid");
  });

  test("publishes one synthetic v3 candidate as exactly three canonical files", async () => {
    const setup = createSyntheticRepo();
    const receiptPath = join(setup.root, setup.input.approvalFile);
    const receiptBefore = readFileSync(receiptPath);
    const candidateDirectory = join(
      setup.root, "data", "staging", "example-land", "run-001",
    );
    const candidateBefore = Object.fromEntries(readdirSync(candidateDirectory).map((name) => [
      name,
      readFileSync(join(candidateDirectory, name)),
    ]));

    const result = await publishBasicCountry(setup.input);

    expect(result).toEqual({
      status: "published",
      countryCode: "XZ",
      runId: "run-001",
      relativeDirectory: "data/example-land",
    });
    const target = join(setup.root, "data", "example-land");
    expect(readdirSync(target).sort()).toEqual([
      "collection-manifest.json", "country.json", "market-overview.json",
    ]);
    expect(JSON.parse(readFileSync(join(target, "collection-manifest.json"), "utf8")))
      .toEqual(setup.fixture.manifest);
    expect(JSON.parse(readFileSync(join(target, "market-overview.json"), "utf8")))
      .toEqual(setup.fixture.canonical.marketOverview);
    expect(existsSync(join(setup.root, "data", "approvals", "example-land", "run-001.json")))
      .toBe(true);
    expect(readFileSync(receiptPath)).toEqual(receiptBefore);
    expect(Object.fromEntries(readdirSync(candidateDirectory).map((name) => [
      name,
      readFileSync(join(candidateDirectory, name)),
    ]))).toEqual(candidateBefore);
  });

  test("refuses pre-existing canonical and never replaces it", async () => {
    const setup = createSyntheticRepo();
    const target = join(setup.root, "data", "example-land");
    mkdirSync(target, { mode: 0o700 });
    writeFileSync(join(target, "owned.txt"), "keep");

    await expect(publishBasicCountry(setup.input)).rejects.toThrow(
      /^basic publication failed$/,
    );
    expect(readFileSync(join(target, "owned.txt"), "utf8")).toBe("keep");
    expect(readdirSync(join(setup.root, "data")).some((name) =>
      name.startsWith(".publication-")
    )).toBe(false);
  });

  test("cannot create an approval decision when the exact receipt is absent", async () => {
    const setup = createSyntheticRepo();
    rmSync(join(setup.root, setup.input.approvalFile));
    const approvals = join(setup.root, "data", "approvals", "example-land");

    await expect(publishBasicCountry(setup.input)).rejects.toThrow(
      /^basic publication failed$/,
    );
    expect(readdirSync(approvals)).toEqual([]);
    expect(existsSync(join(setup.root, "data", "example-land"))).toBe(false);
  });

  test.each([1, 2, 3])(
    "removes its private partial output after post-create failure for file %i",
    async (failOn) => {
    const setup = createSyntheticRepo();
    injectedFailure.failOn = failOn;

    await expect(publishBasicCountry(setup.input)).rejects.toThrow(
      /^basic publication failed$/,
    );
    expect(readdirSync(join(setup.root, "data")).sort()).toEqual([
      "approvals", "staging",
    ]);
    },
  );

  test("fails with a fixed redacted message for receipt identity and hash drift", async () => {
    const setup = createSyntheticRepo();
    const receiptPath = join(setup.root, setup.input.approvalFile);
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8")) as Record<string, unknown>;
    (receipt.artifactSha256 as Record<string, unknown>)["source-register.json"] =
      "f".repeat(64);
    writeFileSync(receiptPath, `${JSON.stringify(receipt)}\n`);

    await expect(publishBasicCountry(setup.input)).rejects.toThrow(
      /^basic publication failed$/,
    );
  });

  test("rejects receipt symlinks and candidate directories with a fifth file", async () => {
    const symlinkSetup = createSyntheticRepo();
    const receiptPath = join(symlinkSetup.root, symlinkSetup.input.approvalFile);
    const moved = join(symlinkSetup.root, "receipt-copy.json");
    writeFileSync(moved, readFileSync(receiptPath));
    rmSync(receiptPath);
    symlinkSync(moved, receiptPath);
    await expect(publishBasicCountry(symlinkSetup.input)).rejects.toThrow(
      /^basic publication failed$/,
    );

    const extraSetup = createSyntheticRepo();
    writeFileSync(join(
      extraSetup.root,
      "data", "staging", "example-land", "run-001", "approval.json",
    ), "{}\n");
    await expect(publishBasicCountry(extraSetup.input)).rejects.toThrow(
      /^basic publication failed$/,
    );
  });

  test("keeps the durable success result after a post-commit close failure", async () => {
    const setup = createSyntheticRepo();
    injectedCloseFailure.enabled = true;

    await expect(publishBasicCountry(setup.input)).resolves.toMatchObject({
      status: "published",
      countryCode: "XZ",
      runId: "run-001",
    });
    expect(readdirSync(join(setup.root, "data", "example-land")).sort()).toEqual([
      "collection-manifest.json", "country.json", "market-overview.json",
    ]);
  });

  test("refuses a structurally forged writer authorization", async () => {
    await expect(writeApprovedBasicPublication({
      countryDirectory: "example-land",
      serialized: {},
      verify: async () => undefined,
    } as never)).rejects.toThrow(/^basic publication write failed$/);
  });
});

function createSyntheticRepo() {
  const root = mkdtempSync(join(process.platform === "linux" ? "/tmp" : tmpdir(), "basic-publish-v3-"));
  roots.add(root);
  writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "navigator" }));
  mkdirSync(join(root, "packages", "db"), { recursive: true });
  writeFileSync(join(root, "packages", "db", "package.json"), JSON.stringify({ name: "@navigator/db" }));

  const fixture = createBasicCountryPublicationV3Fixture();
  const data = join(root, "data");
  const candidate = join(data, "staging", "example-land", "run-001");
  const approvals = join(data, "approvals", "example-land");
  mkdirSync(candidate, { recursive: true, mode: 0o700 });
  mkdirSync(approvals, { recursive: true, mode: 0o700 });
  chmodSync(data, 0o755);
  chmodSync(join(data, "staging"), 0o700);
  chmodSync(join(data, "staging", "example-land"), 0o700);
  chmodSync(candidate, 0o700);
  chmodSync(join(data, "approvals"), 0o700);
  chmodSync(approvals, 0o700);
  for (const [name, bytes] of Object.entries(fixture.candidateArtifactBytes)) {
    writeFileSync(join(candidate, name), bytes, { mode: 0o600 });
  }
  writeFileSync(
    join(approvals, "run-001.json"),
    fixture.approvalReceiptBytes,
    { mode: 0o600 },
  );
  return {
    root,
    fixture,
    input: {
      repoRoot: root,
      countryCode: "XZ",
      runId: "run-001",
      countryDirectory: "example-land",
      approvalFile: "data/approvals/example-land/run-001.json",
    },
  };
}
