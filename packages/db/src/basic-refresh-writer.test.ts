import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

const injected = vi.hoisted(() => ({
  exchangeCommitted: false,
  mode: null as
    | "pre-commit"
    | "native-unverified"
    | "post-sync"
    | "post-verify"
    | "post-close"
    | "cleanup"
    | null,
}));

vi.mock("./cli/basic-candidate-native-fs.js", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("./cli/basic-candidate-native-fs.js")
  >();
  return {
    ...actual,
    renameBasicCandidateDirectoryChildrenExchangeNative(
      ...arguments_: Parameters<
        typeof actual.renameBasicCandidateDirectoryChildrenExchangeNative
      >
    ): ReturnType<typeof actual.renameBasicCandidateDirectoryChildrenExchangeNative> {
      if (injected.mode === "pre-commit") throw new Error("injected pre-commit failure");
      const result = actual.renameBasicCandidateDirectoryChildrenExchangeNative(...arguments_);
      injected.exchangeCommitted = true;
      return injected.mode === "native-unverified"
        ? { committed: true, verified: false }
        : result;
    },
  };
});

vi.mock("./cli/basic-candidate-constrained-fs.js", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("./cli/basic-candidate-constrained-fs.js")
  >();
  return {
    ...actual,
    async syncBasicCandidateParentDirectory(
      ...arguments_: Parameters<typeof actual.syncBasicCandidateParentDirectory>
    ): ReturnType<typeof actual.syncBasicCandidateParentDirectory> {
      if (injected.exchangeCommitted && injected.mode === "post-sync") {
        throw new Error("injected post-commit sync failure");
      }
      return actual.syncBasicCandidateParentDirectory(...arguments_);
    },
    async verifyBasicCandidateRegularFile(
      ...arguments_: Parameters<typeof actual.verifyBasicCandidateRegularFile>
    ): ReturnType<typeof actual.verifyBasicCandidateRegularFile> {
      if (injected.exchangeCommitted && injected.mode === "post-verify") {
        throw new Error("injected post-commit verify failure");
      }
      return actual.verifyBasicCandidateRegularFile(...arguments_);
    },
    async closeBasicCandidateHeldDirectories(
      ...arguments_: Parameters<typeof actual.closeBasicCandidateHeldDirectories>
    ): ReturnType<typeof actual.closeBasicCandidateHeldDirectories> {
      await actual.closeBasicCandidateHeldDirectories(...arguments_);
      if (injected.exchangeCommitted && injected.mode === "post-close") {
        throw new Error("injected post-commit close failure");
      }
    },
  };
});

