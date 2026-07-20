import {
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

const injectedWriteFailure = vi.hoisted(() => ({
  callCount: 0,
  failOnCall: null as number | null,
}));

vi.mock("./basic-candidate-constrained-fs.js", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("./basic-candidate-constrained-fs.js")
  >();
  return {
    ...actual,
    async writeBasicCandidateExclusiveFile(
      ...arguments_: Parameters<typeof actual.writeBasicCandidateExclusiveFile>
    ): ReturnType<typeof actual.writeBasicCandidateExclusiveFile> {
      injectedWriteFailure.callCount += 1;
      if (injectedWriteFailure.callCount === injectedWriteFailure.failOnCall) {
        throw new Error("injected review file write failure");
      }
      return actual.writeBasicCandidateExclusiveFile(...arguments_);
    },
  };
});

import { createBasicCollectionAuditV3Fixture } from "../basic-collection-v3-test-fixture.js";
import {
  parseBasicReviewPackArguments,
  runBasicReviewPackCli,
  writeBasicReviewPack,
} from "./write-basic-review-pack.js";

const roots = new Set<string>();

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.clear();
  injectedWriteFailure.callCount = 0;
  injectedWriteFailure.failOnCall = null;
});

describe("BASIC review pack CLI", () => {
  test("prints command help without reading or writing project data", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    await expect(runBasicReviewPackCli(["--help"], {
      writeStdout(value) { stdout.push(value); },
      writeStderr(value) { stderr.push(value); },
    })).resolves.toBe(0);
    expect(stdout.join("")).toContain(
      "pnpm basic:review-pack --country=<ISO2> --run-id=<runId>",
    );
    expect(stderr).toEqual([]);
  });

  test("parses exactly one ISO2 country and one safe run ID", () => {
    expect(parseBasicReviewPackArguments(["--country=XZ", "--run-id=run-001"]))
      .toEqual({ countryCode: "XZ", runId: "run-001" });
    expect(() => parseBasicReviewPackArguments(["--country=../XZ", "--run-id=run-001"]))
      .toThrow("basic review pack input is invalid");
    expect(() => parseBasicReviewPackArguments(["--country=XZ", "--run-id=../run-001"]))
      .toThrow("basic review pack input is invalid");
  });

  test("discovers one matching v3 candidate and writes only a local no-replace review directory", async () => {
    const root = createRepo();
    const bundle = createBasicCollectionAuditV3Fixture();
    writeCandidate(root, bundle);
    const candidateBefore = snapshotDirectory(join(root, "data", "staging"));

    const result = await writeBasicReviewPack({
      repoRoot: root,
      countryCode: "XZ",
      runId: bundle.runId,
    });

    expect(result).toEqual({
      status: "written",
      relativeDirectory: `.cache/basic-country/XZ/${bundle.runId}/review`,
    });
    const review = join(root, result.relativeDirectory);
    expect(readdirSync(review).sort()).toEqual(["index.html", "review.json"]);
    expect(readFileSync(join(review, "index.html"), "utf8")).toContain("BASIC 数据审核包");
    expect(JSON.parse(readFileSync(join(review, "review.json"), "utf8"))).toMatchObject({
      countryCode: "XZ", runId: bundle.runId,
    });
    expect(snapshotDirectory(join(root, "data", "staging"))).toEqual(candidateBefore);
    expect(existsSync(join(root, "data", "example-land", "market-overview.json"))).toBe(false);

    await expect(writeBasicReviewPack({
      repoRoot: root, countryCode: "XZ", runId: bundle.runId,
    })).rejects.toThrow("basic review pack write failed");
    expect(readdirSync(join(root, ".cache", "basic-country", "XZ", bundle.runId)))
      .toEqual(["review"]);
  });

  test("fails closed for zero or multiple matching slugs and redacts hostile input", async () => {
    const root = createRepo();
    const bundle = createBasicCollectionAuditV3Fixture();
    await expect(writeBasicReviewPack({
      repoRoot: root, countryCode: "XZ", runId: bundle.runId,
    })).rejects.toThrow(/^basic review pack write failed$/);

    writeCandidate(root, bundle);
    writeCandidate(root, { ...bundle, countryDirectory: "other-land" });
    await expect(writeBasicReviewPack({
      repoRoot: root, countryCode: "XZ", runId: bundle.runId,
    })).rejects.toThrow(/^basic review pack write failed$/);

    await expect(writeBasicReviewPack({
      repoRoot: root, countryCode: "XZ<SECRET>", runId: "run-001",
    })).rejects.toThrow(/^basic review pack write failed$/);
  });

  test("removes the private temporary directory after a partial file write failure", async () => {
    const root = createRepo();
    const bundle = createBasicCollectionAuditV3Fixture();
    writeCandidate(root, bundle);
    injectedWriteFailure.failOnCall = 2;

    await expect(writeBasicReviewPack({
      repoRoot: root, countryCode: "XZ", runId: bundle.runId,
    })).rejects.toThrow(/^basic review pack write failed$/);

    expect(readdirSync(join(root, ".cache", "basic-country", "XZ", bundle.runId)))
      .toEqual([]);
  });

  test("rejects symlinked candidate artifacts through bounded nofollow reads", async () => {
    const root = createRepo();
    const bundle = createBasicCollectionAuditV3Fixture();
    writeCandidate(root, bundle);
    const candidate = join(root, "data", "staging", bundle.countryDirectory, bundle.runId);
    const sourceRegister = join(candidate, "source-register.json");
    const outside = join(root, "outside.json");
    writeFileSync(outside, readFileSync(sourceRegister));
    rmSync(sourceRegister);
    symlinkSync(outside, sourceRegister);

    await expect(writeBasicReviewPack({
      repoRoot: root, countryCode: "XZ", runId: bundle.runId,
    })).rejects.toThrow(/^basic review pack write failed$/);
    expect(existsSync(join(root, ".cache", "basic-country"))).toBe(false);
  });

  test("rejects an isolated canonical market overview without an approved publication", async () => {
    const root = createRepo();
    const bundle = createBasicCollectionAuditV3Fixture();
    writeCandidate(root, bundle);
    const canonical = join(root, "data", bundle.countryDirectory);
    mkdirSync(canonical, { recursive: true });
    writeFileSync(join(canonical, "market-overview.json"), JSON.stringify({
      basicProfile: bundle.marketOverviewDraft.basicProfile,
    }));

    await expect(writeBasicReviewPack({
      repoRoot: root, countryCode: "XZ", runId: bundle.runId,
    })).rejects.toThrow(/^basic review pack write failed$/);
  });

  test("rejects canonical files whose manifest and approval hashes do not validate", async () => {
    const root = createRepo();
    const bundle = createBasicCollectionAuditV3Fixture();
    writeCandidate(root, bundle);
    const canonical = join(root, "data", bundle.countryDirectory);
    mkdirSync(canonical, { recursive: true });
    writeFileSync(join(canonical, "country.json"), "{}\n");
    writeFileSync(join(canonical, "market-overview.json"), JSON.stringify({
      basicProfile: bundle.marketOverviewDraft.basicProfile,
    }));
    writeFileSync(join(canonical, "collection-manifest.json"), JSON.stringify({
      schemaVersion: "basic-country-publication-manifest/v2",
      activeRunId: bundle.runId,
      mappingVersion: "basic-country-canonical/v2",
      auditBundlePath: `data/staging/${bundle.countryDirectory}/${bundle.runId}`,
      approvalReceiptPath: `data/approvals/${bundle.countryDirectory}/${bundle.runId}.json`,
      approvalReceiptSha256: "0".repeat(64),
    }));

    await expect(writeBasicReviewPack({
      repoRoot: root, countryCode: "XZ", runId: bundle.runId,
    })).rejects.toThrow(/^basic review pack write failed$/);
  });
});

