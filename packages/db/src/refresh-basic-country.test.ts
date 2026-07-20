import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

const injected = vi.hoisted(() => ({
  stub: false,
  writerUnverified: false,
  closeFailure: null as "target" | "active" | "workspace" | null,
  openCalls: 0,
  targetCloseCalls: 0,
  activeCloseCalls: 0,
  workspaceCloseCalls: 0,
}));

vi.mock("./cli/basic-candidate-workspace.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./cli/basic-candidate-workspace.js")>();
  return {
    ...actual,
    async openBasicCandidateWorkspace(
      ...args: Parameters<typeof actual.openBasicCandidateWorkspace>
    ): ReturnType<typeof actual.openBasicCandidateWorkspace> {
      injected.openCalls += 1;
      if (injected.stub) return Object.freeze({});
      return actual.openBasicCandidateWorkspace(...args);
    },
    getBasicCandidateWorkspaceRootDirectory(
      ...args: Parameters<typeof actual.getBasicCandidateWorkspaceRootDirectory>
    ): ReturnType<typeof actual.getBasicCandidateWorkspaceRootDirectory> {
      if (injected.stub) return Object.freeze({ marker: "trusted-root" }) as never;
      return actual.getBasicCandidateWorkspaceRootDirectory(...args);
    },
    async closeBasicCandidateWorkspace(
      ...args: Parameters<typeof actual.closeBasicCandidateWorkspace>
    ): ReturnType<typeof actual.closeBasicCandidateWorkspace> {
      injected.workspaceCloseCalls += 1;
      if (!injected.stub) await actual.closeBasicCandidateWorkspace(...args);
      if (injected.closeFailure === "workspace") throw new Error("injected close failure");
    },
  };
});

vi.mock("./cli/basic-active-publication-snapshot.js", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("./cli/basic-active-publication-snapshot.js")
  >();
  return {
    ...actual,
    async locateActiveBasicPublicationSnapshot(
      ...args: Parameters<typeof actual.locateActiveBasicPublicationSnapshot>
    ): ReturnType<typeof actual.locateActiveBasicPublicationSnapshot> {
      if (!injected.stub) return actual.locateActiveBasicPublicationSnapshot(...args);
      return Object.freeze({
        countryDirectory: "example-land",
        countryCode: "XZ",
        runId: "run-active",
        decidedAt: "2026-07-11T00:00:00Z",
        async close(): Promise<void> {
          injected.activeCloseCalls += 1;
          if (injected.closeFailure === "active") throw new Error("injected close failure");
        },
      });
    },
  };
});

vi.mock("./cli/basic-publication-snapshot.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./cli/basic-publication-snapshot.js")>();
  return {
    ...actual,
    async locateApprovedBasicPublicationSnapshot(
      ...args: Parameters<typeof actual.locateApprovedBasicPublicationSnapshot>
    ): ReturnType<typeof actual.locateApprovedBasicPublicationSnapshot> {
      if (!injected.stub) return actual.locateApprovedBasicPublicationSnapshot(...args);
      return Object.freeze({
        countryDirectory: "example-land",
        countryCode: "XZ",
        runId: "run-target",
        decidedAt: "2026-07-12T00:00:00Z",
        async close(): Promise<void> {
          injected.targetCloseCalls += 1;
          if (injected.closeFailure === "target") throw new Error("injected close failure");
        },
      });
    },
  };
});

vi.mock("./cli/basic-refresh-writer.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./cli/basic-refresh-writer.js")>();
  return {
    ...actual,
    async writeRefreshedBasicPublication(
      ...args: Parameters<typeof actual.writeRefreshedBasicPublication>
    ): ReturnType<typeof actual.writeRefreshedBasicPublication> {
      if (injected.stub) {
        return Object.freeze({
          committed: true as const,
          postCommitVerified: !injected.writerUnverified,
        });
      }
      const result = await actual.writeRefreshedBasicPublication(...args);
      return injected.writerUnverified
        ? Object.freeze({ committed: true as const, postCommitVerified: false })
        : result;
    },
  };
});

