import {
  chmodSync,
  existsSync,
  linkSync,
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
const injectedPostCommitFailure = vi.hoisted(() => ({
  committed: false,
  mode: null as "native-unverified" | "sync" | "verify" | "snapshot-close" | null,
}));

vi.mock("./cli/basic-candidate-native-fs.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./cli/basic-candidate-native-fs.js")>();
  return {
    ...actual,
    renameBasicCandidateDirectoryChildNoReplaceNative(
      ...args: Parameters<typeof actual.renameBasicCandidateDirectoryChildNoReplaceNative>
    ): ReturnType<typeof actual.renameBasicCandidateDirectoryChildNoReplaceNative> {
      const result = actual.renameBasicCandidateDirectoryChildNoReplaceNative(...args);
      injectedPostCommitFailure.committed = true;
      if (injectedPostCommitFailure.mode === "native-unverified") {
        return { committed: true, verified: false } as ReturnType<
          typeof actual.renameBasicCandidateDirectoryChildNoReplaceNative
        >;
      }
      return result;
    },
  };
});

vi.mock("./cli/basic-candidate-constrained-fs.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./cli/basic-candidate-constrained-fs.js")>();
  return {
    ...actual,
    async syncBasicCandidateParentDirectory(
      ...args: Parameters<typeof actual.syncBasicCandidateParentDirectory>
    ): ReturnType<typeof actual.syncBasicCandidateParentDirectory> {
      if (
        injectedPostCommitFailure.committed &&
        injectedPostCommitFailure.mode === "sync"
      ) throw new Error("injected post-commit sync failure");
      return actual.syncBasicCandidateParentDirectory(...args);
    },
    async verifyBasicCandidateRegularFile(
      ...args: Parameters<typeof actual.verifyBasicCandidateRegularFile>
    ): ReturnType<typeof actual.verifyBasicCandidateRegularFile> {
      if (
        injectedPostCommitFailure.committed &&
        injectedPostCommitFailure.mode === "verify"
      ) throw new Error("injected post-commit verify failure");
      return actual.verifyBasicCandidateRegularFile(...args);
    },
    async closeBasicCandidateHeldDirectories(
      ...args: Parameters<typeof actual.closeBasicCandidateHeldDirectories>
    ): ReturnType<typeof actual.closeBasicCandidateHeldDirectories> {
      await actual.closeBasicCandidateHeldDirectories(...args);
      if (
        injectedPostCommitFailure.committed &&
        injectedPostCommitFailure.mode === "snapshot-close" &&
        args[0].length === 6
      ) throw new Error("injected snapshot close failure");
    },
  };
});

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
import {
  closeBasicCandidateWorkspace,
  getBasicCandidateWorkspaceRootDirectory,
  openBasicCandidateWorkspace,
} from "./cli/basic-candidate-workspace.js";
import { locateApprovedBasicPublicationSnapshot } from "./cli/basic-publication-snapshot.js";

const roots = new Set<string>();

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.clear();
  injectedFailure.call = 0;
  injectedFailure.failOn = null;
  injectedCloseFailure.enabled = false;
  injectedPostCommitFailure.committed = false;
  injectedPostCommitFailure.mode = null;
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
      postCommitVerified: true,
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

  test("returns the explicit writer commit state", async () => {
    const setup = createSyntheticRepo();
    const workspace = await openBasicCandidateWorkspace(setup.root);
    const snapshot = await locateApprovedBasicPublicationSnapshot(
      getBasicCandidateWorkspaceRootDirectory(workspace),
      setup.input,
    );
    try {
      await expect(writeApprovedBasicPublication(snapshot)).resolves.toEqual({
        committed: true,
        postCommitVerified: true,
      });
    } finally {
      await snapshot.close();
      await closeBasicCandidateWorkspace(workspace);
    }
    expectCanonicalExactThree(setup.root);
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
      postCommitVerified: false,
    });
    expect(readdirSync(join(setup.root, "data", "example-land")).sort()).toEqual([
      "collection-manifest.json", "country.json", "market-overview.json",
    ]);
  });

  test("reports a snapshot close warning after durable publication", async () => {
    const setup = createSyntheticRepo();
    injectedPostCommitFailure.mode = "snapshot-close";

    await expect(publishBasicCountry(setup.input)).resolves.toMatchObject({
      status: "published",
      postCommitVerified: false,
    });
    expectCanonicalExactThree(setup.root);
  });

  test.each(["native-unverified", "sync", "verify"] as const)(
    "reports post-commit %s failure without making retry semantics ambiguous",
    async (mode) => {
      const setup = createSyntheticRepo();
      injectedPostCommitFailure.mode = mode;

      await expect(publishBasicCountry(setup.input)).resolves.toMatchObject({
        status: "published",
        postCommitVerified: false,
      });
      expectCanonicalExactThree(setup.root);
      await expect(publishBasicCountry(setup.input)).rejects.toThrow(
        /^basic publication failed$/,
      );
      expectCanonicalExactThree(setup.root);
    },
  );

  test.each(["receipt", "candidate"] as const)(
    "rejects a %s file with a second hard link",
    async (kind) => {
      const setup = createSyntheticRepo();
      const source = kind === "receipt"
        ? join(setup.root, setup.input.approvalFile)
        : join(setup.root, "data", "staging", "example-land", "run-001", "source-register.json");
      linkSync(source, join(setup.root, `${kind}-hardlink.json`));

      await expect(publishBasicCountry(setup.input)).rejects.toThrow(
        /^basic publication failed$/,
      );
      expect(existsSync(join(setup.root, "data", "example-land"))).toBe(false);
    },
  );

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

function expectCanonicalExactThree(root: string): void {
  expect(readdirSync(join(root, "data", "example-land")).sort()).toEqual([
    "collection-manifest.json", "country.json", "market-overview.json",
  ]);
}