function createRepo(): string {
  const root = mkdtempSync(join(
    process.platform === "linux" ? "/tmp" : tmpdir(),
    "basic-review-pack-",
  ));
  roots.add(root);
  mkdirSync(join(root, "packages", "db"), { recursive: true });
  writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "navigator" }));
  writeFileSync(join(root, "packages", "db", "package.json"), JSON.stringify({ name: "@navigator/db" }));
  mkdirSync(join(root, "data", "staging"), { recursive: true });
  return root;
}

function writeCandidate(
  root: string,
  bundle: ReturnType<typeof createBasicCollectionAuditV3Fixture>,
): void {
  const directory = join(root, "data", "staging", bundle.countryDirectory, bundle.runId);
  mkdirSync(directory, { recursive: true });
  const values = {
    "source-register.json": bundle.sourceRegister,
    "extracted-facts.json": bundle.extractedFacts,
    "market-overview.draft.json": bundle.marketOverviewDraft,
    "review-report.json": bundle.reviewReport,
  };
  for (const [name, value] of Object.entries(values)) {
    writeFileSync(join(directory, name), `${JSON.stringify(value)}\n`);
  }
}

function snapshotDirectory(pathname: string): Record<string, string> {
  return Object.fromEntries(readdirSync(pathname, { recursive: true }).map((entry) => {
    const path = join(pathname, String(entry));
    return [String(entry), existsSync(path) && !String(entry).endsWith("/") && !safeIsDirectory(path)
      ? readFileSync(path).toString("hex") : "<directory>"];
  }));
}

function safeIsDirectory(pathname: string): boolean {
  try {
    return readdirSync(pathname).length >= 0;
  } catch {
    return false;
  }
}