import {
  createBasicCollectionAuditArtifactsV2,
  serializeBasicCollectionAuditArtifactsV2,
} from "./collection/basic-audit-v2-artifacts.js";
import {
  createBasicCollectionAuditArtifactsV3,
  serializeBasicCollectionAuditArtifactsV3,
} from "./collection/basic-audit-v3-artifacts.js";
import type { BasicCollectionAuditBundleV2 } from "./collection/basic-collection-v2-contracts.js";
import type { BasicCollectionAuditBundleV3 } from "./collection/basic-collection-v3-contracts.js";
import type {
  BasicCountryPublicationApprovalReceipt,
  BasicCountryPublicationManifestV2,
  BasicCountryPublicationManifestV3,
} from "./collection/basic-publication-contracts.js";
import { sha256Hex } from "./collection/basic-publication-digests.js";
import { materializeBasicCanonicalFromApprovedCandidateV2 } from "./collection/basic-publication-materializer.js";
import { materializeBasicCanonicalFromApprovedCandidateV3 } from "./collection/basic-publication-materializer-v3.js";
import { createBasicCollectionAuditV2Fixture } from "./basic-collection-test-fixture.js";
import { createBasicCountryPublicationFixture } from "./basic-publication-test-fixture.js";
import { createBasicCountryPublicationV3Fixture } from "./basic-publication-v3-test-fixture.js";
import {
  parseBasicRefreshArguments,
  refreshBasicCountry,
  runBasicRefreshCli,
} from "./cli/refresh-basic-country.js";

const roots = new Set<string>();

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.clear();
  injected.stub = false;
  injected.writerUnverified = false;
  injected.closeFailure = null;
  injected.openCalls = 0;
  injected.targetCloseCalls = 0;
  injected.activeCloseCalls = 0;
  injected.workspaceCloseCalls = 0;
});