vi.mock("./cli/basic-refresh-cache-cleanup.js", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("./cli/basic-refresh-cache-cleanup.js")
  >();
  return {
    ...actual,
    async cleanupBasicRefreshTransaction(
      ...arguments_: Parameters<typeof actual.cleanupBasicRefreshTransaction>
    ): ReturnType<typeof actual.cleanupBasicRefreshTransaction> {
      if (injected.exchangeCommitted && injected.mode === "cleanup") {
        throw new Error("injected cleanup failure");
      }
      return actual.cleanupBasicRefreshTransaction(...arguments_);
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
import { locateActiveBasicPublicationSnapshot } from "./cli/basic-active-publication-snapshot.js";
import {
  closeBasicCandidateWorkspace,
  getBasicCandidateWorkspaceRootDirectory,
  openBasicCandidateWorkspace,
} from "./cli/basic-candidate-workspace.js";
import {
  getApprovedBasicPublicationSnapshotState,
  locateApprovedBasicPublicationSnapshot,
} from "./cli/basic-publication-snapshot.js";
import { writeRefreshedBasicPublication } from "./cli/basic-refresh-writer.js";

const roots = new Set<string>();

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.clear();
  injected.exchangeCommitted = false;
  injected.mode = null;
});

describe("authenticated BASIC refresh snapshots", () => {
  test.each(["v2", "v3"] as const)(
    "holds and verifies an active %s exact-three publication",
    async (version) => {
      const setup = createRepo();
      const active = version === "v2"
        ? writeActiveV2(setup.root)
        : writePublicationV3(setup.root, createTarget("run-active", "2026-07-11T00:00:00Z"), true);
      const workspace = await openBasicCandidateWorkspace(setup.root);
      const snapshot = await locateActiveBasicPublicationSnapshot(
        getBasicCandidateWorkspaceRootDirectory(workspace),
        "example-land",
      );
      expect(snapshot).toMatchObject({
        countryDirectory: "example-land",
        countryCode: "XZ",
        runId: "run-active",
        decidedAt: "2026-07-11T00:00:00Z",
      });
      await snapshot.close();
      await snapshot.close();
      await closeBasicCandidateWorkspace(workspace);
      expect(active.runId).toBe("run-active");
    },
  );

  test("fails closed for absent, non-exact, or byte-replaced active publications", async () => {
    const absent = createRepo();
    const absentWorkspace = await openBasicCandidateWorkspace(absent.root);
    await expect(locateActiveBasicPublicationSnapshot(
      getBasicCandidateWorkspaceRootDirectory(absentWorkspace),
      "example-land",
    )).rejects.toThrow(/^active BASIC publication snapshot failed$/);
    await closeBasicCandidateWorkspace(absentWorkspace);

    const extra = createRepo();
    writeActiveV2(extra.root);
    writeFileSync(join(extra.root, "data", "example-land", "unexpected.json"), "{}\n");
    const extraWorkspace = await openBasicCandidateWorkspace(extra.root);
    await expect(locateActiveBasicPublicationSnapshot(
      getBasicCandidateWorkspaceRootDirectory(extraWorkspace),
      "example-land",
    )).rejects.toThrow(/^active BASIC publication snapshot failed$/);
    await closeBasicCandidateWorkspace(extraWorkspace);

    const changed = createRefreshSetup();
    const held = await openSnapshots(changed);
    const countryPath = join(changed.root, "data", "example-land", "country.json");
    writeFileSync(countryPath, readFileSync(countryPath));
    await expect(writeRefreshedBasicPublication(held.active, held.target))
      .rejects.toThrow(/^basic refresh write failed$/);
    await closeSnapshots(held);
  });

  test.each(["receipt", "candidate", "canonical", "candidate-extra"] as const)(
    "rejects invalid active %s state with one fixed error",
    async (kind) => {
      const setup = createRepo();
      writeActiveV2(setup.root);
      const run = join(setup.root, "data", "staging", "example-land", "run-active");
      if (kind === "receipt") {
        const path = join(
          setup.root, "data", "approvals", "example-land", "run-active.json",
        );
        const value = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
        value.decision = "rejected";
        writeFileSync(path, `${JSON.stringify(value)}\n`);
      } else if (kind === "candidate") {
        const path = join(run, "source-register.json");
        writeFileSync(path, `${readFileSync(path, "utf8")} `);
      } else if (kind === "canonical") {
        const path = join(setup.root, "data", "example-land", "country.json");
        const value = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
        value.code = "YY";
        writeFileSync(path, `${JSON.stringify(value)}\n`);
      } else {
        writeFileSync(join(run, "unexpected.json"), "{}\n");
      }
      const workspace = await openBasicCandidateWorkspace(setup.root);
      await expect(locateActiveBasicPublicationSnapshot(
        getBasicCandidateWorkspaceRootDirectory(workspace),
        "example-land",
      )).rejects.toThrow(/^active BASIC publication snapshot failed$/);
      await closeBasicCandidateWorkspace(workspace);
    },
  );
});

describe("atomic BASIC refresh writer", () => {
  test("exchanges an active v2 publication for approved v3 exact bytes", async () => {
    const setup = createRefreshSetup();
    const before = snapshotAuthorization(setup);
    const held = await openSnapshots(setup);

    await expect(writeRefreshedBasicPublication(held.active, held.target)).resolves.toEqual({
      committed: true,
      postCommitVerified: true,
    });

    expect(readCanonical(setup.root)).toEqual(held.serialized);
    expect(snapshotAuthorization(setup)).toEqual(before);
    expect(readdirSync(join(setup.root, "data", "other-country"))).toEqual(["keep.txt"]);
    expect(cacheTransactions(setup.root)).toEqual([]);
    await closeSnapshots(held);
  });

  test("rejects a same-run authenticated target before commit", async () => {
    const setup = createRepo();
    const publication = createTarget("run-active", "2026-07-12T00:00:00Z");
    writePublicationV3(setup.root, publication, true);
    const workspace = await openBasicCandidateWorkspace(setup.root);
    const root = getBasicCandidateWorkspaceRootDirectory(workspace);
    const active = await locateActiveBasicPublicationSnapshot(root, "example-land");
    const target = await locateApprovedBasicPublicationSnapshot(root, {
      countryDirectory: "example-land",
      countryCode: "XZ",
      runId: "run-active",
    });
    const before = readCanonical(setup.root);
    await expect(writeRefreshedBasicPublication(active, target))
      .rejects.toThrow(/^basic refresh write failed$/);
    expect(readCanonical(setup.root)).toEqual(before);
    await target.close();
    await active.close();
    await closeBasicCandidateWorkspace(workspace);
  });

  test("rejects a stale decision before commit and preserves active bytes", async () => {
    const setup = createRefreshSetup("run-target", "2026-07-11T00:00:00Z");
    const before = readCanonical(setup.root);
    const held = await openSnapshots(setup);
    await expect(writeRefreshedBasicPublication(held.active, held.target))
      .rejects.toThrow(/^basic refresh write failed$/);
    expect(readCanonical(setup.root)).toEqual(before);
    expect(cacheTransactions(setup.root)).toEqual([]);
    await closeSnapshots(held);
  });

  test("rejects country identity mismatch before commit", async () => {
    const setup = createRefreshSetup("run-target", "2026-07-12T00:00:00Z", "EX");
    const before = readCanonical(setup.root);
    const held = await openSnapshots(setup);
    await expect(writeRefreshedBasicPublication(held.active, held.target))
      .rejects.toThrow(/^basic refresh write failed$/);
    expect(readCanonical(setup.root)).toEqual(before);
    await closeSnapshots(held);
  });

  test("cleans only its owned target after a native pre-commit failure", async () => {
    const setup = createRefreshSetup();
    const before = readCanonical(setup.root);
    const held = await openSnapshots(setup);
    injected.mode = "pre-commit";
    await expect(writeRefreshedBasicPublication(held.active, held.target))
      .rejects.toThrow(/^basic refresh write failed$/);
    expect(readCanonical(setup.root)).toEqual(before);
    expect(cacheTransactions(setup.root)).toEqual([]);
    await closeSnapshots(held);
  });

  test.each([
    "native-unverified", "post-sync", "post-verify", "post-close", "cleanup",
  ] as const)("never rolls back after committed %s failure", async (mode) => {
    const setup = createRefreshSetup();
    const held = await openSnapshots(setup);
    injected.mode = mode;
    await expect(writeRefreshedBasicPublication(held.active, held.target)).resolves.toEqual({
      committed: true,
      postCommitVerified: false,
    });
    expect(readCanonical(setup.root)).toEqual(held.serialized);
    if (mode === "cleanup") expect(cacheTransactions(setup.root)).toHaveLength(1);
    injected.mode = null;
    await closeSnapshots(held);
  });

  test("requires private cache modes", async () => {
    const setup = createRefreshSetup();
    mkdirSync(join(setup.root, ".cache"), { mode: 0o755 });
    chmodSync(join(setup.root, ".cache"), 0o755);
    const before = readCanonical(setup.root);
    const held = await openSnapshots(setup);
    await expect(writeRefreshedBasicPublication(held.active, held.target))
      .rejects.toThrow(/^basic refresh write failed$/);
    expect(readCanonical(setup.root)).toEqual(before);
    await closeSnapshots(held);
  });
});

type TargetPublication = ReturnType<typeof createTarget>;

function createRepo(): Readonly<{ root: string }> {
  const root = mkdtempSync(join(process.platform === "linux" ? "/tmp" : tmpdir(), "basic-refresh-"));
  roots.add(root);
  mkdirSync(join(root, "packages", "db"), { recursive: true });
  writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "navigator" }));
  writeFileSync(join(root, "packages", "db", "package.json"), JSON.stringify({ name: "@navigator/db" }));
  mkdirSync(join(root, "data", "staging"), { recursive: true });
  mkdirSync(join(root, "data", "other-country"));
  writeFileSync(join(root, "data", "other-country", "keep.txt"), "keep");
  return Object.freeze({ root });
}