describe("approved BASIC refresh CLI", () => {
  test("exposes the exact root and database package refresh scripts", () => {
    const databasePackage = JSON.parse(readFileSync(
      new URL("../package.json", import.meta.url),
      "utf8",
    )) as { scripts: Record<string, string> };
    const rootPackage = JSON.parse(readFileSync(
      new URL("../../../package.json", import.meta.url),
      "utf8",
    )) as { scripts: Record<string, string> };

    expect(databasePackage.scripts["prebasic:refresh"]).toBe(
      "pnpm run build:basic-candidate-native",
    );
    expect(databasePackage.scripts["basic:refresh"]).toBe(
      "node --conditions=development --experimental-transform-types --import ../../scripts/node-ts-source-hook.mjs src/cli/refresh-basic-country.ts",
    );
    expect(rootPackage.scripts["basic:refresh"]).toBe(
      "pnpm --filter @navigator/db basic:refresh",
    );
  });

  test("prints the exact single-country refresh help", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    expect(await runBasicRefreshCli(["--help"], output(stdout, stderr))).toBe(0);
    expect(stdout.join("")).toBe(
      "Usage: pnpm basic:refresh --country=ID --run-id=<runId> --approval-file=<path>\n",
    );
    expect(stderr).toEqual([]);
  });

  test("accepts exactly one ISO2, run and canonical repository receipt path", () => {
    expect(parseBasicRefreshArguments([
      "--country=XZ",
      "--run-id=run-target",
      "--approval-file=data/approvals/example-land/run-target.json",
    ])).toEqual({
      countryCode: "XZ",
      runId: "run-target",
      countryDirectory: "example-land",
      approvalFile: "data/approvals/example-land/run-target.json",
    });

    const invalidArguments = [
      ["--country=XZ,YY", "--run-id=run-target", "--approval-file=data/approvals/example-land/run-target.json"],
      ["--country=XZ", "--run-id=run-target", "--approval-file=/tmp/run-target.json"],
      ["--country=XZ", "--run-id=run-target", "--approval-file=data/approvals/example-land/../example-land/run-target.json"],
      ["--country=XZ", "--country=YY", "--run-id=run-target"],
      ["--country=XZ", "--run-id=run-target", "positional"],
      ["--country=XZ", "--run-id=run-target", "--unknown=value"],
    ];
    for (const args of invalidArguments) {
      expect(() => parseBasicRefreshArguments(args)).toThrow(
        /^basic refresh input is invalid$/,
      );
    }
  });

  test("writes one exact JSON result and opens one trusted workspace", async () => {
    injected.stub = true;
    const stdout: string[] = [];
    const stderr: string[] = [];

    expect(await runBasicRefreshCli(validArguments(), output(stdout, stderr))).toBe(0);
    expect(stdout.join("")).toBe(`${JSON.stringify({
      status: "refreshed",
      countryCode: "XZ",
      countryDirectory: "example-land",
      previousRunId: "run-active",
      activeRunId: "run-target",
      postCommitVerified: true,
    })}\n`);
    expect(stderr).toEqual([]);
    expect(injected.openCalls).toBe(1);
    expectCloseCalls();
  });

  test("prints committed-but-unverified as refreshed with false", async () => {
    injected.stub = true;
    injected.writerUnverified = true;
    const stdout: string[] = [];
    const stderr: string[] = [];

    expect(await runBasicRefreshCli(validArguments(), output(stdout, stderr))).toBe(0);
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      status: "refreshed",
      previousRunId: "run-active",
      activeRunId: "run-target",
      postCommitVerified: false,
    });
    expect(stderr).toEqual([]);
  });

  test.each(["target", "active", "workspace"] as const)(
    "closes every capability and preserves refreshed false after %s close failure",
    async (capability) => {
      injected.stub = true;
      injected.closeFailure = capability;

      await expect(refreshBasicCountry(stubInput())).resolves.toEqual({
        status: "refreshed",
        countryCode: "XZ",
        countryDirectory: "example-land",
        previousRunId: "run-active",
        activeRunId: "run-target",
        postCommitVerified: false,
      });
      expectCloseCalls();
    },
  );

  test("refreshes a valid active v2 publication to approved v3", async () => {
    const setup = createRefreshSetup();

    await expect(refreshBasicCountry(setup.input)).resolves.toEqual({
      status: "refreshed",
      countryCode: "XZ",
      countryDirectory: "example-land",
      previousRunId: "run-active",
      activeRunId: "run-target",
      postCommitVerified: true,
    });
    expect(JSON.parse(readFileSync(
      join(setup.root, "data", "example-land", "collection-manifest.json"),
      "utf8",
    ))).toEqual(setup.target.manifest);
    expect(readdirSync(join(setup.root, "data", "example-land")).sort()).toEqual([
      "collection-manifest.json", "country.json", "market-overview.json",
    ]);
    expect(heldPathsUnder(setup.root)).toEqual([]);
  });

  test.each([
    "missing-active",
    "same-run",
    "country-mismatch",
    "missing-target-receipt",
    "stale-target",
    "target-hash-drift",
  ] as const)("fails closed with one exact redacted error for %s", async (kind) => {
    const setup = kind === "same-run"
      ? createSameRunSetup()
      : createRefreshSetup(
          kind === "stale-target" ? "2026-07-11T00:00:00Z" : "2026-07-12T00:00:00Z",
          kind === "country-mismatch" ? "EX" : "XZ",
        );
    if (kind === "missing-active") {
      rmSync(join(setup.root, "data", "example-land"), { recursive: true });
    } else if (kind === "missing-target-receipt") {
      rmSync(join(setup.root, setup.input.approvalFile));
    } else if (kind === "target-hash-drift") {
      const receiptPath = join(setup.root, setup.input.approvalFile);
      const receipt = JSON.parse(readFileSync(receiptPath, "utf8")) as
        BasicCountryPublicationApprovalReceipt;
      writeFileSync(receiptPath, encode({
        ...receipt,
        artifactSha256: {
          ...receipt.artifactSha256,
          "source-register.json": "f".repeat(64),
        },
      }));
    }

    await expect(refreshBasicCountry(setup.input)).rejects.toThrow(
      /^basic refresh failed$/,
    );
    expect(heldPathsUnder(setup.root)).toEqual([]);
  });

  test("returns only the exact redacted CLI error before commit", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    expect(await runBasicRefreshCli(["--country=bad"], output(stdout, stderr))).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr.join("")).toBe("basic refresh error\n");
  });
});