function createRefreshSetup(
  runId = "run-target",
  decidedAt = "2026-07-12T00:00:00Z",
  activeCountryCode = "XZ",
) {
  const setup = createRepo();
  writeActiveV2(setup.root, activeCountryCode);
  const target = createTarget(runId, decidedAt);
  writePublicationV3(setup.root, target, false);
  return Object.freeze({ root: setup.root, target });
}

function writeActiveV2(root: string, countryCode = "XZ"): Readonly<{ runId: string }> {
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
  return Object.freeze({ runId });
}

function createTarget(runId: string, decidedAt: string) {
  const base = createBasicCountryPublicationV3Fixture();
  const candidate = replaceAll(base.candidate, {
    [base.candidate.runId]: runId,
  });
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

function writePublicationV3(root: string, target: TargetPublication, active: boolean) {
  writePublication(root, target.candidate, target.bytes, target.approvalBytes, target.manifest, target.canonical, active);
  return Object.freeze({ runId: target.candidate.runId });
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
  const candidateDirectory = join(root, "data", "staging", "example-land", candidate.runId);
  const approvalDirectory = join(root, "data", "approvals", "example-land");
  mkdirSync(candidateDirectory, { recursive: true });
  mkdirSync(approvalDirectory, { recursive: true });
  for (const [name, content] of Object.entries(bytes)) writeFileSync(join(candidateDirectory, name), content);
  writeFileSync(join(approvalDirectory, `${candidate.runId}.json`), approvalBytes);
  if (!active) return;
  const canonicalDirectory = join(root, "data", "example-land");
  mkdirSync(canonicalDirectory, { recursive: true });
  writeFileSync(join(canonicalDirectory, "collection-manifest.json"), encode(manifest));
  writeFileSync(join(canonicalDirectory, "country.json"), encode(canonical.country));
  writeFileSync(join(canonicalDirectory, "market-overview.json"), encode(canonical.marketOverview));
}

async function openSnapshots(setup: ReturnType<typeof createRefreshSetup>) {
  const workspace = await openBasicCandidateWorkspace(setup.root);
  const root = getBasicCandidateWorkspaceRootDirectory(workspace);
  const active = await locateActiveBasicPublicationSnapshot(root, "example-land");
  const target = await locateApprovedBasicPublicationSnapshot(root, {
    countryDirectory: "example-land",
    countryCode: setup.target.candidate.sourceRegister.countryCode,
    runId: setup.target.candidate.runId,
  });
  const serialized = getApprovedBasicPublicationSnapshotState(target).serialized;
  return { workspace, active, target, serialized };
}

async function closeSnapshots(held: Awaited<ReturnType<typeof openSnapshots>>) {
  await held.target.close();
  await held.active.close();
  await closeBasicCandidateWorkspace(held.workspace);
}

function readCanonical(root: string): Readonly<Record<string, Uint8Array>> {
  const directory = join(root, "data", "example-land");
  return Object.fromEntries(readdirSync(directory).sort().map((name) => [
    name, new Uint8Array(readFileSync(join(directory, name))),
  ]));
}

function snapshotAuthorization(setup: ReturnType<typeof createRefreshSetup>) {
  const candidate = join(setup.root, "data", "staging", "example-land", setup.target.candidate.runId);
  const approval = join(setup.root, "data", "approvals", "example-land", `${setup.target.candidate.runId}.json`);
  return {
    candidate: Object.fromEntries(readdirSync(candidate).sort().map((name) => [name, readFileSync(join(candidate, name)).toString("hex")])),
    approval: readFileSync(approval).toString("hex"),
  };
}

function cacheTransactions(root: string): string[] {
  try {
    return readdirSync(join(root, ".cache", "basic-country-refresh"));
  } catch {
    return [];
  }
}

function hashes(bytes: Readonly<Record<string, Uint8Array>>) {
  return Object.fromEntries(Object.entries(bytes).map(([name, content]) => [name, sha256Hex(content)])) as
    BasicCountryPublicationApprovalReceipt["artifactSha256"];
}

function encode(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value)}\n`);
}

function replaceAll<T>(value: T, replacements: Readonly<Record<string, string>>): T {
  let serialized = JSON.stringify(value);
  for (const [from, to] of Object.entries(replacements)) serialized = serialized.replaceAll(from, to);
  return JSON.parse(serialized) as T;
}