type TargetPublication = ReturnType<typeof createTarget>;

function createRefreshSetup(
  decidedAt = "2026-07-12T00:00:00Z",
  activeCountryCode = "XZ",
) {
  const root = createRepo();
  writeActiveV2(root, activeCountryCode);
  const target = createTarget("run-target", decidedAt);
  writePublicationV3(root, target, false);
  return Object.freeze({ root, target, input: input(root, "run-target") });
}

function createSameRunSetup() {
  const root = createRepo();
  const target = createTarget("run-target", "2026-07-12T00:00:00Z");
  writePublicationV3(root, target, true);
  return Object.freeze({ root, target, input: input(root, "run-target") });
}

function createRepo(): string {
  const root = mkdtempSync(join(
    process.platform === "linux" ? "/tmp" : tmpdir(),
    "basic-refresh-cli-",
  ));
  roots.add(root);
  mkdirSync(join(root, "packages", "db"), { recursive: true });
  writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "navigator" }));
  writeFileSync(
    join(root, "packages", "db", "package.json"),
    JSON.stringify({ name: "@navigator/db" }),
  );
  mkdirSync(join(root, "data", "staging"), { recursive: true });
  return root;
}

function writeActiveV2(root: string, countryCode: string): void {
  const runId = "run-active";
  const legacy = countryCode === "EX" ? createBasicCountryPublicationFixture() : null;
  const candidate = replaceAll(
    legacy?.candidate ?? createBasicCollectionAuditV2Fixture(),
    { "run-001": runId },
  );
  const bytes = serializeBasicCollectionAuditArtifactsV2(
    createBasicCollectionAuditArtifactsV2(candidate),
  );
  const approvalReceipt: BasicCountryPublicationApprovalReceipt = {
    schemaVersion: "basic-country-publication-approval/v1",
    countryDirectory: "example-land",
    countryCode,
    runId,
    submission: {
      fromReviewStatus: "draft",
      toReviewStatus: "pending",
      submittedAt: "2026-07-10T00:00:00Z",
    },
    decision: "approved",
    reviewerId: "synthetic-reviewer",
    decidedAt: "2026-07-11T00:00:00Z",
    authorizedPublication: {
      coverageLevel: "BASIC",
      fromReviewStatus: "pending",
      toReviewStatus: "published",
      aiUsable: false,
    },
    artifactSha256: hashes(bytes),
  };
  const approvalBytes = encode(approvalReceipt);
  const manifest: BasicCountryPublicationManifestV2 = {
    schemaVersion: "basic-country-publication-manifest/v2",
    activeRunId: runId,
    mappingVersion: "basic-country-canonical/v2",
    auditBundlePath: `data/staging/example-land/${runId}`,
    approvalReceiptPath: `data/approvals/example-land/${runId}.json`,
    approvalReceiptSha256: sha256Hex(approvalBytes),
  };
  const canonical = materializeBasicCanonicalFromApprovedCandidateV2(candidate, manifest);
  writePublication(root, candidate, bytes, approvalBytes, manifest, canonical);
}

function createTarget(runId: string, decidedAt: string) {
  const base = createBasicCountryPublicationV3Fixture();
  const candidate = replaceAll(base.candidate, { [base.candidate.runId]: runId });
  const bytes = serializeBasicCollectionAuditArtifactsV3(
    createBasicCollectionAuditArtifactsV3(candidate),
  );
  const approvalReceipt: BasicCountryPublicationApprovalReceipt = {
    ...base.approvalReceipt,
    runId,
    submission: { ...base.approvalReceipt.submission, submittedAt: decidedAt },
    decidedAt,
    artifactSha256: hashes(bytes),
  };
  const approvalBytes = encode(approvalReceipt);
  const manifest: BasicCountryPublicationManifestV3 = {
    ...base.manifest,
    activeRunId: runId,
    auditBundlePath: `data/staging/example-land/${runId}`,
    approvalReceiptPath: `data/approvals/example-land/${runId}.json`,
    approvalReceiptSha256: sha256Hex(approvalBytes),
  };
  const canonical = materializeBasicCanonicalFromApprovedCandidateV3(candidate, manifest);
  return Object.freeze({ candidate, bytes, approvalBytes, manifest, canonical });
}

function writePublicationV3(root: string, target: TargetPublication, active: boolean): void {
  writePublication(
    root,
    target.candidate,
    target.bytes,
    target.approvalBytes,
    target.manifest,
    target.canonical,
    active,
  );
}

function writePublication(
  root: string,
  candidate: BasicCollectionAuditBundleV2 | BasicCollectionAuditBundleV3,
  bytes: Readonly<Record<string, Uint8Array>>,
  approvalBytes: Uint8Array,
  manifest: BasicCountryPublicationManifestV2 | BasicCountryPublicationManifestV3,
  canonical: Readonly<{ country: unknown; marketOverview: unknown }>,
  active = true,
): void {
  const candidateDirectory = join(
    root,
    "data",
    "staging",
    "example-land",
    candidate.runId,
  );
  const approvalDirectory = join(root, "data", "approvals", "example-land");
  mkdirSync(candidateDirectory, { recursive: true });
  mkdirSync(approvalDirectory, { recursive: true });
  for (const [name, content] of Object.entries(bytes)) {
    writeFileSync(join(candidateDirectory, name), content);
  }
  writeFileSync(join(approvalDirectory, `${candidate.runId}.json`), approvalBytes);
  if (!active) return;
  const canonicalDirectory = join(root, "data", "example-land");
  mkdirSync(canonicalDirectory, { recursive: true });
  writeFileSync(join(canonicalDirectory, "collection-manifest.json"), encode(manifest));
  writeFileSync(join(canonicalDirectory, "country.json"), encode(canonical.country));
  writeFileSync(
    join(canonicalDirectory, "market-overview.json"),
    encode(canonical.marketOverview),
  );
}

function validArguments(): string[] {
  return [
    "--country=XZ",
    "--run-id=run-target",
    "--approval-file=data/approvals/example-land/run-target.json",
  ];
}

function stubInput() {
  return {
    repoRoot: "/trusted/repository",
    countryCode: "XZ",
    runId: "run-target",
    countryDirectory: "example-land",
    approvalFile: "data/approvals/example-land/run-target.json",
  };
}

function input(repoRoot: string, runId: string) {
  return {
    ...stubInput(),
    repoRoot,
    runId,
    approvalFile: `data/approvals/example-land/${runId}.json`,
  };
}

function output(stdout: string[], stderr: string[]) {
  return {
    writeStdout(value: string): void { stdout.push(value); },
    writeStderr(value: string): void { stderr.push(value); },
  };
}

function expectCloseCalls(): void {
  expect(injected.targetCloseCalls).toBe(1);
  expect(injected.activeCloseCalls).toBe(1);
  expect(injected.workspaceCloseCalls).toBe(1);
}

function heldPathsUnder(root: string): string[] {
  const held: string[] = [];
  for (const name of readdirSync("/proc/self/fd")) {
    try {
      const target = readlinkSync(join("/proc/self/fd", name)).replace(/ \(deleted\)$/, "");
      if (target === root || target.startsWith(`${root}/`)) held.push(target);
    } catch {
      // Descriptors can close between listing and inspection.
    }
  }
  return held.sort();
}

function hashes(bytes: Readonly<Record<string, Uint8Array>>) {
  return Object.fromEntries(Object.entries(bytes).map(([name, content]) => [
    name,
    sha256Hex(content),
  ])) as BasicCountryPublicationApprovalReceipt["artifactSha256"];
}

function encode(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value)}\n`);
}

function replaceAll<T>(value: T, replacements: Readonly<Record<string, string>>): T {
  let serialized = JSON.stringify(value);
  for (const [from, to] of Object.entries(replacements)) {
    serialized = serialized.replaceAll(from, to);
  }
  return JSON.parse(serialized) as T;
}
